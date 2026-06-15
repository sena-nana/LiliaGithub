<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from "vue-router";
import { computed, nextTick, ref, watch } from "vue";
import { AlertCircle, EyeOff, FolderGit2, GitPullRequestArrow, LoaderCircle, Lock, Search, Sparkles, X } from "@lucide/vue";
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
  getGitHubBindingStatus,
  isGitHubBindingExpiredError,
  listGitHubRepos,
  preloadGitHubRepos,
  readCachedGitHubRepos,
  type GitHubBindingStatus,
  type GitHubRepoSummary,
  type RepoSummary,
} from "../services/workspace";
import { repoDisplayName, repoDisplayTitle } from "../utils/repoDisplay";
import { parseRemoteRepoId, remoteRepoRoute } from "../utils/remoteRepo";

const workspace = useWorkspace();
const route = useRoute();
const router = useRouter();
const searchInput = ref<HTMLInputElement | null>(null);
const cloneOpen = ref(false);
const cloneRemoteUrl = ref("");
const cloneDirectoryName = ref("");
const cloneTouchedDirectory = ref(false);
const cloneBusy = ref(false);
const cloneError = ref<string | null>(null);
const cloneInput = ref<HTMLInputElement | null>(null);
const cloneBindingStatus = ref<GitHubBindingStatus | null>(null);
const cloneRepoItems = ref<GitHubRepoSummary[]>([]);
const cloneRepoDropdownOpen = ref(false);
const cloneRepoLoading = ref(false);
const cloneRepoLoadingMore = ref(false);
const cloneRepoLoadError = ref<string | null>(null);
const cloneNextRepoPage = ref<number | null>(null);
const cloneSelectedRepo = ref<GitHubRepoSummary | null>(null);

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

const canSubmitClone = computed(() => cloneRemoteUrl.value.trim().length > 0 && !cloneBusy.value);
const cloneGitHubBound = computed(() => cloneBindingStatus.value?.state === "bound");
const cloneQueryTrimmed = computed(() => cloneRemoteUrl.value.trim());
const cloneBindingExpired = computed(() => cloneError.value?.includes("GitHub 绑定已失效") === true);
const cloneDirectGitHubRepo = computed(() => normalizeGitHubInput(cloneQueryTrimmed.value));
const filteredCloneRepos = computed(() => {
  const text = cloneQueryTrimmed.value.toLowerCase();
  if (!text) return cloneRepoItems.value;
  return cloneRepoItems.value.filter((repo) =>
    repo.fullName.toLowerCase().includes(text) ||
    repo.name.toLowerCase().includes(text) ||
    (repo.description ?? "").toLowerCase().includes(text),
  );
});

watch(cloneRemoteUrl, (value) => {
  if (cloneTouchedDirectory.value) return;
  cloneDirectoryName.value = cloneSelectedRepo.value?.name ?? inferCloneDirectoryName(value);
});

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
  await router.push(`/repos/${encodeURIComponent(repo.id)}`);
}

defineExpose({
  openCloneDialog,
});

function normalizeGitHubInput(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const matched = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (matched) return `${matched[1]}/${matched[2]}`;
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) return trimmed.replace(/\.git$/i, "");
  return null;
}

function dedupeRepos(items: GitHubRepoSummary[]) {
  const seen = new Set<string>();
  const next: GitHubRepoSummary[] = [];
  for (const item of items) {
    if (seen.has(item.fullName)) continue;
    seen.add(item.fullName);
    next.push(item);
  }
  return next;
}

function applyCloneRepoPage(result: { items: GitHubRepoSummary[]; nextPage: number | null }, append = false) {
  cloneRepoLoadError.value = null;
  cloneNextRepoPage.value = result.nextPage;
  cloneRepoItems.value = append
    ? dedupeRepos([...cloneRepoItems.value, ...result.items])
    : result.items;
}

