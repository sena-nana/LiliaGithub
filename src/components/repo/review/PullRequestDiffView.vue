<script setup lang="ts">
import { ChevronDown, ChevronRight, ExternalLink, MessageSquare } from "@lucide/vue";
import { ref } from "vue";
import { openUrl } from "../../../services/workspace/client";
import type {
  CreatePullRequestLineCommentRequest,
  PullRequestChangedFile,
  PullRequestDiffSide,
} from "../../../services/codeReview";
import {
  commentLocation,
  parseUnifiedPatch,
  toSplitDiffRows,
  type SplitDiffCell,
  type UnifiedDiffRow,
} from "./pullRequestDiff";
import { reviewAgentIdToken } from "./reviewAgentId";
import { codeReviewErrorMessage } from "./reviewError";

const props = defineProps<{
  files: readonly PullRequestChangedFile[];
  headSha: string;
  busy: boolean;
  submitComment: (request: CreatePullRequestLineCommentRequest) => Promise<void>;
}>();

type CommentTarget = {
  path: string;
  line: number;
  side: PullRequestDiffSide;
};

const mode = ref<"unified" | "split">("unified");
const collapsed = ref<ReadonlySet<string>>(new Set());
const commentTarget = ref<CommentTarget | null>(null);
const commentBody = ref("");
const commentPending = ref(false);
const commentError = ref<string | null>(null);
const externalError = ref<string | null>(null);

function rows(file: PullRequestChangedFile) {
  return parseUnifiedPatch(file);
}

function fileAgentId(filename: string) {
  return `repo.pulls.review.file.${reviewAgentIdToken(filename)}`;
}

function unifiedCommentAgentId(file: PullRequestChangedFile, row: UnifiedDiffRow) {
  const location = commentLocation(row);
  return location
    ? `${fileAgentId(file.filename)}.line.${location.side.toLocaleLowerCase()}.${location.line}.comment`
    : undefined;
}

function splitCommentAgentId(file: PullRequestChangedFile, cell: SplitDiffCell) {
  return `${fileAgentId(file.filename)}.line.${cell.side.toLocaleLowerCase()}.${cell.line}.comment`;
}

function toggleFile(filename: string) {
  const next = new Set(collapsed.value);
  if (next.has(filename)) next.delete(filename);
  else next.add(filename);
  collapsed.value = next;
  if (commentTarget.value?.path === filename) closeComment();
}

function openUnifiedComment(file: PullRequestChangedFile, row: UnifiedDiffRow) {
  const location = commentLocation(row);
  if (!location || props.busy) return;
  openComment(file.filename, location.line, location.side);
}

function openSplitComment(file: PullRequestChangedFile, cell: SplitDiffCell | null) {
  if (!cell?.line || cell.kind === "empty" || props.busy) return;
  openComment(file.filename, cell.line, cell.side);
}

function openComment(path: string, line: number, side: PullRequestDiffSide) {
  commentTarget.value = { path, line, side };
  commentBody.value = "";
  commentError.value = null;
}

function closeComment() {
  if (commentPending.value) return;
  commentTarget.value = null;
  commentBody.value = "";
  commentError.value = null;
}

async function submitLineComment() {
  const target = commentTarget.value;
  const body = commentBody.value.trim();
  if (!target || !body || commentPending.value || props.busy) return;
  commentPending.value = true;
  commentError.value = null;
  try {
    await props.submitComment({
      body,
      commitId: props.headSha,
      path: target.path,
      line: target.line,
      side: target.side,
    });
    commentTarget.value = null;
    commentBody.value = "";
    commentError.value = null;
  } catch (error) {
    commentError.value = codeReviewErrorMessage(error, { draftPreserved: true });
  } finally {
    commentPending.value = false;
  }
}

async function openChangedFile(file: PullRequestChangedFile) {
  const url = file.blobUrl ?? file.rawUrl;
  if (!url) return;
  externalError.value = null;
  try {
    await openUrl(url);
  } catch (error) {
    externalError.value = codeReviewErrorMessage(error);
  }
}
</script>

