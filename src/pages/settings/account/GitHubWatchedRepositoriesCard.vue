<script setup lang="ts">
import { Dropdown, UiButton, UiCard } from "../../../ui";
import { computed, ref, watch } from "vue";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../../composables/useWorkspace";
import {
  type GitHubRepositorySubscriptionMode,
  type GitHubRepoSummary,
} from "../../../services/workspace";
import { githubErrorCode, isGitHubPermissionError } from "../../../utils/githubErrors";

const WATCHING_URL = "https://github.com/watching";
const NOTIFICATION_SETTINGS_URL = "https://github.com/settings/notifications";

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const repositoriesLoader = createLatestAsyncLoader({ componentEpoch });
const repositories = ref<GitHubRepoSummary[]>([]);
const nextPage = ref<number | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const permissionUnavailable = ref(false);
const error = ref<string | null>(null);
const externalError = ref<string | null>(null);
const savingRepositories = ref<ReadonlySet<string>>(new Set());
let accountContextVersion = 0;

const binding = computed(() => workspace.githubBinding.value);
const hasNotificationScope = computed(() =>
  binding.value?.scopes.some((scope) => scope.toLocaleLowerCase() === "notifications") === true,
);
const accountKey = computed(() => {
  const current = binding.value;
  if (!current) return "";
  return `${current.login.toLocaleLowerCase()}:${[...current.scopes].sort().join(",")}`;
});
const canManageInApp = computed(() => hasNotificationScope.value && !permissionUnavailable.value);
const showEmptyState = computed(() => canManageInApp.value && !loading.value && !error.value && repositories.value.length === 0);

const subscriptionOptions = [
  { value: "watching", label: "关注仓库", agentId: "settings.account.notifications.mode.watching" },
  { value: "participating", label: "仅参与和提及", agentId: "settings.account.notifications.mode.participating" },
  { value: "ignored", label: "忽略此仓库", agentId: "settings.account.notifications.mode.ignored" },
] satisfies ReadonlyArray<{ value: GitHubRepositorySubscriptionMode; label: string; agentId: string }>;

function setRepositorySaving(repoFullName: string, saving: boolean) {
  const next = new Set(savingRepositories.value);
  if (saving) next.add(repoFullName);
  else next.delete(repoFullName);
  savingRepositories.value = next;
}

function isRepositorySaving(repoFullName: string) {
  return savingRepositories.value.has(repoFullName);
}

