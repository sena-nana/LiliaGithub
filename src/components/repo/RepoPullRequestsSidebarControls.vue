<script setup lang="ts">
import { GitPullRequest } from "@lucide/vue";
import { computed } from "vue";
import type {
  GitHubIssueFilterMetadata,
  GitHubPullRequest,
} from "../../services/workspace/types";
import type {
  PullRequestDirection,
  PullRequestPanelFilters,
  PullRequestReview,
  PullRequestSort,
  PullRequestState,
} from "./pullRequestPanelTypes";
import RepoGitHubListSidebarControls from "./RepoGitHubListSidebarControls.vue";

const props = defineProps<{
  pulls: GitHubPullRequest[];
  state: PullRequestState;
  filters: PullRequestPanelFilters;
  metadata: GitHubIssueFilterMetadata;
  metadataLoading: boolean;
  createDisabled?: boolean;
  creating?: boolean;
}>();

const emit = defineEmits<{
  "update:state": [value: PullRequestState];
  "update:filters": [value: PullRequestPanelFilters];
  create: [];
}>();

const states: readonly { value: PullRequestState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
];

const sortOptions = [
  { value: "updated-desc", label: "最近更新" },
  { value: "updated-asc", label: "最早更新" },
  { value: "created-desc", label: "最新创建" },
  { value: "created-asc", label: "最早创建" },
  { value: "comments-desc", label: "评论最多" },
  { value: "comments-asc", label: "评论最少" },
] as const;

const reviewOptions = [
  { value: "", label: "任意 Review" },
  { value: "none", label: "未评审" },
  { value: "required", label: "需要评审" },
  { value: "approved", label: "已批准" },
  { value: "changes_requested", label: "请求更改" },
] as const;

const optionSets = computed(() => ({
  authors: [
    { value: "", label: "任意作者" },
    ...uniqueSorted([...props.metadata.authors, ...props.pulls.map((pull) => pull.author)])
      .map((author) => ({ value: author, label: author })),
  ],
  labels: labelsWithFallback(uniqueSorted([...props.metadata.labels, ...props.pulls.flatMap((pull) => pull.labels ?? [])])),
  assignees: [
    { value: "", label: "任意负责人" },
    { value: "none", label: "未分配" },
    ...uniqueSorted([...props.metadata.assignees, ...props.pulls.flatMap((pull) => pull.assignees ?? [])])
      .map((assignee) => ({ value: assignee, label: assignee })),
  ],
  milestones: [
    { value: "", label: "任意里程碑" },
    { value: "none", label: "无里程碑" },
    ...uniqueMilestones([...props.metadata.milestones, ...props.pulls.flatMap((pull) => pull.milestone ? [pull.milestone] : [])])
      .map((milestone) => ({ value: String(milestone.number), label: milestone.title })),
  ],
  projects: [
    { value: "", label: "任意项目" },
    ...uniqueProjects([...props.metadata.projects, ...props.pulls.flatMap((pull) => pull.projectItems ?? [])])
      .map((project) => ({ value: project.id, label: project.title })),
  ],
}));

const labelSummary = computed(() => multiSelectSummary(props.filters.labels, "任意标签"));
const sidebarFilters = computed(() => [
  dropdownFilter("creator", "作者", props.filters.creator ?? "", optionSets.value.authors),
  dropdownFilter("labels", "标签", props.filters.labels, optionSets.value.labels, {
    multiple: true,
    displayLabel: labelSummary.value,
    placeholder: props.metadataLoading ? "正在加载标签..." : "任意标签",
    disabled: props.metadataLoading && !props.metadata.labels.length,
  }),
  dropdownFilter("project", "项目", props.filters.project ?? "", optionSets.value.projects, {
    disabled: props.metadataLoading && !props.metadata.projects.length,
  }),
  dropdownFilter("milestone", "里程碑", props.filters.milestone == null ? "" : String(props.filters.milestone), optionSets.value.milestones, {
    disabled: props.metadataLoading && !props.metadata.milestones.length,
  }),
  dropdownFilter("review", "Reviews", props.filters.review ?? "", reviewOptions),
  dropdownFilter("assignee", "负责人", props.filters.assignee ?? "", optionSets.value.assignees, {
    disabled: props.metadataLoading && !props.metadata.assignees.length,
  }),
]);

const activeSortValue = computed(() => `${props.filters.sort}-${props.filters.direction}`);

function labelsWithFallback(labels: readonly string[]) {
  const options = labels.map((label) => ({ value: label, label }));
  if (options.length) return options;
  return [{
    value: "__empty_labels__",
    label: props.metadataLoading ? "正在加载标签..." : "暂无标签",
    disabled: true,
  }];
}

function dropdownFilter(
  key: string,
  label: string,
  value: string | string[],
  options: readonly { value: string; label: string; disabled?: boolean }[],
  extra: Partial<{
    multiple: boolean;
    displayLabel: string;
    placeholder: string;
    disabled: boolean;
  }> = {},
) {
  return {
    key,
    label,
    value,
    options: [...options],
    agentId: `repo.pulls.filters.${key}`,
    menuLabel: label,
    buttonClass: "pull-filter-dropdown",
    ...extra,
  };
}

function multiSelectSummary(values: readonly string[], emptyText: string) {
  if (!values.length) return emptyText;
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
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

function updateFilters(next: Partial<PullRequestPanelFilters>) {
  emit("update:filters", {
    ...props.filters,
    ...next,
    labels: next.labels ? [...next.labels] : [...props.filters.labels],
  });
}

function updateFilter(key: string, value: string | string[]) {
  if (key === "labels") updateFilters({ labels: Array.isArray(value) ? value : [value] });
  else if (key === "review") updateFilters({ review: (value || null) as PullRequestReview });
  else updateFilters({ [key]: value || null } as Partial<PullRequestPanelFilters>);
}

function updateSort(value: string) {
  const [sort, direction] = value.split("-") as [PullRequestSort, PullRequestDirection];
  updateFilters({ sort, direction });
}
</script>

<template>
  <RepoGitHubListSidebarControls
    title="Pull Requests"
    panel-label="Pull Request 筛选项"
    :icon="GitPullRequest"
    :create-icon="GitPullRequest"
    create-label="新建 PR"
    create-agent-id="repo.pulls.create"
    :create-disabled="createDisabled"
    :creating="creating"
    :states="states"
    :state="state"
    state-aria-label="Pull Request 状态"
    state-agent-prefix="repo.pulls.state"
    search-label="搜索 Pull Requests"
    search-placeholder="搜索 Pull Requests"
    search-agent-id="repo.pulls.search"
    :query="filters.query"
    :filters="sidebarFilters"
    :sort-value="activeSortValue"
    :sort-options="sortOptions"
    sort-agent-id="repo.pulls.filters.sort"
    sort-button-class="pull-filter-dropdown"
    @create="emit('create')"
    @state="(value) => emit('update:state', value as PullRequestState)"
    @query="(value) => updateFilters({ query: value })"
    @filter="updateFilter"
    @sort="updateSort"
  />
</template>
