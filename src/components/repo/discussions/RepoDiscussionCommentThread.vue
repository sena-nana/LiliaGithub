<script setup lang="ts">
import { CheckCircle2, MessageCircle } from "@lucide/vue";
import { openUrl } from "../../../services/workspace/client";
import type { GitHubRepositoryDiscussionComment } from "../../../services/workspace/discussions/types";
import type { ReadmeLinkTarget } from "../../../utils/readmeLinks";
import MarkdownReadme from "../MarkdownReadme.vue";
import type { DiscussionReplyState } from "./useDiscussionDetail";

const props = defineProps<{
  comment: GitHubRepositoryDiscussionComment;
  replies?: DiscussionReplyState;
  linkBaseUrl: string;
}>();

const emit = defineEmits<{ loadReplies: [commentId: string]; loadMoreReplies: [commentId: string] }>();

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function openMarkdownTarget(target: ReadmeLinkTarget) {
  if (target.kind === "external") void openUrl(target.href);
}
</script>

<template>
  <article class="discussion-comment" :class="{ 'is-answer': comment.isAnswer }">
    <header>
      <div>
        <strong>{{ comment.author?.login || "未知作者" }}</strong>
        <span>{{ formatDate(comment.createdAt) }}</span>
      </div>
      <span v-if="comment.isAnswer" class="discussion-comment__answer">
        <CheckCircle2 :size="13" aria-hidden="true" /> 已采纳
      </span>
    </header>
    <MarkdownReadme :content="comment.body" :link-base-url="linkBaseUrl" @open-link="openMarkdownTarget" />

    <div v-if="comment.replyCount" class="discussion-comment__replies">
      <p v-if="!replies?.loaded && replies?.error" class="repo-error">{{ replies.error }}</p>
      <button
        v-if="!replies?.loaded"
        type="button"
        class="ghost"
        :data-agent-id="`repo.discussions.comments.${comment.id}.replies`"
        :disabled="replies?.loading"
        @click="emit('loadReplies', comment.id)"
      >
        <MessageCircle :size="13" aria-hidden="true" />
        {{ replies?.loading ? "正在读取回复" : replies?.error ? "重试读取回复" : `查看 ${comment.replyCount} 条回复` }}
      </button>
      <template v-else>
        <article v-for="reply in replies.items" :key="reply.id" class="discussion-comment__reply">
          <header>
            <strong>{{ reply.author?.login || "未知作者" }}</strong>
            <span>{{ formatDate(reply.createdAt) }}</span>
          </header>
          <MarkdownReadme :content="reply.body" :link-base-url="linkBaseUrl" @open-link="openMarkdownTarget" />
        </article>
        <p v-if="replies.error" class="repo-error">{{ replies.error }}</p>
        <button
          v-if="replies.hasNextPage"
          type="button"
          class="ghost"
          :data-agent-id="`repo.discussions.comments.${comment.id}.replies-more`"
          :disabled="replies.loading"
          @click="emit('loadMoreReplies', comment.id)"
        >
          {{ replies.loading ? "正在加载" : `加载更多回复（${replies.items.length} / ${replies.totalCount}）` }}
        </button>
      </template>
    </div>
  </article>
</template>

<style scoped>
.discussion-comment {
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.discussion-comment.is-answer {
  border-color: color-mix(in srgb, var(--ok) 45%, var(--border));
}

.discussion-comment > header,
.discussion-comment > header > div,
.discussion-comment__reply header,
.discussion-comment__answer,
.discussion-comment__replies button {
  display: flex;
  align-items: center;
  gap: 7px;
}

.discussion-comment > header {
  justify-content: space-between;
}

.discussion-comment header span {
  color: var(--text-muted);
  font-size: 12px;
}

.discussion-comment__answer {
  color: var(--ok);
  font-weight: 650;
}

.discussion-comment__replies {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding-left: 16px;
  border-left: 2px solid var(--border-soft);
}

.discussion-comment__replies button {
  justify-self: start;
  min-height: 28px;
}

.discussion-comment__reply {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-soft);
}

@media (max-width: 760px) {
  .discussion-comment > header {
    align-items: flex-start;
    flex-direction: column;
  }

  .discussion-comment__replies {
    padding-left: 9px;
  }
}
</style>
