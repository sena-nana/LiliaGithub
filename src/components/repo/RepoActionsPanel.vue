<script setup lang="ts">
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FileArchive,
  LoaderCircle,
  Package,
  RefreshCw,
  Upload,
  XCircle,
} from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { invalidateSessionContextSnapshot } from "../../composables/sessionContext";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import {
  getGitHubWorkflowArtifactFilePreview,
  getGitHubWorkflowJobLog,
  getGitHubWorkflowRunDetail,
  listGitHubWorkflowArtifactFiles,
  openUrl,
} from "../../services/workspace/client";
import type {
  GitHubAttachWorkflowArtifactAssetRequest,
  GitHubWorkflowArtifact,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowJob,
  GitHubRelease,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  RepoFilePreview,
} from "../../services/workspace/types";
import {
  isWorkflowRunFailure,
  workflowRunStatusText,
  workflowRunStatusTone,
  type WorkflowRunTone,
} from "../../utils/repoDisplay";
import { buildWorkflowGraph } from "../../utils/workflowGraph";
import { errorExcerptFromLog, workflowFailureSummary } from "../../utils/workflowDiagnostics";
import MarkdownReadme from "./MarkdownReadme.vue";
import { parseWorkflowJobLogSections } from "./workflowLogs";

const props = defineProps<{
  repoFullName: string;
  runs: readonly GitHubWorkflowRun[];
  loading: boolean;
  focusedRunId?: number | null;
  focusedJobId?: number | null;
  draftReleases?: readonly GitHubRelease[];
  attachAssetMutating?: boolean;
}>();

const emit = defineEmits<{
  focusRun: [runId: number | null];
  focusJob: [jobId: number | null];
  refresh: [];
  attachArtifactAsset: [request: GitHubAttachWorkflowArtifactAssetRequest];
}>();

const selectedRunId = ref<number | null>(props.focusedRunId ?? null);
const expandedJobId = ref<number | null>(props.focusedJobId ?? null);
const selectedArtifactId = ref<number | null>(null);
const selectedArtifactPath = ref<string | null>(null);
const detail = ref<GitHubWorkflowRunDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const artifactEntries = ref<Record<number, GitHubWorkflowArtifactEntry[] | undefined>>({});
const artifactLoading = ref<Record<number, boolean | undefined>>({});
const artifactErrors = ref<Record<number, string | undefined>>({});
const artifactPreview = ref<RepoFilePreview | null>(null);
const artifactPreviewLoading = ref(false);
const artifactPreviewError = ref<string | null>(null);
const jobLogs = ref<Record<number, string | undefined>>({});
const jobLogLoading = ref<Record<number, boolean | undefined>>({});
const jobLogErrors = ref<Record<number, string | undefined>>({});
const selectedDraftReleaseId = ref<number | null>(null);
const componentEpoch = useComponentEpoch();
const detailLoader = createLatestAsyncLoader({ componentEpoch });
const artifactPreviewLoader = createLatestAsyncLoader({ componentEpoch });

const selectedRun = computed(() =>
  props.runs.find((run) => run.id === selectedRunId.value) ?? null,
);
const detailRun = computed(() => detail.value?.run ?? selectedRun.value);
const selectedArtifact = computed(() =>
  detail.value?.artifacts.find((artifact) => artifact.id === selectedArtifactId.value) ?? null,
);
const selectedArtifactEntries = computed(() =>
  selectedArtifactId.value == null ? [] : artifactEntries.value[selectedArtifactId.value] ?? [],
);
const totalDuration = computed(() => durationText(detailRun.value?.runStartedAt ?? detailRun.value?.createdAt, detailRun.value?.updatedAt));
const totalArtifacts = computed(() => detail.value?.artifacts.length ?? 0);
const activeJob = computed(() => detail.value?.jobs.find((job) => job.id === expandedJobId.value) ?? null);
const workflowGraph = computed(() => buildWorkflowGraph(detail.value));
const failureSummary = computed(() => workflowFailureSummary(detail.value?.jobs ?? []));
const activeJobLogSections = computed(() => {
  const job = activeJob.value;
  if (!job) return [];
  return parseWorkflowJobLogSections(job, jobLogs.value[job.id] ?? "");
});
const activeJobFailureExcerpt = computed(() => {
  const job = activeJob.value;
  if (!job) return "";
  const failedStep = activeJobLogSections.value.find((section) => section.step.conclusion === "failure") ??
    activeJobLogSections.value.find((section) => isWorkflowRunFailure(section.step));
  return errorExcerptFromLog(failedStep?.content || jobLogs.value[job.id] || "");
});
const draftReleaseTargets = computed(() => props.draftReleases ?? []);
const selectedDraftRelease = computed(() =>
  draftReleaseTargets.value.find((release) => release.id === selectedDraftReleaseId.value) ??
  draftReleaseTargets.value[0] ??
  null,
);
watch(() => props.focusedRunId, (runId) => {
  if (runId == null) {
    clearRunDetail();
    return;
  }
  void selectRun(runId, { emitRoute: false, load: true });
}, { immediate: true });

