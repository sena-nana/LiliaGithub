<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ArrowRight,
  CircleOff,
  GitMerge,
  GitPullRequest,
} from "@lucide/vue";
import type {
  GitHubDiscussionTimelineItem,
  GitHubPullRequest,
  GitHubPullRequestCheck,
} from "../../services/workspace/types";
import type {
  PullRequestPanelFilters,
  PullRequestState,
} from "./pullRequestPanelTypes";
import RepoMilestoneGroup from "./RepoMilestoneGroup.vue";
import RepoPullRequestDetail from "./RepoPullRequestDetail.vue";
import {
  groupRepoItemsByMilestone,
  repoMilestoneGroupAgentSuffix,
  type RepoMilestoneGroup as RepoMilestoneGroupModel,
} from "./repoMilestoneGroups";

const props = defineProps<{
  pulls: GitHubPullRequest[];
  state: PullRequestState;
  filters: PullRequestPanelFilters;
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
  worktreePath?: string | null;
  currentBranch?: string | null;
  remoteUrl?: string | null;
  sourceRoute: string;
  isFocused: (pullNumber: number) => boolean;
  timelineItemOpener?: (item: GitHubDiscussionTimelineItem) => void;
}>();

type PullRequestChip = {
  key: string;
  text: string;
};

type PullRequestDisplayRow = {
  pull: GitHubPullRequest;
  milestone: GitHubPullRequest["milestone"];
  statusText: string;
  updatedText: string;
  chips: PullRequestChip[];
  closed: boolean;
};

const emit = defineEmits<{
  "update:mergeMethod": [value: "merge" | "squash" | "rebase"];
  back: [];
  focus: [pull: GitHubPullRequest];
  toggle: [pull: GitHubPullRequest];
  merge: [pull: GitHubPullRequest];
}>();

const PULL_RENDER_PAGE_SIZE = 50;
const visiblePullCount = ref(PULL_RENDER_PAGE_SIZE);

const focusedPullRequest = computed(() => {
  const pullNumber = props.focusedPullRequestNumber;
  if (pullNumber == null) return null;
  if (props.focusedPullRequestDetail?.number === pullNumber) return props.focusedPullRequestDetail;
  return props.pulls.find((pull) => pull.number === pullNumber) ?? null;
});

const pullRows = computed<PullRequestDisplayRow[]>(() =>
  props.pulls.map((pull) => ({
    pull,
    milestone: pull.milestone,
    statusText: pullStatusText(pull),
    updatedText: pullUpdatedText(pull),
    chips: pullChips(pull),
    closed: pull.state !== "open" || pull.merged,
  })),
);
const pullGrouping = computed(() =>
  groupRepoItemsByMilestone(pullRows.value, visiblePullCount.value),
);
const pullGroups = computed(() => pullGrouping.value.groups);
const hiddenPullCount = computed(() => pullGrouping.value.hiddenCount);

watch(
  () => [
    props.state,
    props.filters.query,
    props.filters.creator,
    props.filters.assignee,
    props.filters.milestone,
    props.filters.project,
    props.filters.review,
    props.filters.sort,
    props.filters.direction,
    props.filters.labels.join("\0"),
  ] as const,
  () => {
    visiblePullCount.value = PULL_RENDER_PAGE_SIZE;
  },
);

function showMorePulls() {
  visiblePullCount.value += PULL_RENDER_PAGE_SIZE;
}