function repositoryAgentKey(repo: GitHubRepoSummary) {
  return repo.fullName.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function notificationErrorMessage(cause: unknown) {
  const code = githubErrorCode(cause);
  if (code === "github_authentication_required") return "GitHub 账户授权已失效，请重新绑定后再试。";
  if (code === "github_rate_limited") return "GitHub 请求暂时受限，请稍后重试。";
  if (isGitHubPermissionError(cause)) return "当前账户无法在应用内管理仓库通知。";
  return "暂时无法读取仓库通知，请重试。";
}

function isNotificationAccessUnavailable(cause: unknown) {
  return isGitHubPermissionError(cause) || githubErrorCode(cause) === "github_authentication_required";
}

function mergeRepositories(current: readonly GitHubRepoSummary[], incoming: readonly GitHubRepoSummary[]) {
  const merged = new Map(current.map((repo) => [repo.fullName.toLocaleLowerCase(), repo]));
  for (const repo of incoming) merged.set(repo.fullName.toLocaleLowerCase(), repo);
  return [...merged.values()];
}

async function loadRepositories(page = 1, append = false) {
  if (!canManageInApp.value) return;
  const contextKey = accountKey.value;
  const contextVersion = accountContextVersion;
  await repositoriesLoader.run(`${contextKey}:${page}`, async (runId) => {
    if (append) loadingMore.value = true;
    else loading.value = true;
    error.value = null;
    try {
      const result = await workspace.listGitHubWatchedRepos(page);
      if (!repositoriesLoader.isCurrent(runId) || accountKey.value !== contextKey || contextVersion !== accountContextVersion) return;
      repositories.value = append ? mergeRepositories(repositories.value, result.items) : [...result.items];
      nextPage.value = result.nextPage;
    } catch (cause) {
      if (!repositoriesLoader.isCurrent(runId) || accountKey.value !== contextKey || contextVersion !== accountContextVersion) return;
      permissionUnavailable.value = isNotificationAccessUnavailable(cause);
      error.value = notificationErrorMessage(cause);
      if (!append) {
        repositories.value = [];
        nextPage.value = null;
      }
    } finally {
      if (repositoriesLoader.isCurrent(runId) && contextVersion === accountContextVersion) {
        loading.value = false;
        loadingMore.value = false;
      }
    }
  });
}

async function refreshRepositories() {
  repositoriesLoader.invalidate();
  nextPage.value = null;
  await loadRepositories();
}

async function loadMoreRepositories() {
  if (nextPage.value == null || loading.value || loadingMore.value) return;
  await loadRepositories(nextPage.value, true);
}

async function updateSubscription(repo: GitHubRepoSummary, mode: GitHubRepositorySubscriptionMode) {
  if (!canManageInApp.value || mode === "watching" || isRepositorySaving(repo.fullName)) return;
  const contextKey = accountKey.value;
  const contextVersion = accountContextVersion;
  setRepositorySaving(repo.fullName, true);
  error.value = null;
  try {
    const subscription = await workspace.updateGitHubRepositorySubscription(repo.fullName, mode);
    if (!componentEpoch.assertAlive() || accountKey.value !== contextKey || contextVersion !== accountContextVersion) return;
    if (subscription.mode !== "watching") {
      repositories.value = repositories.value.filter((item) => item.fullName.toLocaleLowerCase() !== repo.fullName.toLocaleLowerCase());
    }
  } catch (cause) {
    if (!componentEpoch.assertAlive() || accountKey.value !== contextKey || contextVersion !== accountContextVersion) return;
    permissionUnavailable.value = isNotificationAccessUnavailable(cause);
    error.value = notificationErrorMessage(cause);
  } finally {
    if (componentEpoch.assertAlive() && accountKey.value === contextKey && contextVersion === accountContextVersion) {
      setRepositorySaving(repo.fullName, false);
    }
  }
}

async function openGitHub(url: string) {
  externalError.value = null;
  try {
    await workspace.openUrl(url);
  } catch {
    if (componentEpoch.assertAlive()) externalError.value = "无法打开 GitHub，请稍后重试。";
  }
}

watch(accountKey, () => {
  accountContextVersion += 1;
  repositoriesLoader.invalidate();
  repositories.value = [];
  nextPage.value = null;
  loading.value = false;
  loadingMore.value = false;
  permissionUnavailable.value = false;
  error.value = null;
  externalError.value = null;
  savingRepositories.value = new Set();
  if (hasNotificationScope.value) void loadRepositories();
}, { immediate: true });
</script>

<template>
  <UiCard title="仓库通知" aria-label="仓库通知" agent-id="settings.account.notifications" :loading="loading">
    <p v-if="!hasNotificationScope" class="watched-card__state" role="status">
      通知权限尚未授权，应用内无法管理关注仓库。
    </p>
    <p v-else-if="permissionUnavailable" class="watched-card__state" role="status">
      {{ error ?? "当前账户无法在应用内管理仓库通知。" }}
    </p>

    <template v-if="canManageInApp">
      <div v-if="repositories.length" class="watched-card__list" role="list" aria-label="关注的仓库">
        <div
          v-for="repo in repositories"
          :key="repo.id"
          class="watched-card__row"
          role="listitem"
          :data-agent-id="`settings.account.notifications.row.${repositoryAgentKey(repo)}`"
        >
          <button
            type="button"
            class="watched-card__identity"
            :data-agent-id="`settings.account.notifications.row.${repositoryAgentKey(repo)}.open`"
            @click="openGitHub(repo.htmlUrl)"
          >
            <img v-if="repo.owner?.avatarUrl" :src="repo.owner.avatarUrl" alt="" class="watched-card__avatar">
            <span class="watched-card__repo-copy">
              <strong>{{ repo.fullName }}</strong>
              <small v-if="repo.description">{{ repo.description }}</small>
            </span>
          </button>
          <div class="watched-card__mode">
            <Dropdown
              model-value="watching"
              :options="subscriptionOptions"
              placement="bottom"
              :disabled="isRepositorySaving(repo.fullName)"
              :agent-id="`settings.account.notifications.row.${repositoryAgentKey(repo)}.mode`"
              @update:model-value="updateSubscription(repo, $event as GitHubRepositorySubscriptionMode)"
            />
            <span class="watched-card__saving" aria-live="polite">
              {{ isRepositorySaving(repo.fullName) ? "正在保存…" : "" }}
            </span>
          </div>
        </div>
      </div>
      <p v-else-if="showEmptyState" class="watched-card__state" role="status">当前没有关注的仓库。</p>
      <p v-if="error" class="watched-card__error" role="alert">{{ error }}</p>
      <div v-if="error && !permissionUnavailable" class="watched-card__retry">
        <UiButton size="sm" agent-id="settings.account.notifications.retry" :busy="loading" @click="refreshRepositories">重试</UiButton>
      </div>
      <div v-if="!error" class="watched-card__list-actions">
        <UiButton size="sm" agent-id="settings.account.notifications.refresh" :disabled="loadingMore" @click="refreshRepositories">刷新</UiButton>
        <UiButton v-if="nextPage !== null" size="sm" agent-id="settings.account.notifications.load-more" :busy="loadingMore" :disabled="loading" @click="loadMoreRepositories">加载更多</UiButton>
      </div>
    </template>

    <p v-if="externalError" class="watched-card__error" role="alert">{{ externalError }}</p>

    <div class="watched-card__external-actions">
      <UiButton size="sm" agent-id="settings.account.notifications.github-watching" @click="openGitHub(WATCHING_URL)">在 GitHub 管理关注仓库</UiButton>
      <UiButton size="sm" agent-id="settings.account.notifications.github-settings" @click="openGitHub(NOTIFICATION_SETTINGS_URL)">通知设置</UiButton>
    </div>
  </UiCard>
</template>

<style scoped>
.watched-card__list { display: grid; }
.watched-card__row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--border-soft); }
.watched-card__row:last-child { border-bottom: 0; }
.watched-card__identity { display: flex; min-width: 0; flex: 1; align-items: center; gap: 9px; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.watched-card__identity:hover strong { color: var(--accent); }
.watched-card__avatar { width: 28px; height: 28px; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 50%; }
.watched-card__repo-copy { display: grid; min-width: 0; gap: 2px; }
.watched-card__repo-copy strong { overflow-wrap: anywhere; font-size: 13px; font-weight: 600; transition: color 0.12s ease; }
.watched-card__repo-copy small { display: -webkit-box; overflow: hidden; color: var(--text-muted); font-size: 12px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.watched-card__mode { display: grid; min-width: 150px; justify-items: end; gap: 2px; }
.watched-card__saving { min-height: 15px; color: var(--text-muted); font-size: 11px; }
.watched-card__state, .watched-card__error { margin: 2px 0 8px; font-size: 12px; overflow-wrap: anywhere; }
.watched-card__state { color: var(--text-muted); }
.watched-card__error { color: var(--err); }
.watched-card__retry, .watched-card__list-actions, .watched-card__external-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.watched-card__retry { margin-bottom: 10px; }
.watched-card__list-actions { justify-content: flex-end; margin-top: 10px; }
.watched-card__external-actions { justify-content: flex-end; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-soft); }
@media (max-width: 760px) {
  .watched-card__row { align-items: flex-start; flex-direction: column; gap: 8px; }
  .watched-card__mode { width: 100%; justify-items: start; }
  .watched-card__external-actions, .watched-card__list-actions { justify-content: flex-start; }
}
</style>