watch(draftReleaseTargets, (targets) => {
  if (!targets.length) {
    selectedDraftReleaseId.value = null;
    return;
  }
  if (!targets.some((release) => release.id === selectedDraftReleaseId.value)) {
    selectedDraftReleaseId.value = targets[0].id;
  }
}, { immediate: true });

watch(() => props.focusedJobId, (jobId) => {
  expandedJobId.value = jobId ?? null;
}, { immediate: true });

watch(() => props.runs, () => {
  if (!props.runs.length && props.focusedRunId == null) clearRunDetail();
}, { immediate: true });

onBeforeUnmount(() => {
  detailLoader.invalidate();
  artifactPreviewLoader.invalidate();
});

function clearRunDetail() {
  selectedRunId.value = null;
  expandedJobId.value = null;
  selectedArtifactId.value = null;
  selectedArtifactPath.value = null;
  artifactPreview.value = null;
  jobLogs.value = {};
  jobLogLoading.value = {};
  jobLogErrors.value = {};
  detail.value = null;
  detailError.value = null;
  detailLoader.invalidate();
  artifactPreviewLoader.invalidate();
}

async function selectRun(runId: number, options: { emitRoute?: boolean; load?: boolean } = {}) {
  selectedRunId.value = runId;
  expandedJobId.value = props.focusedJobId ?? null;
  selectedArtifactId.value = null;
  selectedArtifactPath.value = null;
  artifactPreview.value = null;
  if (options.emitRoute !== false) emit("focusRun", runId);
  if (options.load !== false) await loadDetail(runId);
}

function closeRunDetail() {
  if (selectedRunId.value != null || detail.value) {
    invalidateSessionContextSnapshot();
  }
  emit("focusRun", null);
}

async function loadDetail(runId: number, force = false) {
  await detailLoader.run(runId, async (loaderRunId) => {
    detailLoading.value = true;
    detailError.value = null;
    try {
      const nextDetail = await getGitHubWorkflowRunDetail(props.repoFullName, runId, { forceRefresh: force });
      if (!detailLoader.isCurrent(loaderRunId) || selectedRunId.value !== runId) return;
      detail.value = nextDetail;
      expandedJobId.value = props.focusedJobId ?? null;
      if (expandedJobId.value != null) {
        const job = nextDetail.jobs.find((item) => item.id === expandedJobId.value);
        if (job) void loadJobLog(job);
      }
    } catch (err) {
      if (!detailLoader.isCurrent(loaderRunId)) return;
      detail.value = null;
      detailError.value = String(err);
    } finally {
      if (detailLoader.isCurrent(loaderRunId)) detailLoading.value = false;
    }
  }, { reusePending: !force });
}

function selectJob(job: GitHubWorkflowJob) {
  expandedJobId.value = job.id;
  emit("focusJob", expandedJobId.value);
  void loadJobLog(job);
}

function closeJobDetail() {
  expandedJobId.value = null;
  emit("focusJob", null);
}

async function loadJobLog(job: GitHubWorkflowJob, force = false) {
  if (!force && jobLogs.value[job.id] != null) return;
  jobLogLoading.value = { ...jobLogLoading.value, [job.id]: true };
  jobLogErrors.value = { ...jobLogErrors.value, [job.id]: undefined };
  try {
    const log = await getGitHubWorkflowJobLog(props.repoFullName, job.id);
    jobLogs.value = { ...jobLogs.value, [job.id]: log.content };
  } catch (err) {
    jobLogErrors.value = { ...jobLogErrors.value, [job.id]: String(err) };
  } finally {
    jobLogLoading.value = { ...jobLogLoading.value, [job.id]: false };
  }
}

async function selectArtifact(artifact: GitHubWorkflowArtifact) {
  selectedArtifactId.value = selectedArtifactId.value === artifact.id ? null : artifact.id;
  selectedArtifactPath.value = null;
  artifactPreview.value = null;
  artifactPreviewError.value = null;
  if (selectedArtifactId.value == null) return;
  await loadArtifactEntries(artifact.id);
}

