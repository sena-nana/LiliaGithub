<script setup lang="ts">
import { GitMerge, LoaderCircle, RefreshCw, Send } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import {
  createPullRequestLineComment,
  getPullRequestCodeReview,
  replyPullRequestReviewThread,
  submitPullRequestCodeReview,
  type CreatePullRequestLineCommentRequest,
  type PullRequestCodeReviewDetail,
  type SubmitPullRequestCodeReviewRequest,
} from "../../../services/codeReview";
import {
  buildPullRequestReviewHandoff,
  createLiliaCodeTaskHandoff,
  openLiliaCodeTaskHandoffResult,
  waitForLiliaCodeTaskHandoff,
  type LiliaCodeTaskHandoff,
  type LiliaCodeTaskHandoffStatus,
} from "../../../services/liliaCodeHandoff";
import type { GitHubPullRequest, GitHubPullRequestCheck } from "../../../services/workspace/types";
import PullRequestDiffView from "./PullRequestDiffView.vue";
import PullRequestReviewComposer from "./PullRequestReviewComposer.vue";
import PullRequestReviewThreads from "./PullRequestReviewThreads.vue";
import { evaluatePullRequestMergeGate } from "./pullRequestMergeGate";
import { activeRequestedChanges, latestPullRequestReviews } from "./pullRequestReviewState";
import { reviewAgentIdToken } from "./reviewAgentId";
import { codeReviewErrorMessage } from "./reviewError";

const props = defineProps<{
  repoFullName: string;
  pull: GitHubPullRequest;
  checks: readonly GitHubPullRequestCheck[];
  updating: boolean;
  mergeMethod: "merge" | "squash" | "rebase";
  worktreePath?: string | null;
  currentBranch?: string | null;
  remoteUrl?: string | null;
  sourceRoute: string;
}>();

const emit = defineEmits<{
  merge: [pull: GitHubPullRequest];
  "update:mergeMethod": [value: "merge" | "squash" | "rebase"];
}>();

const detail = ref<PullRequestCodeReviewDetail | null>(null);
const loading = ref(false);
const refreshing = ref(false);
const error = ref<string | null>(null);
const mutation = ref<"line-comment" | "thread-reply" | "review" | null>(null);
const handoffDraft = ref<LiliaCodeTaskHandoff | null>(null);
const handoffStatus = ref<LiliaCodeTaskHandoffStatus | null>(null);
const handoffPending = ref(false);
const handoffError = ref<string | null>(null);
const handoffOpenPending = ref(false);
const handoffOpenError = ref<string | null>(null);
const reviewLoader = createLatestAsyncLoader({ componentEpoch: useComponentEpoch() });

const mergeGate = computed(() => evaluatePullRequestMergeGate(props.pull, props.checks, detail.value));
const unresolvedThreads = computed(() => detail.value?.threads.filter((thread) => !thread.isResolved) ?? []);
const latestReviews = computed(() => latestPullRequestReviews(detail.value?.reviews ?? []));
const requestedChanges = computed(() => activeRequestedChanges(detail.value?.reviews ?? []));
const latestReviewerStates = computed(() => {
  const states = new Map<string, string>();
  for (const reviewer of props.pull.reviewers ?? []) states.set(reviewer.login, reviewer.state);
  for (const review of latestReviews.value) states.set(review.author, review.state);
  return [...states].map(([login, state]) => ({ login, state }));
});
const canHandoff = computed(() => Boolean(props.worktreePath?.trim() && props.currentBranch?.trim()));
const handoffRequirements = computed(() => {
  const requirements = [
    ...requestedChanges.value
      .filter((review) => review.body)
      .map((review) => `${review.author}: ${review.body}`),
    ...unresolvedThreads.value.flatMap((thread) =>
      thread.comments.slice(0, 1).map((comment) => `${thread.path}: ${comment.body}`)
    ),
  ];
  return requirements.length ? requirements : mergeGate.value.reasons;
});

const mergeMethodOptions = [
  { value: "merge" as const, label: "Merge" },
  { value: "squash" as const, label: "Squash" },
  { value: "rebase" as const, label: "Rebase" },
];

function cleanError(reason: unknown) {
  return String(reason).replace(/^Error:\s*/, "");
}

