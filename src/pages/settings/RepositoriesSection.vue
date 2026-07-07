<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  FolderGit2,
  GitBranchPlus,
  KeyRound,
  LoaderCircle,
  LogOut,
  Pencil,
  Radar,
  RotateCcw,
  Save,
  ShieldCheck,
  X,
} from "@lucide/vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { createPendingTaskTracker } from "../../composables/usePendingTaskTracker";
import { useWorkspace } from "../../composables/useWorkspace";
import ContributionIdentityRecommendations from "../../components/ContributionIdentityRecommendations.vue";
import RepoCreateCard from "../../components/sidebar/RepoCreateCard.vue";
import {
  type HiddenRepo,
  type ContributionIdentity,
  type ContributionIdentityRecommendation,
  type ContributionIdentityRecommendationResult,
  type WorkspaceTask,
} from "../../services/workspace";
import {
  contributionIdentityKey,
  mergeContributionIdentity,
  normalizeContributionIdentities,
} from "../../utils/contributionIdentities";

const workspace = useWorkspace();
const hiddenRepos = ref<HiddenRepo[]>([]);
const loading = ref(false);
const restoringRepoId = ref<string | null>(null);
const resettingSystemGitRepoId = ref<string | null>(null);
const discovering = ref(false);
const addingRepo = ref(false);
const choosingWorkspaceRoot = ref(false);
const confirmingGitHubUnbind = ref(false);
const unbindingGitHub = ref(false);
const createDialogOpen = ref(false);
const error = ref<string | null>(null);
const cancellingTaskIds = ref<string[]>([]);
const taskCancelErrors = ref<Record<string, string | undefined>>({});
const contributionIdentityDraft = ref<ContributionIdentity[]>([]);
const editingContributionIdentityIndex = ref<number | null>(null);
const savingContributionIdentities = ref(false);
const contributionIdentitySaved = ref(false);
const contributionIdentityRecommendations = ref<ContributionIdentityRecommendationResult | null>(null);
const scanningContributionIdentities = ref(false);
const adoptingContributionIdentityKey = ref<string | null>(null);
const contributionRecommendationError = ref<string | null>(null);
const componentEpoch = useComponentEpoch();
const hiddenReposLoader = createLatestAsyncLoader({ componentEpoch });
const settingsActionTracker = createPendingTaskTracker();

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

function cloneContributionIdentities(identities: readonly ContributionIdentity[] | undefined) {
  return (identities ?? []).map((identity) => ({
    name: identity.name ?? "",
    email: identity.email ?? "",
  }));
}

function normalizeContributionIdentityDraft() {
  return normalizeContributionIdentities(contributionIdentityDraft.value);
}

function isContributionIdentityEditing(index: number) {
  return editingContributionIdentityIndex.value === index;
}

function canSaveContributionIdentity(index: number) {
  const identity = contributionIdentityDraft.value[index];
  return Boolean(identity?.name?.trim() || identity?.email?.trim());
}

function addContributionIdentity() {
  contributionIdentityDraft.value.push({ name: "", email: "" });
  editingContributionIdentityIndex.value = contributionIdentityDraft.value.length - 1;
  contributionIdentitySaved.value = false;
}

function removeContributionIdentity(index: number) {
  contributionIdentityDraft.value.splice(index, 1);
  if (editingContributionIdentityIndex.value === index) {
    editingContributionIdentityIndex.value = null;
  } else if (editingContributionIdentityIndex.value !== null && editingContributionIdentityIndex.value > index) {
    editingContributionIdentityIndex.value -= 1;
  }
  contributionIdentitySaved.value = false;
}

function markContributionIdentityChanged() {
  contributionIdentitySaved.value = false;
}

async function saveContributionIdentities() {
  savingContributionIdentities.value = true;
  contributionIdentitySaved.value = false;
  error.value = null;
  try {
    await settingsActionTracker.run(
      () => workspace.setContributionIdentities(normalizeContributionIdentityDraft()),
      { kind: "workspace", title: "保存贡献身份", priority: "normal" },
    );
    if (!componentEpoch.assertAlive()) return;
    contributionIdentitySaved.value = true;
    return true;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
    return false;
  } finally {
    if (componentEpoch.assertAlive()) savingContributionIdentities.value = false;
  }
}

