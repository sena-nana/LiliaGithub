<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { FolderGit2, FolderInput, GitBranchPlus, LoaderCircle, X } from "@lucide/vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { createPendingTaskTracker } from "../../composables/usePendingTaskTracker";
import { useWorkspace } from "../../composables/useWorkspace";
import { Dropdown } from "@lilia/ui";
import {
  createGitHubRepo,
  listGitHubRepoOwners,
  listGitHubRepoTemplates,
  type GitHubCreateRepoRequest,
  type GitHubRepoOwner,
  type GitHubRepoSummary,
  type GitHubRepoTemplate,
  type RepoSummary,
} from "../../services/workspace";

type RepoCreateMode = "local" | "remote";
type RepoCreateAction = "local" | "remote-only" | "remote-clone";
type RepoTemplatesStatus = "idle" | "loading" | "loaded" | "error";
type RepoCreateGroup = {
  readonly id: string;
  readonly name: string;
  readonly repoIds: readonly string[];
};
const UNGROUPED_REPO_GROUP_VALUE = "__ungrouped__";

const props = defineProps<{
  open: boolean;
  mode: RepoCreateMode;
  workspaceReady: boolean;
  githubReady: boolean;
  repoGroups?: readonly RepoCreateGroup[];
}>();

const emit = defineEmits<{
  close: [];
  localCreated: [repo: RepoSummary, groupId: string | null];
  remoteCloned: [repo: RepoSummary, remote: GitHubRepoSummary, groupId: string | null];
}>();

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const repoOwnersLoader = createLatestAsyncLoader({ componentEpoch });
const repoTemplatesLoader = createLatestAsyncLoader({ componentEpoch });
const createRepoLoader = createLatestAsyncLoader({ componentEpoch });
const createActionTracker = createPendingTaskTracker();
const firstInput = ref<HTMLInputElement | null>(null);
const repoOwners = ref<GitHubRepoOwner[]>([]);
const repoTemplates = ref<GitHubRepoTemplate[]>([]);
const repoTemplatesStatus = ref<RepoTemplatesStatus>("idle");
const activeCreateAction = ref<RepoCreateAction | null>(null);
const cloningCreatedRepo = ref(false);
const createdRepo = ref<GitHubRepoSummary | null>(null);
const createError = ref<string | null>(null);
const selectedGroupId = ref<string | null>(null);

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
const groupSelectionEnabled = computed(() => props.repoGroups !== undefined);
const repoGroupOptions = computed(() => [
  {
    value: UNGROUPED_REPO_GROUP_VALUE,
    label: "未分组仓库",
    hint: "默认",
    agentId: "repo-create.group.option.ungrouped",
  },
  ...(props.repoGroups ?? []).map((group) => ({
    value: group.id,
    label: group.name,
    hint: `${group.repoIds.length} 个仓库`,
    agentId: `repo-create.group.option.${group.id}`,
  })),
]);
const repoOwnerOptions = computed(() =>
  repoOwners.value.map((owner) => ({
    value: owner.login,
    label: `${owner.login} · ${owner.kind}`,
    agentId: `repo-create.owner.option.${owner.kind}.${owner.login}`,
  }))
);
const repoTemplateOptions = computed(() =>
  repoTemplates.value.map((template) => ({
    value: template.fullName,
    label: template.fullName,
    hint: [template.private ? "Private" : "Public", template.description]
      .filter(Boolean)
      .join(" · "),
    agentId: `repo-create.template.option.${template.id}`,
  }))
);
const selectedOwnerValue = computed({
  get: () => form.value.owner,
  set: (value: string) => {
    form.value.owner = value;
    syncOwnerKind();
  },
});
const selectedGroupValue = computed({
  get: () => selectedGroupId.value ?? UNGROUPED_REPO_GROUP_VALUE,
  set: (value: string) => {
    selectedGroupId.value = value === UNGROUPED_REPO_GROUP_VALUE ? null : value;
  },
});
const blockedReason = computed(() => {
  if (!props.workspaceReady) return "请先选择工作区。";
  if (isRemoteMode.value && !props.githubReady) return "请先绑定 GitHub。";
  return null;
});
const primarySubmitLabel = computed(() => {
  if (!isRemoteMode.value) return "创建";
  if (cloningCreatedRepo.value) return "正在 clone";
  if (createdRepo.value) return "重试克隆";
  return "创建并克隆";
});
const submitDisabled = computed(() => (
  Boolean(blockedReason.value)
  || activeCreateAction.value !== null
  || cloningCreatedRepo.value
  || !form.value.name.trim()
  || (isRemoteMode.value && !form.value.owner)
  || (isRemoteMode.value && form.value.useTemplate && (
    repoTemplatesStatus.value !== "loaded"
    || !form.value.templateFullName
  ))
));
const groupPickerDisabled = computed(() => (
  Boolean(blockedReason.value)
  || activeCreateAction.value !== null
  || cloningCreatedRepo.value
  || Boolean(createdRepo.value)
));

