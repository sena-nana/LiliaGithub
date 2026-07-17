<script setup lang="ts">
import { CheckCircle2, Heart, MessageCircle, Pencil, Trash2 } from "@lucide/vue";
import { ref } from "vue";
import { openUrl } from "../../../services/workspace/client";
import type { GitHubDiscussionReactionContent, GitHubRepositoryDiscussionComment } from "../../../services/workspace/discussions/types";
import type { ReadmeLinkTarget } from "../../../utils/readmeLinks";
import MarkdownReadme from "../MarkdownReadme.vue";
import type { DiscussionReplyState } from "./useDiscussionDetail";

const props = defineProps<{
  comment: GitHubRepositoryDiscussionComment;
  replies?: DiscussionReplyState;
  linkBaseUrl: string;
  viewerLogin: string;
  answerable: boolean;
  mutationPending: Record<string, boolean>;
  mutationErrors: Record<string, string | null>;
  createComment: (body: string, replyToId?: string | null) => Promise<GitHubRepositoryDiscussionComment | null>;
  updateComment: (commentId: string, body: string) => Promise<GitHubRepositoryDiscussionComment | null>;
  deleteComment: (commentId: string) => Promise<unknown>;
  react: (commentId: string, content: GitHubDiscussionReactionContent, remove?: boolean) => Promise<unknown>;
  setAnswer: (commentId: string, mark: boolean) => Promise<unknown>;
}>();

const emit = defineEmits<{ loadReplies: [commentId: string]; loadMoreReplies: [commentId: string] }>();
const replyDraft = ref("");
const editingId = ref<string | null>(null);
const editDraft = ref("");
const deleteConfirmId = ref<string | null>(null);
const reactionSuccess = ref<Record<string, boolean>>({});

function isOwn(comment: GitHubRepositoryDiscussionComment) {
  return Boolean(props.viewerLogin && comment.author?.login?.toLowerCase() === props.viewerLogin.toLowerCase());
}

function beginEdit(comment: GitHubRepositoryDiscussionComment) {
  editingId.value = comment.id;
  editDraft.value = comment.body;
}

async function submitEdit(comment: GitHubRepositoryDiscussionComment) {
  const updated = await props.updateComment(comment.id, editDraft.value);
  if (updated) { editingId.value = null; editDraft.value = ""; }
}

async function submitReply() {
  const created = await props.createComment(replyDraft.value, props.comment.id);
  if (created) replyDraft.value = "";
}

async function addHeart(commentId: string) {
  const remove = Boolean(reactionSuccess.value[commentId]);
  const result = await props.react(commentId, "HEART", remove);
  if (result !== null) reactionSuccess.value = { ...reactionSuccess.value, [commentId]: !remove };
}

