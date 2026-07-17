<script setup lang="ts">
import {
  CircleDot,
  CircleOff,
  ExternalLink,
  GitPullRequest,
  LoaderCircle,
  Pencil,
  RotateCw,
} from "@lucide/vue";
import { computed } from "vue";
import type { GitHubIssue, GitHubPullRequest } from "../../services/workspace/types";

const props = defineProps<{
  issue?: GitHubIssue | null;
  pull?: GitHubPullRequest | null;
  updatingIssue?: boolean;
  updatingPullRequest?: boolean;
}>();

const emit = defineEmits<{
  openIssue: [issue: GitHubIssue];
  editIssue: [issue: GitHubIssue];
  toggleIssue: [issue: GitHubIssue];
  openPullRequest: [pull: GitHubPullRequest];
  togglePullRequest: [pull: GitHubPullRequest];
}>();

type SidebarSection = {
  key: string;
  title: string;
  items: string[];
  emptyText?: string;
  chips?: boolean;
  inline?: boolean;
};

type SidebarSectionOptions = Pick<SidebarSection, "emptyText" | "chips" | "inline">;
const reviewerStateLabels: Record<string, string> = {
  requested: "待审阅",
  approved: "已通过",
  changes_requested: "需修改",
  commented: "已评论",
  dismissed: "已撤销",
  pending: "待提交",
};

const headerText = computed(() => {
  if (props.issue) return `Issue #${props.issue.number}`;
  if (props.pull) return `PR #${props.pull.number}`;
  return "";
});

const sidebarLabel = computed(() => props.issue ? "Issue 详情侧栏" : "Pull Requests 详情侧栏");
const sections = computed<SidebarSection[]>(() => {
  if (props.issue) return issueSections(props.issue);
  if (props.pull) return pullSections(props.pull);
  return [];
});

function sidebarSection(
  key: string,
  title: string,
  items: readonly string[],
  options: SidebarSectionOptions = {},
): SidebarSection {
  return { key, title, items: normalizeValues(items), ...options };
}

function normalizeValues(values: readonly (string | null | undefined)[] | null | undefined) {
  return (values ?? []).map((value) => value?.trim() ?? "").filter(Boolean);
}

function projectItems(items: readonly { title: string }[] | null | undefined) {
  return normalizeValues((items ?? []).map((item) => item.title));
}

function dateText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function participants(author: string | null | undefined, assignees: readonly string[]) {
  return uniqueSorted([author ?? "", ...assignees]);
}

function developmentItemLabels(items: readonly { label: string }[] | null | undefined) {
  return normalizeValues((items ?? []).map((item) => item.label));
}

function reviewerStateText(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "";
  return reviewerStateLabels[normalized] ?? value?.trim() ?? "";
}

function reviewerItems(pull: GitHubPullRequest) {
  return normalizeValues((pull.reviewers ?? []).map((reviewer) => {
    const parts = [reviewer.login];
    if (reviewer.kind === "team") parts.push("团队");
    const state = reviewerStateText(reviewer.state);
    if (state) parts.push(state);
    return parts.join(" · ");
  }));
}

function commitCountText(count: number | null | undefined) {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  return `${count} 个 commits`;
}

function pullDevelopmentItems(pull: GitHubPullRequest) {
  return normalizeValues([
    `${pull.headBranch} -> ${pull.baseBranch}`,
    pullMergeableText(pull),
    commitCountText(pull.commitCount),
    ...developmentItemLabels(pull.developmentItems),
  ]);
}

function issueStatusText(issue: GitHubIssue) {
  if (issue.state === "open") return "打开";
  if (issue.state === "closed") return "已关闭";
  return issue.state || "未知";
}

function pullStatusText(pull: GitHubPullRequest) {
  if (pull.merged) return "已合并";
  if (pull.draft) return "草稿";
  if (pull.state === "open") return "打开";
  if (pull.state === "closed") return "已关闭";
  return pull.state || "未知";
}

function mergeableStateText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (["mergeable", "clean", "has_hooks", "unstable"].includes(normalized)) return "可合并";
  if (["blocked", "dirty", "behind"].includes(normalized)) return "阻塞";
  if (normalized === "unknown") return "未知";
  if (normalized === "merged") return "已合并";
  return text;
}

