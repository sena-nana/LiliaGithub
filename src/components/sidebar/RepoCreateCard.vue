<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { FolderGit2, GitBranchPlus, LoaderCircle, X } from "@lucide/vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../composables/useWorkspace";
import {
  createGitHubRepo,
  listGitHubRepoOwners,
  type GitHubRepoOwner,
  type GitHubRepoSummary,
  type RepoSummary,
} from "../../services/workspace";

type RepoCreateMode = "local" | "remote";

const props = defineProps<{
  open: boolean;
  mode: RepoCreateMode;
  workspaceReady: boolean;
  githubReady: boolean;
}>();

const emit = defineEmits<{
  close: [];
  localCreated: [repo: RepoSummary];
  remoteCloned: [repo: RepoSummary, remote: GitHubRepoSummary];
}>();

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const repoOwnersLoader = createLatestAsyncLoader({ componentEpoch });
const createRepoLoader = createLatestAsyncLoader({ componentEpoch });
const firstInput = ref<HTMLInputElement | null>(null);
const repoOwners = ref<GitHubRepoOwner[]>([]);
const creatingRepo = ref(false);
const cloningCreatedRepo = ref(false);
const createdRepo = ref<GitHubRepoSummary | null>(null);
const createError = ref<string | null>(null);

const form = ref({
  owner: "",
  ownerKind: "user",
  name: "",
  description: "",
  private: false,
  useTemplate: false,
  templateFullName: "",
  includeAllBranches: false,
  addReadme: true,
  gitignoreTemplate: "",
  licenseTemplate: "",
  hasIssues: true,
  hasWiki: false,
});

const isRemoteMode = computed(() => props.mode === "remote");
const dialogTitle = computed(() => isRemoteMode.value ? "新建 GitHub 仓库" : "新建本地仓库");
const blockedReason = computed(() => {
  if (!props.workspaceReady) return "请先选择工作区。";
  if (isRemoteMode.value && !props.githubReady) return "请先绑定 GitHub。";
  return null;
});
const submitDisabled = computed(() => (
  Boolean(blockedReason.value)
  || creatingRepo.value
  || cloningCreatedRepo.value
  || !form.value.name.trim()
  || (isRemoteMode.value && !form.value.owner)
  || (isRemoteMode.value && form.value.useTemplate && !form.value.templateFullName.trim())
));

function resetForm() {
  form.value = {
    owner: repoOwners.value[0]?.login ?? "",
    ownerKind: repoOwners.value[0]?.kind ?? "user",
    name: "",
    description: "",
    private: false,
    useTemplate: false,
    templateFullName: "",
    includeAllBranches: false,
    addReadme: true,
    gitignoreTemplate: "",
    licenseTemplate: "",
    hasIssues: true,
    hasWiki: false,
  };
  creatingRepo.value = false;
  cloningCreatedRepo.value = false;
  createdRepo.value = null;
  createError.value = null;
}

async function loadRepoOwners() {
  await repoOwnersLoader.run("repo-owners", async (runId) => {
    try {
      const owners = await listGitHubRepoOwners();
      if (!repoOwnersLoader.isCurrent(runId)) return;
      repoOwners.value = owners;
      if (!form.value.owner && owners.length) {
        form.value.owner = owners[0].login;
        form.value.ownerKind = owners[0].kind;
      }
    } catch {
      if (!repoOwnersLoader.isCurrent(runId)) return;
      repoOwners.value = [];
    }
  });
}

function syncOwnerKind() {
  const owner = repoOwners.value.find((item) => item.login === form.value.owner);
  if (owner) form.value.ownerKind = owner.kind;
}

function closeCard() {
  createRepoLoader.invalidate();
  emit("close");
}

