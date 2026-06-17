<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from "vue-router";
import { computed, nextTick, ref, watch } from "vue";
import { AlertCircle, EyeOff, FolderGit2, GitPullRequestArrow, LoaderCircle, Search, X } from "@lucide/vue";
import { SIDEBAR_NAV } from "../config/appShell";
import { useWorkspace } from "../composables/useWorkspace";
import {
  bulkSyncRunningRepoIds as getBulkSyncRunningRepoIds,
  repoActionErrorForRepo,
  syncErrorByRepoId,
} from "../composables/workspace/state";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import SidebarRowTools from "../components/sidebar/SidebarRowTools.vue";
import type { ContextMenuItem } from "../composables/useContextMenu";
import {
  type RepoSummary,
} from "../services/workspace";
import { repoDisplayName, repoDisplayTitle } from "../utils/repoDisplay";
import { parseRemoteRepoId, remoteRepoRoute } from "../utils/remoteRepo";
import { repoRoute } from "../utils/repoRoutes";

const workspace = useWorkspace();
const route = useRoute();
const router = useRouter();
const searchInput = ref<HTMLInputElement | null>(null);

const props = defineProps<{
  searchOpen: boolean;
  searchQuery: string;
}>();

const emit = defineEmits<{
  "update:searchOpen": [value: boolean];
  "update:searchQuery": [value: string];
}>();

const searchQueryModel = computed({
  get: () => props.searchQuery,
  set: (value: string) => emit("update:searchQuery", value),
});

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

const bulkSyncRunningRepoIds = computed(() => {
  return getBulkSyncRunningRepoIds();
});

const bulkSyncErrorByRepoId = computed(() => {
  return syncErrorByRepoId();
});

function isRefreshingRepo(repoId: string) {
  return workspace.state.refreshingRepoIds.includes(repoId);
}

interface RepoIssue {
  label: string;
  title: string;
}

function repoIssue(repo: RepoSummary): RepoIssue | null {
  const syncError = bulkSyncErrorByRepoId.value.get(repo.id);
  if (syncError) return { label: "同步失败", title: syncError };
  const actionError = repoActionErrorForRepo(repo.id);
  if (actionError) return { label: "仓库操作失败", title: actionError };
  if (repo.conflictCount > 0) {
    return { label: "存在合并冲突", title: "存在合并冲突，请处理后再同步" };
  }
  return null;
}

const filteredRepoItems = computed(() => {
  const query = searchQueryModel.value.trim().toLocaleLowerCase();
  return workspace.state.repos
    .filter((repo) =>
      !query ||
      [
        repoDisplayName(repo),
        repo.name,
        repo.githubFullName,
        repo.relativePath,
        repo.path,
      ].some((value) => value?.toLocaleLowerCase().includes(query)),
    )
    .map((repo) => ({
      repo,
      dirtyCount: repoDirtyCount(repo),
      issue: repoIssue(repo),
    }));
});

const localRepoFullNames = computed(() =>
  new Set(
    workspace.state.repos
      .map((repo) => repo.githubFullName)
      .filter((name): name is string => Boolean(name)),
  ),
);

const remoteRepoItems = computed(() =>
  [...(workspace.state.settings?.remoteRepoShortcuts ?? [])]
    .filter((repo) => !localRepoFullNames.value.has(repo.fullName))
    .sort((a, b) => b.openedAt - a.openedAt || a.fullName.localeCompare(b.fullName)),
);

const activeRemoteFullName = computed(() =>
  parseRemoteRepoId(String(route.params.repoId ?? "")),
);

watch(
  () => props.searchOpen,
  (open) => {
    if (open) void nextTick(() => searchInput.value?.focus());
  },
);

function closeSearch() {
  emit("update:searchOpen", false);
  emit("update:searchQuery", "");
}

async function openFirstSearchResult() {
  const repo = filteredRepoItems.value[0]?.repo;
  if (!repo) return;
  await router.push(repoRoute(repo.id));
}

async function openRemoteRepo(fullName: string) {
  await router.push(remoteRepoRoute(fullName));
}

async function removeRemoteRepo(fullName: string) {
  await workspace.forgetRemoteRepo(fullName);
  if (activeRemoteFullName.value === fullName) {
    await router.push("/");
  }
}

function repoContextMenu(repo: RepoSummary): ContextMenuItem[] {
  return [
    {
      id: `hide-repo-${repo.id}`,
      label: "隐藏仓库",
      icon: EyeOff,
      danger: true,
      confirmLabel: "确认隐藏？再点一次",
      async onSelect() {
        await workspace.hideRepo(repo.id);
        if (route.path.startsWith("/repos/") && String(route.params.repoId ?? "") === repo.id) {
          await router.push("/");
        }
      },
    },
  ];
}

function isRepoActive(repoId: string) {
  const base = repoRoute(repoId);
  return route.path === base || route.path.startsWith(`${base}/`);
}
</script>

