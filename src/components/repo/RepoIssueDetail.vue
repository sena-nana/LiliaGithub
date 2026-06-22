<script setup lang="ts">
import {
  ArrowLeft,
  CircleDot,
  CircleOff,
  ExternalLink,
  LoaderCircle,
  Pencil,
  RotateCcw,
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
  updating: boolean;
  repoFullName: string;
}>();

const emit = defineEmits<{
  back: [];
  open: [issue: GitHubIssue];
  edit: [issue: GitHubIssue];
  toggle: [issue: GitHubIssue];
}>();

const statusText = computed(() => props.issue.state === "open" ? "Open" : "Closed");
const labelText = computed(() => props.issue.labels.join(", ") || "无标签");
const assigneeText = computed(() => props.issue.assignees.join(", ") || "未分配");
const projectText = computed(() => props.issue.projectItems?.map((project) => project.title).join(", ") || "无项目");
const milestoneText = computed(() => props.issue.milestone?.title || "无里程碑");
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
      <div class="issue-detail__head-actions">
        <button type="button" class="ghost" @click="emit('open', issue)">
          <ExternalLink :size="14" aria-hidden="true" />
          打开 GitHub
        </button>
        <button type="button" class="ghost" :disabled="updating" @click="emit('edit', issue)">
          <Pencil :size="14" aria-hidden="true" />
          编辑
        </button>
        <button type="button" class="ghost" :disabled="updating" @click="emit('toggle', issue)">
          <LoaderCircle v-if="updating" :size="14" aria-hidden="true" class="sb-spin" />
          <CircleOff v-else-if="issue.state === 'open'" :size="14" aria-hidden="true" />
          <RotateCcw v-else :size="14" aria-hidden="true" />
          {{ issue.state === "open" ? "关闭" : "重开" }}
        </button>
      </div>
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

    <section class="issue-detail__summary" aria-label="Issue 摘要">
      <div>
        <span>负责人</span>
        <strong>{{ assigneeText }}</strong>
      </div>
      <div>
        <span>标签</span>
        <strong>{{ labelText }}</strong>
      </div>
      <div>
        <span>项目</span>
        <strong>{{ projectText }}</strong>
      </div>
      <div>
        <span>里程碑</span>
        <strong>{{ milestoneText }}</strong>
      </div>
    </section>

    <RepoDiscussionTimeline
      :items="timeline"
      :loading="discussionLoading"
      :error="discussionError"
      :link-base-url="linkBaseUrl"
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

.issue-detail__head,
.issue-detail__head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.issue-detail__head {
  justify-content: space-between;
}

.issue-detail__back,
.issue-detail__head-actions button {
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

.issue-detail__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.issue-detail__summary div {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface);
}

.issue-detail__summary span {
  color: var(--text-muted);
  font-size: 12px;
}

.issue-detail__summary strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

@media (max-width: 760px) {
  .issue-detail__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .issue-detail__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