async function submitLocalRepo() {
  await createRepoLoader.run("create-local-repo", async (runId) => {
    creatingRepo.value = true;
    createError.value = null;
    try {
      const repo = await workspace.createLocalRepo({
        name: form.value.name,
        description: form.value.description || null,
        addReadme: form.value.addReadme,
        gitignoreTemplate: form.value.gitignoreTemplate || null,
        licenseTemplate: form.value.licenseTemplate || null,
      });
      if (!createRepoLoader.isCurrent(runId) || !props.open) return;
      emit("localCreated", repo);
      emit("close");
    } catch (err) {
      if (!createRepoLoader.isCurrent(runId) || !props.open) return;
      createError.value = String(err);
    } finally {
      if (createRepoLoader.isCurrent(runId)) creatingRepo.value = false;
    }
  });
}

async function cloneCreatedRepo() {
  const repo = createdRepo.value;
  if (!repo) return;
  cloningCreatedRepo.value = true;
  createError.value = null;
  try {
    const localRepo = await workspace.cloneRepo(repo.cloneUrl, repo.name);
    if (!componentEpoch.assertAlive() || !props.open) return;
    await workspace.refreshRepos();
    if (!componentEpoch.assertAlive() || !props.open) return;
    emit("remoteCloned", localRepo, repo);
    emit("close");
  } catch (err) {
    if (!componentEpoch.assertAlive() || !props.open) return;
    createError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) cloningCreatedRepo.value = false;
  }
}

async function submitRemoteRepo() {
  if (createdRepo.value) {
    await cloneCreatedRepo();
    return;
  }
  await createRepoLoader.run("create-remote-repo", async (runId) => {
    creatingRepo.value = true;
    createError.value = null;
    syncOwnerKind();
    try {
      const useTemplate = form.value.useTemplate;
      const repo = await createGitHubRepo({
        owner: form.value.owner,
        ownerKind: form.value.ownerKind,
        name: form.value.name,
        description: form.value.description || null,
        private: form.value.private,
        autoInit: useTemplate ? false : form.value.addReadme,
        gitignoreTemplate: useTemplate ? null : form.value.gitignoreTemplate || null,
        licenseTemplate: useTemplate ? null : form.value.licenseTemplate || null,
        hasIssues: form.value.hasIssues,
        hasWiki: form.value.hasWiki,
        templateFullName: useTemplate ? form.value.templateFullName : null,
        includeAllBranches: useTemplate ? form.value.includeAllBranches : false,
      });
      if (!createRepoLoader.isCurrent(runId) || !props.open) return;
      createdRepo.value = repo;
      await cloneCreatedRepo();
    } catch (err) {
      if (!createRepoLoader.isCurrent(runId) || !props.open) return;
      createError.value = String(err);
    } finally {
      if (createRepoLoader.isCurrent(runId)) creatingRepo.value = false;
    }
  });
}

async function submitCreateRepo() {
  if (submitDisabled.value && !createdRepo.value) return;
  if (isRemoteMode.value) {
    await submitRemoteRepo();
  } else {
    await submitLocalRepo();
  }
}

watch(
  () => [props.open, props.mode] as const,
  ([open]) => {
    if (!open) return;
    resetForm();
    if (props.mode === "remote") void loadRepoOwners();
    void nextTick(() => firstInput.value?.focus());
  },
);

onUnmounted(() => {
  repoOwnersLoader.invalidate();
  createRepoLoader.invalidate();
});
</script>

