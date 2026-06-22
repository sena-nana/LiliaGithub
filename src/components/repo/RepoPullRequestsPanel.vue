<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ArrowRight,
  CircleOff,
  GitMerge,
  GitPullRequest,
  ListFilter,
  Plus,
  Search,
} from "@lucide/vue";
import Dropdown from "../Dropdown.vue";
import type {
  GitHubDiscussionTimelineItem,
  GitHubIssueFilterMetadata,
  GitHubPullRequest,
  GitHubPullRequestCheck,
} from "../../services/workspace/types";
import type {
  PullRequestDirection,
  PullRequestPanelFilters,
  PullRequestSort,
  PullRequestState,
} from "./pullRequestPanelTypes";
import RepoPullRequestDetail from "./RepoPullRequestDetail.vue";

const props = defineProps<{
  pulls: GitHubPullRequest[];
  state: PullRequestState;
  filters: PullRequestPanelFilters;
  metadata: GitHubIssueFilterMetadata;
  metadataLoading: boolean;
  loading: boolean;
  checksLoading: boolean;
  discussionLoading: boolean;
  discussionError: string | null;
  discussionTimeline: readonly GitHubDiscussionTimelineItem[];
  updating: boolean;
  focusedPullRequestNumber: number | null;
  focusedPullRequestDetail: GitHubPullRequest | null;
  pullChecks: Record<number, GitHubPullRequestCheck[]>;
  mergeMethod: "merge" | "squash" | "rebase";
  repoFullName: string;
  isFocused: (pullNumber: number) => boolean;
}>();

const emit = defineEmits<{
  "update:state": [value: PullRequestState];
  "update:filters": [value: PullRequestPanelFilters];
  "update:mergeMethod": [value: "merge" | "squash" | "rebase"];
  create: [];
  back: [];
  focus: [pull: GitHubPullRequest];
  open: [pull: GitHubPullRequest];
  toggle: [pull: GitHubPullRequest];
  merge: [pull: GitHubPullRequest];
}>();

const filtersOpen = ref(false);

const stateFilters: readonly { value: PullRequestState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
];

const sortOptions = [
  { value: "updated-desc", label: "最近更新" },
  { value: "created-desc", label: "最新创建" },
  { value: "created-asc", label: "最早创建" },
  { value: "comments-desc", label: "评论最多" },
] as const;

const reviewOptions = [
  { value: "", label: "任意 Review" },
  { value: "none", label: "未评审" },
  { value: "required", label: "需要评审" },
  { value: "approved", label: "已批准" },
  { value: "changes_requested", label: "请求更改" },
] as const;

const pullAuthors = computed(() => props.pulls.map((pull) => pull.author));
const pullLabels = computed(() => props.pulls.flatMap((pull) => pull.labels ?? []));
const pullAssignees = computed(() => props.pulls.flatMap((pull) => pull.assignees ?? []));
const pullMilestones = computed(() => props.pulls.flatMap((pull) => pull.milestone ? [pull.milestone] : []));
const pullProjects = computed(() => props.pulls.flatMap((pull) => pull.projectItems ?? []));
const focusedPullRequest = computed(() => {
  const pullNumber = props.focusedPullRequestNumber;
  if (pullNumber == null) return null;
  if (props.focusedPullRequestDetail?.number === pullNumber) return props.focusedPullRequestDetail;
  return props.pulls.find((pull) => pull.number === pullNumber) ?? null;
});

const authorOptions = computed(() => [
  { value: "", label: "任意作者" },
  ...uniqueSorted([...props.metadata.authors, ...pullAuthors.value]).map((author) => ({ value: author, label: author })),
]);
const labelOptions = computed(() => {
  const labels = uniqueSorted([...props.metadata.labels, ...pullLabels.value]).map((label) => ({ value: label, label }));
  if (labels.length) return labels;
  return [{
    value: "__empty_labels__",
    label: props.metadataLoading ? "正在加载标签..." : "暂无标签",
    disabled: true,
  }];
});
const assigneeOptions = computed(() => [
  { value: "", label: "任意负责人" },
  { value: "none", label: "未分配" },
  ...uniqueSorted([...props.metadata.assignees, ...pullAssignees.value]).map((assignee) => ({ value: assignee, label: assignee })),
]);
const milestoneOptions = computed(() => [
  { value: "", label: "任意里程碑" },
  { value: "none", label: "无里程碑" },
  ...uniqueMilestones([...props.metadata.milestones, ...pullMilestones.value]).map((milestone) => ({
    value: String(milestone.number),
    label: milestone.title,
  })),
]);
const projectOptions = computed(() => [
  { value: "", label: "任意项目" },
  ...uniqueProjects([...props.metadata.projects, ...pullProjects.value]).map((project) => ({ value: project.id, label: project.title })),
]);