<template>
  <section class="review-diff" aria-label="Changed Files" data-agent-id="repo.pulls.review.diff">
    <header class="review-diff__header">
      <div>
        <h4>Changed Files</h4>
        <span>{{ files.length }} 个文件</span>
      </div>
      <div class="ui-segmented review-diff__modes" role="group" aria-label="Diff 显示方式">
        <button type="button" :class="{ 'is-active': mode === 'unified' }" :aria-pressed="mode === 'unified'" data-agent-id="repo.pulls.review.diff.unified" @click="mode = 'unified'">Unified</button>
        <button type="button" :class="{ 'is-active': mode === 'split' }" :aria-pressed="mode === 'split'" data-agent-id="repo.pulls.review.diff.split" @click="mode = 'split'">Split</button>
      </div>
    </header>

    <p v-if="externalError" class="review-diff__error" role="alert" data-agent-id="repo.pulls.review.diff.external-error">{{ externalError }}</p>
    <p v-if="!files.length" class="review-diff__empty">当前 Pull Request 没有文件变更。</p>

    <article v-for="file in files" :key="file.filename" class="review-file" :data-agent-id="fileAgentId(file.filename)">
      <header class="review-file__header">
        <button type="button" class="review-file__toggle" :aria-expanded="!collapsed.has(file.filename)" :data-agent-id="`${fileAgentId(file.filename)}.toggle`" @click="toggleFile(file.filename)">
          <ChevronRight v-if="collapsed.has(file.filename)" :size="14" aria-hidden="true" />
          <ChevronDown v-else :size="14" aria-hidden="true" />
          <strong>{{ file.filename }}</strong>
        </button>
        <span class="review-file__stats"><em>+{{ file.additions }}</em><i>-{{ file.deletions }}</i></span>
      </header>

      <div v-if="!collapsed.has(file.filename)" class="review-file__body">
        <div v-if="file.truncated || !file.patch" class="review-file__fallback">
          <p>{{ file.changes ? "此文件的 diff 过大或无法内联显示。" : "此文件没有可显示的文本 diff。" }}</p>
          <button v-if="file.blobUrl || file.rawUrl" type="button" class="ghost" :data-agent-id="`${fileAgentId(file.filename)}.open-external`" @click="openChangedFile(file)">
            <ExternalLink :size="13" aria-hidden="true" />
            在 GitHub 查看文件
          </button>
        </div>

        <div v-else-if="mode === 'unified'" class="unified-diff" role="table" :aria-label="`${file.filename} unified diff`">
          <div v-for="row in rows(file)" :key="row.key" class="unified-row" :class="`is-${row.kind}`" role="row">
            <template v-if="row.kind === 'hunk' || row.kind === 'meta'">
              <code class="unified-row__hunk">{{ row.content }}</code>
            </template>
            <template v-else>
              <button type="button" class="diff-comment" :disabled="busy" :aria-label="`评论 ${file.filename} 第 ${row.newLine ?? row.oldLine} 行`" :data-agent-id="unifiedCommentAgentId(file, row)" @click="openUnifiedComment(file, row)">
                <MessageSquare :size="12" aria-hidden="true" />
              </button>
              <span class="diff-line">{{ row.oldLine ?? '' }}</span>
              <span class="diff-line">{{ row.newLine ?? '' }}</span>
              <code><span class="diff-prefix">{{ row.kind === 'addition' ? '+' : row.kind === 'deletion' ? '-' : ' ' }}</span>{{ row.content }}</code>
            </template>
          </div>
        </div>

        <div v-else class="split-diff" role="table" :aria-label="`${file.filename} split diff`">
          <div v-for="row in toSplitDiffRows(rows(file))" :key="row.key" class="split-row" role="row">
            <code v-if="row.hunk != null" class="split-row__hunk">{{ row.hunk }}</code>
            <template v-else>
              <div class="split-cell" :class="row.left ? `is-${row.left.kind}` : ''">
                <button v-if="row.left && row.left.kind !== 'empty'" type="button" class="diff-comment" :disabled="busy" :data-agent-id="splitCommentAgentId(file, row.left)" @click="openSplitComment(file, row.left)"><MessageSquare :size="12" aria-hidden="true" /></button>
                <span class="diff-line">{{ row.left?.line ?? '' }}</span>
                <code>{{ row.left?.content ?? '' }}</code>
              </div>
              <div class="split-cell" :class="row.right ? `is-${row.right.kind}` : ''">
                <button v-if="row.right && row.right.kind !== 'empty'" type="button" class="diff-comment" :disabled="busy" :data-agent-id="splitCommentAgentId(file, row.right)" @click="openSplitComment(file, row.right)"><MessageSquare :size="12" aria-hidden="true" /></button>
                <span class="diff-line">{{ row.right?.line ?? '' }}</span>
                <code>{{ row.right?.content ?? '' }}</code>
              </div>
            </template>
          </div>
        </div>

        <form v-if="commentTarget?.path === file.filename" class="line-comment" @submit.prevent="submitLineComment">
          <label :for="`line-comment-${file.sha}`">评论第 {{ commentTarget.line }} 行</label>
          <textarea :id="`line-comment-${file.sha}`" v-model="commentBody" rows="3" :disabled="commentPending || busy" :data-agent-id="`${fileAgentId(file.filename)}.comment.body`" />
          <p v-if="commentError" role="alert" :data-agent-id="`${fileAgentId(file.filename)}.comment.error`">{{ commentError }}</p>
          <div>
            <button type="button" class="ghost" :disabled="commentPending" @click="closeComment">取消</button>
            <button type="submit" class="primary" :disabled="commentPending || busy || !commentBody.trim()" :data-agent-id="`${fileAgentId(file.filename)}.comment.submit`">{{ commentPending ? "正在提交..." : "提交行评论" }}</button>
          </div>
        </form>
      </div>
    </article>
  </section>