async function load(force = false) {
  if (!props.repoFullName || !props.pull.number) return;
  const key = `${props.repoFullName}:${props.pull.number}`;
  if (!force && reviewLoader.isPending(key)) return;
  await reviewLoader.run(key, async (runId) => {
    if (force) refreshing.value = true;
    else loading.value = true;
    error.value = null;
    try {
      const next = await getPullRequestCodeReview(props.repoFullName, props.pull.number);
      if (reviewLoader.isCurrent(runId)) detail.value = next;
    } catch (reason) {
      if (reviewLoader.isCurrent(runId)) error.value = codeReviewErrorMessage(reason);
    } finally {
      if (reviewLoader.isCurrent(runId)) {
        loading.value = false;
        refreshing.value = false;
      }
    }
  });
}

async function runMutation<T>(kind: NonNullable<typeof mutation.value>, action: () => Promise<T>) {
  if (mutation.value) throw new Error("另一项 Review 操作仍在进行，请稍候。");
  mutation.value = kind;
  try {
    const result = await action();
    await load(true);
    return result;
  } finally {
    mutation.value = null;
  }
}

function submitLineComment(request: CreatePullRequestLineCommentRequest) {
  return runMutation("line-comment", () =>
    createPullRequestLineComment(props.repoFullName, props.pull.number, request)
  ).then(() => undefined);
}

function replyThread(threadId: string, body: string) {
  return runMutation("thread-reply", () =>
    replyPullRequestReviewThread(props.repoFullName, props.pull.number, { threadId, body })
  ).then(() => undefined);
}

function submitReview(request: SubmitPullRequestCodeReviewRequest) {
  return runMutation("review", () =>
    submitPullRequestCodeReview(props.repoFullName, props.pull.number, request)
  ).then(() => undefined);
}

function createHandoffDraft() {
  if (!props.worktreePath || !props.currentBranch) return null;
  return buildPullRequestReviewHandoff({
    repository: {
      fullName: props.repoFullName,
      worktreePath: props.worktreePath,
      branch: props.currentBranch,
      remoteUrl: props.remoteUrl ?? null,
    },
    pull: props.pull,
    sourceRoute: props.sourceRoute,
    reviewRequirements: handoffRequirements.value,
    relatedFiles: detail.value?.files.map((file) => file.filename) ?? [],
    baseSha: detail.value?.baseSha ?? null,
    headSha: detail.value?.headSha ?? null,
  });
}

async function handoffToLiliaCode() {
  if (!canHandoff.value || handoffPending.value) return;
  handoffPending.value = true;
  handoffError.value = null;
  try {
    const draft = handoffDraft.value ?? createHandoffDraft();
    if (!draft) return;
    handoffDraft.value = draft;
    let status = handoffStatus.value;
    if (!status || status.handoffId !== draft.id || status.status !== "pending") {
      status = await createLiliaCodeTaskHandoff(draft);
      handoffStatus.value = status;
    }
    if (status.status === "pending") {
      status = await waitForLiliaCodeTaskHandoff(draft.id, { attempts: 4, intervalMs: 250 });
      handoffStatus.value = status;
    }
    if (status.status === "failed" || status.status === "incompatible") {
      handoffError.value = status.error || (status.status === "incompatible" ? "LiliaCode 版本暂不支持此任务。" : "LiliaCode 未能接收任务。");
    }
  } catch (reason) {
    handoffError.value = cleanError(reason);
  } finally {
    handoffPending.value = false;
  }
}

async function openHandoffResult() {
  const status = handoffStatus.value;
  if (status?.status !== "accepted" || !status.resultRoute || handoffOpenPending.value) return;
  handoffOpenPending.value = true;
  handoffOpenError.value = null;
  try {
    await openLiliaCodeTaskHandoffResult(status.handoffId);
  } catch (reason) {
    handoffOpenError.value = cleanError(reason);
  } finally {
    handoffOpenPending.value = false;
  }
}

function handoffStatusText(status: LiliaCodeTaskHandoffStatus | null) {
  if (!status) return null;
  if (status.status === "accepted") return status.taskId ? `LiliaCode 已接收任务 ${status.taskId}。` : "LiliaCode 已接收任务。";
  if (status.status === "pending") return "任务已保存，正在等待 LiliaCode 接收。";
  if (status.status === "incompatible") return "任务草稿已保留，请更新 LiliaCode 后重试。";
  return "任务草稿已保留，可以重试交接。";
}

