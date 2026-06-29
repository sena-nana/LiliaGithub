<script setup lang="ts">
import { CircleDot, Plus } from "@lucide/vue";
import { computed } from "vue";
import type { GitHubIssueFilterMetadata } from "../../services/workspace/types";
import RepoGitHubListSidebarControls from "./RepoGitHubListSidebarControls.vue";

type IssueState = "open" | "closed" | "all";
type IssueSort = "created" | "updated" | "comments";
type IssueDirection = "asc" | "desc";
type IssuePanelFilters = {
  creator: string | null;
  assignee: string | null;
  labels: string[];
  milestone: string | number | null;
  project: string | null;
  sort: IssueSort;
  direction: IssueDirection;
  query: string;
};

const props = defineProps<{
  state: IssueState;
  filters: IssuePanelFilters;
  metadata: GitHubIssueFilterMetadata;
  metadataLoading: boolean;
  createDisabled?: boolean;
  creating?: boolean;
}>();

const emit = defineEmits<{
  "update:state": [value: IssueState];
  "update:filters": [value: IssuePanelFilters];
  create: [];
}>();

const states: readonly { value: IssueState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const sortOptions = [
  { value: "created-desc", label: "最新创建" },
  { value: "created-asc", label: "最早创建" },
  { value: "updated-desc", label: "最近更新" },
  { value: "comments-desc", label: "评论最多" },
] as const;

const optionSets = computed(() => ({
  authors: [
    { value: "", label: "任意作者" },
    ...props.metadata.authors.map((author) => ({ value: author, label: author })),
  ],
  labels: labelsWithFallback(props.metadata.labels),
  assignees: [
    { value: "", label: "任意负责人" },
    { value: "none", label: "未分配" },
    ...props.metadata.assignees.map((assignee) => ({ value: assignee, label: assignee })),
  ],
  milestones: [
    { value: "", label: "任意里程碑" },
    { value: "none", label: "无里程碑" },
    ...props.metadata.milestones.map((milestone) => ({ value: String(milestone.number), label: milestone.title })),
  ],
  projects: [
    { value: "", label: "任意项目" },
    ...props.metadata.projects.map((project) => ({ value: project.id, label: project.title })),
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
    agentId: `repo.issues.filters.${key}`,
    menuLabel: label,
    buttonClass: "issue-filter-dropdown",
    ...extra,
  };
}

function multiSelectSummary(values: readonly string[], emptyText: string) {
  if (!values.length) return emptyText;
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

function updateFilters(next: Partial<IssuePanelFilters>) {
  emit("update:filters", {
    ...props.filters,
    ...next,
    labels: next.labels ? [...next.labels] : [...props.filters.labels],
  });
}

function updateFilter(key: string, value: string | string[]) {
  if (key === "labels") updateFilters({ labels: Array.isArray(value) ? value : [value] });
  else updateFilters({ [key]: value || null } as Partial<IssuePanelFilters>);
}

function updateSort(value: string) {
  const [sort, direction] = value.split("-") as [IssueSort, IssueDirection];
  updateFilters({ sort, direction });
}
</script>

<template>
  <RepoGitHubListSidebarControls
    title="Issues"
    panel-label="Issue 筛选项"
    :icon="CircleDot"
    :create-icon="Plus"
    create-label="新建 Issue"
    create-agent-id="repo.issues.create"
    :create-disabled="createDisabled"
    :creating="creating"
    :states="states"
    :state="state"
    state-aria-label="Issue 状态"
    state-agent-prefix="repo.issues.state"
    search-label="搜索 Issues"
    search-placeholder="搜索 Issues"
    search-agent-id="repo.issues.search"
    :query="filters.query"
    :filters="sidebarFilters"
    :sort-value="activeSortValue"
    :sort-options="sortOptions"
    sort-agent-id="repo.issues.filters.sort"
    sort-button-class="issue-filter-dropdown"
    @create="emit('create')"
    @state="(value) => emit('update:state', value as IssueState)"
    @query="(value) => updateFilters({ query: value })"
    @filter="updateFilter"
    @sort="updateSort"
  />
</template>
