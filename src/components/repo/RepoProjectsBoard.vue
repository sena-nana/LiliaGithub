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
type BoardProjectFilter = string;
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

const ALL_PROJECTS_ID = "__all_projects__";
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
const projectFilter = ref<BoardProjectFilter>(ALL_PROJECTS_ID);
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

const projects = computed(() => {
  const byId = new Map<string, GitHubIssueProjectItem>();
  for (const project of props.projects) byId.set(project.id, project);
  for (const item of allItems.value) {
    for (const project of item.projectItems) byId.set(project.id, project);
  }
  return [...byId.values()].sort((left, right) => left.title.localeCompare(right.title));
});

const baseFilteredItems = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return allItems.value.filter((item) => {
    if (typeFilter.value !== "all" && item.kind !== typeFilter.value) return false;
    if (stateFilter.value === "open" && !isOpenItem(item)) return false;
    if (stateFilter.value === "closed" && isOpenItem(item)) return false;
    return !needle || item.searchText.includes(needle);
  });
});

const visibleItems = computed(() =>
  baseFilteredItems.value.filter((item) => projectMatches(item, projectFilter.value))
);

const projectFilterOptions = computed(() => {
  const options = projects.value.map((project) => ({
    id: project.id,
    title: project.title,
    count: projectCount(project.id),
  }));
  const unassignedCount = projectCount(NO_PROJECT_ID);
  if (unassignedCount || !options.length) {
    options.push({ id: NO_PROJECT_ID, title: "No project", count: unassignedCount });
  }
  return options;
});

const issueCount = computed(() => visibleItems.value.filter((item) => item.kind === "issue").length);
const pullCount = computed(() => visibleItems.value.filter((item) => item.kind === "pull").length);
const projectCountTotal = computed(() => projects.value.length);
const loadingText = computed(() => props.loading || props.metadataLoading ? "读取中" : "已同步");
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

function projectMatches(item: BoardItem, projectId: BoardProjectFilter) {
  if (projectId === ALL_PROJECTS_ID) return true;
  if (projectId === NO_PROJECT_ID) return item.projectItems.length === 0;
  return item.projectItems.some((project) => project.id === projectId);
}

function projectCount(projectId: BoardProjectFilter) {
  return baseFilteredItems.value.filter((item) => projectMatches(item, projectId)).length;
}

function itemStateText(item: BoardItem) {
  if (item.merged) return "merged";
  if (item.draft) return "draft";
  return item.state;
}