watch(
  () => [props.repoFullName, props.pull.number] as const,
  () => {
    reviewLoader.invalidate();
    detail.value = null;
    error.value = null;
    handoffDraft.value = null;
    handoffStatus.value = null;
    handoffError.value = null;
    handoffOpenError.value = null;
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="code-review" aria-label="Pull Request Code Review" data-agent-id="repo.pulls.review.workspace">
    <header class="code-review__header">
      <div><h4>Code Review</h4><span>在完整代码上下文中处理 review。</span></div>
      <button type="button" class="ghost" :disabled="loading || refreshing || mutation !== null" data-agent-id="repo.pulls.review.refresh" @click="load(true)">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'sb-spin': refreshing }" />
        刷新
      </button>
    </header>

    <div v-if="loading && !detail" class="code-review__state"><LoaderCircle :size="15" aria-hidden="true" class="sb-spin" />正在读取 Changed Files 和 review threads...</div>
    <div v-else-if="error && !detail" class="code-review__state is-error" role="alert" data-agent-id="repo.pulls.review.load-error"><span>{{ error }}</span><button type="button" class="ghost" data-agent-id="repo.pulls.review.load-retry" @click="load(true)">重试</button></div>
    <div v-if="error && detail" class="code-review__refresh-error" role="alert" data-agent-id="repo.pulls.review.refresh-error"><span>{{ error }}</span><button type="button" class="ghost" data-agent-id="repo.pulls.review.refresh-retry" @click="load(true)">重新加载 Review</button></div>

    <template v-if="detail">
      <section class="review-summary" aria-label="Review 状态" data-agent-id="repo.pulls.review.summary">
        <div><strong>{{ detail.reviewDecision || "尚无 Review Decision" }}</strong><span>{{ unresolvedThreads.length }} 个未解决 thread</span></div>
        <ul v-if="latestReviewerStates.length"><li v-for="reviewer in latestReviewerStates" :key="reviewer.login"><span>{{ reviewer.login }}</span><em>{{ reviewer.state }}</em></li></ul>
        <p v-else>尚无 reviewer 状态。</p>
        <ol v-if="requestedChanges.length" class="requested-changes" aria-label="Requested changes">
          <li v-for="review in requestedChanges" :key="review.id" :data-agent-id="`repo.pulls.review.requested-change.${reviewAgentIdToken(String(review.id))}`">
            <strong>{{ review.author }} 请求修改</strong>
            <p>{{ review.body || "该 review 没有附加说明。" }}</p>
          </li>
        </ol>
      </section>

      <PullRequestDiffView :files="detail.files" :head-sha="detail.headSha" :busy="mutation !== null" :submit-comment="submitLineComment" />
      <PullRequestReviewThreads :threads="detail.threads" :busy="mutation !== null" :reply="replyThread" />
      <PullRequestReviewComposer :busy="mutation !== null" :submit-review="submitReview" />

      <section class="handoff" data-agent-id="repo.pulls.review.handoff">
        <div>
          <h4>交给 LiliaCode 处理</h4>
          <p v-if="canHandoff">将 review 要求、相关文件和当前 worktree 上下文一并交接。</p>
          <p v-else>先在本地检出仓库和目标分支，再创建修复任务。</p>
          <p v-if="handoffStatusText(handoffStatus)" class="handoff__status" role="status">{{ handoffStatusText(handoffStatus) }}</p>
          <p v-if="handoffError" class="handoff__error" role="alert">{{ handoffError }}</p>
          <p v-if="handoffOpenError" class="handoff__error" role="alert">{{ handoffOpenError }}</p>
          <button
            v-if="handoffStatus?.status === 'accepted' && handoffStatus.resultRoute"
            type="button"
            class="ghost handoff__result"
            :disabled="handoffOpenPending"
            data-agent-id="repo.pulls.review.handoff.open-result"
            @click="openHandoffResult"
          >{{ handoffOpenPending ? "正在打开..." : "查看任务结果" }}</button>
        </div>
        <button v-if="handoffStatus?.status !== 'accepted'" type="button" class="ghost" :disabled="!canHandoff || handoffPending" data-agent-id="repo.pulls.review.handoff.create" @click="handoffToLiliaCode">
          <Send :size="13" aria-hidden="true" />
          {{ handoffPending ? "正在交接..." : handoffStatus?.status === 'pending' ? "继续等待" : handoffDraft ? "重试交接" : "创建修复任务" }}
        </button>
      </section>

      <section class="merge-gate" :class="{ 'is-blocked': !mergeGate.allowed }" aria-label="合并条件" data-agent-id="repo.pulls.review.merge-gate">
        <div class="merge-gate__summary">
          <div><h4>{{ mergeGate.allowed ? "可以合并" : "暂不可合并" }}</h4><span>{{ detail.branchProtection.protected ? `目标分支 ${detail.baseBranch} 受保护` : `目标分支 ${detail.baseBranch}` }}</span></div>
          <ul v-if="mergeGate.reasons.length"><li v-for="reason in mergeGate.reasons" :key="reason">{{ reason }}</li></ul>
          <p v-for="warning in mergeGate.warnings" :key="warning">{{ warning }}</p>
        </div>
        <div class="merge-gate__actions">
          <div class="ui-segmented" role="group" aria-label="合并方式">
            <button v-for="method in mergeMethodOptions" :key="method.value" type="button" :class="{ 'is-active': mergeMethod === method.value }" :aria-pressed="mergeMethod === method.value" @click="emit('update:mergeMethod', method.value)">{{ method.label }}</button>
          </div>
          <button type="button" class="primary" :disabled="updating || !mergeGate.allowed" data-agent-id="repo.pulls.review.merge" @click="emit('merge', pull)">
            <LoaderCircle v-if="updating" :size="14" aria-hidden="true" class="sb-spin" />
            <GitMerge v-else :size="14" aria-hidden="true" />
            合并
          </button>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.code-review { display: grid; gap: 14px; min-width: 0; padding-top: 12px; border-top: 1px solid var(--border-soft); }
.code-review__header, .code-review__header > div, .review-summary > div, .handoff, .merge-gate, .merge-gate__actions { display: flex; align-items: center; gap: 8px; }
.code-review__header, .handoff, .merge-gate { justify-content: space-between; }
.code-review__header > div, .review-summary > div { align-items: baseline; }
.code-review h4 { margin: 0; font-size: 13px; font-weight: 650; }
.code-review__header span, .review-summary > div span, .handoff p, .merge-gate span { color: var(--text-muted); font-size: 11px; }
.code-review__header button, .handoff button, .merge-gate__actions > button { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.code-review__state { display: flex; min-height: 72px; align-items: center; justify-content: center; gap: 7px; color: var(--text-muted); font-size: 12px; }
.code-review__state.is-error { flex-direction: column; color: var(--err); }
.code-review__refresh-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 0; color: var(--err); font-size: 11px; }
.review-summary { display: grid; gap: 7px; min-width: 0; padding-bottom: 12px; border-bottom: 1px solid var(--border-soft); }
.review-summary ul { display: flex; flex-wrap: wrap; gap: 5px; margin: 0; padding: 0; list-style: none; }
.review-summary li { display: inline-flex; gap: 5px; padding: 3px 6px; border-radius: var(--radius-sm); background: var(--bg-subtle); font-size: 11px; }
.review-summary li em { color: var(--text-muted); font-style: normal; }
.review-summary p { margin: 0; color: var(--text-muted); font-size: 11px; }
.requested-changes { display: grid !important; gap: 6px !important; margin: 3px 0 0; padding: 0; list-style: none; }
.requested-changes li { display: grid; gap: 3px; padding: 7px 8px; border-radius: var(--radius-sm); background: var(--warn-soft); }
.requested-changes strong { color: var(--warn); font-size: 11px; }
.requested-changes p { color: var(--text) !important; line-height: 1.45; white-space: pre-wrap; }
.handoff, .merge-gate { align-items: flex-start; gap: 10px; min-width: 0; padding-top: 12px; border-top: 1px solid var(--border-soft); }
.handoff > div, .merge-gate__summary { display: grid; gap: 4px; min-width: 0; }
.handoff p, .merge-gate p { margin: 0; }
.handoff__status { color: var(--ok) !important; }
.handoff__error { color: var(--err) !important; }
.handoff__result { width: fit-content; padding: 0; color: var(--accent); font-size: 11px; }
.merge-gate.is-blocked { padding: 10px 8px; border-top: 0; border-radius: var(--radius-sm); background: var(--warn-soft); }
.merge-gate__summary > div { display: flex; align-items: baseline; gap: 7px; }
.merge-gate ul { display: grid; gap: 3px; margin: 4px 0 0; padding-left: 18px; color: var(--warn); font-size: 11px; }
.merge-gate p { color: var(--warn); font-size: 11px; }
.merge-gate__actions { align-self: center; }
.merge-gate__actions .ui-segmented { height: 30px; }
.merge-gate__actions .ui-segmented button { height: 28px; padding: 0 8px; font-size: 11px; }
@media (max-width: 760px) { .code-review__header, .handoff, .merge-gate { align-items: stretch; flex-direction: column; } .merge-gate__actions { align-self: stretch; flex-wrap: wrap; } }
</style>