async function loadArtifactEntries(artifactId: number, force = false) {
  if (!force && artifactEntries.value[artifactId]) return;
  artifactLoading.value = { ...artifactLoading.value, [artifactId]: true };
  artifactErrors.value = { ...artifactErrors.value, [artifactId]: undefined };
  try {
    const entries = await listGitHubWorkflowArtifactFiles(props.repoFullName, artifactId, { forceRefresh: force });
    artifactEntries.value = { ...artifactEntries.value, [artifactId]: entries };
    const firstFile = entries.find((entry) => entry.kind === "file");
    if (firstFile) await selectArtifactFile(firstFile);
  } catch (err) {
    artifactErrors.value = { ...artifactErrors.value, [artifactId]: String(err) };
  } finally {
    artifactLoading.value = { ...artifactLoading.value, [artifactId]: false };
  }
}

async function selectArtifactFile(entry: GitHubWorkflowArtifactEntry) {
  if (entry.kind !== "file" || selectedArtifactId.value == null) return;
  const artifactId = selectedArtifactId.value;
  selectedArtifactPath.value = entry.path;
  await artifactPreviewLoader.run(`${artifactId}:${entry.path}`, async (runId) => {
    artifactPreviewLoading.value = true;
    artifactPreviewError.value = null;
    try {
      const preview = await getGitHubWorkflowArtifactFilePreview(props.repoFullName, artifactId, entry.path);
      if (!artifactPreviewLoader.isCurrent(runId) || selectedArtifactId.value !== artifactId || selectedArtifactPath.value !== entry.path) return;
      artifactPreview.value = preview;
    } catch (err) {
      if (!artifactPreviewLoader.isCurrent(runId)) return;
      artifactPreview.value = null;
      artifactPreviewError.value = String(err);
    } finally {
      if (artifactPreviewLoader.isCurrent(runId)) artifactPreviewLoading.value = false;
    }
  });
}

function runToneClass(run: GitHubWorkflowRun) {
  return `actions-status--${workflowRunStatusTone(run)}`;
}

function runMetaText(run: GitHubWorkflowRun) {
  return [run.name !== run.displayTitle ? run.name : "", run.branch, relativeTime(run.updatedAt)]
    .filter(Boolean)
    .join(" · ");
}

function jobTone(job: GitHubWorkflowJob): WorkflowRunTone {
  return workflowRunStatusTone(job);
}

function statusLabel(item: { status: string; conclusion: string | null }) {
  return workflowRunStatusText(item);
}

function statusIconKind(item: { status: string; conclusion: string | null }) {
  if (isWorkflowRunFailure(item)) return "error";
  if (workflowRunStatusTone(item) === "ok") return "ok";
  return "pending";
}

