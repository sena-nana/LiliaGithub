<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CircleDot,
  CircleOff,
  GitMerge,
  GitPullRequest,
  ListFilter,
  LoaderCircle,
  RotateCw,
  Search,
} from "@lucide/vue";
import type {
  GitHubIssue,
  GitHubIssueProjectItem,
  GitHubPullRequest,
} from "../../services/workspace/types";

type BoardItemKind = "issue" | "pull";
type BoardTypeFilter = "all" | BoardItemKind;
type BoardStateFilter = "open" | "closed" | "all";
type BoardItem = {
  key: string;
  kind: BoardItemKind;
  number: number;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  author: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  projectItems: GitHubIssueProjectItem[];
  updatedAt: string;
  searchText: string;
  issue?: GitHubIssue;
  pull?: GitHubPullRequest;
};
type BoardColumn = {
  id: string;
  title: string;
  items: BoardItem[];
};

const NO_PROJECT_ID = "__no_project__";

const props = defineProps<{
  issues: GitHubIssue[];
  pulls: GitHubPullRequest[];
  projects: GitHubIssueProjectItem[];
  loading: boolean;
  metadataLoading: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  openIssue: [issue: GitHubIssue];
  openPullRequest: [pull: GitHubPullRequest];
}>();

const typeFilter = ref<BoardTypeFilter>("all");
const stateFilter = ref<BoardStateFilter>("open");
const query = ref("");

const typeFilters: readonly { value: BoardTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "issue", label: "Issues" },
  { value: "pull", label: "PRs" },
];
const stateFilters: readonly { value: BoardStateFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const allItems = computed<BoardItem[]>(() => [
  ...props.issues.map((issue) => boardIssue(issue)),
  ...props.pulls.map((pull) => boardPull(pull)),
].sort((left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt)));

const projectColumns = computed(() => {
  const byId = new Map<string, GitHubIssueProjectItem>();
  for (const project of props.projects) byId.set(project.id, project);
  for (const item of allItems.value) {
    for (const project of item.projectItems) byId.set(project.id, project);
  }
  return [...byId.values()].sort((left, right) => left.title.localeCompare(right.title));
});

const visibleItems = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return allItems.value.filter((item) => {
    if (typeFilter.value !== "all" && item.kind !== typeFilter.value) return false;
    if (stateFilter.value === "open" && !isOpenItem(item)) return false;
    if (stateFilter.value === "closed" && isOpenItem(item)) return false;
    return !needle || item.searchText.includes(needle);
  });
});

const boardColumns = computed<BoardColumn[]>(() => {
  const columns: BoardColumn[] = projectColumns.value.map((project) => ({
    id: project.id,
    title: project.title,
    items: visibleItems.value.filter((item) => item.projectItems.some((entry) => entry.id === project.id)),
  }));
  const unassignedItems = visibleItems.value.filter((item) => !item.projectItems.length);
  if (unassignedItems.length || !columns.length) {
    columns.push({ id: NO_PROJECT_ID, title: "No project", items: unassignedItems });
  }
  return columns;
});

const issueCount = computed(() => visibleItems.value.filter((item) => item.kind === "issue").length);
const pullCount = computed(() => visibleItems.value.filter((item) => item.kind === "pull").length);
const projectCount = computed(() => projectColumns.value.length);
const emptyText = computed(() => props.loading ? "正在读取项目事项。" : "没有匹配的项目事项。");

function boardIssue(issue: GitHubIssue): BoardItem {
  const projectItems = issue.projectItems ?? [];
  return {
    key: `issue:${issue.number}`,
    kind: "issue",
    number: issue.number,
    title: issue.title,
    state: issue.state,
    merged: false,
    draft: false,
    author: issue.author ?? "",
    labels: issue.labels ?? [],
    assignees: issue.assignees ?? [],
    milestone: issue.milestone?.title ?? null,
    projectItems,
    updatedAt: issue.updatedAt,
    searchText: searchText([
      issue.title,
      issue.author,
      issue.state,
      issue.milestone?.title,
      ...(issue.labels ?? []),
      ...(issue.assignees ?? []),
      ...projectItems.map((project) => project.title),
    ]),
    issue,
  };
}

function boardPull(pull: GitHubPullRequest): BoardItem {
  const projectItems = pull.projectItems ?? [];
  return {
    key: `pull:${pull.number}`,
    kind: "pull",
    number: pull.number,
    title: pull.title,
    state: pull.state,
    merged: pull.merged,
    draft: pull.draft,
    author: pull.author,
    labels: pull.labels ?? [],
    assignees: pull.assignees ?? [],
    milestone: pull.milestone?.title ?? null,
    projectItems,
    updatedAt: pull.updatedAt,
    searchText: searchText([
      pull.title,
      pull.author,
      pull.state,
      pull.baseBranch,
      pull.headBranch,
      pull.milestone?.title,
      ...(pull.labels ?? []),
      ...(pull.assignees ?? []),
      ...projectItems.map((project) => project.title),
    ]),
    pull,
  };
}