function showCloneRepoLoadError(err: unknown) {
  const expired = isGitHubBindingExpiredError(err);
  cloneRepoLoadError.value = expired
    ? "GitHub 绑定已失效，请重新绑定后再加载账号仓库。"
    : `仓库列表加载失败：${String(err)}`;
  if (expired) {
    cloneError.value = "GitHub 绑定已失效，请重新绑定。";
  }
  cloneRepoItems.value = [];
  cloneNextRepoPage.value = null;
  cloneSelectedRepo.value = null;
}

async function loadCloneRepoPage(
  page = 1,
  append = false,
  options: { force?: boolean; showLoading?: boolean } = {},
) {
  if (!cloneGitHubBound.value) return;
  const showLoading = options.showLoading ?? !append;
  if (append) {
    cloneRepoLoadingMore.value = true;
  } else if (showLoading) {
    cloneRepoLoading.value = true;
  }
  try {
    const result = page === 1
      ? await preloadGitHubRepos({ force: options.force })
      : await listGitHubRepos(page);
    applyCloneRepoPage(result, append);
  } catch (err) {
    showCloneRepoLoadError(err);
  } finally {
    if (showLoading) {
      cloneRepoLoading.value = false;
    }
    cloneRepoLoadingMore.value = false;
  }
}

function startCloneReposLoad() {
  if (!cloneGitHubBound.value || cloneRepoLoading.value || cloneRepoItems.value.length > 0) return;
  void loadCloneRepoPage(1).catch(() => undefined);
}

async function maybeLoadMoreCloneRepos() {
  if (!cloneGitHubBound.value || !cloneNextRepoPage.value || cloneRepoLoadingMore.value) return;
  if (filteredCloneRepos.value.length > 0 && cloneQueryTrimmed.value) return;
  await loadCloneRepoPage(cloneNextRepoPage.value, true);
}

async function openCloneDialog() {
  cloneOpen.value = true;
  cloneRemoteUrl.value = "";
  cloneDirectoryName.value = "";
  cloneTouchedDirectory.value = false;
  cloneError.value = null;
  cloneBindingStatus.value = null;
  cloneRepoItems.value = [];
  cloneRepoDropdownOpen.value = false;
  cloneRepoLoading.value = false;
  cloneRepoLoadingMore.value = false;
  cloneRepoLoadError.value = null;
  cloneNextRepoPage.value = null;
  cloneSelectedRepo.value = null;
  try {
    cloneBindingStatus.value = await getGitHubBindingStatus();
    if (cloneGitHubBound.value) {
      const cached = readCachedGitHubRepos();
      if (cached) {
        applyCloneRepoPage(cached);
      }
      void loadCloneRepoPage(1, false, {
        force: Boolean(cached),
        showLoading: !cached,
      }).catch(() => undefined);
    }
  } catch (err) {
    cloneError.value = String(err);
  }
  await nextTick();
  cloneInput.value?.focus();
}

function closeCloneDialog() {
  if (cloneBusy.value) return;
  cloneOpen.value = false;
  cloneError.value = null;
}

function inferCloneDirectoryName(remoteUrl: string) {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const scpPath = trimmed.match(/^[\w.-]+@[^:]+:(.+)$/)?.[1];
  const source = scpPath ?? trimmed;
  const parts = source.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

async function submitClone() {
  if (!canSubmitClone.value) return;
  cloneBusy.value = true;
  cloneError.value = null;
  try {
    const selected = cloneSelectedRepo.value;
    const remote = selected?.cloneUrl ?? cloneDirectGitHubRepo.value ?? cloneRemoteUrl.value.trim();
    const summary = await workspace.cloneRepo(
      remote,
      cloneDirectoryName.value.trim() || selected?.name || null,
    );
    cloneOpen.value = false;
    await router.push(`/repos/${encodeURIComponent(summary.id)}`);
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) {
      showCloneRepoLoadError(err);
    } else {
      cloneError.value = String(err);
    }
  } finally {
    cloneBusy.value = false;
  }
}

