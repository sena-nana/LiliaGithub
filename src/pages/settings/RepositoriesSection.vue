<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { FolderGit2, GitBranchPlus, KeyRound, LoaderCircle, Radar, RotateCcw, ShieldCheck, X } from "@lucide/vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../composables/useWorkspace";
import {
  createGitHubRepo,
  listGitHubRepoOwners,
  type GitHubRepoOwner,
  type GitHubRepoSummary,
  type HiddenRepo,
  type WorkspaceTask,
} from "../../services/workspace";

const workspace = useWorkspace();
const hiddenRepos = ref<HiddenRepo[]>([]);
const repoOwners = ref<GitHubRepoOwner[]>([]);
const loading = ref(false);
const restoringRepoId = ref<string | null>(null);
const resettingSystemGitRepoId = ref<string | null>(null);
const discovering = ref(false);
const addingRepo = ref(false);
const createDialogOpen = ref(false);
const creatingRepo = ref(false);
const cloningCreatedRepo = ref(false);
const createdRepo = ref<GitHubRepoSummary | null>(null);
const error = ref<string | null>(null);
const createError = ref<string | null>(null);
const cancellingTaskIds = ref<string[]>([]);
const taskCancelErrors = ref<Record<string, string | undefined>>({});
const componentEpoch = useComponentEpoch();
const hiddenReposLoader = createLatestAsyncLoader({ componentEpoch });
const repoOwnersLoader = createLatestAsyncLoader({ componentEpoch });
const createRepoLoader = createLatestAsyncLoader({ componentEpoch });
const cloneCreatedRepoLoader = createLatestAsyncLoader({ componentEpoch });
const createForm = ref({
  owner: "",
  ownerKind: "user",
  name: "",
  description: "",
  private: false,
  autoInit: true,
  gitignoreTemplate: "",
  licenseTemplate: "",
  hasIssues: true,
  hasWiki: false,
});

const systemGitRepos = computed(() => {
  const reposById = new Map(workspace.state.repos.map((repo) => [repo.id, repo]));
  return (workspace.state.settings?.systemGitRepoIds ?? []).map((id) => {
    const repo = reposById.get(id);
    return {
      id,
      name: repo?.name ?? id,
      path: repo?.relativePath ?? repo?.path ?? id,
    };
  });
});

const WORKSPACE_TASK_STATUS_TEXT: Record<WorkspaceTask["status"], string> = {
  pending: "等待中",
  running: "执行中",
  success: "完成",
  error: "失败",
  cancelled: "已取消",
};

function taskStatusText(status: WorkspaceTask["status"]) {
  return WORKSPACE_TASK_STATUS_TEXT[status];
}

function taskStatusClass(status: WorkspaceTask["status"]) {
  return `is-${status}`;
}

function isTaskCancellable(task: WorkspaceTask) {
  return task.status === "pending" || task.status === "running";
}

function isCancellingTask(taskId: string) {
  return cancellingTaskIds.value.includes(taskId);
}

function taskMessage(task: WorkspaceTask) {
  return task.message ?? taskStatusText(task.status);
}

async function loadHiddenRepos() {
  await hiddenReposLoader.run("hidden-repos", async (runId) => {
    loading.value = true;
    error.value = null;
    try {
      const repos = await workspace.listHiddenRepos();
      if (!hiddenReposLoader.isCurrent(runId)) return;
      hiddenRepos.value = repos;
    } catch (err) {
      if (!hiddenReposLoader.isCurrent(runId)) return;
      error.value = String(err);
    } finally {
      if (hiddenReposLoader.isCurrent(runId)) {
        loading.value = false;
      }
    }
  });
}

async function loadRepoOwners() {
  await repoOwnersLoader.run("repo-owners", async (runId) => {
    try {
      const owners = await listGitHubRepoOwners();
      if (!repoOwnersLoader.isCurrent(runId)) return;
      repoOwners.value = owners;
      if (!createForm.value.owner && repoOwners.value.length) {
        createForm.value.owner = repoOwners.value[0].login;
        createForm.value.ownerKind = repoOwners.value[0].kind;
      }
    } catch {
      if (!repoOwnersLoader.isCurrent(runId)) return;
      repoOwners.value = [];
    }
  });
}

