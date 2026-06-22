<script setup lang="ts">
import {
  Check,
  CircleDot,
  CircleOff,
  ListFilter,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  X,
} from "@lucide/vue";
import { computed, ref } from "vue";
import Dropdown from "../Dropdown.vue";
import type {
  GitHubIssue,
  GitHubIssueFilterMetadata,
} from "../../services/workspace/types";

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
  issues: GitHubIssue[];
  state: IssueState;
  filters: IssuePanelFilters;
  metadata: GitHubIssueFilterMetadata;
  metadataLoading: boolean;
  loading: boolean;
  updating: boolean;
  editingIssueNumber: number | null;
  editingTitle: string;
  editingLabels: string;
  editingAssignees: string;
  editingBody: string;
  isFocused: (issueNumber: number) => boolean;
}>();

const emit = defineEmits<{
  "update:state": [value: IssueState];
  "update:filters": [value: IssuePanelFilters];
  "update:editingTitle": [value: string];
  "update:editingLabels": [value: string];
  "update:editingAssignees": [value: string];
  "update:editingBody": [value: string];
  create: [];
  edit: [issue: GitHubIssue];
  "cancel-edit": [];
  "save-edit": [issue: GitHubIssue];
  toggle: [issue: GitHubIssue];
}>();

const filtersOpen = ref(false);