function pullMergeableText(pull: GitHubPullRequest) {
  if (pull.merged) return "已合并";
  if (pull.mergeable === true) return mergeableStateText(pull.mergeableState) ?? "可合并";
  if (pull.mergeable === false) return mergeableStateText(pull.mergeableState) ?? "阻塞";
  return mergeableStateText(pull.mergeableState) ?? "未知";
}

function issueSections(issue: GitHubIssue): SidebarSection[] {
  return [
    sidebarSection("status", "状态", [issueStatusText(issue)], { chips: true, inline: true }),
    sidebarSection("author", "作者", [issue.author || "未知作者"], { chips: true, inline: true }),
    sidebarSection("assignees", "负责人", issue.assignees, { chips: true, emptyText: "未分配" }),
    sidebarSection("labels", "标签", issue.labels, { chips: true, emptyText: "无标签" }),
    sidebarSection("projects", "项目", projectItems(issue.projectItems), { chips: true, emptyText: "无项目" }),
    sidebarSection("milestone", "里程碑", issue.milestone?.title ? [issue.milestone.title] : [], {
      chips: true,
      inline: true,
      emptyText: "无里程碑",
    }),
    sidebarSection("development", "开发", developmentItemLabels(issue.developmentItems), {
      chips: true,
      emptyText: "暂无关联开发项",
    }),
    sidebarSection("participants", "参与者", participants(issue.author, issue.assignees), {
      chips: true,
      emptyText: "暂无参与者",
    }),
    sidebarSection("updated", "更新于", [dateText(issue.updatedAt)], { inline: true }),
  ];
}

function pullSections(pull: GitHubPullRequest): SidebarSection[] {
  return [
    sidebarSection("status", "状态", [pullStatusText(pull)], { chips: true, inline: true }),
    sidebarSection("reviewers", "审阅人", reviewerItems(pull), { chips: true, emptyText: "暂无审阅人" }),
    sidebarSection("author", "作者", [pull.author || "未知作者"], { chips: true, inline: true }),
    sidebarSection("assignees", "负责人", pull.assignees, { chips: true, emptyText: "未分配" }),
    sidebarSection("labels", "标签", pull.labels, { chips: true, emptyText: "无标签" }),
    sidebarSection("projects", "项目", projectItems(pull.projectItems), { chips: true, emptyText: "无项目" }),
    sidebarSection("milestone", "里程碑", pull.milestone?.title ? [pull.milestone.title] : [], {
      chips: true,
      inline: true,
      emptyText: "无里程碑",
    }),
    sidebarSection("development", "开发", pullDevelopmentItems(pull), {
      chips: true,
    }),
    sidebarSection("participants", "参与者", participants(pull.author, pull.assignees), {
      chips: true,
      emptyText: "暂无参与者",
    }),
    sidebarSection("updated", "更新于", [dateText(pull.updatedAt)], { inline: true }),
  ];
}
</script>

