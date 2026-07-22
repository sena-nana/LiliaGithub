<script setup lang="ts">
import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ExternalLink,
  RotateCcw,
  ScrollText,
  XCircle,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import {
  getGitHubWorkflowJobLog,
  openUrl,
  rerunFailedGitHubWorkflowRun,
  rerunGitHubWorkflowJob,
} from "../../services/workspace/client";
import type { GitHubWorkflowJob, GitHubWorkflowRunDetail } from "../../services/workspace/types";
import { workflowRunStatusText, workflowRunStatusTone } from "../../utils/repoDisplay";
import { errorExcerptFromLog, workflowFailureSummary } from "../../utils/workflowDiagnostics";
import { actionDurationText, actionStatusIconKind } from "./actionsDisplay";
import { parseWorkflowJobLogSections } from "./workflowLogs";
import {
  workflowJobRerunAvailability,
  workflowRerunErrorMessage,
  workflowRunRerunAvailability,
} from "../../utils/workflowActions";

const props = defineProps<{
  repoFullName: string;
  detail: GitHubWorkflowRunDetail;
  focusedJobId?: number | null;
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  focusJob: [jobId: number | null];
  refresh: [];
}>();

const selectedJobId = ref<number | null>(null);
const jobLogs = ref<Record<number, string | undefined>>({});
const jobLogLoading = ref<Record<number, boolean | undefined>>({});
const jobLogErrors = ref<Record<number, string | undefined>>({});
const rerunPending = ref<"run" | `job:${number}` | null>(null);
const rerunError = ref<string | null>(null);
const rerunNotice = ref<string | null>(null);

const failureSummary = computed(() => workflowFailureSummary(props.detail.jobs));
const selectedJob = computed(() =>
  props.detail.jobs.find((job) => job.id === selectedJobId.value) ?? null,
);
const selectedJobLog = computed(() =>
  selectedJobId.value == null ? "" : jobLogs.value[selectedJobId.value] ?? "",
);
const selectedJobLogSections = computed(() =>
  selectedJob.value ? parseWorkflowJobLogSections(selectedJob.value, selectedJobLog.value) : [],
);
const displayedJobLogSections = computed(() => {
  const matched = selectedJobLogSections.value.filter((section) => section.matched);
  return matched.length ? matched : selectedJobLogSections.value.slice(0, 1);
});
const selectedJobErrorExcerpt = computed(() => errorExcerptFromLog(selectedJobLog.value));
const runRerunAvailability = computed(() => workflowRunRerunAvailability(props.detail.run));
const jobRerunAvailability = computed(() =>
  selectedJob.value
    ? workflowJobRerunAvailability(props.detail.run, selectedJob.value)
    : { available: false, reason: "Job 详情不可用" },
);
const focusedJobMissing = computed(() =>
  props.focusedJobId != null && !props.detail.jobs.some((job) => job.id === props.focusedJobId),
);

watch(
  () => [props.detail.run.id, props.detail.run.runAttempt, props.focusedJobId] as const,
  () => {
    const routedJob = props.focusedJobId == null
      ? null
      : props.detail.jobs.find((job) => job.id === props.focusedJobId) ?? null;
    const selectedStillExists = props.detail.jobs.some((job) => job.id === selectedJobId.value);
    selectedJobId.value = routedJob?.id ?? (selectedStillExists ? selectedJobId.value : null) ?? failureSummary.value.failedJobs[0]?.id ?? null;
  },
  { immediate: true },
);

function selectJob(job: GitHubWorkflowJob) {
  selectedJobId.value = job.id;
  emit("focusJob", job.id);
  rerunError.value = null;
  rerunNotice.value = null;
}