const stateFilters: readonly { value: IssueState; label: string }[] = [
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

const authorOptions = computed(() => [
  { value: "", label: "任意作者" },
  ...props.metadata.authors.map((author) => ({ value: author, label: author })),
]);
const labelOptions = computed(() => {
  const labels = props.metadata.labels.map((label) => ({ value: label, label }));
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
  ...props.metadata.assignees.map((assignee) => ({ value: assignee, label: assignee })),
]);
const milestoneOptions = computed(() => [
  { value: "", label: "任意里程碑" },
  { value: "none", label: "无里程碑" },
  ...props.metadata.milestones.map((milestone) => ({
    value: String(milestone.number),
    label: milestone.title,
  })),
]);
const projectOptions = computed(() => [
  { value: "", label: "任意项目" },
  ...props.metadata.projects.map((project) => ({ value: project.id, label: project.title })),
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
    props.filters.labels.length ? "labels" : null,
  ].filter(Boolean).length
);

function updateFilters(next: Partial<IssuePanelFilters>) {
  emit("update:filters", {
    ...props.filters,
    ...next,
    labels: next.labels ? [...next.labels] : [...props.filters.labels],
  });
}

function updateSort(value: string) {
  const [sort, direction] = value.split("-") as [IssueSort, IssueDirection];
  updateFilters({ sort, direction });
}

function formatIssueDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function issueMetaText(issue: GitHubIssue) {
  return [
    issue.author || "未知作者",
    `${issue.labels.join(", ") || "无标签"} · ${issue.assignees.join(", ") || "未分配"}`,
    issue.projectItems?.map((project) => project.title).join(", ") || "-",
    issue.milestone?.title || "-",
    formatIssueDate(issue.updatedAt),
  ].join(" · ");
}
</script>

<template>
  <div class="issues-panel">
    <h3 class="issues-panel__sr-title">Issues</h3>
    <div class="issues-panel__toolbar">
      <div class="issues-panel__states" role="group" aria-label="Issue 状态">
        <button
          v-for="filter in stateFilters"
          :key="filter.value"
          type="button"
          :class="{ 'is-active': state === filter.value }"
          :aria-pressed="state === filter.value"
          @click="emit('update:state', filter.value)"
        >
          <span>{{ filter.label }}</span>
          <strong>{{ state === filter.value ? issues.length : 0 }}</strong>
        </button>
      </div>

      <button
        type="button"
        class="ghost issues-panel__filter-button"
        :class="{ 'is-active': filtersOpen || activeFilterCount > 0 }"
        :aria-expanded="filtersOpen"
        @click="filtersOpen = !filtersOpen"
      >
        <ListFilter :size="15" aria-hidden="true" />
        筛选
        <strong v-if="activeFilterCount">{{ activeFilterCount }}</strong>
      </button>

      <label class="issues-panel__search">
        <Search :size="15" aria-hidden="true" />
        <input
          :value="filters.query"
          type="search"
          placeholder="搜索 Issues"
          aria-label="搜索 Issues"
          @input="updateFilters({ query: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <button type="button" class="primary issues-panel__new" @click="emit('create')">
        <Plus :size="14" aria-hidden="true" />
        新建 Issue
      </button>
    </div>

    <div v-if="filtersOpen" class="issues-panel__filters" aria-label="Issue 筛选项">
      <div class="issues-panel__filter">
        <span>作者</span>
        <Dropdown
          :model-value="filters.creator ?? ''"
          :options="authorOptions"
          :disabled="metadataLoading && !metadata.authors.length"
          button-class="issue-filter-dropdown"
          menu-width="220px"
          menu-label="作者"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ creator: value || null })"
        />
      </div>
      <div class="issues-panel__filter">
        <span>标签</span>
        <Dropdown
          :model-value="filters.labels"
          multiple
          :options="labelOptions"
          :display-label="labelSummary"
          :placeholder="metadataLoading ? '正在加载标签...' : '任意标签'"
          :disabled="metadataLoading && !metadata.labels.length"
          button-class="issue-filter-dropdown"
          menu-width="220px"
          menu-label="标签"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ labels: value })"
        />
      </div>
      <div class="issues-panel__filter">
        <span>项目</span>
        <Dropdown
          :model-value="filters.project ?? ''"
          :options="projectOptions"
          :disabled="metadataLoading && !metadata.projects.length"
          button-class="issue-filter-dropdown"
          menu-width="220px"
          menu-label="项目"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ project: value || null })"
        />
      </div>
      <div class="issues-panel__filter">
        <span>里程碑</span>
        <Dropdown
          :model-value="filters.milestone == null ? '' : String(filters.milestone)"
          :options="milestoneOptions"
          :disabled="metadataLoading && !metadata.milestones.length"
          button-class="issue-filter-dropdown"
          menu-width="220px"
          menu-label="里程碑"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ milestone: value || null })"
        />
      </div>
      <div class="issues-panel__filter">
        <span>负责人</span>
        <Dropdown
          :model-value="filters.assignee ?? ''"
          :options="assigneeOptions"
          :disabled="metadataLoading && !metadata.assignees.length"
          button-class="issue-filter-dropdown"
          menu-width="220px"
          menu-label="负责人"
          placement="bottom"
          @update:model-value="(value) => updateFilters({ assignee: value || null })"
        />
      </div>
      <div class="issues-panel__filter">
        <span>排序</span>
        <Dropdown
          :model-value="activeSortValue"
          :options="sortOptions"
          button-class="issue-filter-dropdown"
          menu-width="220px"
          menu-label="排序"
          placement="bottom"
          @update:model-value="updateSort"
        />
      </div>
    </div>

    <div class="issues-list" role="list" aria-label="Issues">
      <div
        v-for="issue in issues"
        :key="issue.number"
        class="issues-list__item project-row--issue"
        :class="{ 'is-target': isFocused(issue.number) }"
        :data-issue-number="issue.number"
        role="listitem"
      >
        <template v-if="editingIssueNumber !== issue.number">
          <span class="issues-list__status" :class="{ 'is-closed': issue.state !== 'open' }" :title="issue.state">
            <CircleDot v-if="issue.state === 'open'" :size="15" aria-hidden="true" />
            <CircleOff v-else :size="15" aria-hidden="true" />
          </span>
          <div class="issues-list__content">
            <strong class="issues-list__title">
              #{{ issue.number }} {{ issue.title }}
            </strong>
            <span class="issues-list__meta">{{ issueMetaText(issue) }}</span>
          </div>
          <div class="issues-list__actions">
            <button type="button" class="ghost project-icon-action" aria-label="编辑" title="编辑" @click="emit('edit', issue)">
              <Pencil :size="14" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="ghost project-icon-action"
              :aria-label="issue.state === 'open' ? '关闭' : '重开'"
              :title="issue.state === 'open' ? '关闭' : '重开'"
              @click="emit('toggle', issue)"
            >
              <CircleOff v-if="issue.state === 'open'" :size="14" aria-hidden="true" />
              <RotateCcw v-else :size="14" aria-hidden="true" />
            </button>
          </div>
        </template>

        <form v-else class="issues-list__edit project-compact-form" @submit.prevent="emit('save-edit', issue)">
          <div class="project-compact-form__line">
            <input
              :value="editingTitle"
              class="project-compact-form__title"
              type="text"
              placeholder="Issue 标题"
              @input="emit('update:editingTitle', ($event.target as HTMLInputElement).value)"
            />
            <input
              :value="editingLabels"
              type="text"
              placeholder="labels, comma separated"
              @input="emit('update:editingLabels', ($event.target as HTMLInputElement).value)"
            />
            <input
              :value="editingAssignees"
              type="text"
              placeholder="assignees"
              @input="emit('update:editingAssignees', ($event.target as HTMLInputElement).value)"
            />
            <button
              type="submit"
              class="primary project-icon-action project-icon-action--primary"
              :disabled="updating || !editingTitle.trim()"
              aria-label="保存"
              title="保存"
            >
              <LoaderCircle v-if="updating" :size="14" aria-hidden="true" class="sb-spin" />
              <Check v-else :size="14" aria-hidden="true" />
            </button>
            <button type="button" class="ghost project-icon-action" aria-label="取消" title="取消" @click="emit('cancel-edit')">
              <X :size="14" aria-hidden="true" />
            </button>
          </div>
          <textarea
            :value="editingBody"
            rows="2"
            placeholder="Issue 内容"
            @input="emit('update:editingBody', ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </form>
      </div>

      <p v-if="!issues.length && !loading" class="muted repo-empty issues-list__empty">
        没有匹配的 Issue。
      </p>
      <p v-else-if="loading && !issues.length" class="muted repo-empty issues-list__empty">
        正在读取 Issues。
      </p>
    </div>
  </div>