async function restoreRepo(repoId: string) {
  restoringRepoId.value = repoId;
  error.value = null;
  try {
    await workspace.unhideRepo(repoId);
    if (!componentEpoch.assertAlive()) return;
    await loadHiddenRepos();
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) restoringRepoId.value = null;
  }
}

async function useDefaultTokenAuth(repoId: string) {
  resettingSystemGitRepoId.value = repoId;
  error.value = null;
  try {
    await workspace.useDefaultTokenAuthForRepo(repoId);
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) resettingSystemGitRepoId.value = null;
  }
}

async function addLocalRepo() {
  addingRepo.value = true;
  error.value = null;
  try {
    await workspace.addLocalRepo();
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) addingRepo.value = false;
  }
}

async function discoverRepos() {
  discovering.value = true;
  error.value = null;
  try {
    await workspace.discoverRepos();
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) discovering.value = false;
  }
}

function openCreateDialog() {
  createRepoLoader.invalidate();
  cloneCreatedRepoLoader.invalidate();
  createDialogOpen.value = true;
  creatingRepo.value = false;
  cloningCreatedRepo.value = false;
  createdRepo.value = null;
  createError.value = null;
  void loadRepoOwners();
}

function closeCreateDialog() {
  createRepoLoader.invalidate();
  cloneCreatedRepoLoader.invalidate();
  createDialogOpen.value = false;
  creatingRepo.value = false;
  cloningCreatedRepo.value = false;
  createdRepo.value = null;
  createError.value = null;
}

function syncOwnerKind() {
  const owner = repoOwners.value.find((item) => item.login === createForm.value.owner);
  if (owner) createForm.value.ownerKind = owner.kind;
}

async function submitCreateRepo() {
  if (!createDialogOpen.value || creatingRepo.value) return;
  await createRepoLoader.run("create-repo", async (runId) => {
    creatingRepo.value = true;
    createError.value = null;
    createdRepo.value = null;
    syncOwnerKind();
    try {
      const repo = await createGitHubRepo({
        ...createForm.value,
        description: createForm.value.description || null,
        gitignoreTemplate: createForm.value.gitignoreTemplate || null,
        licenseTemplate: createForm.value.licenseTemplate || null,
      });
      if (!createRepoLoader.isCurrent(runId) || !createDialogOpen.value) return;
      createdRepo.value = repo;
    } catch (err) {
      if (!createRepoLoader.isCurrent(runId) || !createDialogOpen.value) return;
      createError.value = String(err);
    } finally {
      if (createRepoLoader.isCurrent(runId)) {
        creatingRepo.value = false;
      }
    }
  });
}

async function cloneCreatedRepo() {
  if (!createdRepo.value) return;
  await cloneCreatedRepoLoader.run("clone-created-repo", async (runId) => {
    const repo = createdRepo.value;
    if (!repo) return;
    cloningCreatedRepo.value = true;
    createError.value = null;
    try {
      await workspace.cloneRepo(repo.cloneUrl, repo.name);
      if (!cloneCreatedRepoLoader.isCurrent(runId) || !createDialogOpen.value) return;
      await workspace.refreshRepos();
      if (!cloneCreatedRepoLoader.isCurrent(runId) || !createDialogOpen.value) return;
      closeCreateDialog();
    } catch (err) {
      if (!cloneCreatedRepoLoader.isCurrent(runId) || !createDialogOpen.value) return;
      createError.value = String(err);
    } finally {
      if (cloneCreatedRepoLoader.isCurrent(runId)) {
        cloningCreatedRepo.value = false;
      }
    }
  });
}

async function cancelTask(taskId: string) {
  if (isCancellingTask(taskId)) return;
  cancellingTaskIds.value.push(taskId);
  delete taskCancelErrors.value[taskId];
  try {
    await workspace.cancelWorkspaceTask(taskId);
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    taskCancelErrors.value[taskId] = String(err);
  } finally {
    if (!componentEpoch.assertAlive()) return;
    const index = cancellingTaskIds.value.indexOf(taskId);
    if (index >= 0) cancellingTaskIds.value.splice(index, 1);
  }
}

onMounted(() => {
  void loadHiddenRepos();
  void loadRepoOwners();
});