function searchText(parts: readonly (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function dateValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isOpenItem(item: BoardItem) {
  return item.kind === "pull" ? item.state === "open" && !item.merged : item.state === "open";
}

function itemStateText(item: BoardItem) {
  if (item.merged) return "merged";
  if (item.draft) return "draft";
  return item.state;
}

function itemKindLabel(item: BoardItem) {
  return item.kind === "issue" ? "Issue" : "PR";
}

function itemMeta(item: BoardItem) {
  return [
    item.author || "未知作者",
    item.assignees.length ? item.assignees.join(", ") : "未分配",
    item.milestone,
    `更新于 ${formatDate(item.updatedAt)}`,
  ].filter(Boolean).join(" · ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function openItem(item: BoardItem) {
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
        <span>{{ visibleItems.length }} items · {{ projectCount }} projects</span>
      </div>

      <div class="projects-board__controls">
        <div class="projects-board__segments" role="group" aria-label="事项类型">
          <button
            v-for="filter in typeFilters"
            :key="filter.value"
            type="button"
            :class="{ 'is-active': typeFilter === filter.value }"
            :aria-pressed="typeFilter === filter.value"
            @click="typeFilter = filter.value"
          >
            {{ filter.label }}
          </button>
        </div>
        <div class="projects-board__segments" role="group" aria-label="事项状态">
          <button
            v-for="filter in stateFilters"
            :key="filter.value"
            type="button"
            :class="{ 'is-active': stateFilter === filter.value }"
            :aria-pressed="stateFilter === filter.value"
            @click="stateFilter = filter.value"
          >
            {{ filter.label }}
          </button>
        </div>
        <label class="projects-board__search">
          <Search :size="15" aria-hidden="true" />
          <input v-model="query" type="search" placeholder="搜索项目事项" aria-label="搜索项目事项" />
        </label>
        <button
          type="button"
          class="ghost projects-board__refresh"
          :disabled="loading || metadataLoading"
          aria-label="刷新 Projects"
          title="刷新"
          @click="emit('refresh')"
        >
          <LoaderCircle v-if="loading || metadataLoading" :size="15" aria-hidden="true" class="sb-spin" />
          <RotateCw v-else :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="projects-board__summary" aria-label="Projects 摘要">
      <span><CircleDot :size="13" aria-hidden="true" />{{ issueCount }} Issues</span>
      <span><GitPullRequest :size="13" aria-hidden="true" />{{ pullCount }} PRs</span>
      <span><ListFilter :size="13" aria-hidden="true" />{{ boardColumns.length }} columns</span>
    </div>

    <div class="projects-board__columns" role="list" aria-label="Project columns">
      <section
        v-for="column in boardColumns"
        :key="column.id"
        class="projects-board__column"
        :aria-label="column.title"
      >
        <header class="projects-board__column-head">
          <strong>{{ column.title }}</strong>
          <span>{{ column.items.length }}</span>
        </header>

        <div class="projects-board__cards" role="list">
          <button
            v-for="item in column.items"
            :key="item.key"
            type="button"
            class="projects-board-card"
            :class="{
              'projects-board-card--issue': item.kind === 'issue',
              'projects-board-card--pull': item.kind === 'pull',
              'is-closed': !isOpenItem(item),
            }"
            @click="openItem(item)"
          >
            <span class="projects-board-card__status" :title="itemStateText(item)">
              <CircleDot v-if="item.kind === 'issue' && isOpenItem(item)" :size="14" aria-hidden="true" />
              <GitPullRequest v-else-if="item.kind === 'pull' && isOpenItem(item)" :size="14" aria-hidden="true" />
              <GitMerge v-else-if="item.merged" :size="14" aria-hidden="true" />
              <CircleOff v-else :size="14" aria-hidden="true" />
            </span>
            <span class="projects-board-card__body">
              <strong>#{{ item.number }} {{ item.title }}</strong>
              <span>{{ itemKindLabel(item) }} · {{ itemMeta(item) }}</span>
              <span v-if="item.labels.length" class="projects-board-card__chips">
                <em v-for="label in item.labels" :key="label">{{ label }}</em>
              </span>
            </span>
          </button>
          <p v-if="!column.items.length" class="muted projects-board__empty-column">暂无事项</p>
        </div>
      </section>
    </div>

    <p v-if="!visibleItems.length" class="muted repo-empty projects-board__empty">{{ emptyText }}</p>
  </section>
</template>

<style scoped>
.projects-board {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 10px;
  min-width: 0;
  min-height: 0;
}

.projects-board__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
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
.projects-board__summary,
.projects-board-card__body > span {
  color: var(--text-muted);
  font-size: 12px;
}

.projects-board__controls {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.projects-board__segments {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 2px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.projects-board__segments button {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.projects-board__segments button.is-active {
  background: var(--bg-elev);
  color: var(--text);
}

.projects-board__search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 170px;
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

.projects-board__refresh {
  width: 32px;
  height: 32px;
  padding: 0;
}

.projects-board__summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.projects-board__summary span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-weight: 600;
}

.projects-board__columns {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(250px, 300px);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-bottom: 2px;
}

.projects-board__column {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.projects-board__column-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-soft);
}

.projects-board__column-head strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board__column-head span {
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-elev);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}

.projects-board__cards {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.projects-board-card {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  color: var(--text);
  text-align: left;
}

.projects-board-card:hover,
.projects-board-card:focus-visible {
  border-color: var(--accent);
  background: var(--bg-hover);
  filter: none;
}

.projects-board-card__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  color: var(--ok);
}

.projects-board-card--pull .projects-board-card__status {
  color: var(--accent);
}

.projects-board-card.is-closed .projects-board-card__status {
  color: var(--text-muted);
}

.projects-board-card__body {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.projects-board-card__body strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.32;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board-card__body > span {
  min-width: 0;
  overflow: hidden;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.projects-board-card__chips em {
  min-width: 0;
  max-width: 100%;
  height: 19px;
  padding: 0 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  line-height: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board__empty-column,
.projects-board__empty {
  margin: 0;
  padding: 12px 4px;
  text-align: center;
}

@media (max-width: 900px) {
  .projects-board__toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .projects-board__controls {
    flex-wrap: wrap;
  }

  .projects-board__search {
    flex: 1 1 190px;
  }

  .projects-board__columns {
    grid-auto-columns: minmax(230px, 86vw);
  }
}
</style>