async function saveContributionIdentity(index: number) {
  if (!canSaveContributionIdentity(index)) return;
  if (await saveContributionIdentities()) {
    editingContributionIdentityIndex.value = null;
  }
}

async function scanContributionIdentities() {
  if (scanningContributionIdentities.value || savingContributionIdentities.value) return;
  scanningContributionIdentities.value = true;
  contributionRecommendationError.value = null;
  try {
    const result = await settingsActionTracker.run(
      () => workspace.scanContributionIdentities(),
      { kind: "workspace", title: "扫描贡献身份", priority: "normal" },
    );
    if (!componentEpoch.assertAlive()) return;
    contributionIdentityRecommendations.value = result;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    contributionRecommendationError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) scanningContributionIdentities.value = false;
  }
}

async function adoptContributionIdentityRecommendation(recommendation: ContributionIdentityRecommendation) {
  const key = contributionIdentityKey(recommendation.identity);
  if (scanningContributionIdentities.value || savingContributionIdentities.value || adoptingContributionIdentityKey.value) {
    return;
  }
  adoptingContributionIdentityKey.value = key;
  savingContributionIdentities.value = true;
  contributionIdentitySaved.value = false;
  contributionRecommendationError.value = null;
  try {
    const identities = mergeContributionIdentity(normalizeContributionIdentityDraft(), recommendation.identity);
    const identityLabel = contributionIdentityKey(recommendation.identity);
    const settings = await settingsActionTracker.run(
      () => workspace.setContributionIdentities(identities),
      { kind: "workspace", title: "采纳贡献身份", detail: identityLabel, priority: "normal" },
    );
    if (!componentEpoch.assertAlive()) return;
    contributionIdentityDraft.value = cloneContributionIdentities(settings.contributionIdentities);
    contributionIdentitySaved.value = true;
    contributionIdentityRecommendations.value = contributionIdentityRecommendations.value
      ? {
        ...contributionIdentityRecommendations.value,
        recommendations: contributionIdentityRecommendations.value.recommendations.filter(
          (item) => contributionIdentityKey(item.identity) !== key,
        ),
      }
      : null;
    void workspace.refreshRepoContributions();
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    contributionRecommendationError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) {
      adoptingContributionIdentityKey.value = null;
      savingContributionIdentities.value = false;
    }
  }
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

async function restoreRepo(repoId: string) {
  restoringRepoId.value = repoId;
  error.value = null;
  try {
    await settingsActionTracker.run(
      async () => {
        await workspace.unhideRepo(repoId);
        if (!componentEpoch.assertAlive()) return;
        await loadHiddenRepos();
      },
      { kind: "workspace", title: "恢复隐藏仓库", repoId, priority: "normal" },
    );
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
    await settingsActionTracker.run(
      () => workspace.useDefaultTokenAuthForRepo(repoId),
      { kind: "github", title: "恢复默认凭证", repoId, priority: "normal" },
    );
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
    await settingsActionTracker.run(
      () => workspace.addLocalRepo(),
      { kind: "workspace", title: "添加本地仓库", priority: "normal" },
    );
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
    await settingsActionTracker.run(
      () => workspace.discoverRepos(),
      { kind: "workspace", title: "发现工作区仓库", priority: "normal" },
    );
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) discovering.value = false;
  }
}

async function chooseWorkspaceRoot() {
  choosingWorkspaceRoot.value = true;
  error.value = null;
  try {
    await settingsActionTracker.run(
      () => workspace.chooseWorkspaceRoot(),
      { kind: "workspace", title: "更换工作区", priority: "high" },
    );
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) choosingWorkspaceRoot.value = false;
  }
}

async function confirmGitHubUnbind() {
  if (unbindingGitHub.value) return;
  unbindingGitHub.value = true;
  error.value = null;
  try {
    await settingsActionTracker.run(
      () => workspace.unbindGitHub(),
      { kind: "github", title: "解绑 GitHub", priority: "high" },
    );
    if (!componentEpoch.assertAlive()) return;
    confirmingGitHubUnbind.value = false;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) unbindingGitHub.value = false;
  }
}

