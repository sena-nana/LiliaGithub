<script setup lang="ts">
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileArchive,
  LoaderCircle,
  Package,
  RefreshCw,
  XCircle,
} from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import {
  getGitHubWorkflowArtifactFilePreview,
  getGitHubWorkflowRunDetail,
  listGitHubWorkflowArtifactFiles,
  openUrl,
} from "../../services/workspace/client";
import type {
  GitHubWorkflowArtifact,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowJob,
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
import MarkdownReadme from "./MarkdownReadme.vue";

const props = defineProps<{
  repoFullName: string;
  runs: readonly GitHubWorkflowRun[];
  loading: boolean;
  focusedRunId?: number | null;
  focusedJobId?: number | null;
}>();

const emit = defineEmits<{
  focusRun: [runId: number | null];
  focusJob: [jobId: number | null];
  refresh: [];
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
const detailLoader = createLatestAsyncLoader();
const artifactPreviewLoader = createLatestAsyncLoader();

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
watch(() => props.focusedRunId, (runId) => {
  if (runId == null) {
    clearRunDetail();
    return;
  }
  void selectRun(runId, { emitRoute: false, load: true });
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
}

function closeJobDetail() {
  expandedJobId.value = null;
  emit("focusJob", null);
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
</script>

<template>
  <div class="actions-panel" :class="{ 'is-detail': focusedRunId != null }">
    <aside v-if="focusedRunId == null" class="actions-panel__runs" aria-label="Actions 运行列表">
      <div class="actions-panel__runs-head">
        <div>
          <strong>运行</strong>
          <span>{{ runs.length }} 条运行</span>
        </div>
        <button type="button" class="ghost actions-icon-btn" aria-label="刷新 Actions" title="刷新" @click="emit('refresh')">
          <LoaderCircle v-if="loading" :size="14" aria-hidden="true" class="sb-spin" />
          <RefreshCw v-else :size="14" aria-hidden="true" />
        </button>
      </div>
      <p v-if="loading && !runs.length" class="muted actions-empty">正在读取 GitHub Actions。</p>
      <button
        v-for="run in runs"
        :key="run.id"
        type="button"
        class="actions-run"
        :class="{ 'is-active': selectedRunId === run.id }"
        :data-run-id="run.id"
        @click="selectRun(run.id, { load: false })"
      >
        <span class="actions-status" :class="runToneClass(run)" :title="workflowRunStatusText(run)" :aria-label="workflowRunStatusText(run)">
          <XCircle v-if="statusIconKind(run) === 'error'" :size="15" aria-hidden="true" />
          <CheckCircle2 v-else-if="statusIconKind(run) === 'ok'" :size="15" aria-hidden="true" />
          <CircleDot v-else :size="15" aria-hidden="true" />
        </span>
        <span class="actions-run__body">
          <strong>{{ run.displayTitle }}</strong>
          <span>{{ run.name }} · {{ run.branch }} · {{ relativeTime(run.updatedAt) }}</span>
        </span>
      </button>
      <p v-if="!runs.length && !loading" class="muted actions-empty">没有 GitHub Actions 运行记录。</p>
    </aside>

    <section v-else class="actions-panel__detail" aria-label="Actions 详情">
      <p v-if="!detailRun && !detailLoading" class="muted actions-empty">选择一个 run 查看详情。</p>
      <template v-else>
        <header class="actions-detail-head">
          <div class="actions-detail-title">
            <button type="button" class="ghost actions-icon-btn" aria-label="返回 Actions 运行列表" title="返回 Runs" @click="closeRunDetail">
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
          <button v-if="detailRun?.htmlUrl" type="button" class="ghost actions-icon-btn" aria-label="打开 GitHub" title="打开 GitHub" @click="openUrl(detailRun.htmlUrl)">
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

        <p v-if="detailLoading" class="muted actions-empty">正在读取 run 详情。</p>
        <p v-if="detailError" class="repo-error">{{ detailError }}</p>

        <div v-if="detail" class="actions-detail-grid">
          <section v-if="!activeJob" class="actions-workflow" aria-label="Actions 流程">
            <div class="actions-section-head">
              <strong>流程</strong>
              <span>{{ detail.jobs.length }} 个任务</span>
            </div>
            <div class="actions-job-flow">
              <div class="actions-job-flow__nodes">
                <button
                  v-for="job in detail.jobs"
                  :key="job.id"
                  type="button"
                  class="actions-job-node"
                  :data-job-id="job.id"
                  @click="selectJob(job)"
                >
                  <span class="actions-status" :class="`actions-status--${jobTone(job)}`">
                    <XCircle v-if="statusIconKind(job) === 'error'" :size="17" aria-hidden="true" />
                    <CheckCircle2 v-else-if="statusIconKind(job) === 'ok'" :size="17" aria-hidden="true" />
                    <CircleDot v-else :size="17" aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{{ job.name }}</strong>
                    <small>{{ statusLabel(job) }} · {{ durationText(job.startedAt, job.completedAt) }}</small>
                  </span>
                  <ChevronRight :size="15" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>

          <section v-else class="actions-jobs" aria-label="Job 步骤">
            <div class="actions-section-head">
              <button type="button" class="ghost actions-flow-back" @click="closeJobDetail">
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
                  <button
                    v-for="entry in selectedArtifactEntries"
                    :key="entry.path"
                    type="button"
                    :disabled="entry.kind !== 'file'"
                    :class="{ 'is-active': selectedArtifactPath === entry.path }"
                    @click="selectArtifactFile(entry)"
                  >
                    <FileArchive :size="14" aria-hidden="true" />
                    <span>{{ entry.path }}</span>
                    <small>{{ entry.kind === "file" ? formatBytes(entry.size) : "目录" }}</small>
                  </button>
                </div>
                <div class="actions-artifact-preview">
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

.actions-run,
.actions-job__head,
.actions-step__head,
.actions-job-node,
.actions-artifact,
.actions-artifact-files button {
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
  grid-template-columns: 18px minmax(0, 1fr);
  min-height: 48px;
  padding: 8px;
}

.actions-run:hover,
.actions-job-node:hover,
.actions-artifact:hover,
.actions-artifact-files button:hover:not(:disabled) {
  background: var(--bg-hover);
}

  .actions-run.is-active,
  .actions-job__head.is-active,
  .actions-job-node.is-active,
  .actions-artifact.is-active,
  .actions-artifact-files button.is-active {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border-strong));
  background: var(--accent-soft);
}

.actions-run__body,
.actions-job__title,
.actions-job-node span,
.actions-artifact span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.actions-run strong,
.actions-job strong,
.actions-job-node strong,
.actions-artifact strong,
.actions-run span,
.actions-job small,
.actions-job-node small,
.actions-artifact small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-run strong,
.actions-job strong,
.actions-job-node strong,
.actions-artifact strong {
  font-size: 13px;
  font-weight: 600;
}

.actions-run span,
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
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 4px 0 0;
  border-left: 1px solid var(--border-soft);
}

.actions-job-flow__nodes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 280px));
  gap: 12px;
  align-items: start;
  padding-left: 12px;
}

.actions-job-node {
  grid-template-columns: 20px minmax(0, 1fr) 16px;
  min-height: 58px;
  padding: 10px;
  border-color: var(--border);
  background: var(--bg-elev);
}

.actions-job-node svg:last-child {
  color: var(--text-muted);
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

.actions-artifact-files button {
  grid-template-columns: 16px minmax(0, 1fr);
  padding: 7px;
}

.actions-artifact-files button:disabled {
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
