<script setup lang="ts">
import { computed, watch } from "vue";
import RepoGitHubUnavailableNotice from "../RepoGitHubUnavailableNotice.vue";
import {
  RepoDiscussionCreateForm,
  RepoDiscussionDetail,
  RepoDiscussionList,
  preloadDiscussionView,
} from "./discussionViewModules";
import { useRepoDiscussionsStore } from "./useRepoDiscussions";
import { useWorkspace } from "../../../composables/useWorkspace";

const props = defineProps<{
  repoFullName: string;
  focusedDiscussionNumber: number | null;
  createView: boolean;
  unavailableReason?: string | null;
}>();

const emit = defineEmits<{
  focus: [discussionNumber: number];
  back: [];
  cancelCreate: [];
  created: [discussionNumber: number];
}>();

const store = useRepoDiscussionsStore(() => props.repoFullName);
const workspace = useWorkspace();
const metadata = computed(() => store.value.list.metadata.value);
const contentUnavailable = computed(() => props.unavailableReason || store.value.list.metadataError.value);

watch(
  () => [props.repoFullName, props.focusedDiscussionNumber, props.createView] as const,
  async ([, discussionNumber, createView]) => {
    if (props.unavailableReason) return;
    const currentStore = store.value;
    await currentStore.list.ensureLoaded();
    if (currentStore !== store.value || !currentStore.list.metadata.value?.enabled) return;
    if (createView) {
      currentStore.create.prepare();
      await preloadDiscussionView("create");
    } else if (discussionNumber) {
      await Promise.all([
        preloadDiscussionView("detail"),
        currentStore.detail.open(discussionNumber),
      ]);
    } else {
      await preloadDiscussionView("list");
    }
  },
  { immediate: true },
);

async function submitCreate() {
  const created = await store.value.createDiscussion();
  if (created && created.id === store.value.detail.detail.value?.id) emit("created", created.number);
}

async function refresh() {
  if (props.unavailableReason) return;
  const currentStore = store.value;
  await currentStore.list.loadMetadata(true);
  if (currentStore !== store.value || !currentStore.list.metadata.value?.enabled) return;
  await currentStore.list.load(true);
  if (currentStore !== store.value) return;
  if (props.focusedDiscussionNumber) {
    await currentStore.detail.open(props.focusedDiscussionNumber, true);
  }
}

async function retryDetail() {
  if (props.focusedDiscussionNumber) await store.value.detail.open(props.focusedDiscussionNumber, true);
}

defineExpose({ refresh });
</script>

<template>
  <section class="repo-discussions-panel">
    <RepoGitHubUnavailableNotice
      v-if="unavailableReason"
      title="Discussions 暂不可用"
      :reason="unavailableReason"
      :loading="false"
    />
    <p v-else-if="store.list.metadataLoading.value && !metadata" class="muted repo-discussions-panel__state">
      正在读取 Discussions 配置。
    </p>
    <div
      v-else-if="contentUnavailable"
      class="repo-discussions-panel__error repo-discussions-panel__state"
    >
      <p class="repo-error">{{ contentUnavailable }}</p>
      <button
        type="button"
        class="ghost"
        data-agent-id="repo.discussions.metadata.retry"
        @click="refresh"
      >重试</button>
    </div>
    <RepoGitHubUnavailableNotice
      v-else-if="metadata && !metadata.enabled"
      title="Discussions 未启用"
      reason="该 GitHub 仓库尚未启用 Discussions。"
      :loading="false"
    />
    <RepoGitHubUnavailableNotice
      v-else-if="createView && !store.create.canCreate.value"
      title="无法创建 Discussion"
      reason="当前账号可以浏览 Discussions，但没有可创建的分类或创建权限。"
      :loading="false"
    />
    <RepoDiscussionCreateForm
      v-else-if="createView && metadata"
      :categories="metadata.creatableCategories"
      :category-id="store.create.draft.categoryId"
      :title="store.create.draft.title"
      :body="store.create.draft.body"
      :creating="store.create.creating.value"
      :can-submit="store.create.canSubmit.value"
      :error="store.create.error.value"
      @update:category-id="store.create.draft.categoryId = $event"
      @update:title="store.create.draft.title = $event"
      @update:body="store.create.draft.body = $event"
      @cancel="emit('cancelCreate')"
      @submit="submitCreate"
    />
    <p
      v-else-if="focusedDiscussionNumber && store.detail.detailLoading.value && !store.detail.detail.value"
      class="muted repo-discussions-panel__state"
    >
      正在读取 Discussion 详情。
    </p>
    <div
      v-else-if="focusedDiscussionNumber && store.detail.detailError.value && !store.detail.detail.value"
      class="repo-discussions-panel__error repo-discussions-panel__state"
    >
      <p class="repo-error">{{ store.detail.detailError.value }}</p>
      <div>
        <button
          type="button"
          class="ghost"
          data-agent-id="repo.discussions.detail.error-back"
          @click="emit('back')"
        >返回列表</button>
        <button
          type="button"
          class="ghost"
          data-agent-id="repo.discussions.detail.retry"
          @click="retryDetail"
        >重试</button>
      </div>
    </div>
    <RepoDiscussionDetail
      v-else-if="focusedDiscussionNumber && store.detail.detail.value"
      :detail="store.detail.detail.value"
      :comments="store.detail.comments.value"
      :comments-total-count="store.detail.commentsTotalCount.value"
      :comments-loading="store.detail.commentsLoading.value"
      :comments-loading-more="store.detail.commentsLoadingMore.value"
      :comments-has-next-page="store.detail.commentsHasNextPage.value"
      :comments-error="store.detail.commentsError.value"
      :reply-states="store.detail.replyStates.value"
      :repo-full-name="repoFullName"
      :viewer-login="workspace.githubBinding.value?.login || ''"
      :mutation-pending="store.detail.mutationPending.value"
      :mutation-errors="store.detail.mutationErrors.value"
      :create-comment="store.detail.createComment"
      :update-comment="store.detail.updateComment"
      :delete-comment="store.detail.deleteComment"
      :react="store.detail.react"
      :change-state="store.detail.changeState"
      :set-answer="store.detail.setAnswer"
      @back="emit('back')"
      @load-more-comments="store.detail.loadMoreComments(focusedDiscussionNumber)"
      @load-replies="store.detail.loadReplies($event)"
      @load-more-replies="store.detail.loadMoreReplies($event)"
    />
    <RepoDiscussionList
      v-else
      :items="store.list.items.value"
      :total-count="store.list.totalCount.value"
      :loading="store.list.listLoading.value"
      :loading-more="store.list.listLoadingMore.value"
      :has-next-page="store.list.hasNextPage.value"
      :error="store.list.listError.value"
      @focus="emit('focus', $event.number)"
      @load-more="store.list.loadMore()"
    />
  </section>
</template>

<style scoped>
.repo-discussions-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.repo-discussions-panel__state {
  margin: 0;
  padding: 46px 12px;
  text-align: center;
}

.repo-discussions-panel__error,
.repo-discussions-panel__error > div {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.repo-discussions-panel__error {
  flex-direction: column;
}

.repo-discussions-panel__error p {
  margin: 0;
}
</style>
