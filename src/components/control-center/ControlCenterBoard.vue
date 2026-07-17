<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ControlCenterContinueSection from "./ControlCenterContinueSection.vue";
import ControlCenterMomentumSection from "./ControlCenterMomentumSection.vue";
import ControlCenterWorkSection from "./ControlCenterWorkSection.vue";
import type { DiscoveryRepositoryInput, DiscoveryScanResult } from "../../services/discovery/types";
import type { GitHubAccountIssueItem, RepoSummary, WorkspaceTask } from "../../services/workspace/types";
import { getGitHubWorkflowJobLog, getGitHubWorkflowRunDetail } from "../../services/workspace/client";
import {
  buildWorkflowFailureHandoff,
  createLiliaCodeTaskHandoff,
  openLiliaCodeTaskHandoffResult,
  waitForLiliaCodeTaskHandoff,
  type LiliaCodeTaskHandoff,
} from "../../services/liliaCodeHandoff";
import { errorExcerptFromLog, workflowFailureSummary } from "../../utils/workflowDiagnostics";
import {
  applyWorkItemDispositions,
  buildProjectMomentum,
  buildWorkItems,
  continueContextsFromTasks,
  readContinueContexts,
  readWorkItemDispositions,
  removeContinueContext,
  restoreHiddenWorkItems,
  stableSortWorkItems,
  writeWorkItemDisposition,
  type ContinueContext,
  type WorkItem,
  type WorkItemDispositionState,
} from "../../services/controlCenter";

const props = withDefaults(defineProps<{
  repositories: readonly DiscoveryRepositoryInput[];
  localRepositories: readonly RepoSummary[];
  scan: DiscoveryScanResult | null;
  accountItems?: readonly GitHubAccountIssueItem[];
  tasks?: readonly WorkspaceTask[];
  loading?: boolean;
  error?: string | null;
  scope?: string;
}>(), {
  accountItems: () => [],
  tasks: () => [],
  loading: false,
  error: null,
  scope: "default",
});

const revision = ref(0);
type HandoffState = {
  pending: boolean;
  message: string | null;
  error: string | null;
  handoffId?: string | null;
  resultAvailable?: boolean;
  openingResult?: boolean;
  resultOpened?: boolean;
  resultError?: string | null;
};

const handoffStates = ref<Record<string, HandoffState | undefined>>({});
const handoffDrafts = new Map<string, LiliaCodeTaskHandoff>();
const rawItems = computed(() => buildWorkItems({
  repositories: props.repositories,
  localRepositories: props.localRepositories,
  scan: props.scan,
  accountItems: props.accountItems,
  tasks: props.tasks,
}));
const dispositionView = computed(() => {
  revision.value;
  return applyWorkItemDispositions(rawItems.value, readWorkItemDispositions(undefined, props.scope));
});
const visibleItems = computed(() => stableSortWorkItems(dispositionView.value.visible));
const attention = computed(() => visibleItems.value.filter((item) => item.bucket === "attention"));
const today = computed(() => visibleItems.value.filter((item) => item.bucket === "today"));
const hidden = computed(() => dispositionView.value.hidden);
const storedContinue = computed(() => {
  revision.value;
  return readContinueContexts().items;
});
const continueContexts = computed(() => dedupeContinue([
  ...continueContextsFromTasks(props.tasks, props.localRepositories),
  ...storedContinue.value,
]));
const momentum = computed(() => buildProjectMomentum({
  repositories: props.repositories,
  localRepositories: props.localRepositories,
  scan: props.scan,
}));

watch(() => props.scope, () => { revision.value += 1; });

function setDisposition(item: WorkItem, state: WorkItemDispositionState) {
  writeWorkItemDisposition(item.id, {
    state,
    snoozedUntil: state === "snoozed" ? Date.now() + 24 * 60 * 60 * 1000 : null,
  }, { scope: props.scope, sourceRevision: item.sourceRevision ?? null });
  revision.value += 1;
}

function togglePin(item: WorkItem) {
  writeWorkItemDisposition(item.id, { state: "active", pinned: !item.pinned }, {
    scope: props.scope,
    sourceRevision: item.sourceRevision ?? null,
  });
  revision.value += 1;
}

function restoreHidden() {
  restoreHiddenWorkItems(hidden.value.map((item) => item.id), { scope: props.scope });
  revision.value += 1;
}

function removeContext(context: ContinueContext) {
  removeContinueContext(context.id);
  revision.value += 1;
}

function workflowHandoffAvailable(item: WorkItem) {
  if (item.kind !== "workflow" || !item.repoId) return false;
  const repository = props.localRepositories.find((repo) => repo.id === item.repoId);
  return Boolean(repository?.path && repository.currentBranch && workflowEntry(item));
}