async function loadJobLog(job: GitHubWorkflowJob, force = false) {
  if (!force && jobLogs.value[job.id] != null) return;
  jobLogLoading.value = { ...jobLogLoading.value, [job.id]: true };
  jobLogErrors.value = { ...jobLogErrors.value, [job.id]: undefined };
  try {
    const log = await getGitHubWorkflowJobLog(props.repoFullName, job.id, { forceRefresh: force });
    jobLogs.value = { ...jobLogs.value, [job.id]: log.content };
  } catch (err) {
    jobLogErrors.value = { ...jobLogErrors.value, [job.id]: String(err).replace(/^Error:\s*/, "") };
  } finally {
    jobLogLoading.value = { ...jobLogLoading.value, [job.id]: false };
  }
}

async function rerunFailedRun() {
  if (!runRerunAvailability.value.available || rerunPending.value) return;
  rerunPending.value = "run";
  rerunError.value = null;
  rerunNotice.value = null;
  try {
    await rerunFailedGitHubWorkflowRun(props.repoFullName, props.detail.run.id);
    rerunNotice.value = "已提交失败任务重跑。";
    emit("refresh");
  } catch (err) {
    rerunError.value = workflowRerunErrorMessage(err);
  } finally {
    rerunPending.value = null;
  }
}

async function rerunJob(job: GitHubWorkflowJob) {
  if (!jobRerunAvailability.value.available || rerunPending.value) return;
  rerunPending.value = `job:${job.id}`;
  rerunError.value = null;
  rerunNotice.value = null;
  try {
    await rerunGitHubWorkflowJob(props.repoFullName, job.id);
    rerunNotice.value = `已提交 ${job.name} 重跑。`;
    emit("refresh");
  } catch (err) {
    rerunError.value = workflowRerunErrorMessage(err);
  } finally {
    rerunPending.value = null;
  }
}
</script>