</template>

<style scoped>
.issues-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.issues-panel__sr-title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.issues-panel__toolbar {
  display: grid;
  grid-template-columns: auto auto minmax(180px, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.issues-panel__states {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.issues-panel__states button {
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

.issues-panel__states button.is-active {
  background: var(--bg-active);
  color: var(--text);
}

.issues-panel__states strong,
.issues-panel__filter-button strong {
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

.issues-panel__filter-button,
.issues-panel__new {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
  white-space: nowrap;
}

.issues-panel__filter-button.is-active {
  color: var(--text);
  background: var(--bg-hover);
}

.issues-panel__search {
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

.issues-panel__search input {
  min-width: 0;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
}

.issues-panel__filters {
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

.issues-panel__filter {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.issues-panel__filter > span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.issues-panel__filter :deep(.dd) {
  width: 100%;
  min-width: 0;
}

.issues-panel__filter :deep(.issue-filter-dropdown) {
  width: 100%;
  min-width: 0;
  height: 30px;
  justify-content: space-between;
  border-color: var(--border);
  color: var(--text);
}

.issues-panel__filter :deep(.issue-filter-dropdown span) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issues-list {
  display: grid;
  min-width: 0;
}

.issues-list__item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  padding: 0 2px;
  border-bottom: 1px solid var(--border-soft);
}

.issues-list__item:last-of-type {
  border-bottom: 0;
}

.issues-list__item:hover {
  background: var(--bg-hover);
}

.issues-list__item.is-target {
  background: var(--bg-active);
}

.issues-list__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.issues-list__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issues-list__title {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}

.issues-list__meta {
  justify-self: end;
  min-width: max-content;
  color: var(--text-muted);
  font-size: 12px;
  text-align: right;
  white-space: nowrap;
}

.issues-list__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ok);
}

.issues-list__status.is-closed {
  color: var(--text-muted);
}

.issues-list__actions {
  display: inline-flex;
  justify-content: flex-end;
  gap: 4px;
}

.project-icon-action {
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  flex-shrink: 0;
}

.project-icon-action:hover {
  color: var(--text);
}

.project-icon-action--primary {
  color: var(--accent);
}

.project-compact-form {
  display: grid;
  gap: 8px;
  padding: 4px 0 10px;
  border-bottom: 1px solid var(--border-soft);
  background: transparent;
}

.project-compact-form__line {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(110px, 160px) minmax(110px, 160px) auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.project-compact-form__title {
  min-width: 0;
}

.project-compact-form textarea {
  min-height: 54px;
  resize: vertical;
}

.issues-list__edit {
  grid-column: 1 / -1;
  margin: 7px 0;
}

.issues-list__empty {
  margin: 0;
  padding: 46px 12px;
  text-align: center;
}

@media (max-width: 820px) {
  .issues-panel__toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .issues-panel__states,
  .issues-panel__search {
    grid-column: 1 / -1;
  }

  .issues-panel__filters {
    grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  }

  .issues-list__item {
    grid-template-columns: 20px minmax(0, 1fr) auto;
  }
}
</style>