function itemMeta(item: BoardItem) {
  return [
    item.author ? `opened by ${item.author}` : "未知作者",
    `更新于 ${formatDate(item.updatedAt)}`,
    item.assignees.length ? `负责人 ${item.assignees.join(", ")}` : "未分配",
    item.milestone ? `里程碑 ${item.milestone}` : null,
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
    <main class="projects-board__main">
      <div class="projects-board__toolbar">
        <div class="projects-board__title">
          <h3>Projects</h3>
          <span>{{ visibleItems.length }} items · {{ projectCountTotal }} projects · {{ loadingText }}</span>
        </div>

        <label class="projects-board__search">
          <Search :size="15" aria-hidden="true" />
          <input v-model="query" type="search" placeholder="搜索项目事项" aria-label="搜索项目事项" />
        </label>
      </div>

      <div class="projects-board__list" role="list" aria-label="Project items">
        <button
          v-for="item in visibleItems"
          :key="item.key"
          type="button"
          class="repo-list-row repo-list-row--with-actions projects-board-row"
          :class="{
            'projects-board-row--issue': item.kind === 'issue',
            'projects-board-row--pull': item.kind === 'pull',
            'is-closed': !isOpenItem(item),
          }"
          @click="openItem(item)"
        >
          <span class="projects-board-row__status" :title="itemStateText(item)">
            <CircleDot v-if="item.kind === 'issue' && isOpenItem(item)" :size="16" aria-hidden="true" />
            <GitPullRequest v-else-if="item.kind === 'pull' && isOpenItem(item)" :size="16" aria-hidden="true" />
            <GitMerge v-else-if="item.merged" :size="16" aria-hidden="true" />
            <CircleOff v-else :size="16" aria-hidden="true" />
          </span>
            <span class="projects-board-row__body">
            <span class="projects-board-row__title-line">
              <strong class="repo-list-row__title">#{{ item.number }} {{ item.title }}</strong>
              <em>{{ item.kind === "issue" ? "Issue" : "PR" }}</em>
              <em>{{ itemStateText(item) }}</em>
            </span>
            <span class="repo-list-row__meta projects-board-row__meta">{{ itemMeta(item) }}</span>
            <span class="projects-board-row__chips">
              <em v-for="label in item.labels" :key="`label:${item.key}:${label}`">{{ label }}</em>
              <em v-if="item.milestone">{{ item.milestone }}</em>
              <em
                v-for="project in item.projectItems"
                :key="`project:${item.key}:${project.id}`"
                class="projects-board-row__project"
              >
                {{ project.title }}
              </em>
              <em v-if="!item.projectItems.length" class="projects-board-row__project">No project</em>
            </span>
          </span>
        </button>
      </div>

      <p v-if="!visibleItems.length" class="muted repo-empty projects-board__empty">{{ emptyText }}</p>
    </main>

    <aside class="projects-board__sidebar" aria-label="Projects filters">
      <section class="projects-board-sidebar-card" aria-label="Projects 摘要">
        <div class="projects-board-sidebar-card__head">
          <ListFilter :size="14" aria-hidden="true" />
          <strong>Overview</strong>
        </div>
        <dl class="projects-board__stats">
          <div>
            <dt>Items</dt>
            <dd>{{ visibleItems.length }}</dd>
          </div>
          <div>
            <dt>Issues</dt>
            <dd>{{ issueCount }}</dd>
          </div>
          <div>
            <dt>PRs</dt>
            <dd>{{ pullCount }}</dd>
          </div>
          <div>
            <dt>Projects</dt>
            <dd>{{ projectCountTotal }}</dd>
          </div>
        </dl>
        <button
          type="button"
          class="ghost projects-board__refresh"
          :disabled="loading || metadataLoading"
          aria-label="刷新 Projects"
          @click="emit('refresh')"
        >
          <LoaderCircle v-if="loading || metadataLoading" :size="14" aria-hidden="true" class="sb-spin" />
          <RotateCw v-else :size="14" aria-hidden="true" />
          刷新 Projects
        </button>
      </section>

      <section class="projects-board-sidebar-card" aria-label="事项类型">
        <div class="projects-board-sidebar-card__head">
          <strong>Type</strong>
        </div>
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
      </section>

      <section class="projects-board-sidebar-card" aria-label="事项状态">
        <div class="projects-board-sidebar-card__head">
          <strong>Status</strong>
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
      </section>

      <section class="projects-board-sidebar-card" aria-label="Project filters">
        <div class="projects-board-sidebar-card__head">
          <strong>Projects</strong>
        </div>
        <nav class="projects-board__project-list" aria-label="Project filters">
          <button
            type="button"
            :class="{ 'is-active': projectFilter === ALL_PROJECTS_ID }"
            @click="projectFilter = ALL_PROJECTS_ID"
          >
            <span>All projects</span>
            <em>{{ baseFilteredItems.length }}</em>
          </button>
          <button
            v-for="project in projectFilterOptions"
            :key="project.id"
            type="button"
            :class="{ 'is-active': projectFilter === project.id }"
            @click="projectFilter = project.id"
          >
            <span>{{ project.title }}</span>
            <em>{{ project.count }}</em>
          </button>
        </nav>
      </section>
    </aside>
  </section>
</template>

<style scoped>
.projects-board {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 260px);
  gap: 14px;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.projects-board__main,
.projects-board__sidebar {
  min-width: 0;
  min-height: 0;
}

.projects-board__main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  align-self: stretch;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
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
.projects-board-row__meta {
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
  align-items: start;
  width: 100%;
  min-height: 72px;
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
  gap: 5px;
  min-width: 0;
}

.projects-board-row__title-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
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
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.projects-board-row__chips em {
  background: var(--accent-soft);
  color: var(--accent);
}

.projects-board-row__chips .projects-board-row__project {
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.projects-board-row__meta {
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

.projects-board__sidebar {
  display: grid;
  align-content: start;
  gap: 10px;
  overflow: auto;
}

.projects-board-sidebar-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.projects-board-sidebar-card__head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
}

.projects-board-sidebar-card__head strong {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board__stats {
  display: grid;
  gap: 7px;
  min-width: 0;
  margin: 0;
}

.projects-board__stats div {
  display: grid;
  grid-template-columns: minmax(58px, max-content) minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.projects-board__stats dt,
.projects-board__stats dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board__stats dd {
  color: var(--text);
  font-weight: 600;
}

.projects-board__refresh {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.projects-board__segments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  min-width: 0;
  padding: 2px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.projects-board__segments button {
  height: 28px;
  min-width: 0;
  padding: 0 6px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board__segments button.is-active {
  background: var(--bg-elev);
  color: var(--text);
}

.projects-board__project-list {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.projects-board__project-list button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 30px;
  padding: 0 7px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  text-align: left;
}

.projects-board__project-list button:hover,
.projects-board__project-list button:focus-visible,
.projects-board__project-list button.is-active {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.projects-board__project-list span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projects-board__project-list em {
  min-width: 20px;
  height: 19px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  line-height: 19px;
  text-align: center;
}

@media (max-width: 900px) {
  .projects-board {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .projects-board__sidebar {
    order: -1;
    overflow: visible;
  }

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