function openCreateDialog() {
  createDialogOpen.value = true;
}

function closeCreateDialog() {
  createDialogOpen.value = false;
}

async function cancelTask(taskId: string) {
  if (isCancellingTask(taskId)) return;
  cancellingTaskIds.value.push(taskId);
  delete taskCancelErrors.value[taskId];
  try {
    await settingsActionTracker.run(
      () => workspace.cancelWorkspaceTask(taskId),
      { kind: "workspace", title: "取消后台任务", priority: "normal" },
    );
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
});

watch(
  () => workspace.state.settings?.contributionIdentities,
  (identities) => {
    contributionIdentityDraft.value = cloneContributionIdentities(identities);
    contributionIdentitySaved.value = false;
  },
  { immediate: true },
);

watch(
  () => workspace.githubBinding.value,
  (binding) => {
    if (!binding) confirmingGitHubUnbind.value = false;
  },
);

onUnmounted(() => {
  hiddenReposLoader.invalidate();
  settingsActionTracker.reset();
});
</script>

<template>
  <div class="card">
    <h2>仓库</h2>
    <div class="repo-settings">
      <div class="settings-panel">
        <div class="settings-panel__body">
          <strong>工作区</strong>
          <span :title="workspace.workspaceRoot.value ?? undefined">
            {{ workspace.workspaceRoot.value ?? "尚未选择工作区" }}
          </span>
          <p>应用会扫描该文件夹下的 Git 仓库。</p>
        </div>
        <button
          type="button"
          class="ghost"
          data-agent-id="settings.repositories.workspace-root.change"
          :disabled="choosingWorkspaceRoot"
          @click="chooseWorkspaceRoot"
        >
          <LoaderCircle v-if="choosingWorkspaceRoot" :size="14" aria-hidden="true" class="sb-spin" />
          <FolderGit2 v-else :size="14" aria-hidden="true" />
          更换工作区
        </button>
      </div>
      <div class="settings-panel">
        <div class="settings-panel__body">
          <strong>{{ workspace.githubBinding.value?.login ?? "GitHub 授权" }}</strong>
          <span>{{ workspace.authBindingStatusText.value }}</span>
          <p v-if="workspace.deviceFlow.value">
            设备码 <code>{{ workspace.deviceFlow.value.userCode }}</code>
            <template v-if="workspace.authRemainingText.value"> · 剩余 {{ workspace.authRemainingText.value }}</template>
          </p>
          <p v-if="workspace.state.authNotice" class="settings-panel__notice">
            {{ workspace.state.authNotice }}
          </p>
          <p v-else-if="workspace.githubBinding.value">
            已绑定账号可用于仓库列表、创建仓库和同步操作。
          </p>
          <p v-else>绑定后可加载账号仓库、创建仓库并执行 GitHub 同步操作。</p>
        </div>
        <div class="settings-panel__actions">
          <button
            type="button"
            class="primary"
            data-agent-id="settings.repositories.github.bind"
            :disabled="workspace.state.authLoading || unbindingGitHub"
            @click="workspace.startAuthFlow"
          >
            <LoaderCircle v-if="workspace.state.authLoading" :size="14" aria-hidden="true" class="sb-spin" />
            <ShieldCheck v-else :size="14" aria-hidden="true" />
            {{ workspace.githubBinding.value || workspace.deviceFlow.value ? "重新绑定 GitHub" : "绑定 GitHub" }}
          </button>
          <template v-if="workspace.githubBinding.value">
            <button
              v-if="confirmingGitHubUnbind"
              type="button"
              class="ghost danger"
              data-agent-id="settings.repositories.github.unbind.confirm"
              :disabled="unbindingGitHub"
              @click="confirmGitHubUnbind"
            >
              <LoaderCircle v-if="unbindingGitHub" :size="14" aria-hidden="true" class="sb-spin" />
              <LogOut v-else :size="14" aria-hidden="true" />
              确认解绑
            </button>
            <button
              v-else
              type="button"
              class="ghost"
              data-agent-id="settings.repositories.github.unbind"
              :disabled="workspace.state.authLoading || unbindingGitHub"
              @click="confirmingGitHubUnbind = true"
            >
              <LogOut :size="14" aria-hidden="true" />
              解绑 GitHub
            </button>
            <button
              v-if="confirmingGitHubUnbind"
              type="button"
              class="ghost"
              data-agent-id="settings.repositories.github.unbind.cancel"
              :disabled="unbindingGitHub"
              @click="confirmingGitHubUnbind = false"
            >
              取消
            </button>
          </template>
        </div>
      </div>
      <div class="repo-settings__actions">
        <button type="button" class="ghost" data-agent-id="settings.repositories.add-local" :disabled="addingRepo" @click="addLocalRepo">
          <LoaderCircle v-if="addingRepo" :size="14" aria-hidden="true" class="sb-spin" />
          <FolderGit2 v-else :size="14" aria-hidden="true" />
          添加本地仓库
        </button>
        <button type="button" class="ghost" data-agent-id="settings.repositories.discover" :disabled="discovering" @click="discoverRepos">
          <LoaderCircle v-if="discovering" :size="14" aria-hidden="true" class="sb-spin" />
          <Radar v-else :size="14" aria-hidden="true" />
          后台发现仓库
        </button>
        <button type="button" class="primary" data-agent-id="settings.repositories.create-remote" @click="openCreateDialog">
          <GitBranchPlus :size="14" aria-hidden="true" />
          新建 GitHub 仓库
        </button>
      </div>
      <section class="contribution-identity-list" aria-labelledby="contribution-identity-list-title">
        <div class="contribution-identity-list__head">
          <div>
            <h3 id="contribution-identity-list-title" tabindex="-1">贡献身份</h3>
            <p>热度图只统计这些名称或邮箱对应的本地提交。</p>
          </div>
          <div class="contribution-identity-list__head-actions">
            <button
              type="button"
              class="ghost"
              data-agent-id="settings.repositories.contribution-identities.scan"
              :disabled="scanningContributionIdentities || savingContributionIdentities || Boolean(adoptingContributionIdentityKey)"
              @click="scanContributionIdentities"
            >
              <LoaderCircle v-if="scanningContributionIdentities" :size="14" aria-hidden="true" class="sb-spin" />
              <Radar v-else :size="14" aria-hidden="true" />
              扫描推荐
            </button>
            <button
              type="button"
              class="ghost"
              data-agent-id="settings.repositories.contribution-identities.add"
              @click="addContributionIdentity"
            >
              添加身份
            </button>
          </div>
        </div>
        <ContributionIdentityRecommendations
          v-if="contributionIdentityRecommendations || scanningContributionIdentities || contributionRecommendationError"
          :result="contributionIdentityRecommendations"
          :loading="scanningContributionIdentities"
          :saving-key="adoptingContributionIdentityKey"
          :error="contributionRecommendationError"
          @adopt="adoptContributionIdentityRecommendation"
        />
        <div class="contribution-identity-list__rows">
          <div
            v-for="(identity, index) in contributionIdentityDraft"
            :key="index"
            class="contribution-identity-list__row"
            :class="{ 'is-preview': !isContributionIdentityEditing(index) }"
          >
            <template v-if="isContributionIdentityEditing(index)">
              <label>
                <span>名称</span>
                <input
                  v-model="identity.name"
                  type="text"
                  :data-agent-id="`settings.repositories.contribution-identities.${index}.name`"
                  @input="markContributionIdentityChanged"
                />
              </label>
              <label>
                <span>邮箱</span>
                <input
                  v-model="identity.email"
                  type="email"
                  :data-agent-id="`settings.repositories.contribution-identities.${index}.email`"
                  @input="markContributionIdentityChanged"
                />
              </label>
            </template>
            <template v-else>
              <div class="contribution-identity-list__preview-field">
                <span>名称</span>
                <strong>{{ identity.name || "未命名" }}</strong>
              </div>
              <div class="contribution-identity-list__preview-field">
                <span>邮箱</span>
                <strong>{{ identity.email || "未填写" }}</strong>
              </div>
            </template>
            <div class="contribution-identity-list__row-actions">
              <button
                v-if="isContributionIdentityEditing(index)"
                type="button"
                class="ghost contribution-identity-list__save"
                :data-agent-id="`settings.repositories.contribution-identities.${index}.save`"
                :disabled="savingContributionIdentities || !canSaveContributionIdentity(index)"
                @click="saveContributionIdentity(index)"
              >
                <LoaderCircle v-if="savingContributionIdentities" :size="14" aria-hidden="true" class="sb-spin" />
                <Save v-else :size="14" aria-hidden="true" />
                保存
              </button>
              <button
                v-else
                type="button"
                class="ghost contribution-identity-list__save"
                :data-agent-id="`settings.repositories.contribution-identities.${index}.edit`"
                @click="editingContributionIdentityIndex = index"
              >
                <Pencil :size="14" aria-hidden="true" />
                编辑
              </button>
              <button
                type="button"
                class="ghost contribution-identity-list__remove"
                :data-agent-id="`settings.repositories.contribution-identities.${index}.remove`"
                @click="removeContributionIdentity(index)"
              >
                <X :size="14" aria-hidden="true" />
              </button>
            </div>
          </div>
          <p v-if="!contributionIdentityDraft.length" class="muted">未添加身份时使用仓库用户配置。</p>
        </div>
        <div class="contribution-identity-list__footer">
          <button
            type="button"
            class="primary"
            data-agent-id="settings.repositories.contribution-identities.save"
            :disabled="savingContributionIdentities"
            @click="saveContributionIdentities"
          >
            <LoaderCircle v-if="savingContributionIdentities" :size="14" aria-hidden="true" class="sb-spin" />
            保存贡献身份
          </button>
          <span v-if="contributionIdentitySaved">已保存</span>
        </div>
      </section>
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
              :data-agent-id="`settings.repositories.system-git.restore.${repo.id}`"
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
            :data-agent-id="`settings.repositories.hidden.restore.${repo.id}`"
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
              :data-agent-id="`settings.repositories.task.cancel.${task.id}`"
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
    <RepoCreateCard
      :open="createDialogOpen"
      mode="remote"
      :workspace-ready="Boolean(workspace.workspaceRoot.value)"
      :github-ready="workspace.isAuthorized.value"
      @close="closeCreateDialog"
    />
  </div>
