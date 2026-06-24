<script setup lang="ts">
import {
  ArrowLeft,
  CircleDot,
  CircleOff,
} from "@lucide/vue";
import { computed } from "vue";
import type {
  GitHubDiscussionTimelineItem,
  GitHubIssue,
} from "../../services/workspace/types";
import RepoDiscussionTimeline from "./RepoDiscussionTimeline.vue";

const props = defineProps<{
  issue: GitHubIssue;
  timeline: readonly GitHubDiscussionTimelineItem[];
  discussionLoading: boolean;
  discussionError: string | null;
  repoFullName: string;
  timelineItemOpener?: (item: GitHubDiscussionTimelineItem) => void;
}>();

const emit = defineEmits<{
  back: [];
}>();

const statusText = computed(() => props.issue.state === "open" ? "Open" : "Closed");
const linkBaseUrl = computed(() => `https://github.com/${props.repoFullName}`);

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
</script>

<template>
  <article class="issue-detail" aria-label="Issue 详情">
    <div class="issue-detail__head">
      <button type="button" class="ghost issue-detail__back" @click="emit('back')">
        <ArrowLeft :size="14" aria-hidden="true" />
        Issues
      </button>
    </div>

    <header class="issue-detail__title-block">
      <div class="issue-detail__status" :class="{ 'is-closed': issue.state !== 'open' }">
        <CircleDot v-if="issue.state === 'open'" :size="16" aria-hidden="true" />
        <CircleOff v-else :size="16" aria-hidden="true" />
        <span>{{ statusText }}</span>
      </div>
      <h3>#{{ issue.number }} {{ issue.title }}</h3>
      <p>
        {{ issue.author || "未知作者" }} opened
        <time :datetime="issue.createdAt">{{ formatDateTime(issue.createdAt) }}</time>
        · updated
        <time :datetime="issue.updatedAt">{{ formatDateTime(issue.updatedAt) }}</time>
      </p>
    </header>

    <RepoDiscussionTimeline
      :items="timeline"
      :loading="discussionLoading"
      :error="discussionError"
      :link-base-url="linkBaseUrl"
      :timeline-item-opener="props.timelineItemOpener"
      empty-text="当前 Issue 没有讨论内容。"
    />
  </article>
</template>

<style scoped>
.issue-detail {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.issue-detail__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.issue-detail__head {
  justify-content: space-between;
}

.issue-detail__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  white-space: nowrap;
}

.issue-detail__title-block {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.issue-detail__title-block h3,
.issue-detail__title-block p {
  margin: 0;
}

.issue-detail__title-block h3 {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 18px;
}

.issue-detail__title-block p {
  color: var(--text-muted);
  font-size: 13px;
}

.issue-detail__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}

.issue-detail__status.is-closed {
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .issue-detail__head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