const activeSortValue = computed(() => `${props.filters.sort}-${props.filters.direction}`);
const labelSummary = computed(() => {
  if (!props.filters.labels.length) return "任意标签";
  if (props.filters.labels.length <= 2) return props.filters.labels.join(", ");
  return `${props.filters.labels.slice(0, 2).join(", ")} +${props.filters.labels.length - 2}`;
});

const activeFilterCount = computed(() =>
  [
    props.filters.creator,
    props.filters.assignee,
    props.filters.milestone,
    props.filters.project,
    props.filters.review,
    props.filters.labels.length ? "labels" : null,
  ].filter(Boolean).length
);

function updateFilters(next: Partial<PullRequestPanelFilters>) {
  emit("update:filters", {
    ...props.filters,
    ...next,
    labels: next.labels ? [...next.labels] : [...props.filters.labels],
  });
}

function updateSort(value: string) {
  const [sort, direction] = value.split("-") as [PullRequestSort, PullRequestDirection];
  updateFilters({ sort, direction });
}

function checksFor(pullNumber: number) {
  return props.pullChecks[pullNumber] ?? [];
}

function formatPullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pullStatusText(pull: GitHubPullRequest) {
  if (pull.merged) return "merged";
  if (pull.draft) return "draft";
  return pull.state;
}

function pullUpdatedText(pull: GitHubPullRequest) {
  return `更新于 ${formatPullDate(pull.updatedAt)}`;
}

function pullMetaItems(pull: GitHubPullRequest) {
  return [
    pull.author || "未知作者",
    `${pull.headBranch} -> ${pull.baseBranch}`,
    pullUpdatedText(pull),
  ];
}

