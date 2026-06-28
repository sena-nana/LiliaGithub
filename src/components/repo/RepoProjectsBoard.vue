<script setup lang="ts">
import {
  CircleDot,
  CircleOff,
  GitMerge,
  GitPullRequest,
  Search,
} from "@lucide/vue";
import type {
  GitHubIssue,
  GitHubPullRequest,
} from "../../services/workspace/types";
import {
  isOpenRepoProjectsBoardItem,
  repoProjectsBoardItemStateText,
  type RepoProjectsBoardItem,
} from "./useRepoProjectsBoard";

const props = defineProps<{
  items: RepoProjectsBoardItem[];
  query: string;
  projectCountTotal: number;
  loadingText: string;
  emptyText: string;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  openIssue: [issue: GitHubIssue];
  openPullRequest: [pull: GitHubPullRequest];
}>();

const VISIBLE_LABEL_LIMIT = 2;

function itemUpdatedText(item: RepoProjectsBoardItem) {
  return `更新于 ${formatDate(item.updatedAt)}`;
}

function itemDetailsTitle(item: RepoProjectsBoardItem) {
  return [
    `#${item.number} ${item.title}`,
    item.kind === "issue" ? "Issue" : "PR",
    repoProjectsBoardItemStateText(item),
    item.author ? `opened by ${item.author}` : "未知作者",
    itemUpdatedText(item),
    item.assignees.length ? `负责人 ${item.assignees.join(", ")}` : "未分配",
    item.milestone ? `里程碑 ${item.milestone}` : null,
    item.projectItems.length ? `Projects ${item.projectItems.map((project) => project.title).join(", ")}` : "No project",
    item.labels.length ? `Labels ${item.labels.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
}

function labelChips(item: RepoProjectsBoardItem) {
  const visible = [...item.labels]
    .sort((left, right) => labelRank(left) - labelRank(right))
    .slice(0, VISIBLE_LABEL_LIMIT);
  const hiddenCount = item.labels.length - visible.length;
  return hiddenCount > 0 ? [...visible, `+${hiddenCount}`] : visible;
}

function labelRank(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.startsWith("area:")) return 0;
  if (/^(v\d|\d)|milestone|roadmap/.test(normalized)) return 1;
  return 2;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function openItem(item: RepoProjectsBoardItem) {
  if (item.issue) {
    emit("openIssue", item.issue);
    return;
  }
  if (item.pull) emit("openPullRequest", item.pull);
}
</script>

<template>
  <section class="projects-board" aria-label="Projects board">
    <div class="projects-board__toolbar">
      <div class="projects-board__title">
        <h3>Projects</h3>
        <span>{{ items.length }} items · {{ projectCountTotal }} projects · {{ loadingText }}</span>
      </div>

      <label class="projects-board__search">
        <Search :size="15" aria-hidden="true" />
        <input
          :value="query"
          type="search"
          placeholder="搜索项目事项"
          aria-label="搜索项目事项"
          data-agent-id="repo.projects.search"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <div class="projects-board__list" role="list" aria-label="Project items">
      <button
        v-for="item in props.items"
        :key="item.key"
        type="button"
        class="repo-list-row repo-list-row--with-actions projects-board-row"
        :class="{
          'projects-board-row--issue': item.kind === 'issue',
          'projects-board-row--pull': item.kind === 'pull',
          'is-closed': !isOpenRepoProjectsBoardItem(item),
        }"
        :data-agent-id="`repo.projects.${item.kind}.${item.number}.open`"
        :title="itemDetailsTitle(item)"
        @click="openItem(item)"
      >
        <span class="projects-board-row__status" :title="repoProjectsBoardItemStateText(item)">
          <CircleDot v-if="item.kind === 'issue' && isOpenRepoProjectsBoardItem(item)" :size="16" aria-hidden="true" />
          <GitPullRequest v-else-if="item.kind === 'pull' && isOpenRepoProjectsBoardItem(item)" :size="16" aria-hidden="true" />
          <GitMerge v-else-if="item.merged" :size="16" aria-hidden="true" />
          <CircleOff v-else :size="16" aria-hidden="true" />
        </span>
        <span class="projects-board-row__body">
          <span class="projects-board-row__title-line">
            <strong class="repo-list-row__title">#{{ item.number }} {{ item.title }}</strong>
            <em>{{ item.kind === "issue" ? "Issue" : "PR" }}</em>
            <span class="repo-list-row__meta projects-board-row__updated">{{ itemUpdatedText(item) }}</span>
          </span>
          <span v-if="item.labels.length" class="projects-board-row__chips" aria-label="Labels">
            <em
              v-for="label in labelChips(item)"
              :key="`label:${item.key}:${label}`"
              :class="{ 'projects-board-row__more': label.startsWith('+') }"
            >
              {{ label }}
            </em>
          </span>
        </span>
      </button>
    </div>

    <p v-if="!items.length" class="muted repo-empty projects-board__empty">{{ emptyText }}</p>
  </section>
</template>

<style scoped>
.projects-board {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.projects-board__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 280px);
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-soft);
}

.projects-board__title {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.projects-board__title h3 {
  margin: 0;
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
}

.projects-board__title span,
.projects-board-row__updated {
  color: var(--text-muted);
  font-size: 12px;
}

.projects-board__search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text-muted);
}

.projects-board__search input {
  min-width: 0;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  outline: none;
}

.projects-board__list {
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.projects-board-row {
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  width: 100%;
  min-height: 52px;
  border: 0;
  border-bottom: 1px solid var(--border-soft);
  border-radius: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.projects-board-row:hover,
.projects-board-row:focus-visible {
  background: var(--bg-hover);
  filter: none;
}

.projects-board-row__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 22px;
  color: var(--ok);
}

.projects-board-row--pull .projects-board-row__status {
  color: var(--accent);
}

.projects-board-row.is-closed .projects-board-row__status {
  color: var(--text-muted);
}

.projects-board-row__body {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.projects-board-row__title-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.projects-board-row__title-line strong {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board-row__title-line em,
.projects-board-row__chips em {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  height: 19px;
  padding: 0 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  line-height: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board-row__chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.projects-board-row__chips em {
  background: var(--accent-soft);
  color: var(--accent);
}

.projects-board-row__chips .projects-board-row__more {
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.projects-board-row__updated {
  min-width: 0;
  overflow: hidden;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board__empty {
  margin: 0;
  padding: 18px;
  text-align: center;
}

@media (max-width: 900px) {
  .projects-board__toolbar,
  .projects-board-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .projects-board-row {
    padding-left: 12px;
  }

  .projects-board-row__status {
    display: none;
  }
}
</style>
