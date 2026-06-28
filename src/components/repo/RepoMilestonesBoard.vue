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
  isOpenRepoMilestonesBoardItem,
  repoMilestonesBoardItemStateText,
  type RepoMilestonesBoardGroup,
  type RepoMilestonesBoardItem,
} from "./useRepoMilestonesBoard";

const props = defineProps<{
  groups: RepoMilestonesBoardGroup[];
  itemCount: number;
  query: string;
  milestoneCountTotal: number;
  loadingText: string;
  emptyText: string;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  openIssue: [issue: GitHubIssue];
  openPullRequest: [pull: GitHubPullRequest];
}>();

const VISIBLE_LABEL_LIMIT = 2;

function itemUpdatedText(item: RepoMilestonesBoardItem) {
  return `更新于 ${formatDate(item.updatedAt)}`;
}

function itemDetailsTitle(item: RepoMilestonesBoardItem) {
  return [
    `#${item.number} ${item.title}`,
    item.kind === "issue" ? "Issue" : "PR",
    repoMilestonesBoardItemStateText(item),
    item.author ? `opened by ${item.author}` : "未知作者",
    itemUpdatedText(item),
    item.assignees.length ? `负责人 ${item.assignees.join(", ")}` : "未分配",
    item.milestone ? `里程碑 ${item.milestone.title}` : "No milestone",
    item.labels.length ? `Labels ${item.labels.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
}

function labelChips(item: RepoMilestonesBoardItem) {
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

function openItem(item: RepoMilestonesBoardItem) {
  if (item.issue) {
    emit("openIssue", item.issue);
    return;
  }
  if (item.pull) emit("openPullRequest", item.pull);
}
</script>

<template>
  <section class="milestones-board" aria-label="Milestones board">
    <div class="milestones-board__toolbar">
      <div class="milestones-board__title">
        <h3>Milestones</h3>
        <span>{{ itemCount }} items · {{ milestoneCountTotal }} milestones · {{ loadingText }}</span>
      </div>

      <label class="milestones-board__search">
        <Search :size="15" aria-hidden="true" />
        <input
          :value="query"
          type="search"
          placeholder="搜索里程碑事项"
          aria-label="搜索里程碑事项"
          data-agent-id="repo.milestones.search"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <div class="milestones-board__groups" role="list" aria-label="Milestone groups">
      <section
        v-for="group in props.groups"
        :key="group.id"
        class="milestones-board-group"
        role="listitem"
        :aria-label="`${group.title} milestone`"
      >
        <header class="milestones-board-group__head">
          <div>
            <h4>{{ group.title }}</h4>
            <span v-if="group.state">{{ group.state }}</span>
          </div>
          <em>{{ group.items.length }}</em>
        </header>

        <div class="milestones-board__list" role="list" :aria-label="`${group.title} items`">
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="repo-list-row repo-list-row--with-actions milestones-board-row"
            :class="{
              'milestones-board-row--issue': item.kind === 'issue',
              'milestones-board-row--pull': item.kind === 'pull',
              'is-closed': !isOpenRepoMilestonesBoardItem(item),
            }"
            :data-agent-id="`repo.milestones.${item.kind}.${item.number}.open`"
            :title="itemDetailsTitle(item)"
            @click="openItem(item)"
          >
            <span class="milestones-board-row__status" :title="repoMilestonesBoardItemStateText(item)">
              <CircleDot v-if="item.kind === 'issue' && isOpenRepoMilestonesBoardItem(item)" :size="16" aria-hidden="true" />
              <GitPullRequest v-else-if="item.kind === 'pull' && isOpenRepoMilestonesBoardItem(item)" :size="16" aria-hidden="true" />
              <GitMerge v-else-if="item.merged" :size="16" aria-hidden="true" />
              <CircleOff v-else :size="16" aria-hidden="true" />
            </span>
            <span class="milestones-board-row__body">
              <span class="milestones-board-row__title-line">
                <strong class="repo-list-row__title">#{{ item.number }} {{ item.title }}</strong>
                <em>{{ item.kind === "issue" ? "Issue" : "PR" }}</em>
                <span class="repo-list-row__meta milestones-board-row__updated">{{ itemUpdatedText(item) }}</span>
              </span>
              <span v-if="item.labels.length" class="milestones-board-row__chips" aria-label="Labels">
                <em
                  v-for="label in labelChips(item)"
                  :key="`label:${item.key}:${label}`"
                  :class="{ 'milestones-board-row__more': label.startsWith('+') }"
                >
                  {{ label }}
                </em>
              </span>
            </span>
          </button>
        </div>
      </section>
    </div>

    <p v-if="!itemCount" class="muted repo-empty milestones-board__empty">{{ emptyText }}</p>
  </section>
</template>

<style scoped>
.milestones-board {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.milestones-board__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 280px);
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-soft);
}

.milestones-board__title {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.milestones-board__title h3 {
  margin: 0;
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
}

.milestones-board__title span,
.milestones-board-row__updated {
  color: var(--text-muted);
  font-size: 12px;
}

.milestones-board__search {
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

.milestones-board__search input {
  min-width: 0;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  outline: none;
}

.milestones-board__groups {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow: auto;
}

.milestones-board-group {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg);
}

.milestones-board-group__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-subtle);
}

.milestones-board-group__head div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.milestones-board-group__head h4 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.milestones-board-group__head span,
.milestones-board-group__head em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.milestones-board-group__head em {
  min-width: 22px;
  height: 19px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-elev);
  line-height: 19px;
  text-align: center;
}

.milestones-board__list {
  display: grid;
  align-content: start;
  min-width: 0;
}

.milestones-board-row {
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

.milestones-board-row:last-child {
  border-bottom: 0;
}

.milestones-board-row:hover,
.milestones-board-row:focus-visible {
  background: var(--bg-hover);
  filter: none;
}

.milestones-board-row__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 22px;
  color: var(--ok);
}

.milestones-board-row--pull .milestones-board-row__status {
  color: var(--accent);
}

.milestones-board-row.is-closed .milestones-board-row__status {
  color: var(--text-muted);
}

.milestones-board-row__body {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.milestones-board-row__title-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.milestones-board-row__title-line strong {
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

.milestones-board-row__title-line em,
.milestones-board-row__chips em {
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

.milestones-board-row__chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.milestones-board-row__chips em {
  background: var(--accent-soft);
  color: var(--accent);
}

.milestones-board-row__chips .milestones-board-row__more {
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.milestones-board-row__updated {
  min-width: 0;
  overflow: hidden;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.milestones-board__empty {
  margin: 0;
  padding: 18px;
  text-align: center;
}

@media (max-width: 900px) {
  .milestones-board__toolbar,
  .milestones-board-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .milestones-board-row {
    padding-left: 12px;
  }

  .milestones-board-row__status {
    display: none;
  }
}
</style>