function parseTime(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function durationText(start: string | null | undefined, end: string | null | undefined) {
  const startMs = parseTime(start);
  const endMs = parseTime(end);
  if (!startMs || !endMs || endMs < startMs) return "-";
  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function relativeTime(value: string | null | undefined) {
  const timestamp = parseTime(value);
  if (!timestamp) return "-";
  const delta = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  return `${Math.floor(delta / day)} 天前`;
}

function formatTime(value: string | null | undefined) {
  const timestamp = parseTime(value);
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString();
}

function workflowEventText(value: string | null | undefined) {
  if (!value) return "-";
  const normalized = value.toLowerCase();
  const labels: Record<string, string> = {
    push: "推送",
    pull_request: "拉取请求",
    workflow_dispatch: "手动触发",
    schedule: "定时触发",
    dynamic: "动态触发",
    release: "发布",
    repository_dispatch: "仓库事件",
  };
  return labels[normalized] ?? value;
}

function workflowStateText(value: string | null | undefined) {
  if (!value) return "-";
  const normalized = value.toLowerCase();
  const labels: Record<string, string> = {
    success: "成功",
    failure: "失败",
    cancelled: "已取消",
    skipped: "已跳过",
    neutral: "无结论",
    timed_out: "超时",
    action_required: "需要操作",
    completed: "已完成",
    queued: "排队中",
    requested: "已请求",
    waiting: "等待中",
    pending: "等待中",
    in_progress: "运行中",
  };
  return labels[normalized] ?? value;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isWindowsInstallerArtifact(entry: GitHubWorkflowArtifactEntry) {
  return entry.kind === "file" && /\.(exe|msi|msix|msixbundle|appx|appxbundle|zip)$/i.test(entry.name || entry.path);
}

function hasAttachableArtifact(entries: readonly GitHubWorkflowArtifactEntry[]) {
  return entries.some(isWindowsInstallerArtifact);
}

function releaseOptionLabel(release: GitHubRelease) {
  return `${release.tagName}${release.name ? ` · ${release.name}` : ""}`;
}

function attachArtifactFile(entry: GitHubWorkflowArtifactEntry) {
  if (!detailRun.value || !selectedArtifact.value || !selectedDraftRelease.value) return;
  emit("attachArtifactAsset", {
    runId: detailRun.value.id,
    artifactId: selectedArtifact.value.id,
    artifactName: selectedArtifact.value.name,
    artifactPath: entry.path,
    releaseId: selectedDraftRelease.value.id,
    expectedTagName: selectedDraftRelease.value.tagName,
    label: "Windows",
  });
}
</script>

<template>
  <div class="actions-panel" :class="{ 'is-detail': focusedRunId != null }">
    <aside v-if="focusedRunId == null" class="actions-panel__runs" aria-label="Actions 运行列表">
      <div class="actions-panel__runs-head">
        <div>
          <strong>运行</strong>
          <span>{{ runs.length }} 条运行</span>
        </div>
        <button type="button" class="ghost actions-icon-btn" data-agent-id="repo.actions.refresh" aria-label="刷新 Actions" title="刷新" @click="emit('refresh')">
          <LoaderCircle v-if="loading" :size="14" aria-hidden="true" class="sb-spin" />
          <RefreshCw v-else :size="14" aria-hidden="true" />
        </button>
      </div>
      <p v-if="loading && !runs.length" class="muted actions-empty">正在读取 GitHub Actions。</p>
      <button
        v-for="run in runs"
        :key="run.id"
        type="button"
        class="actions-run repo-list-row"
        :class="{ 'is-active': selectedRunId === run.id }"
        :data-run-id="run.id"
        :data-agent-id="`repo.actions.run.${run.id}`"
        @click="selectRun(run.id, { load: false })"
      >
        <span class="actions-status repo-list-row__status" :class="runToneClass(run)" :title="workflowRunStatusText(run)" :aria-label="workflowRunStatusText(run)">
          <XCircle v-if="statusIconKind(run) === 'error'" :size="15" aria-hidden="true" />
          <CheckCircle2 v-else-if="statusIconKind(run) === 'ok'" :size="15" aria-hidden="true" />
          <CircleDot v-else :size="15" aria-hidden="true" />
        </span>
        <span class="actions-run__body repo-list-row__body">
          <strong class="repo-list-row__title">{{ run.displayTitle }}</strong>
          <span class="actions-run__meta repo-list-row__meta">{{ runMetaText(run) }}</span>
        </span>
      </button>
      <p v-if="!runs.length && !loading" class="muted actions-empty">没有 GitHub Actions 运行记录。</p>
    </aside>

    <section v-else class="actions-panel__detail" aria-label="Actions 详情">
      <p v-if="!detailRun && !detailLoading" class="muted actions-empty">选择一个 run 查看详情。</p>
      <template v-else>
        <header class="actions-detail-head">
          <div class="actions-detail-title">
            <button type="button" class="ghost actions-icon-btn" data-agent-id="repo.actions.detail.back" aria-label="返回 Actions 运行列表" title="返回 Runs" @click="closeRunDetail">
              <ArrowLeft :size="14" aria-hidden="true" />
            </button>
            <span
              class="actions-status"
              :class="detailRun ? runToneClass(detailRun) : ''"
              :aria-label="detailRun ? workflowRunStatusText(detailRun) : 'Actions 状态'"
              :title="detailRun ? workflowRunStatusText(detailRun) : 'Actions 状态'"
            >
              <XCircle v-if="detailRun && statusIconKind(detailRun) === 'error'" :size="16" aria-hidden="true" />
              <CheckCircle2 v-else-if="detailRun && statusIconKind(detailRun) === 'ok'" :size="16" aria-hidden="true" />
              <CircleDot v-else :size="16" aria-hidden="true" />
            </span>
          </div>
          <button v-if="detailRun?.htmlUrl" type="button" class="ghost actions-icon-btn" data-agent-id="repo.actions.detail.open-github" aria-label="打开 GitHub" title="打开 GitHub" @click="openUrl(detailRun.htmlUrl)">
            <ExternalLink :size="14" aria-hidden="true" />
          </button>
        </header>

        <div class="actions-summary">
          <div class="actions-summary-title">
            <h3>{{ detailRun?.displayTitle ?? "Actions" }}</h3>
            <span>
              运行 #{{ detailRun?.runNumber ?? detailRun?.id }} · 工作流：{{ detailRun?.name ?? "-" }} · 分支：{{ detailRun?.branch ?? "-" }}
            </span>
          </div>
          <div>
            <span>触发者</span>
            <strong>{{ detailRun?.actor ?? detailRun?.event ?? "-" }}</strong>
            <small>{{ workflowEventText(detailRun?.event) }} · {{ relativeTime(detailRun?.createdAt) }}</small>
          </div>
          <div>
            <span>状态</span>
            <strong>{{ detailRun ? statusLabel(detailRun) : "-" }}</strong>
            <small>{{ workflowStateText(detailRun?.conclusion ?? detailRun?.status) }}</small>
          </div>
          <div>
            <span>总耗时</span>
            <strong>{{ totalDuration }}</strong>
            <small>{{ formatTime(detailRun?.runStartedAt ?? detailRun?.createdAt) }}</small>
          </div>
          <div>
            <span>产物</span>
            <strong>{{ totalArtifacts }}</strong>
            <small>{{ totalArtifacts ? "可预览" : "无产物" }}</small>
          </div>
        </div>

        <section
          v-if="failureSummary.failedJobs.length || failureSummary.failedSteps.length"
          class="actions-failure-panel"
          aria-label="失败诊断"
        >
          <div class="actions-section-head">
            <strong>失败诊断</strong>
            <span>{{ failureSummary.failedJobs.length }} 个 job / {{ failureSummary.failedSteps.length }} 个 step</span>
          </div>
          <button
            v-for="{ job, step } in failureSummary.failedSteps"
            :key="`${job.id}:${step.number}`"
            type="button"
            class="actions-failure-row"
            :data-agent-id="`repo.actions.failure.${job.id}.${step.number}`"
            @click="selectJob(job)"
          >
            <XCircle :size="14" aria-hidden="true" />
            <span>
              <strong>{{ step.name }}</strong>
              <small>{{ job.name }} · {{ statusLabel(step) }}</small>
            </span>
          </button>
          <p v-if="!failureSummary.failedSteps.length" class="muted actions-empty">
            失败集中在 job 级别，打开失败 job 查看日志。
          </p>
        </section>

        <p v-if="detailLoading" class="muted actions-empty">正在读取 run 详情。</p>
        <p v-if="detailError" class="repo-error">{{ detailError }}</p>

        <div v-if="detail" class="actions-detail-grid">
          <section v-if="!activeJob" class="actions-workflow" aria-label="Actions 流程">
            <div class="actions-section-head">
              <strong>流程</strong>
              <span>{{ detail.jobs.length }} 个任务</span>
            </div>
            <div class="actions-job-flow">
              <div
                class="actions-job-graph"
                :style="{ '--actions-graph-width': `${workflowGraph.width}px`, '--actions-graph-height': `${workflowGraph.height}px` }"
              >
                <svg
                  class="actions-job-graph__svg"
                  :width="workflowGraph.width"
                  :height="workflowGraph.height"
                  :viewBox="`0 0 ${workflowGraph.width} ${workflowGraph.height}`"
                  aria-hidden="true"
                >
                  <path
                    v-for="edge in workflowGraph.edges"
                    :key="edge.id"
                    class="actions-job-graph__edge"
                    :d="edge.path"
                    :stroke="edge.color"
                  />
                </svg>
                <button
                  v-for="node in workflowGraph.nodes"
                  :key="node.id"
                  type="button"
                  class="actions-job-node"
                  :class="[{ 'is-active': expandedJobId === node.job.id }, `actions-job-node--${node.tone}`]"
                  :data-job-id="node.job.id"
                  :data-agent-id="`repo.actions.job.${node.job.id}`"
                  :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${workflowGraph.nodeWidth}px`, minHeight: `${workflowGraph.nodeHeight}px` }"
                  :title="`${node.job.name} · ${statusLabel(node.job)} · ${durationText(node.job.startedAt, node.job.completedAt)}`"
                  @click="selectJob(node.job)"
                >
                  <span class="actions-status" :class="`actions-status--${node.tone}`">
                    <XCircle v-if="statusIconKind(node.job) === 'error'" :size="17" aria-hidden="true" />
                    <CheckCircle2 v-else-if="statusIconKind(node.job) === 'ok'" :size="17" aria-hidden="true" />
                    <CircleDot v-else :size="17" aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{{ node.job.name }}</strong>
                    <small>{{ statusLabel(node.job) }} · {{ durationText(node.job.startedAt, node.job.completedAt) }}</small>
                  </span>
                </button>
              </div>
            </div>
          </section>

          <section v-else class="actions-jobs" aria-label="Job 步骤">
            <div class="actions-section-head">
              <button type="button" class="ghost actions-flow-back" data-agent-id="repo.actions.job.back" @click="closeJobDetail">
                <ArrowLeft :size="14" aria-hidden="true" />
                <span>返回流程</span>
              </button>
              <span>{{ activeJob.steps.length }} steps</span>
            </div>
            <article class="actions-job" :data-job-id="activeJob.id">
              <div class="actions-job__head is-active">
                <span class="actions-status" :class="`actions-status--${jobTone(activeJob)}`">
                  <XCircle v-if="statusIconKind(activeJob) === 'error'" :size="15" aria-hidden="true" />
                  <CheckCircle2 v-else-if="statusIconKind(activeJob) === 'ok'" :size="15" aria-hidden="true" />
                  <CircleDot v-else :size="15" aria-hidden="true" />
                </span>
                <span class="actions-job__title">
                  <strong>{{ activeJob.name }}</strong>
                  <small>{{ statusLabel(activeJob) }} · {{ durationText(activeJob.startedAt, activeJob.completedAt) }}</small>
                </span>
              </div>
              <div class="actions-steps">
                <div
                  v-for="step in activeJob.steps"
                  :key="step.number"
                  class="actions-step"
                >
                  <div class="actions-step__head actions-step__head--static">
                    <span class="actions-status" :class="`actions-status--${workflowRunStatusTone(step)}`">
                      <XCircle v-if="statusIconKind(step) === 'error'" :size="14" aria-hidden="true" />
                      <CheckCircle2 v-else-if="statusIconKind(step) === 'ok'" :size="14" aria-hidden="true" />
                      <CircleDot v-else :size="14" aria-hidden="true" />
                    </span>
                    <span>{{ step.name }}</span>
                    <small>{{ durationText(step.startedAt, step.completedAt) }}</small>
                  </div>
                </div>
              </div>
              <div class="actions-job-log-diagnostic">
                <p v-if="jobLogLoading[activeJob.id]" class="muted actions-empty">正在读取 job 日志。</p>
                <p v-else-if="jobLogErrors[activeJob.id]" class="repo-error">{{ jobLogErrors[activeJob.id] }}</p>
                <template v-else-if="activeJobFailureExcerpt">
                  <strong>错误片段</strong>
                  <pre>{{ activeJobFailureExcerpt }}</pre>
                </template>
                <p v-else-if="jobLogs[activeJob.id]" class="muted actions-empty">日志已读取，未识别到明显错误片段。</p>
                <button type="button" class="ghost" data-agent-id="repo.actions.job.log.refresh" @click="loadJobLog(activeJob, true)">刷新日志</button>
              </div>
            </article>
          </section>

          <section class="actions-artifacts" aria-label="Artifacts">
            <div class="actions-section-head">
              <strong>产物</strong>
              <span>{{ detail.artifacts.length }} 项</span>
            </div>
            <p v-if="!detail.artifacts.length" class="muted actions-empty">没有产物。</p>
            <button
              v-for="artifact in detail.artifacts"
              :key="artifact.id"
              type="button"
              class="actions-artifact"
              :class="{ 'is-active': selectedArtifactId === artifact.id }"
              :data-agent-id="`repo.actions.artifact.${artifact.id}`"
              @click="selectArtifact(artifact)"
            >
              <Package :size="15" aria-hidden="true" />
              <span>
                <strong>{{ artifact.name }}</strong>
                <small>{{ formatBytes(artifact.sizeInBytes) }} · {{ artifact.expired ? "已过期" : `过期 ${formatTime(artifact.expiresAt)}` }}</small>
              </span>
            </button>
            <div v-if="selectedArtifact" class="actions-artifact-detail">
              <p v-if="artifactLoading[selectedArtifact.id]" class="muted actions-empty">正在下载并读取 artifact。</p>
              <p v-if="artifactErrors[selectedArtifact.id]" class="repo-error">{{ artifactErrors[selectedArtifact.id] }}</p>
              <div v-if="selectedArtifactEntries.length" class="actions-artifact-browser">
                <div class="actions-artifact-files">
                  <div
                    v-for="entry in selectedArtifactEntries"
                    :key="entry.path"
                    class="actions-artifact-file-row"
                    :class="{ 'is-active': selectedArtifactPath === entry.path }"
                  >
                    <button
                      type="button"
                      class="actions-artifact-file-select"
                      :disabled="entry.kind !== 'file'"
                      :data-agent-id="`repo.actions.artifact.file.${entry.path}`"
                      @click="selectArtifactFile(entry)"
                    >
                      <FileArchive :size="14" aria-hidden="true" />
                      <span>{{ entry.path }}</span>
                      <small>{{ entry.kind === "file" ? formatBytes(entry.size) : "目录" }}</small>
                    </button>
                    <button
                      v-if="isWindowsInstallerArtifact(entry)"
                      type="button"
                      class="ghost actions-artifact-attach"
                      :disabled="!selectedDraftRelease || attachAssetMutating"
                      :data-agent-id="`repo.actions.artifact.attach.${entry.name}`"
                      :aria-label="`附加 ${entry.name} 到 draft release`"
                      :title="selectedDraftRelease ? `附加到 ${selectedDraftRelease.tagName}` : '没有 draft release'"
                      @click="attachArtifactFile(entry)"
                    >
                      <Upload :size="13" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div class="actions-artifact-preview">
                  <div v-if="hasAttachableArtifact(selectedArtifactEntries)" class="actions-artifact-release-target">
                    <label>
                      <span>Draft Release</span>
                      <select v-model.number="selectedDraftReleaseId" data-agent-id="repo.actions.artifact.release-target" :disabled="!draftReleaseTargets.length || attachAssetMutating">
                        <option v-for="release in draftReleaseTargets" :key="release.id" :value="release.id">
                          {{ releaseOptionLabel(release) }}
                        </option>
                      </select>
                    </label>
                  </div>
                  <p v-if="artifactPreviewLoading" class="muted actions-empty">正在预览文件。</p>
                  <p v-else-if="artifactPreviewError" class="repo-error">{{ artifactPreviewError }}</p>
                  <MarkdownReadme
                    v-else-if="artifactPreview?.previewKind === 'markdown'"
                    :content="artifactPreview.content ?? ''"
                    :images="{}"
                  />
                  <img v-else-if="artifactPreview?.previewKind === 'image' && artifactPreview.dataUrl" :src="artifactPreview.dataUrl" :alt="artifactPreview.name" />
                  <pre v-else-if="artifactPreview?.previewKind === 'text'">{{ artifactPreview.content }}</pre>
                  <p v-else-if="artifactPreview?.previewKind === 'tooLarge'" class="muted actions-empty">文件超过 1 MB，已跳过内置预览。</p>
                  <p v-else-if="artifactPreview" class="muted actions-empty">二进制文件不可预览。</p>
                  <p v-else class="muted actions-empty">选择 artifact 文件预览内容。</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.actions-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.actions-panel__runs,
.actions-panel__detail {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.actions-panel__runs {
  display: grid;
  align-content: start;
  gap: 6px;
  padding-right: 4px;
}

.actions-panel__runs-head,
.actions-detail-head,
.actions-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.actions-panel__runs-head {
  min-height: 34px;
  padding: 0 2px 6px;
  border-bottom: 1px solid var(--border-soft);
}

.actions-panel__runs-head div,
.actions-section-head {
  display: grid;
  gap: 2px;
}

.actions-panel__runs-head strong,
.actions-section-head strong {
  color: var(--text);
  font-size: 13px;
}

.actions-panel__runs-head span,
.actions-section-head span {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-job__head,
.actions-step__head,
.actions-job-node,
.actions-artifact,
.actions-artifact-file-select {
  display: grid;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
}

.actions-run {
  min-height: 36px;
  padding: 7px 8px;
}

.actions-job-node:hover,
.actions-artifact:hover,
.actions-artifact-file-select:hover:not(:disabled),
.actions-artifact-attach:hover:not(:disabled) {
  background: var(--bg-hover);
}

.actions-job__head.is-active,
.actions-job-node.is-active,
.actions-artifact.is-active,
.actions-artifact-file-row.is-active .actions-artifact-file-select {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border-strong));
  background: var(--accent-soft);
}

.actions-job__title,
.actions-job-node span,
.actions-artifact span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.actions-run__meta {
  min-width: max-content;
}

.actions-job strong,
.actions-job-node strong,
.actions-artifact strong,
.actions-job small,
.actions-job-node small,
.actions-artifact small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-job strong,
.actions-job-node strong,
.actions-artifact strong {
  font-size: 13px;
  font-weight: 600;
}

.actions-run__meta,
.actions-job small,
.actions-job-node small,
.actions-artifact small {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-panel__detail {
  display: grid;
  align-content: start;
  gap: 12px;
}

.actions-detail-title {
  display: grid;
  grid-template-columns: 30px 20px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.actions-summary-title h3 {
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-detail-title span,
.actions-summary-title span {
  color: var(--text-muted);
  font-size: 12px;
}

.actions-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 2px 0 8px;
  border-bottom: 1px solid var(--border-soft);
}

.actions-summary div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.actions-summary-title {
  grid-column: 1 / -1;
  gap: 4px;
  padding-bottom: 4px;
}

.actions-summary span,
.actions-summary small {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-summary strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  min-height: 0;
}

.actions-failure-panel,
.actions-job-log-diagnostic {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--err-soft);
  border-radius: var(--radius-sm);
  background: var(--err-soft);
}

.actions-failure-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--err);
  text-align: left;
}

.actions-failure-row:hover,
.actions-failure-row:focus-visible {
  border-color: var(--err);
}

.actions-failure-row span,
.actions-job-log-diagnostic {
  min-width: 0;
}

.actions-failure-row strong,
.actions-failure-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-failure-row small {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-job-log-diagnostic strong {
  color: var(--err);
  font-size: 12px;
}

.actions-job-log-diagnostic pre {
  max-height: 180px;
  margin: 0;
  overflow: auto;
  color: var(--text);
  font-size: 12px;
  white-space: pre-wrap;
}

.actions-jobs,
.actions-workflow,
.actions-artifacts {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}

.actions-job,
.actions-artifact-detail {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.actions-job__head {
  grid-template-columns: 18px minmax(0, 1fr);
  min-height: 42px;
  padding: 8px;
}

.actions-chevron {
  color: var(--text-muted);
  transition: transform 0.15s ease;
}

.actions-chevron.is-open {
  transform: rotate(90deg);
}

.actions-steps {
  display: grid;
  gap: 4px;
  padding: 0 8px 8px 28px;
}

.actions-step__head {
  grid-template-columns: 18px minmax(0, 1fr) auto;
  min-height: 32px;
  padding: 6px;
}

.actions-step__head--static {
  cursor: default;
}

.actions-step__head > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-job-flow {
  min-width: 0;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg);
}

.actions-job-graph {
  position: relative;
  width: var(--actions-graph-width);
  min-width: 100%;
  height: var(--actions-graph-height);
}

.actions-job-graph__svg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: visible;
  pointer-events: none;
}

.actions-job-graph__edge {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  opacity: 0.86;
}

.actions-job-node {
  position: absolute;
  z-index: 1;
  grid-template-columns: 20px minmax(0, 1fr);
  min-height: 58px;
  padding: 10px;
  border-color: var(--border);
  background: var(--bg-elev);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 70%, transparent);
}

.actions-job-node--ok {
  border-color: color-mix(in srgb, var(--ok) 34%, var(--border));
}

.actions-job-node--error {
  border-color: color-mix(in srgb, var(--err) 34%, var(--border));
}

.actions-job-node--warn {
  border-color: color-mix(in srgb, var(--warn) 36%, var(--border));
}

.actions-job-node--muted {
  border-color: var(--border);
}

.actions-flow-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: max-content;
  min-height: 28px;
}

.actions-log {
  margin: 4px 0 8px 34px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.actions-log__note {
  margin: 0;
  padding: 8px 10px 0;
}

.actions-log pre,
.actions-artifact-preview pre {
  max-height: 360px;
  margin: 0;
  overflow: auto;
  padding: 10px;
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.actions-artifact {
  grid-template-columns: 18px minmax(0, 1fr);
  min-height: 44px;
  padding: 8px;
}

.actions-artifact-detail {
  display: grid;
  gap: 8px;
  padding: 8px;
}

.actions-artifact-browser {
  display: grid;
  grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
  gap: 8px;
  min-height: 260px;
}

.actions-artifact-files {
  display: grid;
  align-content: start;
  gap: 4px;
  min-width: 0;
  max-height: 360px;
  overflow: auto;
}

.actions-artifact-file-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  gap: 4px;
  min-width: 0;
}

.actions-artifact-file-select {
  grid-template-columns: 16px minmax(0, 1fr);
  padding: 7px;
}

.actions-artifact-file-select:disabled {
  cursor: default;
  opacity: 0.58;
}

.actions-artifact-files span,
.actions-artifact-files small {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-artifact-files small {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-artifact-attach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
}

.actions-artifact-release-target {
  padding: 8px;
  border-bottom: 1px solid var(--border-soft);
}

.actions-artifact-release-target label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 11px;
}

.actions-artifact-release-target select {
  width: 100%;
  min-width: 0;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 12px;
}

.actions-artifact-preview {
  min-width: 0;
  max-height: 420px;
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.actions-artifact-preview img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
  padding: 10px;
}

.actions-artifact-preview :deep(.readme-render) {
  padding: 10px;
}

.actions-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.actions-status--ok {
  color: var(--ok);
}

.actions-status--error {
  color: var(--err);
}

.actions-status--warn {
  color: var(--warn);
}

.actions-status--muted {
  color: var(--text-muted);
}

.actions-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
}

.actions-empty {
  margin: 0;
  padding: 10px;
}

@media (max-width: 980px) {
  .actions-panel,
  .actions-detail-grid,
  .actions-artifact-browser {
    grid-template-columns: 1fr;
  }

  .actions-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
