<script setup lang="ts">
import { ArrowLeft, CheckCircle2, Lock } from "@lucide/vue";
import { computed, ref } from "vue";
import type { GitHubDiscussionTimelineItem } from "../../../services/workspace/types";
import type {
  GitHubRepositoryDiscussion,
  GitHubRepositoryDiscussionComment,
  GitHubDiscussionReactionContent,
  GitHubDiscussionStateAction,
} from "../../../services/workspace/discussions/types";
import RepoDiscussionTimeline from "../RepoDiscussionTimeline.vue";
import RepoDiscussionCommentThread from "./RepoDiscussionCommentThread.vue";
import type { DiscussionReplyState } from "./useDiscussionDetail";

const props = defineProps<{
  detail: GitHubRepositoryDiscussion;
  comments: readonly GitHubRepositoryDiscussionComment[];
  commentsTotalCount: number;
  commentsLoading: boolean;
  commentsLoadingMore: boolean;
  commentsHasNextPage: boolean;
  commentsError: string | null;
  replyStates: Record<string, DiscussionReplyState>;
  repoFullName: string;
  viewerLogin: string;
  mutationPending: Record<string, boolean>;
  mutationErrors: Record<string, string | null>;
  createComment: (body: string, replyToId?: string | null) => Promise<GitHubRepositoryDiscussionComment | null>;
  updateComment: (commentId: string, body: string) => Promise<GitHubRepositoryDiscussionComment | null>;
  deleteComment: (commentId: string) => Promise<unknown>;
  react: (commentId: string, content: GitHubDiscussionReactionContent, remove?: boolean) => Promise<unknown>;
  changeState: (action: GitHubDiscussionStateAction) => Promise<unknown>;
  setAnswer: (commentId: string, mark: boolean) => Promise<unknown>;
}>();

const emit = defineEmits<{
  back: [];
  loadMoreComments: [];
  loadReplies: [commentId: string];
  loadMoreReplies: [commentId: string];
}>();

const bodyTimeline = computed<GitHubDiscussionTimelineItem[]>(() => [{
  id: props.detail.id,
  kind: "body",
  actor: props.detail.author?.login,
  body: props.detail.body,
  url: props.detail.url,
  createdAt: props.detail.createdAt,
  updatedAt: props.detail.updatedAt,
}]);
const linkBaseUrl = computed(() => `https://github.com/${props.repoFullName}`);
const commentDraft = ref("");

