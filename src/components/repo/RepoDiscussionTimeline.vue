<script setup lang="ts">
import {
  CircleDot,
  GitPullRequestArrow,
  MessageSquare,
  PencilLine,
  Text,
} from "@lucide/vue";
import type { Component } from "vue";
import { computed } from "vue";
import { openUrl } from "../../services/workspace/client";
import type { GitHubDiscussionTimelineItem } from "../../services/workspace/types";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";
import MarkdownReadme from "./MarkdownReadme.vue";

const props = defineProps<{
  items: readonly GitHubDiscussionTimelineItem[];
  loading: boolean;
  error: string | null;
  linkBaseUrl?: string | null;
  emptyText?: string;
}>();

const sortedItems = computed(() => [...props.items].sort((left, right) => {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}));

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function timelineIcon(item: GitHubDiscussionTimelineItem): Component {
  if (item.kind === "body") return Text;
  if (item.kind === "comment") return MessageSquare;
  if (item.kind === "review" || item.kind === "reviewComment") return GitPullRequestArrow;
  return CircleDot;
}

function itemTitle(item: GitHubDiscussionTimelineItem) {
  if (item.kind === "body") return "描述";
  if (item.kind === "comment") return "评论";
  if (item.kind === "review") return `Review${item.state ? ` · ${item.state}` : ""}`;
  if (item.kind === "reviewComment") return "Review comment";
  return item.title || item.event || "事件";
}

function itemMeta(item: GitHubDiscussionTimelineItem) {
  const parts = [
    item.actor || "unknown",
    formatDateTime(item.createdAt),
  ];
  if (item.path) {
    parts.push(`${item.path}${item.line ? `:${item.line}` : ""}`);
  }
  return parts.join(" · ");
}

function hasMarkdownBody(item: GitHubDiscussionTimelineItem) {
  return item.kind !== "event" && Boolean(item.body?.trim());
}

function openItem(item: GitHubDiscussionTimelineItem) {
  if (item.url) void openUrl(item.url);
}

function openMarkdownTarget(target: ReadmeLinkTarget) {
  if (target.kind === "external") void openUrl(target.href);
}
</script>

<template>
  <section class="discussion-timeline" aria-label="讨论时间线">
    <p v-if="loading" class="muted discussion-timeline__state">正在读取讨论。</p>
    <p v-else-if="error" class="repo-error discussion-timeline__state">{{ error }}</p>
    <p v-else-if="!sortedItems.length" class="muted discussion-timeline__state">
      {{ emptyText ?? "暂无讨论内容。" }}
    </p>

    <ol v-else class="discussion-timeline__list">
      <li
        v-for="item in sortedItems"
        :key="`${item.kind}:${item.id}`"
        class="discussion-timeline__item"
        :class="`is-${item.kind}`"
      >
        <span class="discussion-timeline__icon">
          <component :is="timelineIcon(item)" :size="15" aria-hidden="true" />
        </span>
        <article class="discussion-timeline__entry">
          <header class="discussion-timeline__entry-head">
            <div>
              <strong>{{ itemTitle(item) }}</strong>
              <span>{{ itemMeta(item) }}</span>
            </div>
            <button
              v-if="item.url"
              type="button"
              class="ghost project-icon-action"
              aria-label="打开讨论项"
              title="打开讨论项"
              @click="openItem(item)"
            >
              <PencilLine :size="14" aria-hidden="true" />
            </button>
          </header>
          <MarkdownReadme
            v-if="hasMarkdownBody(item)"
            :content="item.body ?? ''"
            :link-base-url="linkBaseUrl"
            @open-link="openMarkdownTarget"
          />
          <p v-else-if="item.kind === 'event'" class="muted discussion-timeline__event">
            {{ item.title || item.event || "记录了一次时间线事件。" }}
          </p>
          <p v-else class="muted discussion-timeline__event">没有正文内容。</p>
        </article>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.discussion-timeline {
  min-width: 0;
}

.discussion-timeline__state {
  margin: 0;
}

.discussion-timeline__list {
  display: grid;
  gap: 12px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.discussion-timeline__item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
}

.discussion-timeline__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-top: 2px;
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
  color: var(--text-muted);
  background: var(--surface-raised);
}

.discussion-timeline__entry {
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface);
}

.discussion-timeline__entry-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.discussion-timeline__entry-head > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.discussion-timeline__entry-head strong,
.discussion-timeline__entry-head span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discussion-timeline__entry-head span {
  color: var(--text-muted);
  font-size: 12px;
}

.discussion-timeline__entry :deep(.markdown-readme) {
  padding: 12px;
}

.discussion-timeline__event {
  margin: 0;
  padding: 12px;
}
</style>
