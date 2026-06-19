<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from "vue-router";
import { computed, nextTick, ref, watch } from "vue";
import { EyeOff, FolderGit2, FolderInput, GitPullRequestArrow, Plus, Search, Trash2, X } from "@lucide/vue";
import { SIDEBAR_NAV } from "../config/appShell";
import { useWorkspace } from "../composables/useWorkspace";
import {
  bulkSyncRunningRepoIds as getBulkSyncRunningRepoIds,
  repoActionErrorForRepo,
  syncErrorByRepoId,
} from "../composables/workspace/state";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import RepoSidebarRow from "../components/sidebar/RepoSidebarRow.vue";
import SidebarRowTools from "../components/sidebar/SidebarRowTools.vue";
import type { ContextMenuItem } from "../composables/useContextMenu";
import type { RepoSummary } from "../services/workspace";
import { repoDisplayName } from "../utils/repoDisplay";
import { parseRemoteRepoId, remoteRepoRoute } from "../utils/remoteRepo";
import { repoRoute } from "../utils/repoRoutes";

const workspace = useWorkspace();
const route = useRoute();
const router = useRouter();
const searchInput = ref<HTMLInputElement | null>(null);
const createGroupOpen = ref(false);
const createGroupName = ref("");
const createGroupError = ref<string | null>(null);
const createGroupBusy = ref(false);
const pendingDeleteGroupId = ref<string | null>(null);

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