function resetForm() {
  repoTemplatesLoader.invalidate();
  repoTemplates.value = [];
  repoTemplatesStatus.value = "idle";
  const defaultOwner = repoOwners.value[0];
  form.value = {
    owner: defaultOwner?.login ?? "",
    ownerKind: defaultOwner?.kind ?? "user",
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
  activeCreateAction.value = null;
  cloningCreatedRepo.value = false;
  createdRepo.value = null;
  createError.value = null;
  selectedGroupId.value = null;
}

function cancelTemplateLoading() {
  repoTemplatesLoader.invalidate();
  if (repoTemplatesStatus.value !== "loaded") repoTemplatesStatus.value = "idle";
  form.value.templateFullName = "";
  form.value.includeAllBranches = false;
}

function sortRepoOwners(owners: readonly GitHubRepoOwner[]) {
  return [...owners].sort((left, right) => (
    Number(left.kind !== "user") - Number(right.kind !== "user")
    || left.login.localeCompare(right.login)
    || left.kind.localeCompare(right.kind)
  ));
}

async function loadRepoOwners() {
  await repoOwnersLoader.run("repo-owners", async (runId) => {
    try {
      const owners = await listGitHubRepoOwners();
      if (!repoOwnersLoader.isCurrent(runId)) return;
      const sortedOwners = sortRepoOwners(owners);
      repoOwners.value = sortedOwners;
      if (!form.value.owner && sortedOwners.length) {
        form.value.owner = sortedOwners[0].login;
        form.value.ownerKind = sortedOwners[0].kind;
      }
    } catch {
      if (!repoOwnersLoader.isCurrent(runId)) return;
      repoOwners.value = [];
    }
  });
}

async function loadRepoTemplates() {
  if (repoTemplatesStatus.value === "loaded") return;
  await repoTemplatesLoader.run("repo-templates", async (runId) => {
    repoTemplatesStatus.value = "loading";
    try {
      const templates = await listGitHubRepoTemplates();
      if (!repoTemplatesLoader.isCurrent(runId) || !props.open || !form.value.useTemplate) return;
      repoTemplates.value = templates;
      repoTemplatesStatus.value = "loaded";
    } catch {
      if (!repoTemplatesLoader.isCurrent(runId) || !props.open || !form.value.useTemplate) return;
      repoTemplatesStatus.value = "error";
    }
  }, { reusePending: true });
}

function syncOwnerKind() {
  const owner = repoOwners.value.find((item) => item.login === form.value.owner);
  if (owner) form.value.ownerKind = owner.kind;
}

function buildGitHubCreateRepoRequest(): GitHubCreateRepoRequest {
  const useTemplate = form.value.useTemplate;
  return {
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
  };
}

function closeCard() {
  cancelTemplateLoading();
  createRepoLoader.invalidate();
  emit("close");
}

async function submitLocalRepo() {
  await createRepoLoader.run("create-local-repo", async (runId) => {
    activeCreateAction.value = "local";
    createError.value = null;
    try {
      const repo = await createActionTracker.run(() => workspace.createLocalRepo({
          name: form.value.name,
          description: form.value.description || null,
          addReadme: form.value.addReadme,
          gitignoreTemplate: form.value.gitignoreTemplate || null,
          licenseTemplate: form.value.licenseTemplate || null,
        }));
      if (!createRepoLoader.isCurrent(runId) || !props.open) return;
      emit("localCreated", repo, selectedGroupId.value);
      emit("close");
    } catch (err) {
      if (!createRepoLoader.isCurrent(runId) || !props.open) return;
      createError.value = String(err);
    } finally {
      if (createRepoLoader.isCurrent(runId)) activeCreateAction.value = null;
    }
  });
}

async function cloneCreatedRepo() {
  const repo = createdRepo.value;
  if (!repo) return;
  cloningCreatedRepo.value = true;
  createError.value = null;
  try {
    await createActionTracker.run(async () => {
        const clonedRepo = await workspace.cloneRepo(repo.cloneUrl, repo.name);
        if (!componentEpoch.assertAlive() || !props.open) return clonedRepo;
        emit("remoteCloned", clonedRepo, repo, selectedGroupId.value);
        emit("close");
        await workspace.refreshRepos();
        return clonedRepo;
      });
  } catch (err) {
    if (!componentEpoch.assertAlive() || !props.open) return;
    createError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) cloningCreatedRepo.value = false;
  }
}