<template>
  <div v-if="open" class="repo-create-backdrop" role="presentation" @click.self="closeCard">
    <form class="repo-create-card" role="dialog" :aria-label="dialogTitle" @submit.prevent="submitCreateRepo">
      <div class="repo-create-card__head">
        <h3>{{ dialogTitle }}</h3>
        <button type="button" class="ghost" aria-label="关闭" @click="closeCard">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <p v-if="blockedReason" class="repo-create-card__error">{{ blockedReason }}</p>

      <div v-if="isRemoteMode" class="repo-create-grid">
        <label>
          <span>Owner</span>
          <select v-model="form.owner" :disabled="Boolean(blockedReason)" @change="syncOwnerKind">
            <option v-for="owner in repoOwners" :key="`${owner.kind}:${owner.login}`" :value="owner.login">
              {{ owner.login }} · {{ owner.kind }}
            </option>
          </select>
        </label>
        <label>
          <span>仓库名</span>
          <input ref="firstInput" v-model="form.name" type="text" required placeholder="new-repo" />
        </label>
      </div>
      <label v-else>
        <span>仓库名</span>
        <input ref="firstInput" v-model="form.name" type="text" required placeholder="new-repo" />
      </label>

      <label>
        <span>描述</span>
        <input v-model="form.description" type="text" maxlength="350" />
      </label>

      <div v-if="isRemoteMode" class="repo-create-switches">
        <label><input v-model="form.private" type="checkbox" /> Private</label>
        <label><input v-model="form.useTemplate" type="checkbox" /> 使用模板</label>
      </div>

      <template v-if="isRemoteMode && form.useTemplate">
        <label>
          <span>模板仓库</span>
          <input v-model="form.templateFullName" type="text" placeholder="owner/template-repo" />
        </label>
        <div class="repo-create-switches">
          <label><input v-model="form.includeAllBranches" type="checkbox" /> 包含所有分支</label>
        </div>
      </template>

      <template v-else>
        <div class="repo-create-grid">
          <label>
            <span>.gitignore 模板</span>
            <input v-model="form.gitignoreTemplate" type="text" placeholder="Node" />
          </label>
          <label>
            <span>License 模板</span>
            <input v-model="form.licenseTemplate" type="text" placeholder="mit" />
          </label>
        </div>
        <div class="repo-create-switches">
          <label><input v-model="form.addReadme" type="checkbox" /> 初始化 README</label>
          <label v-if="isRemoteMode"><input v-model="form.hasIssues" type="checkbox" /> Issues</label>
          <label v-if="isRemoteMode"><input v-model="form.hasWiki" type="checkbox" /> Wiki</label>
        </div>
      </template>

      <p v-if="createError" class="repo-create-card__error">{{ createError }}</p>
      <div v-if="createdRepo" class="repo-create-result">
        <strong>{{ createdRepo.fullName }}</strong>
        <span>{{ createdRepo.cloneUrl }}</span>
      </div>
      <div class="repo-create-actions">
        <button type="button" class="ghost" @click="closeCard">取消</button>
        <button type="submit" class="primary" :disabled="submitDisabled && !createdRepo">
          <LoaderCircle
            v-if="creatingRepo || cloningCreatedRepo"
            :size="14"
            aria-hidden="true"
            class="sb-spin"
          />
          <FolderGit2 v-else-if="!isRemoteMode" :size="14" aria-hidden="true" />
          <GitBranchPlus v-else :size="14" aria-hidden="true" />
          {{ createdRepo ? "重试克隆" : "创建" }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.repo-create-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: start center;
  padding: 96px 16px 24px;
  background: color-mix(in srgb, var(--bg) 54%, transparent);
  backdrop-filter: blur(2px);
}

.repo-create-card {
  width: min(640px, calc(100vw - 32px));
  max-height: calc(100vh - 128px);
  overflow: auto;
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.repo-create-card__head,
.repo-create-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.repo-create-card__head h3 {
  margin: 0;
  font-size: 15px;
}

.repo-create-card label {
  min-width: 0;
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-create-card input[type="text"],
.repo-create-card select {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text);
}

.repo-create-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.repo-create-switches {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.repo-create-switches label {
  display: inline-flex;
  grid-auto-flow: column;
  align-items: center;
  gap: 6px;
  color: var(--text);
}

.repo-create-card__error {
  margin: 0;
  color: var(--err);
  font-size: 12px;
}

.repo-create-result {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.repo-create-result span {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.repo-create-actions {
  justify-content: flex-end;
}

.repo-create-card .ghost,
.repo-create-actions .primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .repo-create-grid {
    grid-template-columns: 1fr;
  }
}
</style>
