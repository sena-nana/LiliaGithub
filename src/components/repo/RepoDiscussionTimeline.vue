<script setup lang="ts">
import { PencilLine } from "@lucide/vue";
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
  timelineItemOpener?: (item: GitHubDiscussionTimelineItem) => void;
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
    const line = item.line ?? item.originalLine;
    parts.push(`${item.path}${line ? `:${line}` : ""}`);
  }
  return parts.join(" · ");
}

function hasMarkdownBody(item: GitHubDiscussionTimelineItem) {
  return Boolean(item.body?.trim());
}

function openItem(item: GitHubDiscussionTimelineItem) {
  if (props.timelineItemOpener) {
    props.timelineItemOpener(item);
    return;
  }
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
        <span class="discussion-timeline__rail" aria-hidden="true">
          <span class="discussion-timeline__node"></span>
        </span>
        <div class="discussion-timeline__body">
          <article v-if="item.kind !== 'event'" class="discussion-timeline__entry">
            <header class="discussion-timeline__entry-head">
              <div>
                <strong>{{ itemTitle(item) }}</strong>
                <span>{{ itemMeta(item) }}</span>
              </div>
              <button
                v-if="item.url"
                type="button"
                class="ghost project-icon-action"
                :data-agent-id="`repo.conversation.${item.kind}.${encodeURIComponent(item.id)}.open`"
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
            <p v-else class="muted discussion-timeline__empty">没有正文内容。</p>
            <slot name="actions" :item="item" />
          </article>

          <div v-else class="discussion-timeline__event-row">
            <div>
              <strong>{{ itemTitle(item) }}</strong>
              <span>{{ itemMeta(item) }}</span>
            </div>
            <button
              v-if="item.url"
              type="button"
              class="ghost project-icon-action"
              :data-agent-id="`repo.conversation.${item.kind}.${encodeURIComponent(item.id)}.open`"
              aria-label="打开讨论项"
              title="打开讨论项"
              @click="openItem(item)"
            >
              <PencilLine :size="14" aria-hidden="true" />
            </button>
          </div>
        </div>
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
  gap: 0;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.discussion-timeline__item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  min-height: 44px;
  min-width: 0;
  padding: 0;
}

.discussion-timeline__rail {
  position: relative;
  display: flex;
  justify-content: center;
  min-height: 100%;
  padding-top: 18px;
  color: var(--text-muted);
}

.discussion-timeline__rail::before {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  content: "";
  background: color-mix(in srgb, currentColor 46%, transparent);
}

.discussion-timeline__item:first-child .discussion-timeline__rail::before {
  top: 20px;
}

.discussion-timeline__item:last-child .discussion-timeline__rail::before {
  bottom: calc(100% - 20px);
}

.discussion-timeline__node {
  position: relative;
  z-index: 1;
  display: block;
  width: 13px;
  height: 13px;
  border: 2px solid var(--bg);
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 22%, transparent);
}

.discussion-timeline__item.is-body .discussion-timeline__rail,
.discussion-timeline__item.is-comment .discussion-timeline__rail {
  color: var(--accent);
}

.discussion-timeline__item.is-review .discussion-timeline__rail,
.discussion-timeline__item.is-reviewComment .discussion-timeline__rail {
  color: var(--ok);
}

.discussion-timeline__body {
  min-width: 0;
  padding: 14px 4px 18px 0;
  border-bottom: 1px solid var(--border-soft);
}

.discussion-timeline__item:last-child .discussion-timeline__body {
  border-bottom: 0;
}

.discussion-timeline__entry {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.discussion-timeline__entry-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 0;
}

.discussion-timeline__event-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 0;
}

.discussion-timeline__event-row > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.discussion-timeline__entry-head > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.discussion-timeline__entry-head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discussion-timeline__entry-head span,
.discussion-timeline__event-row span {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.discussion-timeline__event-row strong {
  flex: 0 0 auto;
  color: var(--text);
  font-size: 13px;
}

.discussion-timeline__entry :deep(.readme-render) {
  padding: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.discussion-timeline__entry :deep(.readme-render h1),
.discussion-timeline__entry :deep(.readme-render h2),
.discussion-timeline__entry :deep(.readme-render h3),
.discussion-timeline__entry :deep(.readme-render h4),
.discussion-timeline__entry :deep(.readme-render h5),
.discussion-timeline__entry :deep(.readme-render h6) {
  margin: 6px 0 4px;
  padding-bottom: 0;
  border-bottom: 0;
  font-size: 13px;
  line-height: 1.35;
}

.discussion-timeline__entry :deep(.readme-render p),
.discussion-timeline__entry :deep(.readme-render ul),
.discussion-timeline__entry :deep(.readme-render ol),
.discussion-timeline__entry :deep(.readme-render blockquote),
.discussion-timeline__entry :deep(.readme-render pre) {
  margin: 5px 0;
}

.discussion-timeline__entry :deep(.readme-render ul),
.discussion-timeline__entry :deep(.readme-render ol) {
  padding-left: 18px;
}

.discussion-timeline__entry :deep(.readme-render li) {
  margin: 2px 0;
}

.discussion-timeline__entry :deep(.readme-render blockquote),
.discussion-timeline__entry :deep(.readme-render :where(p > img:only-child, p > a:only-child img:only-child):not([width]):not([height])) {
  background: transparent;
}

.discussion-timeline__empty {
  margin: 0;
  padding: 0;
}

@media (max-width: 760px) {
  .discussion-timeline__entry-head,
  .discussion-timeline__event-row,
  .discussion-timeline__event-row > div {
    align-items: flex-start;
  }

  .discussion-timeline__event-row,
  .discussion-timeline__event-row > div {
    flex-direction: column;
  }

  .discussion-timeline__entry-head span {
    white-space: normal;
  }
}
</style>
