<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from "vue-router";
import { computed, nextTick, ref, watch } from "vue";
import { AlertCircle, EyeOff, FilePlus2, FolderGit2, GitPullRequestArrow, LoaderCircle, RefreshCw, Search, Upload, X } from "@lucide/vue";
import {
  SIDEBAR_FOOTER_LINKS,
  SIDEBAR_NAV,
} from "../config/appShell";
import { useWorkspace } from "../composables/useWorkspace";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import SidebarRowTools from "../components/sidebar/SidebarRowTools.vue";
import type { ContextMenuItem } from "../composables/useContextMenu";
import type { RepoSummary } from "../services/workspace";
import { repoDisplayName, repoDisplayTitle } from "../utils/repoDisplay";

const workspace = useWorkspace();
const route = useRoute();
const router = useRouter();
const searchOpen = ref(false);
const searchQuery = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const cloneOpen = ref(false);
const cloneRemoteUrl = ref("");
const cloneDirectoryName = ref("");
const cloneTouchedDirectory = ref(false);
const cloneBusy = ref(false);
const cloneError = ref<string | null>(null);

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

const bulkPushRunningRepoIds = computed(() => {
  if (!workspace.state.bulkRunning || workspace.state.bulkPreview?.operation !== "push") {
    return new Set<string>();
  }
  return new Set(
    [...workspace.state.bulkPreview.eligible, ...workspace.state.bulkPreview.blocked]
      .filter((item) => item.repo.ahead > 0)
      .map((item) => item.repo.id),
  );
});

const bulkPushErrorByRepoId = computed(() => {
  if (workspace.state.recentPush) {
    const errors = new Map<string, string>();
    for (const result of workspace.state.recentPush.results) {
      if (result.status === "error") errors.set(result.repoId, result.message);
    }
    if (errors.size) return errors;
  }
  if (workspace.state.bulkPreview?.operation !== "push") return new Map<string, string>();
  return new Map(
    workspace.state.bulkResults
      .filter((result) => result.status === "error")
      .map((result) => [result.repoId, result.message]),
  );
});

const filteredRepos = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return workspace.state.repos;
  return workspace.state.repos.filter((repo) =>
    [
      repoDisplayName(repo),
      repo.name,
      repo.githubFullName,
      repo.relativePath,
      repo.path,
    ].some((value) => value?.toLocaleLowerCase().includes(query)),
  );
});

const canSubmitClone = computed(() => cloneRemoteUrl.value.trim().length > 0 && !cloneBusy.value);

watch(cloneRemoteUrl, (value) => {
  if (cloneTouchedDirectory.value) return;
  cloneDirectoryName.value = inferCloneDirectoryName(value);
});

function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    void nextTick(() => searchInput.value?.focus());
  } else {
    searchQuery.value = "";
  }
}

function closeSearch() {
  searchOpen.value = false;
  searchQuery.value = "";
}

async function openFirstSearchResult() {
  const repo = filteredRepos.value[0];
  if (!repo) return;
  await router.push(`/repos/${encodeURIComponent(repo.id)}`);
}

function openCloneDialog() {
  cloneOpen.value = true;
  cloneRemoteUrl.value = "";
  cloneDirectoryName.value = "";
  cloneTouchedDirectory.value = false;
  cloneError.value = null;
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
    const summary = await workspace.cloneRepo(
      cloneRemoteUrl.value.trim(),
      cloneDirectoryName.value.trim() || null,
    );
    cloneOpen.value = false;
    await workspace.refreshRepos();
    await router.push(`/repos/${encodeURIComponent(summary.id)}`);
  } catch (err) {
    cloneError.value = String(err);
  } finally {
    cloneBusy.value = false;
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
    <div class="sb-section sb-section--actions">
      <button
        type="button"
        class="sb-action"
        title="新建"
        aria-label="新建"
        :disabled="!workspace.workspaceRoot.value"
        @click="openCloneDialog"
      >
        <FilePlus2 :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="sb-action"
        :class="{ 'is-active': searchOpen }"
        title="搜索"
        aria-label="搜索"
        :disabled="!workspace.state.repos.length"
        @click="toggleSearch"
      >
        <Search :size="16" aria-hidden="true" />
      </button>
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
        :class="{ 'is-running': workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'push' }"
        title="一键推送"
        aria-label="一键推送"
        :disabled="!workspace.isReady.value || workspace.state.bulkRunning"
        @click="workspace.pushAll"
      >
        <LoaderCircle
          v-if="workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'push'"
          :size="16"
          aria-hidden="true"
          class="sb-spin"
        />
        <Upload v-else :size="16" aria-hidden="true" />
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
      <div v-if="searchOpen" class="sb-search">
        <Search :size="13" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="searchQuery"
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
          v-for="repo in filteredRepos"
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
            v-if="bulkPushRunningRepoIds.has(repo.id)"
            class="sb-badge"
            title="正在推送"
            aria-label="正在推送"
          >
            <LoaderCircle :size="11" aria-hidden="true" class="sb-spin" />
          </span>
          <span
            v-else-if="bulkPushErrorByRepoId.has(repo.id)"
            class="sb-badge sb-badge--error"
            :title="bulkPushErrorByRepoId.get(repo.id) ?? '推送失败'"
            aria-label="推送失败"
          >
            <AlertCircle :size="11" aria-hidden="true" />
          </span>
          <span v-if="workspace.state.launchStatuses[repo.id]?.state === 'running'" class="sb-badge sb-badge--ok">RUN</span>
          <span v-if="repoDirtyCount(repo)" class="sb-badge sb-badge--warn">{{ repoDirtyCount(repo) }}</span>
          <span v-if="repo.ahead" class="sb-badge">↑{{ repo.ahead }}</span>
          <span v-if="repo.behind" class="sb-badge">↓{{ repo.behind }}</span>
        </RouterLink>
        <p v-if="workspace.state.scanning" class="sb-tree__empty">正在扫描仓库...</p>
        <p v-else-if="!workspace.state.repos.length" class="sb-tree__empty">选择工作区后显示 Git 仓库。</p>
        <p v-else-if="searchOpen && !filteredRepos.length" class="sb-tree__empty">没有匹配的仓库。</p>
      </div>
    </div>

    <SidebarFooter
      :links="SIDEBAR_FOOTER_LINKS"
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
        <label>
          <span>远端 URL</span>
          <input v-model="cloneRemoteUrl" type="text" placeholder="https://github.com/user/repo.git" autofocus />
        </label>
        <label>
          <span>目录名（可选）</span>
          <input
            v-model="cloneDirectoryName"
            type="text"
            placeholder="默认从 URL 推导"
            @input="cloneTouchedDirectory = true"
          />
        </label>
        <p v-if="cloneError" class="sb-clone-dialog__error">{{ cloneError }}</p>
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

.sb-action.is-active {
  background: var(--bg-active);
  color: var(--accent);
}

.sb-action.is-running,
.sb-action.is-running:hover,
.sb-action.is-running:disabled {
  background: var(--accent);
  color: var(--accent-text);
  opacity: 1;
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

.sb-clone-dialog input {
  width: 100%;
}

.sb-clone-dialog__error {
  margin: 0;
  color: var(--err);
  font-size: 12px;
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
