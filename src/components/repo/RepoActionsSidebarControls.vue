<script setup lang="ts">
import { Play } from "@lucide/vue";
import { computed } from "vue";
import type { GitHubWorkflowRun } from "../../services/workspace/types";
import RepoGitHubListSidebarControls from "./RepoGitHubListSidebarControls.vue";

type ActionState = "all" | "active" | "completed";
type ActionSort = "updated" | "created" | "run-number";
type ActionDirection = "asc" | "desc";
type ActionPanelFilters = {
  workflow: string | null;
  branch: string | null;
  event: string | null;
  actor: string | null;
  status: string | null;
  sort: ActionSort;
  direction: ActionDirection;
  query: string;
};

const props = defineProps<{
  runs: readonly GitHubWorkflowRun[];
  visibleCount: number;
  state: ActionState;
  filters: ActionPanelFilters;
  loading: boolean;
  loaded: boolean;
}>();

const emit = defineEmits<{
  "update:state": [value: ActionState];
  "update:filters": [value: ActionPanelFilters];
}>();

const states: readonly { value: ActionState; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Done" },
];

const sortOptions = [
  { value: "updated-desc", label: "最近更新" },
  { value: "updated-asc", label: "最早更新" },
  { value: "created-desc", label: "最新创建" },
  { value: "created-asc", label: "最早创建" },
  { value: "run-number-desc", label: "Run 编号（降序）" },
  { value: "run-number-asc", label: "Run 编号（升序）" },
] as const;

const optionSets = computed(() => ({
  workflows: [{ value: "", label: "任意工作流" }, ...stringOptions(props.runs.map((run) => run.name))],
  branches: [{ value: "", label: "任意分支" }, ...stringOptions(props.runs.map((run) => run.branch))],
  events: [{ value: "", label: "任意事件" }, ...stringOptions(props.runs.map((run) => run.event))],
  actors: [{ value: "", label: "任意触发者" }, ...stringOptions(props.runs.map((run) => run.actor ?? ""))],
  statuses: [
    { value: "", label: "任意状态" },
    ...stringOptions(props.runs.map((run) => run.conclusion || run.status)),
  ],
}));

const sidebarFilters = computed(() => [
  dropdownFilter("workflow", "工作流", props.filters.workflow ?? "", optionSets.value.workflows),
  dropdownFilter("branch", "分支", props.filters.branch ?? "", optionSets.value.branches),
  dropdownFilter("event", "事件", props.filters.event ?? "", optionSets.value.events),
  dropdownFilter("actor", "触发者", props.filters.actor ?? "", optionSets.value.actors),
  dropdownFilter("status", "状态", props.filters.status ?? "", optionSets.value.statuses),
]);

const activeSortValue = computed(() => `${props.filters.sort}-${props.filters.direction}`);

function stringOptions(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}

function dropdownFilter(
  key: string,
  label: string,
  value: string,
  options: readonly { value: string; label: string; disabled?: boolean }[],
) {
  return {
    key,
    label,
    value,
    options: [...options],
    agentId: `repo.actions.filters.${key}`,
    menuLabel: label,
    buttonClass: "action-filter-dropdown",
  };
}

function updateFilters(next: Partial<ActionPanelFilters>) {
  emit("update:filters", {
    ...props.filters,
    ...next,
  });
}

function updateFilter(key: string, value: string | string[]) {
  updateFilters({ [key]: typeof value === "string" && value ? value : null } as Partial<ActionPanelFilters>);
}

function updateSort(value: string) {
  const [sort, direction] = value.split("-") as [ActionSort, ActionDirection];
  updateFilters({ sort, direction });
}
</script>

<template>
  <div class="actions-sidebar-controls">
    <RepoGitHubListSidebarControls
      title="Actions"
      panel-label="Actions 筛选项"
      :icon="Play"
      :show-create="false"
      :states="states"
      :state="state"
      state-aria-label="Actions 状态"
      state-agent-prefix="repo.actions.state"
      search-label="搜索 Actions"
      search-placeholder="搜索 Actions"
      search-agent-id="repo.actions.search"
      :query="filters.query"
      :filters="sidebarFilters"
      :sort-value="activeSortValue"
      :sort-options="sortOptions"
      sort-agent-id="repo.actions.filters.sort"
      sort-button-class="action-filter-dropdown"
      @state="(value) => emit('update:state', value as ActionState)"
      @query="(value) => updateFilters({ query: value })"
      @filter="updateFilter"
      @sort="updateSort"
    />

    <section class="card actions-filter-summary" aria-label="Actions 摘要">
      <dl>
        <div>
          <dt>已加载</dt>
          <dd>{{ runs.length }}</dd>
        </div>
        <div>
          <dt>匹配</dt>
          <dd>{{ visibleCount }}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{{ loading ? "读取中" : loaded ? "已同步" : "未读取" }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.actions-sidebar-controls {
  display: grid;
  gap: var(--repo-sidebar-card-gap);
  min-width: 0;
}

.actions-filter-summary {
  display: grid;
  gap: var(--repo-sidebar-card-gap);
  min-width: 0;
  margin: 0;
  padding: var(--repo-sidebar-card-padding);
}

.actions-filter-summary dl {
  display: grid;
  gap: var(--repo-sidebar-list-gap);
  margin: 0;
}

.actions-filter-summary div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  min-height: var(--repo-sidebar-control-height);
}

.actions-filter-summary dt {
  color: var(--text-muted);
  font-size: 11px;
}

.actions-filter-summary dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
