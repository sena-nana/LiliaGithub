<script setup lang="ts">
import { Heart, MessageCircle, Pencil, Trash2 } from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";
import { useWorkspace } from "../../composables/useWorkspace";
import type { GitHubDiscussionTimelineItem } from "../../services/workspace/types";
import { errorMessage, workspaceErrorCategory } from "../../services/workspace/errors";
import RepoDiscussionTimeline from "./RepoDiscussionTimeline.vue";

const props = defineProps<{
  repoFullName: string;
  issueNumber: number;
  items: readonly GitHubDiscussionTimelineItem[];
  loading: boolean;
  error: string | null;
  linkBaseUrl: string;
  emptyText: string;
  timelineItemOpener?: (item: GitHubDiscussionTimelineItem) => void;
}>();

const workspace = useWorkspace();
const items = ref<GitHubDiscussionTimelineItem[]>([]);
const draft = ref("");
const replyTo = ref<GitHubDiscussionTimelineItem | null>(null);
const editingId = ref<string | null>(null);
const editDraft = ref("");
const deleteConfirmId = ref<string | null>(null);
const pending = reactive<Record<string, boolean>>({});
const errors = reactive<Record<string, string | null>>({});
const reactionCounts = reactive<Record<string, number>>({});
const viewerLogin = computed(() => workspace.githubBinding.value?.login?.toLowerCase() ?? "");

watch(() => props.items, (next) => { items.value = [...next]; }, { immediate: true, deep: true });

function own(item: GitHubDiscussionTimelineItem) {
  return item.kind === "comment" && Boolean(viewerLogin.value && item.actor?.toLowerCase() === viewerLogin.value && item.databaseId);
}

async function run<T>(key: string, action: () => Promise<T>): Promise<T | null> {
  if (pending[key]) return null;
  pending[key] = true; errors[key] = null;
  try { return await action(); }
  catch (error) { errors[key] = recoverableError(error); return null; }
  finally { pending[key] = false; }
}

async function submit() {
  const body = replyTo.value ? `@${replyTo.value.actor || ""} ${draft.value}`.trim() : draft.value;
  const created = await run("create", async () =>
    (await workspace.github.service()).createGitHubIssueComment(props.repoFullName, props.issueNumber, { body }));
  if (!created) return;
  items.value = [...items.value, created]; draft.value = ""; replyTo.value = null;
}

function beginEdit(item: GitHubDiscussionTimelineItem) { editingId.value = item.id; editDraft.value = item.body ?? ""; }
async function saveEdit(item: GitHubDiscussionTimelineItem) {
  if (!item.databaseId) return;
  const updated = await run(`edit:${item.id}`, async () =>
    (await workspace.github.service()).updateGitHubIssueComment(props.repoFullName, item.databaseId!, { body: editDraft.value }));
  if (!updated) return;
  items.value = items.value.map((value) => value.id === item.id ? updated : value); editingId.value = null; editDraft.value = "";
}
async function remove(item: GitHubDiscussionTimelineItem) {
  if (!item.databaseId) return;
  const result = await run(`delete:${item.id}`, async () =>
    (await workspace.github.service()).deleteGitHubIssueComment(props.repoFullName, item.databaseId!));
  if (result !== null) { items.value = items.value.filter((value) => value.id !== item.id); deleteConfirmId.value = null; }
}
async function heart(item: GitHubDiscussionTimelineItem) {
  if (!item.databaseId) return;
  const result = await run(`reaction:${item.id}`, async () =>
    (await workspace.github.service()).addGitHubIssueCommentReaction(props.repoFullName, item.databaseId!, { content: "heart" }));
  if (result !== null) reactionCounts[item.id] = (reactionCounts[item.id] ?? 0) + 1;
}

function recoverableError(error: unknown) {
  const category = workspaceErrorCategory(error);
  if (category === "authentication") return "GitHub 绑定已失效，请重新绑定后重试；草稿已保留。";
  if (category === "authorization") return "当前 GitHub 授权无权执行此操作，请重新绑定有写权限的账号后重试。";
  if (category === "network" || category === "rate-limit") return "暂时无法连接 GitHub，草稿和当前页面状态已保留，请稍后重试。";
  if (category === "not-found" || category === "conflict" || category === "validation") return "目标评论已不存在或对象已失效，请刷新详情后重试。";
  return errorMessage(error);
}
</script>