function selectCloneRepo(repo: GitHubRepoSummary) {
  cloneSelectedRepo.value = repo;
  cloneRemoteUrl.value = repo.fullName;
  if (!cloneTouchedDirectory.value) {
    cloneDirectoryName.value = repo.name;
  }
  cloneRepoDropdownOpen.value = false;
}

function clearSelectedCloneRepoIfNeeded() {
  if (cloneSelectedRepo.value && cloneSelectedRepo.value.fullName !== cloneQueryTrimmed.value) {
    cloneSelectedRepo.value = null;
  }
}

function openCloneRepoDropdown() {
  cloneRepoDropdownOpen.value = true;
  startCloneReposLoad();
}

function handleCloneRepoInput() {
  clearSelectedCloneRepoIfNeeded();
  cloneRepoDropdownOpen.value = true;
  startCloneReposLoad();
  if (cloneQueryTrimmed.value) {
    void maybeLoadMoreCloneRepos();
  }
}

async function openGitHubBindingSettings() {
  cloneOpen.value = false;
  await router.push({ path: "/settings", query: { tab: "repositories" } });
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
          :to="`/repos/${encodeURIComponent(repo.id)}`"
          class="sb-tree__row sb-tree__row--project"
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
        </RouterLink>
        <p v-if="workspace.state.scanning" class="sb-tree__empty">正在扫描仓库...</p>
        <p v-else-if="!workspace.state.repos.length" class="sb-tree__empty">选择工作区后显示 Git 仓库。</p>
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
    <div v-if="cloneOpen" class="sb-modal-backdrop" role="presentation">
      <form class="sb-clone-dialog" role="dialog" aria-modal="true" aria-label="克隆仓库" @submit.prevent="submitClone">
        <div class="sb-clone-dialog__header">
          <h2>克隆仓库</h2>
          <button type="button" class="sb-icon-btn" aria-label="关闭" title="关闭" :disabled="cloneBusy" @click="closeCloneDialog">
            <X :size="14" aria-hidden="true" />
          </button>
        </div>
        <label v-if="!cloneGitHubBound">
          <span>远端 URL</span>
          <input
            ref="cloneInput"
            v-model="cloneRemoteUrl"
            type="text"
            placeholder="https://github.com/user/repo.git"
            autofocus
          />
        </label>
        <div v-else class="sb-clone-field">
          <span>GitHub 仓库</span>
          <div class="sb-clone-repo-picker">
            <Search :size="13" aria-hidden="true" />
            <input
              ref="cloneInput"
              v-model="cloneRemoteUrl"
              type="text"
              placeholder="搜索仓库，或直接输入 owner/repo"
              autocomplete="off"
              spellcheck="false"
              @focus="openCloneRepoDropdown"
              @input="handleCloneRepoInput"
              @keydown.down.prevent="openCloneRepoDropdown"
            />
          </div>
          <div v-if="cloneRepoDropdownOpen" class="sb-clone-repo-menu" role="listbox">
            <template v-if="filteredCloneRepos.length">
              <button
                v-for="repo in filteredCloneRepos"
                :key="repo.id"
                type="button"
                class="sb-clone-repo-item"
                :class="{ 'is-active': cloneSelectedRepo?.id === repo.id }"
                role="option"
                :aria-selected="cloneSelectedRepo?.id === repo.id"
                @click="selectCloneRepo(repo)"
              >
                <span class="sb-clone-repo-item__name">{{ repo.fullName }}</span>
                <span class="sb-clone-repo-item__meta">
                  <Lock v-if="repo.private" :size="11" aria-hidden="true" />
                  {{ repo.private ? "私有" : "公开" }}
                </span>
              </button>
              <button
                v-if="cloneNextRepoPage && !cloneQueryTrimmed"
                type="button"
                class="sb-clone-repo-more"
                :disabled="cloneRepoLoadingMore"
                @click="maybeLoadMoreCloneRepos"
              >
                <LoaderCircle v-if="cloneRepoLoadingMore" :size="12" aria-hidden="true" class="sb-spin" />
                加载更多
              </button>
            </template>
            <button
              v-else-if="cloneDirectGitHubRepo"
              type="button"
              class="sb-clone-repo-item"
              role="option"
              aria-selected="false"
              @click="cloneSelectedRepo = null; cloneRepoDropdownOpen = false"
            >
              <span class="sb-clone-repo-item__name">直接克隆 {{ cloneDirectGitHubRepo }}</span>
              <span class="sb-clone-repo-item__meta">
                <Sparkles :size="11" aria-hidden="true" />
                手动输入
              </span>
            </button>
            <p v-else-if="cloneRepoLoadError" class="sb-clone-repo-empty">{{ cloneRepoLoadError }}</p>
            <p v-else-if="cloneRepoLoading" class="sb-clone-repo-empty">正在加载仓库...</p>
            <p v-else class="sb-clone-repo-empty">没有匹配仓库</p>
          </div>
          <p v-if="cloneBindingStatus?.binding" class="sb-clone-dialog__hint">
            当前绑定账号：<code>{{ cloneBindingStatus.binding.login }}</code>
          </p>
        </div>
        <label>
          <span>目录名（可选）</span>
          <input
            v-model="cloneDirectoryName"
            type="text"
            placeholder="默认从 URL 推导"
            @input="cloneTouchedDirectory = true"
          />
        </label>
        <div v-if="cloneError" class="sb-clone-dialog__error-row">
          <p class="sb-clone-dialog__error">{{ cloneError }}</p>
          <button
            v-if="cloneBindingExpired"
            type="button"
            class="ghost"
            @click="openGitHubBindingSettings"
          >
            重新绑定 GitHub
          </button>
        </div>
        <div class="sb-clone-dialog__actions">
          <button type="button" class="ghost" :disabled="cloneBusy" @click="closeCloneDialog">取消</button>
          <button type="submit" class="primary" :disabled="!canSubmitClone">
            <LoaderCircle v-if="cloneBusy" :size="14" aria-hidden="true" class="sb-spin" />
            克隆
          </button>
        </div>
      </form>
    </div>
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

.sb-modal-backdrop {
  position: fixed;
  inset: 36px 0 0;
  z-index: 30;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 72px;
  background: rgba(0, 0, 0, 0.35);
}

.sb-clone-dialog {
  width: min(420px, calc(100vw - 48px));
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3);
}

