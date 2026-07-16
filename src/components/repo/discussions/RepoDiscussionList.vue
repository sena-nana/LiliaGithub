<script setup lang="ts">
import { CheckCircle2, Lock, MessageCircle, MessagesSquare } from "@lucide/vue";
import type { GitHubRepositoryDiscussionSummary } from "../../../services/workspace/discussions/types";

defineProps<{
  items: readonly GitHubRepositoryDiscussionSummary[];
  totalCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasNextPage: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  focus: [discussion: GitHubRepositoryDiscussionSummary];
  loadMore: [];
}>();

function authorName(discussion: GitHubRepositoryDiscussionSummary) {
  return discussion.author?.login || "未知作者";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
</script>

<template>
  <section class="discussion-list" aria-label="Discussions">
    <p v-if="loading && !items.length" class="muted discussion-list__state">正在读取 Discussions。</p>
    <p v-else-if="error && !items.length" class="repo-error discussion-list__state">{{ error }}</p>
    <p v-else-if="!items.length" class="muted discussion-list__state">没有匹配的 Discussion。</p>

    <div v-else class="discussion-list__rows" role="list">
      <article
        v-for="discussion in items"
        :key="discussion.id"
        class="discussion-list__row repo-list-row"
        role="listitem"
      >
        <span class="discussion-list__status" :class="{ 'is-answered': discussion.isAnswered }">
          <CheckCircle2 v-if="discussion.isAnswered" :size="16" aria-label="已回答" />
          <MessagesSquare v-else :size="16" aria-label="讨论中" />
        </span>
        <div class="discussion-list__content">
          <button
            type="button"
            class="discussion-list__title"
            :data-agent-id="`repo.discussions.${discussion.number}.open`"
            @click="emit('focus', discussion)"
          >
            #{{ discussion.number }} {{ discussion.title }}
          </button>
          <p>
            <span>{{ discussion.category.emoji }} {{ discussion.category.name }}</span>
            <span>{{ authorName(discussion) }}</span>
            <span>{{ formatDate(discussion.updatedAt) }}</span>
            <span v-if="discussion.closed">已关闭</span>
            <span v-if="discussion.locked"><Lock :size="11" aria-hidden="true" /> 已锁定</span>
          </p>
        </div>
        <span class="discussion-list__comments" :aria-label="`${discussion.commentCount} 条评论`">
          <MessageCircle :size="14" aria-hidden="true" />
          {{ discussion.commentCount }}
        </span>
      </article>
    </div>

    <p v-if="error && items.length" class="repo-error discussion-list__inline-error">{{ error }}</p>
    <button
      v-if="hasNextPage"
      type="button"
      class="discussion-list__more"
      data-agent-id="repo.discussions.show-more"
      :disabled="loadingMore"
      @click="emit('loadMore')"
    >
      {{ loadingMore ? "正在加载" : `加载更多（${items.length} / ${totalCount}）` }}
    </button>
  </section>
</template>

<style scoped>
.discussion-list,
.discussion-list__rows {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.discussion-list__state {
  margin: 0;
  padding: 46px 12px;
  text-align: center;
}

.discussion-list__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  min-width: 0;
  min-height: 52px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--border-soft);
}

.discussion-list__status {
  padding-top: 3px;
  color: var(--text-muted);
}

.discussion-list__status.is-answered {
  color: var(--ok);
}

.discussion-list__content {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.discussion-list__title {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-weight: 650;
  overflow-wrap: anywhere;
  text-align: left;
  cursor: pointer;
}

.discussion-list__content p {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 10px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.discussion-list__content p span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.discussion-list__comments {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: center;
  color: var(--text-muted);
  font-size: 12px;
}

.discussion-list__more {
  min-height: 34px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.discussion-list__more:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.discussion-list__inline-error {
  margin: 0;
}

@media (max-width: 760px) {
  .discussion-list__row {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .discussion-list__comments {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