</template>

<style scoped>
.review-diff { display: grid; gap: 9px; min-width: 0; }
.review-diff__header, .review-file__header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.review-diff__header > div:first-child { display: flex; align-items: baseline; gap: 8px; }
.review-diff h4 { margin: 0; font-size: 13px; }
.review-diff__header span, .review-diff__empty { color: var(--text-muted); font-size: 11px; }
.review-diff__modes { height: 30px; }
.review-diff__modes button { height: 28px; padding: 0 9px; font-size: 11px; }
.review-diff__error, .line-comment p { margin: 0; color: var(--err); font-size: 11px; }
.review-file { min-width: 0; overflow: hidden; border-bottom: 1px solid var(--border-soft); }
.review-file:last-of-type { border-bottom: 0; }
.review-file__header { min-height: 38px; padding: 0; }
.review-file__toggle { display: flex; min-width: 0; align-items: center; gap: 6px; padding: 0; border: 0; background: transparent; color: var(--text); }
.review-file__toggle strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.review-file__stats { display: flex; gap: 6px; font-size: 11px; }
.review-file__stats em { color: var(--ok); font-style: normal; }
.review-file__stats i { color: var(--err); font-style: normal; }
.review-file__body { min-width: 0; overflow-x: auto; }
.review-file__fallback { display: flex; min-height: 64px; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; color: var(--text-muted); font-size: 11px; }
.review-file__fallback p { margin: 0; }
.review-file__fallback button { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.unified-diff, .split-diff { min-width: 720px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.55; }
.unified-row { display: grid; grid-template-columns: 25px 42px 42px minmax(0, 1fr); min-height: 22px; }
.unified-row.is-addition, .split-cell.is-addition { background: var(--ok-soft); }
.unified-row.is-deletion, .split-cell.is-deletion { background: var(--err-soft); }
.unified-row__hunk, .split-row__hunk { grid-column: 1 / -1; padding: 3px 8px; color: var(--accent-text); background: var(--accent-soft); white-space: pre; }
.diff-comment { display: grid; width: 25px; min-height: 22px; place-items: center; padding: 0; border: 0; opacity: 0; background: transparent; color: var(--accent); }
.unified-row:hover .diff-comment, .split-cell:hover .diff-comment, .diff-comment:focus-visible { opacity: 1; }
.diff-line { padding: 2px 5px; color: var(--text-faint); text-align: right; user-select: none; }
.unified-row > code, .split-cell > code { padding: 2px 6px; white-space: pre; }
.diff-prefix { color: var(--text-muted); }
.split-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); border-bottom: 1px solid var(--border-soft); }
.split-cell { display: grid; grid-template-columns: 25px 42px minmax(0, 1fr); min-width: 0; }
.split-cell:first-of-type { border-right: 1px solid var(--border); }
.split-cell.is-empty { background: var(--bg-subtle); }
.line-comment { display: grid; gap: 7px; margin: 8px 0; padding: 9px 0; border-top: 1px solid var(--border-soft); }
.line-comment label { color: var(--text-muted); font-size: 11px; }
.line-comment textarea { width: 100%; resize: vertical; }
.line-comment > div { display: flex; justify-content: flex-end; gap: 6px; }
@media (max-width: 760px) { .review-diff__header { align-items: flex-start; } .review-file__fallback { align-items: flex-start; flex-direction: column; } }
</style>