function pullChips(pull: GitHubPullRequest) {
  return [
    ...(pull.labels?.length ? pull.labels.map((label) => ({ key: `label:${label}`, text: label })) : []),
    ...(pull.assignees?.length ? pull.assignees.map((assignee) => ({ key: `assignee:${assignee}`, text: assignee })) : []),
    ...(pull.projectItems?.length ? pull.projectItems.map((project) => ({ key: `project:${project.id}`, text: project.title })) : []),
    ...(pull.milestone ? [{ key: `milestone:${pull.milestone.number}`, text: pull.milestone.title }] : []),
  ];
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniqueMilestones(values: readonly NonNullable<GitHubPullRequest["milestone"]>[]) {
  const byNumber = new Map<number, NonNullable<GitHubPullRequest["milestone"]>>();
  for (const value of values) byNumber.set(value.number, value);
  return [...byNumber.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function uniqueProjects(values: readonly NonNullable<GitHubPullRequest["projectItems"]>[number][]) {
  const byId = new Map<string, NonNullable<GitHubPullRequest["projectItems"]>[number]>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()].sort((left, right) => left.title.localeCompare(right.title));
}
</script>

<template>
  <div class="pulls-panel">
    <RepoPullRequestDetail
      v-if="focusedPullRequest"
      :pull="focusedPullRequest"
      :checks="checksFor(focusedPullRequest.number)"
      :checks-loading="checksLoading"
      :discussion-timeline="discussionTimeline"
      :discussion-loading="discussionLoading"
      :discussion-error="discussionError"
      :updating="updating"
      :merge-method="mergeMethod"
      :repo-full-name="repoFullName"
      @back="emit('back')"
      @open="emit('open', $event)"
      @toggle="emit('toggle', $event)"
      @merge="emit('merge', $event)"
      @update:merge-method="emit('update:mergeMethod', $event)"
    />

    <template v-else>
    <h3 class="pulls-panel__sr-title">Pull Requests</h3>
    <div class="pulls-panel__toolbar">
      <div class="pulls-panel__states" role="group" aria-label="Pull Request 状态">
        <button
          v-for="filter in stateFilters"
          :key="filter.value"
          type="button"
          :class="{ 'is-active': state === filter.value }"
          :aria-pressed="state === filter.value"
          @click="emit('update:state', filter.value)"
        >
          <span>{{ filter.label }}</span>
          <strong>{{ state === filter.value ? pulls.length : 0 }}</strong>
        </button>
      </div>

      <button
        type="button"
        class="ghost pulls-panel__filter-button"
        :class="{ 'is-active': filtersOpen || activeFilterCount > 0 }"
        :aria-expanded="filtersOpen"
        @click="filtersOpen = !filtersOpen"
      >
        <ListFilter :size="15" aria-hidden="true" />
        筛选
        <strong v-if="activeFilterCount">{{ activeFilterCount }}</strong>
      </button>

      <label class="pulls-panel__search">
        <Search :size="15" aria-hidden="true" />
        <input
          :value="filters.query"
          type="search"
          placeholder="搜索 Pull Requests"
          aria-label="搜索 Pull Requests"
          @input="updateFilters({ query: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <button type="button" class="primary pulls-panel__new" @click="emit('create')">
        <Plus :size="14" aria-hidden="true" />
        新建 PR
      </button>
    </div>

    <div v-if="filtersOpen" class="pulls-panel__filters" aria-label="Pull Request 筛选项">
      <div class="pulls-panel__filter">
        <span>作者</span>
        <Dropdown
          :model-value="filters.creator ?? ''"
          :options="authorOptions"
          :disabled="metadataLoading && !metadata.authors.length"
          button-class="pull-filter-dropdown"
          menu-width="220px"
          menu-label="作者"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ creator: value || null })"
        />
      </div>
      <div class="pulls-panel__filter">
        <span>标签</span>
        <Dropdown
          :model-value="filters.labels"
          multiple
          :options="labelOptions"
          :display-label="labelSummary"
          :placeholder="metadataLoading ? '正在加载标签...' : '任意标签'"
          :disabled="metadataLoading && !metadata.labels.length"
          button-class="pull-filter-dropdown"
          menu-width="220px"
          menu-label="标签"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ labels: value })"
        />
      </div>
      <div class="pulls-panel__filter">
        <span>项目</span>
        <Dropdown
          :model-value="filters.project ?? ''"
          :options="projectOptions"
          :disabled="metadataLoading && !metadata.projects.length"
          button-class="pull-filter-dropdown"
          menu-width="220px"
          menu-label="项目"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ project: value || null })"
        />
      </div>
      <div class="pulls-panel__filter">
        <span>里程碑</span>
        <Dropdown
          :model-value="filters.milestone == null ? '' : String(filters.milestone)"
          :options="milestoneOptions"
          :disabled="metadataLoading && !metadata.milestones.length"
          button-class="pull-filter-dropdown"
          menu-width="220px"
          menu-label="里程碑"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ milestone: value || null })"
        />
      </div>
      <div class="pulls-panel__filter">
        <span>Reviews</span>
        <Dropdown
          :model-value="filters.review ?? ''"
          :options="reviewOptions"
          button-class="pull-filter-dropdown"
          menu-width="220px"
          menu-label="Reviews"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ review: value || null })"
        />
      </div>
      <div class="pulls-panel__filter">
        <span>负责人</span>
        <Dropdown
          :model-value="filters.assignee ?? ''"
          :options="assigneeOptions"
          :disabled="metadataLoading && !metadata.assignees.length"
          button-class="pull-filter-dropdown"
          menu-width="220px"
          menu-label="负责人"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ assignee: value || null })"
        />
      </div>
      <div class="pulls-panel__filter">
        <span>排序</span>
        <Dropdown
          :model-value="activeSortValue"
          :options="sortOptions"
          button-class="pull-filter-dropdown"
          menu-width="220px"
          menu-label="排序"
          placement="bottom"
          @update:model-value="updateSort"
        />
      </div>
    </div>

    <div class="pulls-list" role="list" aria-label="Pull Requests">
      <div
        v-for="pull in pulls"
        :key="pull.number"
        class="pulls-list__item project-row--pull"
        :class="{ 'is-target': isFocused(pull.number) }"
        :data-pull-number="pull.number"
        role="listitem"
        @click="emit('focus', pull)"
      >
        <span class="pulls-list__status" :class="{ 'is-closed': pull.state !== 'open' || pull.merged }" :title="pullStatusText(pull)">
          <GitMerge v-if="pull.merged" :size="15" aria-hidden="true" />
          <GitPullRequest v-else-if="pull.state === 'open'" :size="15" aria-hidden="true" />
          <CircleOff v-else :size="15" aria-hidden="true" />
        </span>
        <div class="pulls-list__content">
          <strong class="pulls-list__title">#{{ pull.number }} {{ pull.title }}</strong>
          <div class="pulls-list__meta">
            <span v-for="item in pullMetaItems(pull)" :key="item">{{ item }}</span>
          </div>
          <div v-if="pullChips(pull).length" class="pulls-list__chips" aria-label="Pull Request 元数据">
            <span v-for="chip in pullChips(pull)" :key="chip.key">{{ chip.text }}</span>
          </div>
          <span v-else class="pulls-list__empty-meta">无标签 · 未分配 · 无项目</span>
        </div>
        <ArrowRight class="pulls-list__arrow" :size="15" aria-hidden="true" />
      </div>

      <p v-if="!pulls.length && !loading" class="muted repo-empty pulls-list__empty">
        没有匹配的 Pull Request。
      </p>
      <p v-else-if="loading && !pulls.length" class="muted repo-empty pulls-list__empty">
        正在读取 Pull Requests。
      </p>
    </div>
    </template>
  </div>
