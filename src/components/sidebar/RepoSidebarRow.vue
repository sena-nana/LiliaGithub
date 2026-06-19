<script setup lang="ts">
import { AlertCircle, FolderGit2, GitBranch, LoaderCircle } from "@lucide/vue";
import { RouterLink } from "vue-router";
import type { ContextMenuItem } from "../../composables/useContextMenu";
import type { RepoSummary } from "../../services/workspace";
import { repoDisplayName, repoDisplayTitle } from "../../utils/repoDisplay";
import { isLinkedWorktree } from "../../utils/repoWorktree";

interface RepoSidebarIssue {
  label: string;
  title: string;
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
      class="sb-badge sb-badge--error"
      :title="issue.title"
      :aria-label="issue.label"
    >
      <AlertCircle :size="11" aria-hidden="true" />
    </span>
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

.sb-badge--error {
  background: var(--err-soft);
  color: var(--err);
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
