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
  lines: string[];
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

function listText(values: readonly string[] | null | undefined, emptyText: string) {
  const text = (values ?? []).map((value) => value.trim()).filter(Boolean).join(", ");
  return text || emptyText;
}

function projectText(items: readonly { title: string }[] | null | undefined, emptyText: string) {
  const text = (items ?? []).map((item) => item.title.trim()).filter(Boolean).join(", ");
  return text || emptyText;
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

function participantsText(author: string | null | undefined, assignees: readonly string[]) {
  return uniqueSorted([author ?? "", ...assignees]).join(", ") || "No participants";
}

function issueStatusText(issue: GitHubIssue) {
  return issue.state === "open" ? "Open" : "Closed";
}

function pullStatusText(pull: GitHubPullRequest) {
  if (pull.merged) return "Merged";
  if (pull.draft) return "Draft";
  return pull.state === "open" ? "Open" : "Closed";
}

function pullMergeableText(pull: GitHubPullRequest) {
  if (pull.merged) return "Merged";
  if (pull.mergeable === true) return pull.mergeableState || "Mergeable";
  if (pull.mergeable === false) return pull.mergeableState || "Blocked";
  return pull.mergeableState || "Unknown";
}

function issueSections(issue: GitHubIssue): SidebarSection[] {
  return [
    { key: "status", title: "Status", lines: [issueStatusText(issue)] },
    { key: "author", title: "Author", lines: [issue.author || "Unknown author"] },
    { key: "assignees", title: "Assignees", lines: [listText(issue.assignees, "No assignees")] },
    { key: "labels", title: "Labels", lines: [listText(issue.labels, "No labels")] },
    { key: "projects", title: "Projects", lines: [projectText(issue.projectItems, "No projects")] },
    { key: "milestone", title: "Milestone", lines: [issue.milestone?.title || "No milestone"] },
    { key: "development", title: "Development", lines: ["No development linked"] },
    { key: "participants", title: "Participants", lines: [participantsText(issue.author, issue.assignees)] },
    { key: "updated", title: "Updated", lines: [dateText(issue.updatedAt)] },
  ];
}

function pullSections(pull: GitHubPullRequest): SidebarSection[] {
  return [
    { key: "status", title: "Status", lines: [pullStatusText(pull)] },
    { key: "reviewers", title: "Reviewers", lines: ["No reviewers"] },
    { key: "author", title: "Author", lines: [pull.author || "Unknown author"] },
    { key: "assignees", title: "Assignees", lines: [listText(pull.assignees, "No assignees")] },
    { key: "labels", title: "Labels", lines: [listText(pull.labels, "No labels")] },
    { key: "projects", title: "Projects", lines: [projectText(pull.projectItems, "No projects")] },
    { key: "milestone", title: "Milestone", lines: [pull.milestone?.title || "No milestone"] },
    { key: "development", title: "Development", lines: [`${pull.headBranch} -> ${pull.baseBranch}`, pullMergeableText(pull)] },
    { key: "participants", title: "Participants", lines: [participantsText(pull.author, pull.assignees)] },
    { key: "updated", title: "Updated", lines: [dateText(pull.updatedAt)] },
  ];
}
</script>

<template>
  <section v-if="issue || pull" class="project-sidebar-detail-card" :aria-label="sidebarLabel">
    <div class="project-sidebar-detail-card__head">
      <CircleDot v-if="issue" :size="14" aria-hidden="true" />
      <GitPullRequest v-else :size="14" aria-hidden="true" />
      <strong>{{ headerText }}</strong>
    </div>
    <div v-if="issue" class="project-sidebar-detail-card__actions" aria-label="Issue 操作">
      <button type="button" class="ghost" @click="emit('openIssue', issue)">
        <ExternalLink :size="14" aria-hidden="true" />
        打开 GitHub
      </button>
      <button type="button" class="ghost" :disabled="updatingIssue" @click="emit('editIssue', issue)">
        <Pencil :size="14" aria-hidden="true" />
        编辑
      </button>
      <button type="button" class="ghost" :disabled="updatingIssue" @click="emit('toggleIssue', issue)">
        <LoaderCircle v-if="updatingIssue" :size="14" aria-hidden="true" class="sb-spin" />
        <CircleOff v-else-if="issue.state === 'open'" :size="14" aria-hidden="true" />
        <RotateCw v-else :size="14" aria-hidden="true" />
        {{ issue.state === "open" ? "关闭" : "重开" }}
      </button>
    </div>
    <div v-else-if="pull" class="project-sidebar-detail-card__actions" aria-label="Pull Request 操作">
      <button type="button" class="ghost" @click="emit('openPullRequest', pull)">
        <ExternalLink :size="14" aria-hidden="true" />
        打开 GitHub
      </button>
      <button
        v-if="!pull.merged"
        type="button"
        class="ghost"
        :disabled="updatingPullRequest"
        @click="emit('togglePullRequest', pull)"
      >
        <LoaderCircle v-if="updatingPullRequest" :size="14" aria-hidden="true" class="sb-spin" />
        <CircleOff v-else-if="pull.state === 'open'" :size="14" aria-hidden="true" />
        <RotateCw v-else :size="14" aria-hidden="true" />
        {{ pull.state === "open" ? "关闭" : "重开" }}
      </button>
    </div>

    <div v-for="section in sections" :key="section.key" class="project-sidebar-detail-card__section">
      <h4>{{ section.title }}</h4>
      <p v-for="line in section.lines" :key="line">{{ line }}</p>
    </div>
  </section>
</template>

<style scoped>
.project-sidebar-detail-card {
  display: grid;
  gap: 0;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.project-sidebar-detail-card__head,
.project-sidebar-detail-card__actions,
.project-sidebar-detail-card__section {
  min-width: 0;
  border-bottom: 1px solid var(--border-soft);
}

.project-sidebar-detail-card__head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  color: var(--text);
}

.project-sidebar-detail-card__head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.project-sidebar-detail-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 10px 0;
}

.project-sidebar-detail-card__actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.project-sidebar-detail-card__section {
  display: grid;
  gap: 5px;
  padding: 10px 0;
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
</style>