<template>
  <RepoDiscussionTimeline :items="items" :loading="loading" :error="error" :link-base-url="linkBaseUrl" :empty-text="emptyText" :timeline-item-opener="timelineItemOpener">
    <template #actions="{ item }">
      <div v-if="item.kind === 'comment' && item.databaseId" class="conversation-actions">
        <button type="button" class="ghost" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.reply`" @click="replyTo = item; draft = ''"><MessageCircle :size="13" /> 回复</button>
        <button type="button" class="ghost" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.reaction-heart`" :disabled="pending[`reaction:${item.id}`]" @click="heart(item)"><Heart :size="13" /> Heart <span v-if="reactionCounts[item.id]">{{ reactionCounts[item.id] }}</span></button>
        <button v-if="own(item)" type="button" class="ghost" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.edit`" @click="beginEdit(item)"><Pencil :size="13" /> 编辑</button>
        <button v-if="own(item) && deleteConfirmId !== item.id" type="button" class="ghost danger" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.delete`" @click="deleteConfirmId = item.id"><Trash2 :size="13" /> 删除</button>
        <template v-if="own(item) && deleteConfirmId === item.id">
          <span class="muted">确认删除这条评论？</span>
          <button type="button" class="ghost danger" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.delete-confirm`" :disabled="pending[`delete:${item.id}`]" @click="remove(item)">确认删除</button>
          <button type="button" class="ghost" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.delete-cancel`" :disabled="pending[`delete:${item.id}`]" @click="deleteConfirmId = null">取消</button>
        </template>
      </div>
      <p v-if="errors[`reaction:${item.id}`]" class="repo-error" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.reaction-error`">{{ errors[`reaction:${item.id}`] }}</p>
      <p v-else-if="reactionCounts[item.id]" class="muted" role="status" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.reaction-result`">Reaction 已添加</p>
      <p v-if="errors[`delete:${item.id}`]" class="repo-error" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.delete-error`">{{ errors[`delete:${item.id}`] }}</p>
      <form v-if="editingId === item.id" class="conversation-editor" @submit.prevent="saveEdit(item)">
        <textarea v-model="editDraft" rows="4" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.edit-body`" required />
        <p v-if="errors[`edit:${item.id}`]" class="repo-error" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.edit-error`">{{ errors[`edit:${item.id}`] }}</p>
        <div><button type="button" class="ghost" @click="editingId = null">取消</button><button type="submit" :data-agent-id="`repo.conversation.${issueNumber}.${item.id}.edit-submit`" :disabled="pending[`edit:${item.id}`] || !editDraft.trim()">{{ pending[`edit:${item.id}`] ? "保存中" : "保存" }}</button></div>
      </form>
    </template>
  </RepoDiscussionTimeline>
  <form class="conversation-composer" @submit.prevent="submit">
    <p v-if="replyTo" class="muted">回复 @{{ replyTo.actor }} <button type="button" class="ghost" @click="replyTo = null">取消回复</button></p>
    <textarea v-model="draft" rows="4" data-agent-id="repo.conversation.create-body" placeholder="发表评论" required />
    <p v-if="errors.create" class="repo-error" data-agent-id="repo.conversation.create-error">{{ errors.create }}</p>
    <button type="submit" data-agent-id="repo.conversation.create-submit" :disabled="pending.create || !draft.trim()">{{ pending.create ? "发送中" : replyTo ? "发送回复" : "发表评论" }}</button>
  </form>
</template>

<style scoped>
.conversation-actions, .conversation-editor > div { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.conversation-actions button { min-height: 28px; }
.conversation-actions .danger { color: var(--err); }
.conversation-editor, .conversation-composer { display: grid; gap: 8px; margin-top: 10px; }
.conversation-editor textarea, .conversation-composer textarea { width: 100%; resize: vertical; }
.conversation-editor > div, .conversation-composer > button { justify-self: end; }
.conversation-composer { padding-top: 12px; border-top: 1px solid var(--border-soft); }
.conversation-composer p { margin: 0; }
</style>