interface RepoItem {
  repo: RepoSummary;
  dirtyCount: number;
  issue: RepoIssue | null;
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

const repoItems = computed<RepoItem[]>(() =>
  workspace.state.repos.map((repo) => ({
    repo,
    dirtyCount: repoDirtyCount(repo),
    issue: repoIssue(repo),
  })),
);

function repoMatchesQuery(repo: RepoSummary, query: string) {
  if (!query) return true;
  return [
    repoDisplayName(repo),
    repo.name,
    repo.githubFullName,
    repo.relativePath,
    repo.path,
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}

const filteredRepoItems = computed(() => {
  const query = searchQueryModel.value.trim().toLocaleLowerCase();
  return repoItems.value.filter(({ repo }) => repoMatchesQuery(repo, query));
});

const repoGroups = computed(() => workspace.state.settings?.repoGroups ?? []);

const repoItemById = computed(() => new Map(repoItems.value.map((item) => [item.repo.id, item])));

const groupedRepoIds = computed(() => {
  const ids = new Set<string>();
  for (const group of repoGroups.value) {
    for (const repoId of group.repoIds) ids.add(repoId);
  }
  return ids;
});

const ungroupedRepoItems = computed(() =>
  repoItems.value.filter(({ repo }) => !groupedRepoIds.value.has(repo.id)),
);

const groupedRepoSections = computed(() =>
  repoGroups.value.map((group) => ({
    group,
    items: group.repoIds
      .map((repoId) => repoItemById.value.get(repoId))
      .filter((item): item is RepoItem => Boolean(item)),
  })),
);

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

function repoCurrentGroupId(repoId: string): string | null {
  return repoGroups.value.find((group) => group.repoIds.includes(repoId))?.id ?? null;
}

function repoContextMenu(repo: RepoSummary): ContextMenuItem[] {
  const currentGroupId = repoCurrentGroupId(repo.id);
  const moveChildren: ContextMenuItem[] = [
    {
      id: `move-repo-${repo.id}-ungrouped`,
      label: "移到未分组",
      icon: FolderGit2,
      disabled: currentGroupId === null,
      async onSelect() {
        await workspace.moveRepoToGroup(repo.id, null);
      },
    },
    ...repoGroups.value.map((group) => ({
      id: `move-repo-${repo.id}-${group.id}`,
      label: group.name,
      icon: FolderInput,
      disabled: currentGroupId === group.id,
      async onSelect() {
        await workspace.moveRepoToGroup(repo.id, group.id);
      },
    })),
  ];
  return [
    {
      id: `move-repo-${repo.id}`,
      label: "移动到分组",
      icon: FolderInput,
      children: moveChildren,
    },
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

function repoRowProps(item: RepoItem) {
  return {
    repo: item.repo,
    to: repoRoute(item.repo.id),
    active: isRepoActive(item.repo.id),
    dirtyCount: item.dirtyCount,
    issue: item.issue,
    syncing: bulkSyncRunningRepoIds.value.has(item.repo.id),
    refreshing: isRefreshingRepo(item.repo.id),
    launchRunning: workspace.state.launchStatuses[item.repo.id]?.state === "running",
    contextMenu: repoContextMenu(item.repo),
  };
}

function openCreateGroup() {
  createGroupOpen.value = true;
  createGroupName.value = "";
  createGroupError.value = null;
}

function closeCreateGroup() {
  if (createGroupBusy.value) return;
  createGroupOpen.value = false;
  createGroupName.value = "";
  createGroupError.value = null;
}

async function submitCreateGroup() {
  const name = createGroupName.value.trim();
  if (!name) {
    createGroupError.value = "分组名称不能为空";
    return;
  }
  createGroupBusy.value = true;
  createGroupError.value = null;
  try {
    await workspace.createRepoGroup(name);
    createGroupOpen.value = false;
    createGroupName.value = "";
  } catch (err) {
    createGroupError.value = err instanceof Error ? err.message : String(err);
  } finally {
    createGroupBusy.value = false;
  }
}

async function deleteGroup(group: { id: string }) {
  if (pendingDeleteGroupId.value !== group.id) {
    pendingDeleteGroupId.value = group.id;
    return;
  }
  await workspace.deleteRepoGroup(group.id);
  pendingDeleteGroupId.value = null;
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
        <span class="sb-section__title">
          {{ searchOpen ? `搜索结果 ${filteredRepoItems.length}` : `未分组仓库 ${ungroupedRepoItems.length}` }}
        </span>
        <button
          v-if="!searchOpen"
          type="button"
          class="sb-icon-btn"
          aria-label="创建仓库分组"
          title="创建仓库分组"
          @click="openCreateGroup"
        >
          <Plus :size="13" aria-hidden="true" />
        </button>
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
      <form v-if="createGroupOpen && !searchOpen" class="sb-group-form" @submit.prevent="submitCreateGroup">
        <input
          v-model="createGroupName"
          type="text"
          aria-label="分组名称"
          placeholder="分组名称"
          :disabled="createGroupBusy"
        />
        <button type="submit" class="sb-group-form__submit" :disabled="createGroupBusy">创建</button>
        <button type="button" class="sb-icon-btn" aria-label="取消创建分组" title="取消" @click="closeCreateGroup">
          <X :size="13" aria-hidden="true" />
        </button>
        <p v-if="createGroupError" class="sb-group-form__error">{{ createGroupError }}</p>
      </form>
      <div class="sb-tree">
        <RepoSidebarRow
          v-for="item in searchOpen ? filteredRepoItems : ungroupedRepoItems"
          :key="item.repo.id"
          v-bind="repoRowProps(item)"
        />
        <p v-if="!workspace.state.repos.length" class="sb-tree__empty">选择工作区后显示 Git 仓库。</p>
        <p v-else-if="searchOpen && !filteredRepoItems.length" class="sb-tree__empty">没有匹配的仓库。</p>
      </div>
    </div>

    <template v-if="!searchOpen">
      <div
        v-for="{ group, items } in groupedRepoSections"
        :key="group.id"
        class="sb-section sb-section--group"
      >
        <div class="sb-section__header">
          <span class="sb-section__title">{{ group.name }} {{ items.length }}</span>
          <button
            type="button"
            class="sb-icon-btn"
            :class="{ 'is-danger': pendingDeleteGroupId === group.id }"
            :aria-label="pendingDeleteGroupId === group.id ? `确认删除分组 ${group.name}` : `删除分组 ${group.name}`"
            :title="pendingDeleteGroupId === group.id ? '确认删除分组' : '删除分组'"
            @click="deleteGroup(group)"
          >
            <Trash2 :size="13" aria-hidden="true" />
          </button>
        </div>
        <div class="sb-tree">
          <RepoSidebarRow
            v-for="item in items"
            :key="item.repo.id"
            v-bind="repoRowProps(item)"
          />
          <p v-if="!items.length" class="sb-tree__empty">没有仓库。</p>
        </div>
      </div>
    </template>

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
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
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
  border-radius: var(--radius-sm);
}

.sb-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.sb-icon-btn.is-danger {
  color: var(--err);
  background: var(--err-soft);
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
  border-radius: var(--radius-md);
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

.sb-group-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 22px;
  gap: 4px;
  margin: 0 6px 4px;
  align-items: center;
}

.sb-group-form input {
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.sb-group-form__submit {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  color: var(--text-muted);
  cursor: pointer;
}

.sb-group-form__submit:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.sb-group-form__submit:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.sb-group-form__error {
  grid-column: 1 / -1;
  margin: 0 2px;
  color: var(--err);
  font-size: 12px;
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
