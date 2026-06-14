<script setup lang="ts">
import { onMounted, ref } from "vue";
import { FolderGit2, GitBranchPlus, LoaderCircle, Radar, RotateCcw, ShieldCheck, X } from "@lucide/vue";
import { useWorkspace } from "../../composables/useWorkspace";
import {
  createGitHubRepo,
  listGitHubRepoOwners,
  type GitHubRepoOwner,
  type GitHubRepoSummary,
  type HiddenRepo,
} from "../../services/workspace";

const workspace = useWorkspace();
const hiddenRepos = ref<HiddenRepo[]>([]);
const repoOwners = ref<GitHubRepoOwner[]>([]);
const loading = ref(false);
const restoringRepoId = ref<string | null>(null);
const discovering = ref(false);
const addingRepo = ref(false);
const createDialogOpen = ref(false);
const creatingRepo = ref(false);
const cloningCreatedRepo = ref(false);
const createdRepo = ref<GitHubRepoSummary | null>(null);
const error = ref<string | null>(null);
const createError = ref<string | null>(null);
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

async function loadHiddenRepos() {
  loading.value = true;
  error.value = null;
  try {
    hiddenRepos.value = await workspace.listHiddenRepos();
  } catch (err) {
    error.value = String(err);
  } finally {
    loading.value = false;
  }
}

async function loadRepoOwners() {
  try {
    repoOwners.value = await listGitHubRepoOwners();
    if (!createForm.value.owner && repoOwners.value.length) {
      createForm.value.owner = repoOwners.value[0].login;
      createForm.value.ownerKind = repoOwners.value[0].kind;
    }
  } catch {
    repoOwners.value = [];
  }
}

async function restoreRepo(repoId: string) {
  restoringRepoId.value = repoId;
  error.value = null;
  try {
    await workspace.unhideRepo(repoId);
    await loadHiddenRepos();
  } catch (err) {
    error.value = String(err);
  } finally {
    restoringRepoId.value = null;
  }
}

async function addLocalRepo() {
  addingRepo.value = true;
  error.value = null;
  try {
    await workspace.addLocalRepo();
  } catch (err) {
    error.value = String(err);
  } finally {
    addingRepo.value = false;
  }
}

async function discoverRepos() {
  discovering.value = true;
  error.value = null;
  try {
    await workspace.discoverRepos();
  } catch (err) {
    error.value = String(err);
  } finally {
    discovering.value = false;
  }
}

function openCreateDialog() {
  createDialogOpen.value = true;
  createdRepo.value = null;
  createError.value = null;
  void loadRepoOwners();
}

function closeCreateDialog() {
  createDialogOpen.value = false;
  createdRepo.value = null;
  createError.value = null;
}

function syncOwnerKind() {
  const owner = repoOwners.value.find((item) => item.login === createForm.value.owner);
  if (owner) createForm.value.ownerKind = owner.kind;
}

async function submitCreateRepo() {
  creatingRepo.value = true;
  createError.value = null;
  createdRepo.value = null;
  syncOwnerKind();
  try {
    createdRepo.value = await createGitHubRepo({
      ...createForm.value,
      description: createForm.value.description || null,
      gitignoreTemplate: createForm.value.gitignoreTemplate || null,
      licenseTemplate: createForm.value.licenseTemplate || null,
    });
  } catch (err) {
    createError.value = String(err);
  } finally {
    creatingRepo.value = false;
  }
}

async function cloneCreatedRepo() {
  if (!createdRepo.value) return;
  cloningCreatedRepo.value = true;
  createError.value = null;
  try {
    await workspace.cloneRepo(createdRepo.value.cloneUrl, createdRepo.value.name);
    await workspace.refreshRepos();
    closeCreateDialog();
  } catch (err) {
    createError.value = String(err);
  } finally {
    cloningCreatedRepo.value = false;
  }
}

onMounted(() => {
  void loadHiddenRepos();
  void loadRepoOwners();
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
          <li v-for="task in workspace.state.tasks.slice(0, 6)" :key="task.id">
            <span>{{ task.kind }}</span>
            <em>{{ task.message ?? task.status }}</em>
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
  grid-template-columns: minmax(0, 120px) minmax(0, 1fr);
  gap: 8px;
  padding: 5px 0;
  color: var(--text-muted);
  font-size: 12px;
}

.workspace-task-list em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
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