</template>

<style scoped>
.repo-settings {
  min-height: 40px;
}

.repo-settings .muted {
  margin: 4px 0;
}

.settings-panel {
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

.settings-panel__body {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.settings-panel__body strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-panel__body span,
.settings-panel__body p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.settings-panel__body span {
  color: var(--text);
}

.settings-panel__notice {
  color: var(--accent);
}

.settings-panel > .ghost,
.settings-panel__actions {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.settings-panel__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.settings-panel__actions .primary,
.settings-panel__actions .ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.settings-panel__actions .danger {
  color: var(--err);
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

.repo-settings__actions .primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.contribution-identity-list {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.contribution-identity-list__head,
.contribution-identity-list__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.contribution-identity-list__head h3 {
  margin: 0;
  font-size: 13px;
}

.contribution-identity-list__head p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.contribution-identity-list__head-actions {
  display: inline-flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.contribution-identity-list__head-actions .ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.contribution-identity-list__rows {
  display: grid;
  gap: 8px;
}

.contribution-identity-list__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto;
  gap: 8px;
  align-items: end;
}

.contribution-identity-list__row.is-preview {
  align-items: center;
}

.contribution-identity-list__row label {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.contribution-identity-list__row span {
  color: var(--text-muted);
  font-size: 11px;
}

.contribution-identity-list__row input {
  min-width: 0;
}

.contribution-identity-list__preview-field {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.contribution-identity-list__preview-field strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contribution-identity-list__row-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.contribution-identity-list__save {
  min-width: 70px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.contribution-identity-list__remove {
  width: 32px;
  padding-inline: 0;
}

.contribution-identity-list__footer {
  justify-content: flex-start;
}

.contribution-identity-list__footer .primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.contribution-identity-list__footer span {
  color: var(--ok);
  font-size: 12px;
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

  .contribution-identity-list__head,
  .contribution-identity-list__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .contribution-identity-list__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .contribution-identity-list__row label {
    grid-column: 1 / -1;
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

}
</style>
