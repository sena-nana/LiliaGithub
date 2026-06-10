<script setup lang="ts">
import { RouterLink } from "vue-router";
import { computed } from "vue";
import { FolderGit2, GitPullRequestArrow, RefreshCw, Upload } from "@lucide/vue";
import {
  SIDEBAR_FOOTER_LINKS,
  SIDEBAR_NAV,
} from "../config/appShell";
import { useWorkspace } from "../composables/useWorkspace";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import SidebarRowTools from "../components/sidebar/SidebarRowTools.vue";

const workspace = useWorkspace();

const footerStatus = computed(() => {
  if (!workspace.workspaceRoot.value) {
    return {
      to: "/",
      label: "Setup",
      title: "尚未选择工作区。点击进入总览配置。",
      tone: "warn" as const,
      icon: FolderGit2,
    };
  }
  if (!workspace.isAuthorized.value) {
    return {
      to: "/",
      label: "Auth",
      title: "尚未完成 GitHub 授权。点击进入总览配置。",
      tone: "warn" as const,
      icon: GitPullRequestArrow,
    };
  }
  return {
    to: "/settings",
    label: workspace.githubBinding.value?.login ?? "GitHub",
    title: "GitHub 已授权。点击进入设置。",
    tone: "ok" as const,
    icon: GitPullRequestArrow,
  };
});

function repoDirtyCount(repo: { stagedCount: number; unstagedCount: number; untrackedCount: number }) {
  return repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
}
</script>

<template>
  <aside class="secondary-panel">
    <div class="sb-section sb-section--actions">
      <button
        type="button"
        class="sb-action"
        title="刷新仓库"
        aria-label="刷新仓库"
        :disabled="workspace.state.scanning"
        @click="workspace.refreshRepos"
      >
        <RefreshCw :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="sb-action"
        title="拉取预检"
        aria-label="拉取预检"
        :disabled="!workspace.isReady.value"
        @click="workspace.previewBulk('pull')"
      >
        <GitPullRequestArrow :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="sb-action"
        title="推送预检"
        aria-label="推送预检"
        :disabled="!workspace.isReady.value"
        @click="workspace.previewBulk('push')"
      >
        <Upload :size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="sb-section">
      <div class="sb-section__header">
        <span class="sb-section__title">工作区</span>
      </div>
      <nav class="sb-tree" aria-label="主导航">
        <RouterLink
          v-for="item in SIDEBAR_NAV"
          :key="item.label"
          :to="item.to ?? '/'"
          class="sb-tree__row"
          active-class="is-active"
          :aria-disabled="item.disabled ? 'true' : undefined"
        >
          <component :is="item.icon" :size="14" aria-hidden="true" />
          <span class="sb-tree__name">{{ item.label }}</span>
          <SidebarRowTools v-if="item.tools?.length" :tools="item.tools" />
        </RouterLink>
      </nav>
    </div>

    <div class="sb-section">
      <div class="sb-section__header">
        <span class="sb-section__title">仓库</span>
        <div class="sb-section__tools">
          <button
            type="button"
            class="sb-icon-btn"
            title="刷新仓库"
            aria-label="刷新仓库"
            :disabled="workspace.state.scanning"
            @click="workspace.refreshRepos"
          >
            <RefreshCw :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div class="sb-tree">
        <RouterLink
          v-for="repo in workspace.state.repos"
          :key="repo.id"
          :to="`/repos/${encodeURIComponent(repo.id)}`"
          class="sb-tree__row sb-tree__row--project"
          active-class="is-active"
        >
          <FolderGit2 :size="14" aria-hidden="true" />
          <span class="sb-tree__name">{{ repo.name }}</span>
          <span v-if="workspace.state.launchStatuses[repo.id]?.state === 'running'" class="sb-badge sb-badge--ok">RUN</span>
          <span v-if="repoDirtyCount(repo)" class="sb-badge sb-badge--warn">{{ repoDirtyCount(repo) }}</span>
          <span v-if="repo.ahead" class="sb-badge">↑{{ repo.ahead }}</span>
          <span v-if="repo.behind" class="sb-badge">↓{{ repo.behind }}</span>
        </RouterLink>
        <p v-if="workspace.state.scanning" class="sb-tree__empty">正在扫描仓库...</p>
        <p v-else-if="!workspace.state.repos.length" class="sb-tree__empty">选择工作区后显示 Git 仓库。</p>
      </div>
    </div>

    <SidebarFooter
      :links="SIDEBAR_FOOTER_LINKS"
      :status="footerStatus"
    />
  </aside>
</template>

<style scoped>
.sb-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

.sb-section--actions {
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 2px 2px 0;
}

.sb-section__header {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 6px 0 8px;
  color: var(--text-faint);
}

.sb-section__title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.sb-section__tools {
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.sb-section__header:hover .sb-section__tools,
.sb-section__header:focus-within .sb-section__tools {
  opacity: 1;
}

.sb-action,
.sb-icon-btn {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.sb-action {
  flex: 1;
  height: 30px;
  padding: 0;
  border-radius: 6px;
}

.sb-icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 4px;
}

.sb-action:hover,
.sb-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.sb-tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  min-height: 0;
}

.sb-tree__empty {
  margin: 6px 8px;
  color: var(--text-faint);
  font-size: 12px;
}

.sb-tree__row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
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

.sb-tree__row:hover .sb-tree__hover-tools,
.sb-tree__row:focus-within .sb-tree__hover-tools,
.sb-tree__row.is-active .sb-tree__hover-tools {
  opacity: 1;
  pointer-events: auto;
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

.sb-badge {
  flex-shrink: 0;
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
</style>
