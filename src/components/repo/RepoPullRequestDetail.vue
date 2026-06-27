<script setup lang="ts">
import {
  ArrowLeft,
  CircleOff,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
} from "@lucide/vue";
import { computed } from "vue";
import { openUrl } from "../../services/workspace/client";
import type {
  GitHubDiscussionTimelineItem,
  GitHubPullRequest,
  GitHubPullRequestCheck,
} from "../../services/workspace/types";
import RepoDiscussionTimeline from "./RepoDiscussionTimeline.vue";

const props = defineProps<{
  pull: GitHubPullRequest;
  checks: readonly GitHubPullRequestCheck[];
  checksLoading: boolean;
  discussionTimeline: readonly GitHubDiscussionTimelineItem[];
  discussionLoading: boolean;
  discussionError: string | null;
  updating: boolean;
  mergeMethod: "merge" | "squash" | "rebase";
  repoFullName: string;
  timelineItemOpener?: (item: GitHubDiscussionTimelineItem) => void;
}>();

const emit = defineEmits<{
  back: [];
  merge: [pull: GitHubPullRequest];
  "update:mergeMethod": [value: "merge" | "squash" | "rebase"];
}>();

const mergeMethodOptions: readonly { value: "merge" | "squash" | "rebase"; label: string }[] = [
  { value: "merge", label: "Merge" },
  { value: "squash", label: "Squash" },
  { value: "rebase", label: "Rebase" },
];

const statusText = computed(() => {
  if (props.pull.merged) return "Merged";
  if (props.pull.draft) return "Draft";
  return props.pull.state === "open" ? "Open" : "Closed";
});

const canMerge = computed(() => props.pull.state === "open" && !props.pull.merged);
const linkBaseUrl = computed(() => `https://github.com/${props.repoFullName}`);

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function checkText(check: GitHubPullRequestCheck) {
  return check.conclusion ?? check.status;
}

function checkUrl(check: GitHubPullRequestCheck) {
  return check.htmlUrl ?? check.detailsUrl;
}

function openCheck(check: GitHubPullRequestCheck) {
  const url = checkUrl(check);
  if (url) void openUrl(url);
}
</script>

<template>
  <article class="pull-detail" aria-label="Pull Request 详情">
    <div class="pull-detail__head">
      <button type="button" class="ghost pull-detail__back" @click="emit('back')">
        <ArrowLeft :size="14" aria-hidden="true" />
        Pull Requests
      </button>
    </div>

    <header class="pull-detail__title-block">
      <div class="pull-detail__status" :class="{ 'is-closed': pull.state !== 'open' || pull.merged }">
        <GitMerge v-if="pull.merged" :size="16" aria-hidden="true" />
        <GitPullRequest v-else-if="pull.state === 'open'" :size="16" aria-hidden="true" />
        <CircleOff v-else :size="16" aria-hidden="true" />
        <span>{{ statusText }}</span>
      </div>
      <h3>#{{ pull.number }} {{ pull.title }}</h3>
      <p>
        {{ pull.author || "未知作者" }} opened
        <time :datetime="pull.createdAt">{{ formatDateTime(pull.createdAt) }}</time>
        · updated
        <time :datetime="pull.updatedAt">{{ formatDateTime(pull.updatedAt) }}</time>
      </p>
    </header>

    <section class="pull-detail__checks" aria-label="Checks">
      <div class="pull-detail__section-head">
        <h4>Checks</h4>
        <span>{{ checksLoading ? "正在读取..." : checks.length ? `${checks.length} 个 checks` : "没有 checks" }}</span>
      </div>
      <ul v-if="checks.length" class="pull-detail__check-list">
        <li v-for="check in checks" :key="check.id">
          <span>{{ check.name }}</span>
          <button v-if="checkUrl(check)" type="button" @click="openCheck(check)">
            {{ checkText(check) }}
          </button>
          <em v-else>{{ checkText(check) }}</em>
        </li>
      </ul>
      <p v-else class="muted">当前 Pull Request 没有 check 记录。</p>
    </section>

    <section v-if="canMerge" class="pull-detail__merge" aria-label="合并操作">
      <div>
        <h4>合并方式</h4>
        <span>选择合并策略后执行 Pull Request 合并。</span>
      </div>
      <div class="pull-detail__merge-actions">
        <div class="ui-segmented pull-detail__merge-methods" role="group" aria-label="合并方式">
          <button
            v-for="method in mergeMethodOptions"
            :key="method.value"
            type="button"
            :class="{ 'is-active': mergeMethod === method.value }"
            :aria-pressed="mergeMethod === method.value"
            @click="emit('update:mergeMethod', method.value)"
          >
            {{ method.label }}
          </button>
        </div>
        <button type="button" class="primary" :disabled="updating" @click="emit('merge', pull)">
          <LoaderCircle v-if="updating" :size="14" aria-hidden="true" class="sb-spin" />
          <GitMerge v-else :size="14" aria-hidden="true" />
          合并
        </button>
      </div>
    </section>

    <section class="pull-detail__body" aria-label="Pull Request 讨论">
      <div class="pull-detail__section-head">
        <h4>讨论</h4>
      </div>
      <RepoDiscussionTimeline
        :items="discussionTimeline"
        :loading="discussionLoading"
        :error="discussionError"
        :link-base-url="linkBaseUrl"
        :timeline-item-opener="props.timelineItemOpener"
        empty-text="当前 Pull Request 没有讨论内容。"
      />
    </section>
  </article>
</template>

<style scoped>
.pull-detail {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.pull-detail__head,
.pull-detail__merge-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pull-detail__head {
  justify-content: space-between;
}

.pull-detail__back,
.pull-detail__merge-actions > button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  white-space: nowrap;
}

.pull-detail__title-block {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.pull-detail__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  color: var(--success);
  font-size: 12px;
  font-weight: 700;
}

.pull-detail__status.is-closed {
  color: var(--text-muted);
}

.pull-detail__title-block h3 {
  margin: 0;
  color: var(--text);
  font-size: 18px;
  line-height: 1.35;
}

.pull-detail__title-block p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.pull-detail__checks,
.pull-detail__merge {
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.pull-detail__section-head span,
.pull-detail__merge span {
  color: var(--text-muted);
  font-size: 11px;
}

.pull-detail__checks,
.pull-detail__merge {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.pull-detail__body {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.pull-detail__section-head,
.pull-detail__merge {
  align-items: center;
}

.pull-detail__section-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.pull-detail__section-head h4,
.pull-detail__merge h4 {
  margin: 0;
  color: var(--text);
  font-size: 13px;
}

.pull-detail__check-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pull-detail__check-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.pull-detail__check-list span {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pull-detail__check-list button,
.pull-detail__check-list em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
  text-decoration: none;
}

.pull-detail__check-list button:hover {
  color: var(--text);
}

.pull-detail__merge {
  grid-template-columns: minmax(0, 1fr) auto;
}

.pull-detail__merge > div:first-child {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.pull-detail__merge-methods {
  height: 30px;
}

.pull-detail__merge-methods button {
  height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.pull-detail__body .muted,
.pull-detail__checks .muted {
  margin: 0;
}

@media (max-width: 760px) {
  .pull-detail__merge {
    grid-template-columns: 1fr;
  }

  .pull-detail__head,
  .pull-detail__merge-actions {
    align-items: stretch;
    flex-wrap: wrap;
  }
}
</style>