.sb-clone-dialog__header,
.sb-clone-dialog__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sb-clone-dialog h2 {
  margin: 0;
  font-size: 14px;
}

.sb-clone-dialog label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.sb-clone-field {
  position: relative;
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.sb-clone-dialog input {
  width: 100%;
}

.sb-clone-repo-picker {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-faint);
}

.sb-clone-repo-picker input {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.sb-clone-repo-menu {
  position: absolute;
  top: 56px;
  left: 0;
  right: 0;
  z-index: 2;
  max-height: 220px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-elev);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.24);
}

.sb-clone-repo-item,
.sb-clone-repo-more {
  width: 100%;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.sb-clone-repo-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  text-align: left;
}

.sb-clone-repo-item:hover,
.sb-clone-repo-item.is-active,
.sb-clone-repo-more:hover {
  background: var(--bg-hover);
}

.sb-clone-repo-item__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.sb-clone-repo-item__meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.sb-clone-repo-empty {
  margin: 0;
  padding: 10px 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.sb-clone-repo-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.sb-clone-dialog__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.sb-clone-dialog__error {
  margin: 0;
  color: var(--err);
  font-size: 12px;
}

.sb-clone-dialog__error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sb-clone-dialog__error-row .ghost {
  flex-shrink: 0;
}

.sb-clone-dialog__actions {
  justify-content: flex-end;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