onUnmounted(() => {
  hiddenReposLoader.invalidate();
  repoOwnersLoader.invalidate();
  createRepoLoader.invalidate();
  cloneCreatedRepoLoader.invalidate();
});
</script>

<template>
  <div class="card">
    <h2>仓库</h2>
    <div class="repo-settings">
      <div class="github-binding-panel">
        <div class="github-binding-panel__body">
          <strong>{{ workspace.githubBinding.value?.login ?? "GitHub 授权" }}</strong>
          <span>{{ workspace.authBindingStatusText.value }}</span>
          <p v-if="workspace.deviceFlow.value">
            设备码 <code>{{ workspace.deviceFlow.value.userCode }}</code>
            <template v-if="workspace.authRemainingText.value"> · 剩余 {{ workspace.authRemainingText.value }}</template>
          </p>
          <p v-if="workspace.state.authNotice" class="github-binding-panel__notice">
            {{ workspace.state.authNotice }}
          </p>
          <p v-else-if="workspace.githubBinding.value">
            已绑定账号可用于仓库列表、创建仓库和同步操作。
          </p>
          <p v-else>绑定后可加载账号仓库、创建仓库并执行 GitHub 同步操作。</p>
        </div>
        <button
          type="button"
          class="primary"
          :disabled="workspace.state.authLoading"
          @click="workspace.startAuthFlow"
        >
          <LoaderCircle v-if="workspace.state.authLoading" :size="14" aria-hidden="true" class="sb-spin" />
          <ShieldCheck v-else :size="14" aria-hidden="true" />
          {{ workspace.githubBinding.value || workspace.deviceFlow.value ? "重新绑定 GitHub" : "绑定 GitHub" }}
        </button>
      </div>
      <div class="repo-settings__actions">
        <button type="button" class="ghost" :disabled="addingRepo" @click="addLocalRepo">
          <LoaderCircle v-if="addingRepo" :size="14" aria-hidden="true" class="sb-spin" />
          <FolderGit2 v-else :size="14" aria-hidden="true" />
          添加本地仓库
        </button>
        <button type="button" class="ghost" :disabled="discovering" @click="discoverRepos">
          <LoaderCircle v-if="discovering" :size="14" aria-hidden="true" class="sb-spin" />
          <Radar v-else :size="14" aria-hidden="true" />
          后台发现仓库
        </button>
        <button type="button" class="primary" @click="openCreateDialog">
          <GitBranchPlus :size="14" aria-hidden="true" />
          新建 GitHub 仓库
        </button>
      </div>
      <section class="system-git-list" aria-labelledby="system-git-list-title">
        <div class="system-git-list__head">
          <KeyRound :size="15" aria-hidden="true" />
          <div>
            <h3 id="system-git-list-title">系统 git 凭证</h3>
            <p>这些仓库 push 时会优先使用本机 git 凭证。</p>
          </div>
        </div>
        <p v-if="!systemGitRepos.length" class="muted">没有仓库切到系统 git 凭证。</p>
        <ul v-else class="system-git-list__items">
          <li v-for="repo in systemGitRepos" :key="repo.id" class="system-git-list__item">
            <div class="system-git-list__meta">
              <span class="system-git-list__name">{{ repo.name }}</span>
              <span class="system-git-list__id">{{ repo.path }}</span>
            </div>
            <button
              type="button"
              class="ghost"
              :disabled="resettingSystemGitRepoId === repo.id"
              @click="useDefaultTokenAuth(repo.id)"
            >
              <LoaderCircle
                v-if="resettingSystemGitRepoId === repo.id"
                :size="14"
                aria-hidden="true"
                class="sb-spin"
              />
              <RotateCcw v-else :size="14" aria-hidden="true" />
              恢复默认 token
            </button>
          </li>
        </ul>
      </section>
      <p v-if="loading" class="muted">正在读取隐藏仓库...</p>
      <p v-else-if="!hiddenRepos.length" class="muted">没有隐藏仓库。</p>
      <ul v-else class="hidden-repo-list">
        <li v-for="repo in hiddenRepos" :key="repo.id" class="hidden-repo-list__item">
          <div class="hidden-repo-list__meta">
            <span class="hidden-repo-list__name">{{ repo.name }}</span>
            <span class="hidden-repo-list__id">{{ repo.id }}</span>
          </div>
          <button
            type="button"
            class="ghost"
            :disabled="restoringRepoId === repo.id"
            @click="restoreRepo(repo.id)"
          >
            <RotateCcw :size="14" aria-hidden="true" />
            恢复管理
          </button>
        </li>
      </ul>
      <p v-if="error" class="repo-settings__error">{{ error }}</p>
      <div v-if="workspace.state.tasks.length" class="workspace-task-list">
        <h3>后台任务</h3>
        <ul>
          <li v-for="task in workspace.state.tasks.slice(0, 6)" :key="task.id" class="workspace-task-list__item">
            <span class="workspace-task-list__kind">{{ task.kind }}</span>
            <div class="workspace-task-list__detail">
              <div class="workspace-task-list__summary">
                <span class="workspace-task-list__status" :class="taskStatusClass(task.status)">
                  {{ taskStatusText(task.status) }}
                </span>
                <em :title="taskMessage(task)">{{ taskMessage(task) }}</em>
              </div>
              <p v-if="taskCancelErrors[task.id]" class="workspace-task-list__error">
                {{ taskCancelErrors[task.id] }}
              </p>
            </div>
            <button
              v-if="isTaskCancellable(task)"
              type="button"
              class="ghost workspace-task-list__action"
              :disabled="isCancellingTask(task.id)"
              @click="cancelTask(task.id)"
            >
              <LoaderCircle
                v-if="isCancellingTask(task.id)"
                :size="14"
                aria-hidden="true"
                class="sb-spin"
              />
              <X v-else :size="14" aria-hidden="true" />
              {{ isCancellingTask(task.id) ? "取消中" : "取消" }}
            </button>
          </li>
        </ul>
      </div>
    </div>
    <div v-if="createDialogOpen" class="repo-create-backdrop" role="presentation">
      <form class="repo-create-dialog" role="dialog" aria-label="新建 GitHub 仓库" @submit.prevent="submitCreateRepo">
        <div class="repo-create-dialog__head">
          <h3>新建 GitHub 仓库</h3>
          <button type="button" class="ghost" aria-label="关闭" @click="closeCreateDialog">
            <X :size="14" aria-hidden="true" />
          </button>
        </div>
        <div class="repo-create-grid">
          <label>
            <span>Owner</span>
            <select v-model="createForm.owner" @change="syncOwnerKind">
              <option v-for="owner in repoOwners" :key="`${owner.kind}:${owner.login}`" :value="owner.login">
                {{ owner.login }} · {{ owner.kind }}
              </option>
            </select>
          </label>
          <label>
            <span>仓库名</span>
            <input v-model="createForm.name" type="text" required placeholder="new-repo" />
          </label>
        </div>
        <label>
          <span>描述</span>
          <input v-model="createForm.description" type="text" />
        </label>
        <div class="repo-create-grid">
          <label>
            <span>.gitignore 模板</span>
            <input v-model="createForm.gitignoreTemplate" type="text" placeholder="Node" />
          </label>
          <label>
            <span>License 模板</span>
            <input v-model="createForm.licenseTemplate" type="text" placeholder="mit" />
          </label>
        </div>
        <div class="repo-create-switches">
          <label><input v-model="createForm.private" type="checkbox" /> Private</label>
          <label><input v-model="createForm.autoInit" type="checkbox" /> 初始化 README</label>
          <label><input v-model="createForm.hasIssues" type="checkbox" /> Issues</label>
          <label><input v-model="createForm.hasWiki" type="checkbox" /> Wiki</label>
        </div>
        <p v-if="createError" class="repo-settings__error">{{ createError }}</p>
        <div v-if="createdRepo" class="repo-create-result">
          <strong>{{ createdRepo.fullName }}</strong>
          <span>{{ createdRepo.cloneUrl }}</span>
          <button type="button" class="primary" :disabled="cloningCreatedRepo" @click="cloneCreatedRepo">
            <LoaderCircle v-if="cloningCreatedRepo" :size="14" aria-hidden="true" class="sb-spin" />
            <FolderGit2 v-else :size="14" aria-hidden="true" />
            克隆到工作区
          </button>
        </div>
        <div class="repo-create-actions">
          <button type="button" class="ghost" @click="closeCreateDialog">取消</button>
          <button type="submit" class="primary" :disabled="creatingRepo || !createForm.owner || !createForm.name.trim()">
            <LoaderCircle v-if="creatingRepo" :size="14" aria-hidden="true" class="sb-spin" />
            <GitBranchPlus v-else :size="14" aria-hidden="true" />
            创建
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.repo-settings {
  min-height: 40px;
}