<template>
  <section class="actions-diagnostics" aria-label="失败诊断">
    <div class="actions-section-head">
      <strong>任务与诊断</strong>
      <span v-if="failureSummary.failedJobs.length">
        {{ failureSummary.failedJobs.length }} 个失败任务 · {{ failureSummary.failedSteps.length }} 个失败步骤
      </span>
      <span v-else>{{ detail.jobs.length }} 个任务</span>
    </div>

    <div v-if="failureSummary.failedSteps.length" class="actions-failure-summary" role="status">
      <strong>失败位置</strong>
      <span v-for="item in failureSummary.failedSteps" :key="`${item.job.id}:${item.step.number}`">
        {{ item.job.name }} · {{ item.step.name }}
      </span>
    </div>
    <p v-else-if="failureSummary.failedJobs.length" class="muted actions-empty">失败任务没有返回 step 信息。</p>

    <div v-if="failureSummary.failedJobs.length" class="actions-rerun-row">
      <button
        type="button"
        class="ghost actions-rerun-button"
        data-agent-id="repo.actions.rerun-failed"
        :disabled="!runRerunAvailability.available || rerunPending !== null || refreshing"
        :title="runRerunAvailability.reason ?? '重跑本次运行的失败任务'"
        @click="rerunFailedRun"
      >
        <RotateCcw :size="14" aria-hidden="true" :class="{ 'sb-spin': rerunPending === 'run' }" />
        <span>{{ rerunPending === "run" ? "正在重跑" : "重跑失败任务" }}</span>
      </button>
      <span v-if="!runRerunAvailability.available" class="muted">{{ runRerunAvailability.reason }}</span>
    </div>
    <p v-if="rerunNotice" class="actions-notice" role="status">{{ rerunNotice }}</p>
    <p v-if="rerunError" class="repo-error" role="alert">{{ rerunError }}</p>

    <div class="actions-job-list" role="list" aria-label="Workflow jobs">
      <button
        v-for="job in detail.jobs"
        :key="job.id"
        type="button"
        class="actions-job-row"
        :class="{ 'is-active': selectedJobId === job.id }"
        :data-agent-id="`repo.actions.job.${job.id}`"
        :data-job-id="job.id"
        @click="selectJob(job)"
      >
        <span class="actions-status" :class="`actions-status--${workflowRunStatusTone(job)}`">
          <XCircle v-if="actionStatusIconKind(job) === 'error'" :size="14" aria-hidden="true" />
          <CheckCircle2 v-else-if="actionStatusIconKind(job) === 'ok'" :size="14" aria-hidden="true" />
          <CircleDot v-else :size="14" aria-hidden="true" />
        </span>
        <span>
          <strong>{{ job.name }}</strong>
          <small>{{ workflowRunStatusText(job) }} · {{ actionDurationText(job.startedAt, job.completedAt) }}</small>
        </span>
        <ChevronRight :size="14" aria-hidden="true" />
      </button>
    </div>

    <p v-if="focusedJobMissing" class="repo-error" role="alert">该 job 不存在或已失效。</p>
    <article v-if="selectedJob" class="actions-job-detail" :data-job-id="selectedJob.id">
      <div class="actions-job-detail__head">
        <div>
          <strong>{{ selectedJob.name }}</strong>
          <span>{{ workflowRunStatusText(selectedJob) }}</span>
          <span>{{ selectedJob.steps.length }} steps</span>
        </div>
        <div class="actions-job-actions">
          <button
            v-if="failureSummary.failedJobs.some((job) => job.id === selectedJob?.id)"
            type="button"
            class="ghost actions-rerun-button"
            :data-agent-id="`repo.actions.job.${selectedJob.id}.rerun`"
            :disabled="!jobRerunAvailability.available || rerunPending !== null || refreshing"
            :title="jobRerunAvailability.reason ?? `重跑 ${selectedJob.name}`"
            @click="rerunJob(selectedJob)"
          >
            <RotateCcw :size="13" aria-hidden="true" :class="{ 'sb-spin': rerunPending === `job:${selectedJob.id}` }" />
            <span>{{ rerunPending === `job:${selectedJob.id}` ? "正在重跑" : "重跑 Job" }}</span>
          </button>
          <button
            v-if="selectedJob.htmlUrl"
            type="button"
            class="ghost actions-icon-btn"
            :data-agent-id="`repo.actions.job.${selectedJob.id}.open-github`"
            aria-label="在 GitHub 打开 job"
            title="在 GitHub 打开 job"
            @click="openUrl(selectedJob.htmlUrl)"
          >
            <ExternalLink :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="actions-step-list" aria-label="Job steps">
        <div v-for="step in selectedJob.steps" :key="step.number" class="actions-step-row" :data-step-number="step.number">
          <span class="actions-status" :class="`actions-status--${workflowRunStatusTone(step)}`">
            <XCircle v-if="actionStatusIconKind(step) === 'error'" :size="13" aria-hidden="true" />
            <CheckCircle2 v-else-if="actionStatusIconKind(step) === 'ok'" :size="13" aria-hidden="true" />
            <CircleDot v-else :size="13" aria-hidden="true" />
          </span>
          <span>{{ step.name }}</span>
          <small>{{ actionDurationText(step.startedAt, step.completedAt) }}</small>
        </div>
      </div>

      <button
        type="button"
        class="ghost actions-log-button"
        :data-agent-id="`repo.actions.job.${selectedJob.id}.load-log`"
        :disabled="jobLogLoading[selectedJob.id]"
        @click="loadJobLog(selectedJob, selectedJobLog !== '')"
      >
        <ScrollText :size="14" aria-hidden="true" />
        <span>{{ jobLogLoading[selectedJob.id] ? "正在读取日志" : selectedJobLog ? "刷新日志" : "查看日志" }}</span>
      </button>
      <p v-if="jobLogErrors[selectedJob.id]" class="repo-error" role="alert">{{ jobLogErrors[selectedJob.id] }}</p>
      <div v-if="selectedJobLog" class="actions-log-sections">
        <div v-if="selectedJobErrorExcerpt" class="actions-error-excerpt">
          <strong>错误摘要</strong>
          <pre>{{ selectedJobErrorExcerpt }}</pre>
        </div>
        <p
          v-else-if="failureSummary.failedJobs.some((job) => job.id === selectedJob?.id)"
          class="muted actions-empty"
        >
          未从日志中提取到错误摘要，请查看 step 日志。
        </p>
        <article
          v-for="section in displayedJobLogSections"
          :key="section.step.number"
          class="actions-log-section"
        >
          <strong>{{ section.matched ? section.step.name : "完整 job 日志" }}</strong>
          <small v-if="!section.matched">日志未按 step 分组。</small>
          <pre>{{ section.content || "该 step 没有日志输出。" }}</pre>
        </article>
      </div>
    </article>
  </section>
