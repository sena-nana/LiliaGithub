<script setup lang="ts">
import {
  Check,
  CircleDot,
  CircleOff,
  LoaderCircle,
  Pencil,
  RotateCcw,
  X,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type {
  GitHubDiscussionTimelineItem,
  GitHubIssue,
} from "../../services/workspace/types";
import RepoIssueDetail from "./RepoIssueDetail.vue";
import RepoMilestoneGroup from "./RepoMilestoneGroup.vue";
import {
  groupRepoItemsByMilestone,
  repoMilestoneGroupAgentSuffix,
  type RepoMilestoneGroup as RepoMilestoneGroupModel,
} from "./repoMilestoneGroups";

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

type IssueDisplayRow = {
  issue: GitHubIssue;
  milestone: GitHubIssue["milestone"];
  metaText: string;
  closed: boolean;
};

const props = defineProps<{
  issues: GitHubIssue[];
  state: IssueState;
  filters: IssuePanelFilters;
  loading: boolean;
  updating: boolean;
  editingIssueNumber: number | null;
  editingTitle: string;
  editingLabels: string;
  editingAssignees: string;
  editingBody: string;
  focusedIssueNumber: number | null;
  issueTimeline: readonly GitHubDiscussionTimelineItem[];
  issueDiscussionLoading: boolean;
  issueDiscussionError: string | null;
  repoFullName: string;
  isFocused: (issueNumber: number) => boolean;
  timelineItemOpener?: (item: GitHubDiscussionTimelineItem) => void;
}>();

const emit = defineEmits<{
  "update:editingTitle": [value: string];
  "update:editingLabels": [value: string];
  "update:editingAssignees": [value: string];
  "update:editingBody": [value: string];
  edit: [issue: GitHubIssue];
  focus: [issue: GitHubIssue];
  back: [];
  "cancel-edit": [];
  "save-edit": [issue: GitHubIssue];
  toggle: [issue: GitHubIssue];
}>();

const ISSUE_RENDER_PAGE_SIZE = 50;
const visibleIssueCount = ref(ISSUE_RENDER_PAGE_SIZE);
const focusedIssue = computed(() =>
  props.focusedIssueNumber == null
    ? null
    : props.issues.find((issue) => issue.number === props.focusedIssueNumber) ?? null
);

const issueRows = computed<IssueDisplayRow[]>(() =>
  props.issues.map((issue) => ({
    issue,
    milestone: issue.milestone,
    metaText: issueMetaText(issue),
    closed: issue.state !== "open",
  })),
);
const issueGrouping = computed(() =>
  groupRepoItemsByMilestone(issueRows.value, visibleIssueCount.value),
);
const issueGroups = computed(() => issueGrouping.value.groups);
const hiddenIssueCount = computed(() => issueGrouping.value.hiddenCount);

watch(
  () => [
    props.state,
    props.filters.query,
    props.filters.creator,
    props.filters.assignee,
    props.filters.milestone,
    props.filters.project,
    props.filters.sort,
    props.filters.direction,
    props.filters.labels.join("\0"),
  ] as const,
  () => {
    visibleIssueCount.value = ISSUE_RENDER_PAGE_SIZE;
  },
);

function showMoreIssues() {
  visibleIssueCount.value += ISSUE_RENDER_PAGE_SIZE;
}

function issueGroupAgentId(group: RepoMilestoneGroupModel<IssueDisplayRow>) {
  return `repo.issues.group.${repoMilestoneGroupAgentSuffix(group)}`;
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
    <RepoIssueDetail
      v-if="focusedIssue"
      :issue="focusedIssue"
      :timeline="issueTimeline"
      :discussion-loading="issueDiscussionLoading"
      :discussion-error="issueDiscussionError"
      :repo-full-name="repoFullName"
      :timeline-item-opener="props.timelineItemOpener"
      @back="emit('back')"
    />

    <template v-else>
      <h3 class="issues-panel__sr-title">Issues</h3>
      <div class="issues-list" role="list" aria-label="Issues">
        <RepoMilestoneGroup
          v-for="group in issueGroups"
          :key="group.id"
          :title="group.title"
          :state="group.state"
          :visible-count="group.items.length"
          :total-count="group.totalCount"
          item-label="Issues"
          :agent-id="issueGroupAgentId(group)"
        >
          <div
            v-for="row in group.items"
            :key="row.issue.number"
            class="issues-list__item project-row--issue"
            :class="{
              'is-target': isFocused(row.issue.number),
              'repo-list-row': editingIssueNumber !== row.issue.number,
              'repo-list-row--with-actions': editingIssueNumber !== row.issue.number,
            }"
            :data-issue-number="row.issue.number"
            role="listitem"
          >
        <template v-if="editingIssueNumber !== row.issue.number">
          <span class="issues-list__status repo-list-row__status" :class="{ 'is-closed': row.closed }" :title="row.issue.state">
            <CircleDot v-if="row.issue.state === 'open'" :size="15" aria-hidden="true" />
            <CircleOff v-else :size="15" aria-hidden="true" />
          </span>
          <div class="issues-list__content repo-list-row__body">
            <button
              type="button"
              class="issues-list__title repo-list-row__title"
              :data-agent-id="`repo.issues.${row.issue.number}.open`"
              @click="emit('focus', row.issue)"
            >
              #{{ row.issue.number }} {{ row.issue.title }}
            </button>
            <span class="issues-list__meta repo-list-row__meta">{{ row.metaText }}</span>
          </div>
          <div class="issues-list__actions">
            <button
              type="button"
              class="ghost project-icon-action"
              :data-agent-id="`repo.issues.${row.issue.number}.edit`"
              aria-label="编辑"
              title="编辑"
              @click.stop="emit('edit', row.issue)"
            >
              <Pencil :size="14" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="ghost project-icon-action"
              :data-agent-id="`repo.issues.${row.issue.number}.toggle`"
              :aria-label="row.issue.state === 'open' ? '关闭' : '重开'"
              :title="row.issue.state === 'open' ? '关闭' : '重开'"
              @click.stop="emit('toggle', row.issue)"
            >
              <CircleOff v-if="row.issue.state === 'open'" :size="14" aria-hidden="true" />
              <RotateCcw v-else :size="14" aria-hidden="true" />
            </button>
          </div>
        </template>

        <form v-else class="issues-list__edit project-compact-form" @submit.prevent="emit('save-edit', row.issue)">
          <div class="project-compact-form__line">
            <input
              :value="editingTitle"
              class="project-compact-form__title"
              type="text"
              placeholder="Issue 标题"
              :data-agent-id="`repo.issues.${row.issue.number}.edit.title`"
              @input="emit('update:editingTitle', ($event.target as HTMLInputElement).value)"
            />
            <input
              :value="editingLabels"
              type="text"
              placeholder="labels, comma separated"
              :data-agent-id="`repo.issues.${row.issue.number}.edit.labels`"
              @input="emit('update:editingLabels', ($event.target as HTMLInputElement).value)"
            />
            <input
              :value="editingAssignees"
              type="text"
              placeholder="assignees"
              :data-agent-id="`repo.issues.${row.issue.number}.edit.assignees`"
              @input="emit('update:editingAssignees', ($event.target as HTMLInputElement).value)"
            />
            <button
              type="submit"
              class="primary project-icon-action project-icon-action--primary"
              :data-agent-id="`repo.issues.${row.issue.number}.edit.save`"
              :disabled="updating || !editingTitle.trim()"
              aria-label="保存"
              title="保存"
            >
              <LoaderCircle v-if="updating" :size="14" aria-hidden="true" class="sb-spin" />
              <Check v-else :size="14" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="ghost project-icon-action"
              :data-agent-id="`repo.issues.${row.issue.number}.edit.cancel`"
              aria-label="取消"
              title="取消"
              @click="emit('cancel-edit')"
            >
              <X :size="14" aria-hidden="true" />
            </button>
          </div>
          <textarea
            :value="editingBody"
            rows="2"
            placeholder="Issue 内容"
            :data-agent-id="`repo.issues.${row.issue.number}.edit.body`"
            @input="emit('update:editingBody', ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </form>
          </div>
        </RepoMilestoneGroup>

      <p v-if="!issues.length && !loading" class="muted repo-empty issues-list__empty">
        没有匹配的 Issue。
      </p>
      <p v-else-if="loading && !issues.length" class="muted repo-empty issues-list__empty">
        正在读取 Issues。
      </p>
      <button
        v-if="hiddenIssueCount > 0"
        type="button"
        class="issues-list__more"
        data-agent-id="repo.issues.show-more"
        @click="showMoreIssues"
      >
        显示更多 {{ hiddenIssueCount }} 个
      </button>
      </div>
    </template>
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

.issues-list {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.issues-list__item {
  min-width: 0;
  border-bottom: 1px solid var(--border-soft);
}

.issues-list__item:not(.repo-list-row) {
  display: grid;
}

.issues-list__item.repo-list-row {
  min-height: 44px;
  padding: 4px 8px;
}

.issues-list__item:last-of-type {
  border-bottom: 0;
}

.issues-list__title {
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.issues-list__status {
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

.issues-list__more {
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.issues-list__more:hover,
.issues-list__more:focus-visible {
  background: var(--bg-subtle);
  color: var(--text);
}

@media (max-width: 820px) {
  .issues-list__item {
    padding-inline: 6px;
  }
}
</style>
