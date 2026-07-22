<script setup lang="ts">
import { CheckCircle2, MessageSquareText } from "@lucide/vue";
import { ref } from "vue";
import type { PullRequestReviewThread } from "../../../services/codeReview";
import { reviewAgentIdToken } from "./reviewAgentId";
import { codeReviewErrorMessage } from "./reviewError";

const props = defineProps<{
  threads: readonly PullRequestReviewThread[];
  busy: boolean;
  reply: (threadId: string, body: string) => Promise<void>;
}>();

const drafts = ref<Record<string, string | undefined>>({});
const pendingThread = ref<string | null>(null);
const errors = ref<Record<string, string | undefined>>({});

function location(thread: PullRequestReviewThread) {
  const line = thread.line ?? thread.originalLine;
  return line ? `${thread.path}:${line}` : thread.path;
}

function threadAgentId(threadId: string) {
  return `repo.pulls.review.thread.${reviewAgentIdToken(threadId)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function commentsLoadMessage(thread: PullRequestReviewThread) {
  if (!thread.commentsTruncated) return null;
  return codeReviewErrorMessage(
    thread.commentsUnavailableReason || "部分 thread 回复暂未加载，请刷新后重试。",
  );
}

async function submitReply(thread: PullRequestReviewThread) {
  const body = drafts.value[thread.id]?.trim() ?? "";
  if (!body || pendingThread.value || props.busy) return;
  pendingThread.value = thread.id;
  errors.value = { ...errors.value, [thread.id]: undefined };
  try {
    await props.reply(thread.id, body);
    drafts.value = { ...drafts.value, [thread.id]: "" };
  } catch (error) {
    errors.value = {
      ...errors.value,
      [thread.id]: codeReviewErrorMessage(error, { draftPreserved: true }),
    };
  } finally {
    pendingThread.value = null;
  }
}
</script>

<template>
  <section class="review-threads" aria-label="Review Threads" data-agent-id="repo.pulls.review.threads">
    <header>
      <div>
        <h4>Review Threads</h4>
        <span>{{ threads.filter((thread) => !thread.isResolved).length }} 个未解决</span>
      </div>
    </header>
    <p v-if="!threads.length" class="review-threads__empty">当前没有 review thread。</p>
    <article
      v-for="thread in threads"
      :key="thread.id"
      class="review-thread"
      :class="{ 'is-resolved': thread.isResolved }"
      :data-agent-id="threadAgentId(thread.id)"
    >
      <header class="review-thread__head">
        <div>
          <MessageSquareText v-if="!thread.isResolved" :size="14" aria-hidden="true" />
          <CheckCircle2 v-else :size="14" aria-hidden="true" />
          <strong>{{ location(thread) }}</strong>
        </div>
        <span>{{ thread.isResolved ? "已解决" : thread.isOutdated ? "代码已更新" : "待处理" }}</span>
      </header>
      <pre v-if="thread.diffHunk" class="review-thread__diff">{{ thread.diffHunk }}</pre>
      <ol class="review-thread__comments">
        <li v-for="comment in thread.comments" :key="comment.id">
          <header><strong>{{ comment.author }}</strong><time :datetime="comment.createdAt">{{ formatDate(comment.createdAt) }}</time></header>
          <p>{{ comment.body }}</p>
        </li>
      </ol>
      <p v-if="commentsLoadMessage(thread)" class="review-thread__partial" role="status">
        {{ commentsLoadMessage(thread) }}
      </p>
      <form v-if="!thread.isResolved" class="review-thread__reply" @submit.prevent="submitReply(thread)">
        <label :for="`thread-reply-${thread.id}`">回复 thread</label>
        <textarea
          :id="`thread-reply-${thread.id}`"
          v-model="drafts[thread.id]"
          rows="2"
          :disabled="busy || pendingThread !== null"
          :data-agent-id="`${threadAgentId(thread.id)}.reply.body`"
        />
        <p v-if="errors[thread.id]" role="alert" :data-agent-id="`${threadAgentId(thread.id)}.reply.error`">{{ errors[thread.id] }}</p>
        <button
          type="submit"
          class="primary"
          :disabled="busy || pendingThread !== null || !drafts[thread.id]?.trim()"
          :data-agent-id="`${threadAgentId(thread.id)}.reply.submit`"
        >{{ pendingThread === thread.id ? "正在回复..." : "回复" }}</button>
      </form>
    </article>
  </section>
</template>

<style scoped>
.review-threads { display: grid; gap: 9px; min-width: 0; }
.review-threads > header > div, .review-thread__head, .review-thread__head > div { display: flex; align-items: center; gap: 7px; }
.review-threads > header > div { align-items: baseline; }
.review-threads h4 { margin: 0; font-size: 13px; }
.review-threads > header span, .review-thread__head span, .review-threads__empty { color: var(--text-muted); font-size: 11px; }
.review-thread { min-width: 0; overflow: hidden; padding-bottom: 10px; border-bottom: 1px solid var(--border-soft); }
.review-thread:last-of-type { border-bottom: 0; padding-bottom: 0; }
.review-thread.is-resolved { opacity: .72; }
.review-thread__head { justify-content: space-between; min-height: 36px; padding: 0; }
.review-thread__head > div { min-width: 0; }
.review-thread__head strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.review-thread__diff { max-height: 150px; margin: 0; padding: 7px 9px; overflow: auto; border-bottom: 1px solid var(--border-soft); color: var(--text-muted); background: var(--bg-subtle); font-size: 10px; }
.review-thread__comments { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.review-thread__comments li { display: grid; gap: 5px; padding: 9px; border-bottom: 1px solid var(--border-soft); }
.review-thread__comments header { display: flex; align-items: baseline; gap: 7px; }
.review-thread__comments strong { font-size: 11px; }
.review-thread__comments time { color: var(--text-faint); font-size: 10px; }
.review-thread__comments p { margin: 0; color: var(--text); font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
.review-thread__partial { margin: 0; padding: 7px 9px; border-bottom: 1px solid var(--border-soft); color: var(--warn); font-size: 11px; }
.review-thread__reply { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; padding: 9px; }
.review-thread__reply label { grid-column: 1 / -1; color: var(--text-muted); font-size: 11px; }
.review-thread__reply textarea { min-width: 0; resize: vertical; }
.review-thread__reply p { grid-column: 1 / -1; margin: 0; color: var(--err); font-size: 11px; }
.review-thread__reply button { align-self: end; }
</style>