</template>

<style scoped>
.pulls-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.pulls-panel__sr-title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.pulls-panel__toolbar {
  display: grid;
  grid-template-columns: auto auto minmax(180px, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pulls-panel__states {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.pulls-panel__states button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
}

.pulls-panel__states button.is-active {
  background: var(--bg-active);
  color: var(--text);
}

.pulls-panel__states strong,
.pulls-panel__filter-button strong {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text);
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}

.pulls-panel__filter-button,
.pulls-panel__new {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
  white-space: nowrap;
}

.pulls-panel__filter-button.is-active {
  color: var(--text);
  background: var(--bg-hover);
}

.pulls-panel__search {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.pulls-panel__search input {
  min-width: 0;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
}

.pulls-panel__filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 10px;
  box-sizing: border-box;
  overflow: visible;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.pulls-panel__filter {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.pulls-panel__filter > span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.pulls-panel__filter :deep(.dd) {
  width: 100%;
  min-width: 0;
}

.pulls-panel__filter :deep(.pull-filter-dropdown) {
  width: 100%;
  min-width: 0;
  height: 30px;
  justify-content: space-between;
  border-color: var(--border);
  color: var(--text);
}

.pulls-panel__filter :deep(.pull-filter-dropdown span) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pulls-list {
  display: grid;
  min-width: 0;
}

.pulls-list__item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 22px;
  align-items: start;
  gap: 8px;
  min-width: 0;
  min-height: 56px;
  padding: 9px 4px;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
}

.pulls-list__item:last-of-type {
  border-bottom: 0;
}

.pulls-list__item:hover {
  background: var(--bg-hover);
}

.pulls-list__item.is-target {
  background: var(--bg-active);
}

.pulls-list__content {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.pulls-list__title {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.pulls-list__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.pulls-list__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-top: 1px;
  color: var(--success);
}

.pulls-list__status.is-closed {
  color: var(--text-muted);
}

.pulls-list__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}

.pulls-list__chips span {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 180px;
  padding: 2px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pulls-list__empty-meta {
  color: var(--text-faint);
  font-size: 11px;
}

.pulls-list__arrow {
  align-self: center;
  color: var(--text-faint);
}

.pulls-list__item:hover .pulls-list__arrow {
  color: var(--text-muted);
}

.pulls-list__empty {
  margin: 18px 0 0;
}

@media (max-width: 900px) {
  .pulls-panel__toolbar {
    grid-template-columns: 1fr auto;
  }

  .pulls-panel__states,
  .pulls-panel__search {
    grid-column: 1 / -1;
  }

  .pulls-panel__filters {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .pulls-list__item {
    grid-template-columns: 22px minmax(0, 1fr) 18px;
  }
}
</style>