async function confirmDelete(commentId: string) {
  const result = await props.deleteComment(commentId);
  if (result !== null) deleteConfirmId.value = null;
}

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
    <div class="discussion-comment__actions">
      <button type="button" class="ghost" :data-agent-id="`repo.discussions.comments.${comment.id}.reply`" @click="replyDraft ||= `@${comment.author?.login || ''} `"><MessageCircle :size="13" /> 回复</button>
      <button type="button" class="ghost" :data-agent-id="`repo.discussions.comments.${comment.id}.react.heart`" :disabled="mutationPending[`reaction:${comment.id}:HEART`]" @click="addHeart(comment.id)"><Heart :size="13" /> Heart {{ reactionSuccess[comment.id] ? "✓" : "" }}</button>
      <button v-if="isOwn(comment)" type="button" class="ghost" :data-agent-id="`repo.discussions.comments.${comment.id}.edit`" @click="beginEdit(comment)"><Pencil :size="13" /> 编辑</button>
      <button v-if="isOwn(comment) && deleteConfirmId !== comment.id" type="button" class="ghost danger" :data-agent-id="`repo.discussions.comments.${comment.id}.delete`" @click="deleteConfirmId = comment.id"><Trash2 :size="13" /> 删除</button>
      <template v-if="isOwn(comment) && deleteConfirmId === comment.id"><span class="muted">确认删除？</span><button type="button" class="ghost danger" :data-agent-id="`repo.discussions.comments.${comment.id}.delete-confirm`" :disabled="mutationPending[`delete:${comment.id}`]" @click="confirmDelete(comment.id)">确认</button><button type="button" class="ghost" :data-agent-id="`repo.discussions.comments.${comment.id}.delete-cancel`" @click="deleteConfirmId = null">取消</button></template>
      <button v-if="answerable" type="button" class="ghost" :data-agent-id="`repo.discussions.comments.${comment.id}.answer`" :disabled="mutationPending[`answer:${comment.id}`]" @click="setAnswer(comment.id, !comment.isAnswer)">{{ comment.isAnswer ? "取消采纳" : "采纳答案" }}</button>
    </div>
    <p v-if="mutationErrors[`reaction:${comment.id}:HEART`]" class="repo-error">{{ mutationErrors[`reaction:${comment.id}:HEART`] }}</p>
    <p v-if="mutationErrors[`delete:${comment.id}`]" class="repo-error">{{ mutationErrors[`delete:${comment.id}`] }}</p>
    <form v-if="editingId === comment.id" class="discussion-comment__editor" @submit.prevent="submitEdit(comment)">
      <textarea v-model="editDraft" :data-agent-id="`repo.discussions.comments.${comment.id}.edit-body`" rows="4" required />
      <p v-if="mutationErrors[`edit:${comment.id}`]" class="repo-error" :data-agent-id="`repo.discussions.comments.${comment.id}.edit-error`">{{ mutationErrors[`edit:${comment.id}`] }}</p>
      <div><button type="button" class="ghost" @click="editingId = null">取消</button><button type="submit" :data-agent-id="`repo.discussions.comments.${comment.id}.edit-submit`" :disabled="mutationPending[`edit:${comment.id}`] || !editDraft.trim()">{{ mutationPending[`edit:${comment.id}`] ? "保存中" : "保存" }}</button></div>
    </form>
    <form v-if="replyDraft" class="discussion-comment__editor" @submit.prevent="submitReply">
      <textarea v-model="replyDraft" :data-agent-id="`repo.discussions.comments.${comment.id}.reply-body`" rows="3" required />
      <p v-if="mutationErrors[`reply:${comment.id}`]" class="repo-error" :data-agent-id="`repo.discussions.comments.${comment.id}.reply-error`">{{ mutationErrors[`reply:${comment.id}`] }}</p>
      <div><button type="button" class="ghost" @click="replyDraft = ''">取消</button><button type="submit" :data-agent-id="`repo.discussions.comments.${comment.id}.reply-submit`" :disabled="mutationPending[`reply:${comment.id}`] || !replyDraft.trim()">{{ mutationPending[`reply:${comment.id}`] ? "发送中" : "回复" }}</button></div>
    </form>

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
          <div class="discussion-comment__actions">
            <button type="button" class="ghost" :data-agent-id="`repo.discussions.comments.${reply.id}.react.heart`" :disabled="mutationPending[`reaction:${reply.id}:HEART`]" @click="addHeart(reply.id)"><Heart :size="13" /> Heart {{ reactionSuccess[reply.id] ? "✓" : "" }}</button>
            <button v-if="isOwn(reply)" type="button" class="ghost" :data-agent-id="`repo.discussions.comments.${reply.id}.edit`" @click="beginEdit(reply)"><Pencil :size="13" /> 编辑</button>
            <button v-if="isOwn(reply) && deleteConfirmId !== reply.id" type="button" class="ghost danger" :data-agent-id="`repo.discussions.comments.${reply.id}.delete`" @click="deleteConfirmId = reply.id"><Trash2 :size="13" /> 删除</button>
            <template v-if="isOwn(reply) && deleteConfirmId === reply.id"><span class="muted">确认删除？</span><button type="button" class="ghost danger" :data-agent-id="`repo.discussions.comments.${reply.id}.delete-confirm`" :disabled="mutationPending[`delete:${reply.id}`]" @click="confirmDelete(reply.id)">确认</button><button type="button" class="ghost" @click="deleteConfirmId = null">取消</button></template>
          </div>
          <form v-if="editingId === reply.id" class="discussion-comment__editor" @submit.prevent="submitEdit(reply)">
            <textarea v-model="editDraft" :data-agent-id="`repo.discussions.comments.${reply.id}.edit-body`" rows="3" required />
            <p v-if="mutationErrors[`edit:${reply.id}`]" class="repo-error">{{ mutationErrors[`edit:${reply.id}`] }}</p>
            <div><button type="button" class="ghost" @click="editingId = null">取消</button><button type="submit" :data-agent-id="`repo.discussions.comments.${reply.id}.edit-submit`" :disabled="mutationPending[`edit:${reply.id}`] || !editDraft.trim()">保存</button></div>
          </form>
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

.discussion-comment__actions,
.discussion-comment__editor > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.discussion-comment__actions button { min-height: 28px; }
.discussion-comment__actions .danger { color: var(--danger); }
.discussion-comment__editor { display: grid; gap: 7px; }
.discussion-comment__editor textarea { width: 100%; resize: vertical; }
.discussion-comment__editor > div { justify-content: flex-end; }

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