</template>

<style scoped>
.actions-diagnostics,
.actions-failure-summary,
.actions-job-list,
.actions-job-detail,
.actions-step-list,
.actions-log-sections {
  display: grid;
  gap: var(--repo-sidebar-list-gap);
  min-width: 0;
}

.actions-section-head,
.actions-rerun-row,
.actions-job-detail__head,
.actions-job-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.actions-section-head,
.actions-rerun-row,
.actions-job-detail__head {
  justify-content: space-between;
}

.actions-section-head {
  min-height: var(--repo-sidebar-header-height);
}

.actions-section-head strong {
  color: var(--text);
  font-size: 12px;
}

.actions-section-head span {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-failure-summary {
  padding: 8px;
  border-radius: var(--radius-sm);
  background: var(--err-soft);
  color: var(--text);
  font-size: 11px;
}

.actions-failure-summary strong {
  color: var(--err);
  font-size: 12px;
}

.actions-rerun-row > span {
  font-size: 11px;
  text-align: right;
}

.actions-rerun-button,
.actions-log-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 8px;
  font-size: 12px;
}

.actions-notice {
  margin: 0;
  color: var(--ok);
  font-size: 12px;
}

.actions-job-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 6px 0;
  border: 0;
  border-bottom: 1px solid var(--border-soft);
  border-radius: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.actions-job-row:hover {
  background: var(--bg-hover);
}

.actions-job-row.is-active {
  background: var(--accent-soft);
}

.actions-job-row > span:nth-child(2),
.actions-job-detail__head > div:first-child {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.actions-job-row strong,
.actions-job-row small,
.actions-job-detail__head strong,
.actions-job-detail__head span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-job-row strong,
.actions-job-detail__head strong {
  font-size: 12px;
}

.actions-job-row small,
.actions-job-detail__head span {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-job-row > svg {
  color: var(--text-muted);
}

.actions-job-detail {
  padding: 8px 0 0;
  border-top: 1px solid var(--border-soft);
}

.actions-job-actions {
  flex: none;
}

.actions-step-row {
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  color: var(--text);
  font-size: 11px;
}

.actions-step-row > span:nth-child(2) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-step-row small {
  color: var(--text-muted);
}

.actions-log-button {
  width: 100%;
  border: 0;
  border-top: 1px solid var(--border-soft);
  border-radius: 0;
  background: transparent;
}

.actions-error-excerpt,
.actions-log-section {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 7px 0;
  border-top: 1px solid var(--border-soft);
}

.actions-error-excerpt {
  background: var(--err-soft);
  padding: 7px 8px;
  border-top: 0;
  border-radius: var(--radius-sm);
}

.actions-error-excerpt strong {
  color: var(--err);
}

.actions-log-section strong,
.actions-error-excerpt strong {
  font-size: 11px;
}

.actions-log-section small {
  color: var(--text-muted);
  font-size: 10px;
}

.actions-log-section pre,
.actions-error-excerpt pre {
  max-height: 220px;
  margin: 0;
  overflow: auto;
  color: var(--text);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
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
  width: var(--repo-sidebar-icon-button-size);
  height: var(--repo-sidebar-icon-button-size);
  padding: 0;
}

.actions-empty {
  margin: 0;
  padding: 8px 0;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