async function handoffWorkflow(item: WorkItem) {
  if (!workflowHandoffAvailable(item) || handoffStates.value[item.id]?.pending) return;
  const entry = workflowEntry(item);
  const repository = props.localRepositories.find((repo) => repo.id === item.repoId);
  if (!entry || !repository?.currentBranch) return;
  setHandoffState(item.id, { pending: true, message: null, error: null });
  try {
    let draft = handoffDrafts.get(item.id);
    if (!draft) {
      const detail = await getGitHubWorkflowRunDetail(entry.repoFullName, entry.run.id);
      const failure = workflowFailureSummary(detail.jobs);
      const failedSteps = failure.failedSteps.map(({ job, step }) => `${job.name} / ${step.name}`);
      const failedJobs = failure.failedJobs.map((job) => job.name);
      const logExcerpts = (await Promise.all(failure.failedJobs.slice(0, 3).map(async (job) => {
        try {
          const log = await getGitHubWorkflowJobLog(entry.repoFullName, job.id);
          const excerpt = errorExcerptFromLog(log.content);
          return excerpt ? `${job.name}:\n${excerpt}` : null;
        } catch {
          return null;
        }
      }))).filter((value): value is string => Boolean(value));
      const logSummary = logExcerpts.length
        ? logExcerpts.join("\n\n")
        : failedSteps.length
          ? `失败步骤：${failedSteps.join("；")}`
          : failedJobs.length
            ? `失败任务：${failedJobs.join("；")}`
            : `${entry.run.name} 运行结果：${entry.run.conclusion ?? entry.run.status}`;
      draft = buildWorkflowFailureHandoff({
        repository: {
          fullName: entry.repoFullName,
          worktreePath: repository.path,
          branch: repository.currentBranch,
          remoteUrl: repository.remoteUrl,
        },
        run: entry.run,
        sourceRoute: item.nextAction.route,
        logSummary,
      });
      handoffDrafts.set(item.id, draft);
    }
    const created = await createLiliaCodeTaskHandoff(draft);
    const status = created.status === "pending"
      ? await waitForLiliaCodeTaskHandoff(created.handoffId, { attempts: 8, intervalMs: 500 })
      : created;
    if (status.status === "accepted") {
      setHandoffState(item.id, {
        pending: false,
        message: "LiliaCode 已接收任务。",
        error: null,
        handoffId: status.handoffId,
        resultAvailable: Boolean(status.resultRoute),
      });
      return;
    }
    if (status.status === "pending") {
      setHandoffState(item.id, { pending: false, message: "任务草稿已提交，等待 LiliaCode 接收。", error: null });
      return;
    }
    const message = status.status === "incompatible"
      ? "LiliaCode 协议版本不兼容，请更新后重试；任务草稿已保留。"
      : `${status.error || "LiliaCode 未能接收任务"}；任务草稿已保留，可重试。`;
    setHandoffState(item.id, { pending: false, message: null, error: message });
  } catch (error) {
    setHandoffState(item.id, {
      pending: false,
      message: null,
      error: `${String(error).replace(/^Error:\s*/, "")}；任务草稿已保留，可重试。`,
    });
  }
}

async function openWorkflowHandoffResult(item: WorkItem) {
  const state = handoffStates.value[item.id];
  if (!state?.handoffId || !state.resultAvailable || state.openingResult) return;
  setHandoffState(item.id, { ...state, openingResult: true, resultError: null, resultOpened: false });
  try {
    await openLiliaCodeTaskHandoffResult(state.handoffId);
    setHandoffState(item.id, { ...state, openingResult: false, resultError: null, resultOpened: true });
  } catch (error) {
    setHandoffState(item.id, {
      ...state,
      openingResult: false,
      resultOpened: false,
      resultError: String(error).replace(/^Error:\s*/, ""),
    });
  }
}

function workflowEntry(item: WorkItem) {
  return props.scan?.failedWorkflows.items.find((entry) =>
    item.id === `github:${entry.repoFullName.trim().toLocaleLowerCase()}:workflow:${entry.run.id}`
  ) ?? null;
}

function setHandoffState(itemId: string, state: HandoffState) {
  handoffStates.value = { ...handoffStates.value, [itemId]: state };
}

function dedupeContinue(items: readonly ContinueContext[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, 8);
}

</script>

<template>
  <section class="control-center" aria-label="个人开发控制中心" data-agent-id="control-center.board">
    <div v-if="error" class="control-center__error" role="alert">{{ error }}</div>
    <ControlCenterWorkSection id="control-attention-title" title="Attention" description="明确阻塞、失败或需要你处理的事项" empty-text="当前没有必须立即处理的事项。" :items="attention" :loading="loading" :handoff-available="workflowHandoffAvailable" :handoff-states="handoffStates" @disposition="setDisposition" @pin="togglePin" @handoff="handoffWorkflow" @open-handoff-result="openWorkflowHandoffResult" />
    <ControlCenterWorkSection id="control-today-title" title="Today" description="今天最值得继续推进的工作" empty-text="今天没有新增的推进项。" :items="today" :loading="loading" :handoff-available="workflowHandoffAvailable" :handoff-states="handoffStates" @disposition="setDisposition" @pin="togglePin" @handoff="handoffWorkflow" @open-handoff-result="openWorkflowHandoffResult" />
    <ControlCenterContinueSection :items="continueContexts" @remove="removeContext" />
    <ControlCenterMomentumSection :items="momentum" />

    <footer v-if="hidden.length" class="control-center__footer">
      <span>{{ hidden.length }} 项已忽略、稍后处理或完成</span>
      <button type="button" class="ghost" data-agent-id="control-center.hidden.restore" @click="restoreHidden">恢复已隐藏项</button>
    </footer>
  </section>
</template>

<style scoped>
.control-center { display: grid; gap: 12px; min-width: 0; }
.control-center__error { padding: 9px 11px; border-radius: 7px; color: var(--err); background: var(--err-soft); font-size: 12px; }
.control-center__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; color: var(--text-muted); font-size: 11px; }
</style>
