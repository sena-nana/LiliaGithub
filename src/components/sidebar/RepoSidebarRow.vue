<script setup lang="ts">
import { AlertCircle, FolderGit2, GitBranch, LoaderCircle, RotateCw } from "@lucide/vue";
import { RouterLink } from "vue-router";
import type { ContextMenuItem } from "../../composables/useContextMenu";
import type { RepoSummary } from "../../services/workspace";
import { repoDisplayName, repoDisplayTitle } from "../../utils/repoDisplay";
import { isLinkedWorktree } from "../../utils/repoWorktree";

interface RepoSidebarIssue {
  label: string;
  message: string;
  retryable: boolean;
  retrying: boolean;
}

defineProps<{
  repo: RepoSummary;
  to: string;
  active: boolean;
  dirtyCount: number;
  issue: RepoSidebarIssue | null;
  syncing: boolean;
  refreshing: boolean;
  launchRunning: boolean;
  contextMenu: ContextMenuItem[];
}>();

defineEmits<{
  retry: [];
}>();
</script>

<template>
  <RouterLink
    :to="to"
    class="sb-tree__row sb-tree__row--project"
    :class="{ 'is-active': active }"
    active-class="is-active"
    :title="repoDisplayTitle(repo)"
    v-context-menu="contextMenu"
  >
    <component
      :is="isLinkedWorktree(repo) ? GitBranch : FolderGit2"
      :size="14"
      aria-hidden="true"
      class="sb-tree__repo-icon"
      :class="{ 'is-worktree': isLinkedWorktree(repo) }"
    />
    <span class="sb-tree__name">{{ repoDisplayName(repo) }}</span>
    <span
      v-if="syncing"
      class="sb-badge"
      title="正在同步"
      aria-label="正在同步"
    >
      <LoaderCircle :size="11" aria-hidden="true" class="sb-spin" />
    </span>
    <span
      v-else-if="issue"
      class="sb-issue"
      :title="issue.message"
      :aria-label="issue.label"
    >
      <AlertCircle :size="11" aria-hidden="true" />
      <span>{{ issue.message }}</span>
    </span>
    <button
      v-if="issue?.retryable"
      type="button"
      class="sb-retry"
      :title="issue.retrying ? '正在重试' : '重试'"
      :aria-label="issue.retrying ? '正在重试' : '重试最近同步失败'"
      :disabled="issue.retrying"
      @click.prevent.stop="$emit('retry')"
    >
      <LoaderCircle v-if="issue.retrying" :size="11" aria-hidden="true" class="sb-spin" />
      <RotateCw v-else :size="11" aria-hidden="true" />
    </button>
    <span v-if="launchRunning" class="sb-badge sb-badge--ok">RUN</span>
    <span v-if="dirtyCount" class="sb-badge sb-badge--warn">{{ dirtyCount }}</span>
    <span v-if="repo.ahead" class="sb-badge">↑{{ repo.ahead }}</span>
    <span v-if="repo.behind" class="sb-badge">↓{{ repo.behind }}</span>
    <span
      v-if="refreshing"
      class="sb-row-loader"
      title="正在刷新仓库"
      aria-label="正在刷新仓库"
    >
      <LoaderCircle :size="11" aria-hidden="true" class="sb-spin" />
    </span>
  </RouterLink>
</template>

<style scoped>
.sb-tree__row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  color: var(--text);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  min-width: 0;
}

.sb-tree__row:hover {
  background: var(--bg-hover);
}

.sb-tree__row.is-active {
  background: var(--bg-active);
  color: var(--accent);
}

.sb-tree__row--project {
  color: var(--text-muted);
}

.sb-tree__row--project.is-active {
  color: var(--accent);
}

.sb-tree__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-row-loader {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.sb-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}

.sb-badge--warn {
  background: var(--warn-soft);
  color: var(--warn);
}

.sb-badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}

.sb-issue {
  flex: 0 1 auto;
  min-width: 24px;
  max-width: min(45%, 180px);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--err);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.sb-issue span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sb-retry {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--err-soft);
  color: var(--err);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.sb-retry:hover {
  background: color-mix(in srgb, var(--err-soft) 72%, var(--bg-hover));
}

.sb-retry:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