async function submitComment() {
  const created = await props.createComment(commentDraft.value);
  if (created) commentDraft.value = "";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<template>
  <article class="discussion-detail" aria-label="Discussion 详情">
    <button
      type="button"
      class="ghost discussion-detail__back"
      data-agent-id="repo.discussions.detail.back"
      @click="emit('back')"
    >
      <ArrowLeft :size="14" aria-hidden="true" /> Discussions
    </button>
    <header class="discussion-detail__header">
      <div class="discussion-detail__status">
        <span>{{ detail.category.emoji }} {{ detail.category.name }}</span>
        <span v-if="detail.isAnswered" class="is-answered"><CheckCircle2 :size="13" /> 已回答</span>
        <span v-if="detail.closed">已关闭</span>
        <span v-if="detail.locked"><Lock :size="13" /> 已锁定</span>
      </div>
      <h3>#{{ detail.number }} {{ detail.title }}</h3>
      <p>{{ detail.author?.login || "未知作者" }} · {{ formatDate(detail.createdAt) }}</p>
      <div class="discussion-detail__controls">
        <button type="button" class="ghost" :data-agent-id="`repo.discussions.detail.${detail.closed ? 'reopen' : 'close'}`" :disabled="mutationPending[`state:${detail.closed ? 'reopen' : 'close'}`]" @click="changeState(detail.closed ? 'reopen' : 'close')">{{ detail.closed ? "重新打开" : "关闭" }}</button>
        <button type="button" class="ghost" :data-agent-id="`repo.discussions.detail.${detail.locked ? 'unlock' : 'lock'}`" :disabled="mutationPending[`state:${detail.locked ? 'unlock' : 'lock'}`]" @click="changeState(detail.locked ? 'unlock' : 'lock')">{{ detail.locked ? "解除锁定" : "锁定" }}</button>
      </div>
      <p v-for="action in ['close', 'reopen', 'lock', 'unlock']" v-show="mutationErrors[`state:${action}`]" :key="action" class="repo-error" :data-agent-id="`repo.discussions.detail.${action}-error`">{{ mutationErrors[`state:${action}`] }}</p>
    </header>

    <RepoDiscussionTimeline
      :items="bodyTimeline"
      :loading="false"
      :error="null"
      :link-base-url="linkBaseUrl"
    />

    <section class="discussion-detail__comments" aria-label="Discussion 评论">
      <h4>评论 <span>{{ commentsTotalCount }}</span></h4>
      <form class="discussion-detail__composer" @submit.prevent="submitComment">
        <textarea v-model="commentDraft" rows="4" data-agent-id="repo.discussions.comments.create-body" placeholder="参与讨论" required :disabled="detail.locked" />
        <p v-if="detail.locked" class="muted">当前 Discussion 已锁定，暂不能新增评论。</p>
        <p v-if="mutationErrors.create" class="repo-error" data-agent-id="repo.discussions.comments.create-error">{{ mutationErrors.create }}</p>
        <button type="submit" data-agent-id="repo.discussions.comments.create-submit" :disabled="detail.locked || mutationPending.create || !commentDraft.trim()">{{ mutationPending.create ? "发送中" : "发表评论" }}</button>
      </form>
      <p v-if="commentsLoading && !comments.length" class="muted">正在读取评论。</p>
      <p v-else-if="commentsError && !comments.length" class="repo-error">{{ commentsError }}</p>
      <p v-else-if="!comments.length" class="muted">当前 Discussion 没有评论。</p>
      <RepoDiscussionCommentThread
        v-for="comment in comments"
        :key="comment.id"
        :comment="comment"
        :replies="replyStates[comment.id]"
        :link-base-url="linkBaseUrl"
        :viewer-login="viewerLogin"
        :answerable="detail.category.isAnswerable"
        :mutation-pending="mutationPending"
        :mutation-errors="mutationErrors"
        :create-comment="createComment"
        :update-comment="updateComment"
        :delete-comment="deleteComment"
        :react="react"
        :set-answer="setAnswer"
        @load-replies="emit('loadReplies', $event)"
        @load-more-replies="emit('loadMoreReplies', $event)"
      />
      <p v-if="commentsError && comments.length" class="repo-error">{{ commentsError }}</p>
      <button
        v-if="commentsHasNextPage"
        type="button"
        class="ghost discussion-detail__more"
        data-agent-id="repo.discussions.comments.show-more"
        :disabled="commentsLoadingMore"
        @click="emit('loadMoreComments')"
      >
        {{ commentsLoadingMore ? "正在加载" : `加载更多评论（${comments.length} / ${commentsTotalCount}）` }}
      </button>
    </section>
  </article>
</template>

<style scoped>
.discussion-detail,
.discussion-detail__comments {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.discussion-detail__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  min-height: 32px;
}

.discussion-detail__header {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.discussion-detail__header h3,
.discussion-detail__header p,
.discussion-detail__comments h4 {
  margin: 0;
}

.discussion-detail__header h3 {
  font-size: 18px;
  overflow-wrap: anywhere;
}

.discussion-detail__header p,
.discussion-detail__comments h4 span {
  color: var(--text-muted);
  font-size: 12px;
}

.discussion-detail__status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.discussion-detail__status span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.discussion-detail__status .is-answered {
  color: var(--ok);
}

.discussion-detail__comments h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.discussion-detail__more {
  min-height: 34px;
  border: 1px solid var(--border-soft);
}

.discussion-detail__controls { display: flex; flex-wrap: wrap; gap: 7px; }
.discussion-detail__composer { display: grid; gap: 8px; }
.discussion-detail__composer textarea { width: 100%; resize: vertical; }
.discussion-detail__composer button { justify-self: end; }
</style>