<template>
  <aside class="secondary-panel">
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
          exact-active-class="is-active"
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
        <span class="sb-section__title">仓库 {{ workspace.state.repos.length }}</span>
      </div>
      <div v-if="searchOpen" class="sb-search">
        <Search :size="13" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="searchQueryModel"
          type="search"
          aria-label="搜索仓库"
          placeholder="搜索仓库"
          @keydown.enter.prevent="openFirstSearchResult"
          @keydown.esc.prevent="closeSearch"
        />
        <button type="button" aria-label="关闭搜索" title="关闭搜索" @click="closeSearch">
          <X :size="13" aria-hidden="true" />
        </button>
      </div>
      <div class="sb-tree">
        <RouterLink
          v-for="{ repo, dirtyCount, issue } in filteredRepoItems"
          :key="repo.id"
          :to="repoRoute(repo.id)"
          class="sb-tree__row sb-tree__row--project"
          :class="{ 'is-active': isRepoActive(repo.id) }"
          active-class="is-active"
          :title="repoDisplayTitle(repo)"
          v-context-menu="repoContextMenu(repo)"
        >
          <FolderGit2 :size="14" aria-hidden="true" />
          <span class="sb-tree__name">{{ repoDisplayName(repo) }}</span>
          <span
            v-if="bulkSyncRunningRepoIds.has(repo.id)"
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
          <span v-if="workspace.state.launchStatuses[repo.id]?.state === 'running'" class="sb-badge sb-badge--ok">RUN</span>
          <span v-if="dirtyCount" class="sb-badge sb-badge--warn">{{ dirtyCount }}</span>
          <span v-if="repo.ahead" class="sb-badge">↑{{ repo.ahead }}</span>
          <span v-if="repo.behind" class="sb-badge">↓{{ repo.behind }}</span>
          <span
            v-if="isRefreshingRepo(repo.id)"
            class="sb-row-loader"
            title="正在刷新仓库"
            aria-label="正在刷新仓库"
          >
            <LoaderCircle :size="11" aria-hidden="true" class="sb-spin" />
          </span>
        </RouterLink>
        <p v-if="!workspace.state.repos.length" class="sb-tree__empty">选择工作区后显示 Git 仓库。</p>
        <p v-else-if="searchOpen && !filteredRepoItems.length" class="sb-tree__empty">没有匹配的仓库。</p>
      </div>
    </div>

    <div v-if="remoteRepoItems.length" class="sb-section sb-section--remote">
      <div class="sb-section__header">
        <span class="sb-section__title">远程仓库 {{ remoteRepoItems.length }}</span>
      </div>
      <div class="sb-tree">
        <div
          v-for="repo in remoteRepoItems"
          :key="repo.fullName"
          class="sb-tree__row sb-tree__row--project sb-tree__row--remote"
          :class="{ 'is-active': activeRemoteFullName === repo.fullName }"
          role="link"
          tabindex="0"
          :title="repo.fullName"
          :aria-label="`打开 ${repo.fullName}`"
          @click="openRemoteRepo(repo.fullName)"
          @keydown.enter.prevent="openRemoteRepo(repo.fullName)"
          @keydown.space.prevent="openRemoteRepo(repo.fullName)"
        >
          <FolderGit2 :size="14" aria-hidden="true" />
          <span class="sb-tree__name">{{ repo.name }}</span>
          <span v-if="repo.archived" class="sb-badge">ARCH</span>
          <span v-if="repo.private" class="sb-badge">私有</span>
          <button
            type="button"
            class="sb-icon-btn sb-tree__remote-remove"
            :aria-label="`移除 ${repo.fullName}`"
            title="从侧边栏移除"
            @click.stop="removeRemoteRepo(repo.fullName)"
          >
            <X :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <SidebarFooter
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

.sb-section__header {
  display: flex;
  align-items: center;
  gap: 5px;
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

.sb-row-loader {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

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

.sb-icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 4px;
}

.sb-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
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

.sb-search {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 22px;
  align-items: center;
  gap: 4px;
  margin: 0 6px 4px;
  padding: 0 4px;
  height: 30px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text-faint);
  background: var(--bg-subtle);
}

.sb-search input {
  width: 100%;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
}

.sb-search button {
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--text-muted);
}

.sb-tree__row--project.is-active {
  color: var(--accent);
}

.sb-tree__row--remote {
  cursor: pointer;
}

.sb-tree__remote-remove {
  flex: 0 0 auto;
  opacity: 0;
  pointer-events: none;
}

.sb-tree__row--remote:hover .sb-tree__remote-remove,
.sb-tree__row--remote:focus-within .sb-tree__remote-remove,
.sb-tree__row--remote.is-active .sb-tree__remote-remove {
  opacity: 1;
  pointer-events: auto;
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

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