async function submitRemoteRepo(cloneAfterCreate = true) {
  if (createdRepo.value) {
    await cloneCreatedRepo();
    return;
  }
  await createRepoLoader.run(`create-remote-repo:${cloneAfterCreate ? "clone" : "only"}`, async (runId) => {
    activeCreateAction.value = cloneAfterCreate ? "remote-clone" : "remote-only";
    createError.value = null;
    syncOwnerKind();
    try {
      const request = buildGitHubCreateRepoRequest();
      const repo = await createActionTracker.run(() => createGitHubRepo(request));
      if (!createRepoLoader.isCurrent(runId) || !props.open) return;
      if (!cloneAfterCreate) {
        emit("close");
        return;
      }
      createdRepo.value = repo;
      await cloneCreatedRepo();
    } catch (err) {
      if (!createRepoLoader.isCurrent(runId) || !props.open) return;
      createError.value = String(err);
    } finally {
      if (createRepoLoader.isCurrent(runId)) activeCreateAction.value = null;
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
    if (!open) {
      cancelTemplateLoading();
      return;
    }
    resetForm();
    if (props.mode === "remote") void loadRepoOwners();
    void nextTick(() => firstInput.value?.focus());
  },
);

watch(
  () => form.value.useTemplate,
  (useTemplate) => {
    if (!useTemplate) {
      cancelTemplateLoading();
      return;
    }
    if (props.open && isRemoteMode.value) void loadRepoTemplates();
  },
);

onUnmounted(() => {
  repoOwnersLoader.invalidate();
  repoTemplatesLoader.invalidate();
  createRepoLoader.invalidate();
  createActionTracker.reset();
});
</script>

<template>
  <div v-if="open" class="repo-create-backdrop" role="presentation" @click.self="closeCard">
    <form
      class="repo-create-card"
      role="dialog"
      aria-modal="true"
      :aria-label="dialogTitle"
      @submit.prevent="submitCreateRepo"
    >
      <div class="repo-create-card__head">
        <h3>{{ dialogTitle }}</h3>
        <button type="button" class="ghost repo-create-card__close" aria-label="关闭" @click="closeCard">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <p v-if="blockedReason" class="repo-create-card__error">{{ blockedReason }}</p>

      <div v-if="isRemoteMode" class="repo-create-grid">
        <div class="repo-create-field">
          <span>Owner</span>
          <Dropdown
            v-model="selectedOwnerValue"
            :options="repoOwnerOptions"
            placement="bottom"
            button-class="repo-create-owner-picker"
            agent-id="repo-create.owner.trigger"
            menu-label="选择 GitHub owner"
            menu-width="100%"
            :disabled="Boolean(blockedReason)"
          />
        </div>
        <label>
          <span>仓库名</span>
          <input ref="firstInput" v-model="form.name" type="text" required placeholder="new-repo" />
        </label>
      </div>
      <label v-else>
        <span>仓库名</span>
        <input ref="firstInput" v-model="form.name" type="text" required placeholder="new-repo" />
      </label>

      <div v-if="groupSelectionEnabled" class="repo-create-field">
        <span>仓库分组</span>
        <Dropdown
          v-model="selectedGroupValue"
          :options="repoGroupOptions"
          :icon="FolderInput"
          placement="bottom"
          button-class="repo-create-group-picker"
          agent-id="repo-create.group.trigger"
          menu-label="选择仓库分组"
          menu-width="240px"
          :disabled="groupPickerDisabled"
        />
      </div>

      <label>
        <span>描述</span>
        <input v-model="form.description" type="text" maxlength="350" />
      </label>

      <div v-if="isRemoteMode" class="repo-create-checks">
        <label class="repo-create-check">
          <input v-model="form.private" type="checkbox" />
          <span>Private</span>
        </label>
        <label class="repo-create-check">
          <input v-model="form.useTemplate" type="checkbox" />
          <span>使用模板</span>
        </label>
      </div>

      <template v-if="isRemoteMode && form.useTemplate">
        <div class="repo-create-field">
          <span>模板仓库</span>
          <Dropdown
            v-model="form.templateFullName"
            :options="repoTemplateOptions"
            placeholder="选择模板仓库"
            placement="bottom"
            button-class="repo-create-template-picker"
            agent-id="repo-create.template.trigger"
            menu-label="选择模板仓库"
            menu-width="100%"
            :disabled="repoTemplatesStatus !== 'loaded' || !repoTemplates.length"
          />
          <p v-if="repoTemplatesStatus === 'loading'" class="repo-create-template-state" role="status">
            <LoaderCircle :size="13" aria-hidden="true" class="sb-spin" />
            正在加载模板仓库…
          </p>
          <p v-else-if="repoTemplatesStatus === 'error'" class="repo-create-template-state repo-create-card__error">
            <span>模板仓库加载失败。</span>
            <button
              type="button"
              class="ghost repo-create-template-retry"
              data-agent-id="repo-create.template.retry"
              @click="loadRepoTemplates"
            >
              重试
            </button>
          </p>
          <p
            v-else-if="repoTemplatesStatus === 'loaded' && !repoTemplates.length"
            class="repo-create-template-state"
          >
            没有可用的模板仓库。
          </p>
        </div>
        <div class="repo-create-checks">
          <label class="repo-create-check">
            <input v-model="form.includeAllBranches" type="checkbox" />
            <span>包含所有分支</span>
          </label>
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
        <div class="repo-create-checks">
          <label class="repo-create-check">
            <input v-model="form.addReadme" type="checkbox" />
            <span>初始化 README</span>
          </label>
          <label v-if="isRemoteMode" class="repo-create-check">
            <input v-model="form.hasIssues" type="checkbox" />
            <span>Issues</span>
          </label>
          <label v-if="isRemoteMode" class="repo-create-check">
            <input v-model="form.hasWiki" type="checkbox" />
            <span>Wiki</span>
          </label>
        </div>
      </template>

      <p v-if="createError" class="repo-create-card__error">{{ createError }}</p>
      <div v-if="createdRepo" class="repo-create-result">
        <span>{{ createdRepo.cloneUrl }}</span>
      </div>
      <div class="repo-create-actions">
        <button v-if="!isRemoteMode" type="button" class="ghost" @click="closeCard">取消</button>
        <button
          v-if="isRemoteMode && !createdRepo"
          type="button"
          class="ghost"
          :disabled="submitDisabled"
          @click="submitRemoteRepo(false)"
        >
          <LoaderCircle
            v-if="activeCreateAction === 'remote-only'"
            :size="14"
            aria-hidden="true"
            class="sb-spin"
          />
          创建
        </button>
        <button type="submit" class="primary" :disabled="submitDisabled && !createdRepo">
          <LoaderCircle
            v-if="activeCreateAction === 'local' || activeCreateAction === 'remote-clone' || cloningCreatedRepo"
            :size="14"
            aria-hidden="true"
            class="sb-spin"
          />
          <FolderGit2 v-else-if="!isRemoteMode" :size="14" aria-hidden="true" />
          <GitBranchPlus v-else :size="14" aria-hidden="true" />
          {{ primarySubmitLabel }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.repo-create-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: grid;
  place-items: start center;
  padding: 96px 16px 24px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.repo-create-card {
  width: min(640px, calc(100vw - 32px));
  max-height: calc(100vh - 128px);
  overflow: auto;
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-elev);
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

.repo-create-card__close {
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
  flex: 0 0 auto;
}

.repo-create-card label {
  min-width: 0;
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-create-field {
  min-width: 0;
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-create-card input[type="text"] {
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

:deep(.repo-create-group-picker),
:deep(.repo-create-owner-picker),
:deep(.repo-create-template-picker) {
  width: 100%;
  height: 32px;
  justify-content: flex-start;
  padding: 0 9px;
  border-color: var(--border-soft);
}

:deep(.repo-create-group-picker .chat-chip__label),
:deep(.repo-create-owner-picker .chat-chip__label),
:deep(.repo-create-template-picker .dd__button-label) {
  max-width: none;
}

.repo-create-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.repo-create-card .repo-create-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 5px 7px;
  border-radius: var(--radius-sm);
  color: var(--text);
}

.repo-create-card .repo-create-check:hover {
  background: var(--bg-hover);
}

.repo-create-card__error {
  margin: 0;
  color: var(--err);
  font-size: 12px;
}

.repo-create-template-state {
  min-height: 24px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-create-template-retry {
  min-height: 24px;
  padding: 0 6px;
}

.repo-create-result {
  display: block;
  padding: 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.repo-create-result span {
  display: block;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-create-actions {
  justify-content: flex-end;
}

.repo-create-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  min-width: 64px;
  padding: 0 10px;
  flex: 0 0 auto;
  white-space: nowrap;
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