.repo-settings .muted {
  margin: 4px 0;
}

.github-binding-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.github-binding-panel__body {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.github-binding-panel__body strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.github-binding-panel__body span,
.github-binding-panel__body p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.github-binding-panel__notice {
  color: var(--accent);
}

.github-binding-panel .primary {
  flex-shrink: 0;
}

.repo-settings__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.repo-settings__actions .ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.repo-settings__actions .primary,
.repo-create-actions .primary,
.repo-create-result .primary,
.repo-create-dialog .ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.system-git-list {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.system-git-list__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.system-git-list__head svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--accent);
}

.system-git-list__head h3 {
  margin: 0;
  font-size: 13px;
}

.system-git-list__head p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.system-git-list__items {
  list-style: none;
  padding: 0;
  margin: 0;
}

.system-git-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--border-soft);
}

.system-git-list__meta {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.system-git-list__name {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.system-git-list__id {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.system-git-list__item .ghost {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hidden-repo-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.hidden-repo-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-soft);
}

.hidden-repo-list__item:first-child {
  padding-top: 4px;
}

.hidden-repo-list__item:last-child {
  border-bottom: 0;
  padding-bottom: 4px;
}

.hidden-repo-list__meta {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.hidden-repo-list__name {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden-repo-list__id {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.hidden-repo-list__item .ghost {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.repo-settings__error {
  margin: 10px 0 0;
  color: var(--err);
  font-size: 12px;
}

.workspace-task-list {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}

.workspace-task-list h3 {
  margin: 0 0 6px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.workspace-task-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.workspace-task-list li {
  display: grid;
  grid-template-columns: minmax(0, 120px) minmax(0, 1fr) auto;
  gap: 8px;
  padding: 6px 0;
  color: var(--text-muted);
  font-size: 12px;
  align-items: center;
}

.workspace-task-list__kind {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-task-list__detail {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.workspace-task-list__summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.workspace-task-list em {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}

.workspace-task-list__status {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  line-height: 1.5;
}

.workspace-task-list__status.is-pending,
.workspace-task-list__status.is-running {
  color: var(--warn);
}

.workspace-task-list__status.is-success {
  color: var(--ok);
}

.workspace-task-list__status.is-error {
  color: var(--err);
}

.workspace-task-list__error {
  margin: 0;
  color: var(--err);
}

.workspace-task-list__action {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.repo-create-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 44%);
}

.repo-create-dialog {
  display: grid;
  gap: 12px;
  width: min(640px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  box-shadow: 0 24px 80px rgb(0 0 0 / 28%);
}

.repo-create-dialog__head,
.repo-create-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.repo-create-dialog h3 {
  margin: 0;
  font-size: 16px;
}

.repo-create-dialog label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-create-dialog input,
.repo-create-dialog select {
  width: 100%;
}

.repo-create-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.repo-create-switches {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.repo-create-switches label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
}

.repo-create-switches input {
  width: 14px;
  height: 14px;
  padding: 0;
}

.repo-create-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.repo-create-result span {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-create-result button {
  grid-row: 1 / span 2;
  grid-column: 2;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@media (max-width: 700px) {
  .github-binding-panel {
    align-items: flex-start;
    flex-direction: column;
  }

  .hidden-repo-list__item {
    align-items: flex-start;
    flex-direction: column;
  }

  .system-git-list__item {
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-task-list li {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .workspace-task-list__kind {
    grid-column: 1 / -1;
  }

  .workspace-task-list__summary {
    flex-wrap: wrap;
  }

  .repo-create-grid,
  .repo-create-switches,
  .repo-create-result {
    grid-template-columns: 1fr;
  }

  .repo-create-result button {
    grid-row: auto;
    grid-column: auto;
    justify-self: start;
  }
}
</style>