function pullGroupAgentId(group: RepoMilestoneGroupModel<PullRequestDisplayRow>) {
  return `repo.pulls.group.${repoMilestoneGroupAgentSuffix(group)}`;
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

function pullChips(pull: GitHubPullRequest) {
  return [
    ...(pull.labels?.length ? pull.labels.map((label) => ({ key: `label:${label}`, text: label })) : []),
    ...(pull.assignees?.length ? pull.assignees.map((assignee) => ({ key: `assignee:${assignee}`, text: assignee })) : []),
    ...(pull.projectItems?.length ? pull.projectItems.map((project) => ({ key: `project:${project.id}`, text: project.title })) : []),
    ...(pull.milestone ? [{ key: `milestone:${pull.milestone.number}`, text: pull.milestone.title }] : []),
  ];
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
      :worktree-path="worktreePath"
      :current-branch="currentBranch"
      :remote-url="remoteUrl"
      :source-route="sourceRoute"
      :timeline-item-opener="props.timelineItemOpener"
      @back="emit('back')"
      @merge="emit('merge', $event)"
      @update:merge-method="emit('update:mergeMethod', $event)"
    />

    <template v-else>
      <h3 class="pulls-panel__sr-title">Pull Requests</h3>
      <div class="pulls-list" role="list" aria-label="Pull Requests">
        <RepoMilestoneGroup
          v-for="group in pullGroups"
          :key="group.id"
          :title="group.title"
          :state="group.state"
          :visible-count="group.items.length"
          :total-count="group.totalCount"
          item-label="Pull Requests"
          :agent-id="pullGroupAgentId(group)"
        >
          <div
            v-for="row in group.items"
            :key="row.pull.number"
            class="pulls-list__item project-row--pull repo-list-row repo-list-row--with-actions"
            :class="{ 'is-target': isFocused(row.pull.number) }"
            :data-pull-number="row.pull.number"
            :data-agent-id="`repo.pulls.${row.pull.number}.open`"
            role="listitem"
            @click="emit('focus', row.pull)"
          >
        <span class="pulls-list__status repo-list-row__status" :class="{ 'is-closed': row.closed }" :title="row.statusText">
          <GitMerge v-if="row.pull.merged" :size="15" aria-hidden="true" />
          <GitPullRequest v-else-if="row.pull.state === 'open'" :size="15" aria-hidden="true" />
          <CircleOff v-else :size="15" aria-hidden="true" />
        </span>
        <div class="pulls-list__content repo-list-row__body">
          <div class="pulls-list__main">
            <strong class="pulls-list__title repo-list-row__title">#{{ row.pull.number }} {{ row.pull.title }}</strong>
            <div class="pulls-list__byline">
              <span>{{ row.pull.author || "未知作者" }}</span>
              <span>{{ row.pull.headBranch }} -> {{ row.pull.baseBranch }}</span>
            </div>
          </div>
          <div class="pulls-list__side repo-list-row__meta">
            <span class="pulls-list__updated">{{ row.updatedText }}</span>
            <div v-if="row.chips.length" class="pulls-list__chips" aria-label="Pull Request 元数据">
              <span v-for="chip in row.chips" :key="chip.key">{{ chip.text }}</span>
            </div>
            <span v-else class="pulls-list__empty-meta">无标签 · 未分配 · 无项目</span>
          </div>
        </div>
        <ArrowRight class="pulls-list__arrow" :size="15" aria-hidden="true" />
          </div>
        </RepoMilestoneGroup>

      <p v-if="!pulls.length && !loading" class="muted repo-empty pulls-list__empty">
        没有匹配的 Pull Request。
      </p>
      <p v-else-if="loading && !pulls.length" class="muted repo-empty pulls-list__empty">
        正在读取 Pull Requests。
      </p>
      <button
        v-if="hiddenPullCount > 0"
        type="button"
        class="pulls-list__more"
        data-agent-id="repo.pulls.show-more"
        @click="showMorePulls"
      >
        显示更多 {{ hiddenPullCount }} 个
      </button>
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

.pulls-list {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.pulls-list__item {
  min-width: 0;
  border-bottom: 1px solid var(--border-soft);
}

.pulls-list__item.repo-list-row {
  min-height: 44px;
  padding: 7px 8px;
  cursor: pointer;
}

.pulls-list__item:last-of-type {
  border-bottom: 0;
}

.pulls-list__main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.pulls-list__byline {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
}

.pulls-list__side {
  display: grid;
  justify-items: end;
  gap: 4px;
  overflow: visible;
  white-space: normal;
}

.pulls-list__updated {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pulls-list__status {
  color: var(--ok);
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

.pulls-list__more {
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

.pulls-list__more:hover,
.pulls-list__more:focus-visible {
  background: var(--bg-subtle);
  color: var(--text);
}

@media (max-width: 900px) {
  .pulls-list__item {
    padding-inline: 6px;
  }

  .pulls-list__side {
    justify-items: start;
  }
}
</style>