<template>
  <section v-if="issue || pull" class="card project-sidebar-detail-card" :aria-label="sidebarLabel">
    <div class="project-sidebar-detail-card__head">
      <div class="project-sidebar-detail-card__title">
        <CircleDot v-if="issue" :size="14" aria-hidden="true" />
        <GitPullRequest v-else :size="14" aria-hidden="true" />
        <strong>{{ headerText }}</strong>
      </div>
      <div v-if="issue" class="project-sidebar-detail-card__actions" aria-label="Issue 操作">
        <button type="button" class="ghost" :data-agent-id="`repo.issues.${issue.number}.open-github`" aria-label="打开 GitHub" title="打开 GitHub" @click="emit('openIssue', issue)">
          <ExternalLink :size="14" aria-hidden="true" />
        </button>
        <button type="button" class="ghost" :data-agent-id="`repo.issues.${issue.number}.edit`" :disabled="updatingIssue" aria-label="编辑" title="编辑" @click="emit('editIssue', issue)">
          <Pencil :size="14" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="ghost"
          :data-agent-id="`repo.issues.${issue.number}.toggle`"
          :disabled="updatingIssue"
          :aria-label="issue.state === 'open' ? '关闭' : '重开'"
          :title="issue.state === 'open' ? '关闭' : '重开'"
          @click="emit('toggleIssue', issue)"
        >
          <LoaderCircle v-if="updatingIssue" :size="14" aria-hidden="true" class="sb-spin" />
          <CircleOff v-else-if="issue.state === 'open'" :size="14" aria-hidden="true" />
          <RotateCw v-else :size="14" aria-hidden="true" />
        </button>
      </div>
      <div v-else-if="pull" class="project-sidebar-detail-card__actions" aria-label="Pull Request 操作">
        <button type="button" class="ghost" :data-agent-id="`repo.pulls.${pull.number}.open-github`" aria-label="打开 GitHub" title="打开 GitHub" @click="emit('openPullRequest', pull)">
          <ExternalLink :size="14" aria-hidden="true" />
        </button>
        <button
          v-if="!pull.merged"
          type="button"
          class="ghost"
          :data-agent-id="`repo.pulls.${pull.number}.toggle`"
          :disabled="updatingPullRequest"
          :aria-label="pull.state === 'open' ? '关闭' : '重开'"
          :title="pull.state === 'open' ? '关闭' : '重开'"
          @click="emit('togglePullRequest', pull)"
        >
          <LoaderCircle v-if="updatingPullRequest" :size="14" aria-hidden="true" class="sb-spin" />
          <CircleOff v-else-if="pull.state === 'open'" :size="14" aria-hidden="true" />
          <RotateCw v-else :size="14" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div
      v-for="section in sections"
      :key="section.key"
      class="project-sidebar-detail-card__section"
      :class="{ 'project-sidebar-detail-card__section--inline': section.inline }"
    >
      <h4>{{ section.title }}</h4>
      <div v-if="section.chips && section.items.length" class="project-sidebar-detail-card__chips">
        <span v-for="item in section.items" :key="item" class="project-sidebar-detail-card__chip">{{ item }}</span>
      </div>
      <template v-else-if="section.items.length">
        <p v-for="item in section.items" :key="item">{{ item }}</p>
      </template>
      <p v-else class="project-sidebar-detail-card__empty">{{ section.emptyText ?? "-" }}</p>
    </div>
  </section>
</template>

<style scoped>
.project-sidebar-detail-card {
  display: grid;
  gap: 0;
  min-width: 0;
  margin: 0;
  padding: 0 var(--repo-sidebar-card-padding);
}

.project-sidebar-detail-card__head,
.project-sidebar-detail-card__section {
  min-width: 0;
  border-bottom: 1px solid var(--border-soft);
}

.project-sidebar-detail-card__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: var(--repo-sidebar-header-height);
  color: var(--text);
}

.project-sidebar-detail-card__title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.project-sidebar-detail-card__title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.project-sidebar-detail-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--repo-sidebar-list-gap);
  min-width: 0;
}

.project-sidebar-detail-card__actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--repo-sidebar-icon-button-size);
  height: var(--repo-sidebar-icon-button-size);
  padding: 0;
}

.project-sidebar-detail-card__section {
  display: grid;
  gap: var(--repo-sidebar-list-gap);
  min-height: var(--repo-sidebar-control-height);
  padding: var(--repo-sidebar-card-padding) 0;
}

.project-sidebar-detail-card__section--inline {
  grid-template-columns: var(--repo-sidebar-label-width) minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  height: var(--repo-sidebar-control-height);
  padding: 0;
}

.project-sidebar-detail-card__section:last-child {
  border-bottom: 0;
}

.project-sidebar-detail-card__section h4,
.project-sidebar-detail-card__section p {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-sidebar-detail-card__section h4 {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.project-sidebar-detail-card__section p {
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
}

.project-sidebar-detail-card__section--inline p {
  text-align: right;
}

.project-sidebar-detail-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--repo-sidebar-list-gap);
  min-width: 0;
}

.project-sidebar-detail-card__section--inline .project-sidebar-detail-card__chips {
  flex-wrap: nowrap;
  justify-content: flex-end;
  overflow: hidden;
}

.project-sidebar-detail-card__chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  min-height: 24px;
  padding: 2px 7px;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text);
  font-size: 12px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-sidebar-detail-card__section .project-sidebar-detail-card__empty {
  color: var(--text-muted);
}
</style>
