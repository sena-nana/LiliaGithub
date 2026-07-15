<script setup lang="ts">
import { Bell, ExternalLink, LoaderCircle, RotateCw } from "@lucide/vue";
import { Dropdown, UiButton } from "@lilia/ui";
import { computed, ref, watch } from "vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../composables/useWorkspace";
import {
  getGitHubRepositorySubscription,
  githubErrorCode,
  isGitHubBindingExpiredError,
  isGitHubPermissionError,
  openUrl,
  updateGitHubRepositorySubscription,
} from "../../services/workspace";
import type { GitHubRepositorySubscriptionMode } from "../../services/workspace";

const props = defineProps<{
  repoFullName: string;
}>();

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const subscriptionLoader = createLatestAsyncLoader({ componentEpoch });
const subscriptionSaver = createLatestAsyncLoader({ componentEpoch });
const mode = ref<GitHubRepositorySubscriptionMode | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const unavailable = ref<string | null>(null);
const customizeError = ref<string | null>(null);

const subscriptionOptions = [
  { value: "watching", label: "已关注" },
  { value: "participating", label: "仅参与和提及" },
  { value: "ignored", label: "忽略此仓库" },
] satisfies readonly { value: GitHubRepositorySubscriptionMode; label: string }[];

const binding = computed(() => workspace.githubBinding.value);
const hasNotificationsScope = computed(() =>
  binding.value?.scopes.some((scope) => scope.toLocaleLowerCase() === "notifications") === true,
);
const requestKey = computed(() => {
  const login = binding.value?.login.trim().toLocaleLowerCase() ?? "";
  return `${login}:${props.repoFullName.trim().toLocaleLowerCase()}`;
});
const repositoryUrl = computed(() => {
  const path = props.repoFullName
    .trim()
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://github.com/${path}`;
});

function resetState() {
  subscriptionLoader.invalidate();
  subscriptionSaver.invalidate();
  mode.value = null;
  loading.value = false;
  saving.value = false;
  error.value = null;
  unavailable.value = null;
  customizeError.value = null;
}

function markUnavailable() {
  unavailable.value = "当前 GitHub 授权无法管理此仓库的通知偏好，请在 GitHub 继续设置。";
  error.value = null;
  mode.value = null;
}

function readableError(err: unknown) {
  if (githubErrorCode(err) === "github_rate_limited") return "GitHub 请求暂时受限，请稍后重试。";
  return "暂时无法读取仓库通知偏好，请重试。";
}

async function loadSubscription() {
  if (!hasNotificationsScope.value) {
    unavailable.value = binding.value
      ? "当前 GitHub 授权未包含通知权限，请在 GitHub 继续设置。"
      : "GitHub 尚未绑定，请在 GitHub 继续设置仓库通知。";
    return;
  }

  const key = requestKey.value;
  await subscriptionLoader.run(key, async (runId) => {
    loading.value = true;
    error.value = null;
    unavailable.value = null;
    try {
      const subscription = await getGitHubRepositorySubscription(props.repoFullName);
      if (!subscriptionLoader.isCurrent(runId) || requestKey.value !== key) return;
      mode.value = subscription.mode;
    } catch (err) {
      if (!subscriptionLoader.isCurrent(runId) || requestKey.value !== key) return;
      if (isGitHubBindingExpiredError(err) || isGitHubPermissionError(err)) markUnavailable();
      else error.value = readableError(err);
    } finally {
      if (subscriptionLoader.isCurrent(runId) && requestKey.value === key) loading.value = false;
    }
  });
}

async function updateMode(next: string) {
  if (!subscriptionOptions.some((option) => option.value === next)) return;
  if (!mode.value || saving.value || !hasNotificationsScope.value) return;

  const nextMode = next as GitHubRepositorySubscriptionMode;
  const key = requestKey.value;
  subscriptionLoader.invalidate();
  await subscriptionSaver.run(key, async (runId) => {
    saving.value = true;
    error.value = null;
    try {
      const subscription = await updateGitHubRepositorySubscription(props.repoFullName, nextMode);
      if (!subscriptionSaver.isCurrent(runId) || requestKey.value !== key) return;
      mode.value = subscription.mode;
    } catch (err) {
      if (!subscriptionSaver.isCurrent(runId) || requestKey.value !== key) return;
      if (isGitHubBindingExpiredError(err) || isGitHubPermissionError(err)) markUnavailable();
      else error.value = readableError(err);
    } finally {
      if (subscriptionSaver.isCurrent(runId) && requestKey.value === key) saving.value = false;
    }
  });
}

async function openCustomization() {
  const key = requestKey.value;
  customizeError.value = null;
  try {
    await openUrl(repositoryUrl.value);
  } catch {
    if (componentEpoch.assertAlive() && requestKey.value === key) {
      customizeError.value = "无法打开 GitHub，请稍后重试。";
    }
  }
}

watch(
  () => `${requestKey.value}:${binding.value?.scopes.join(",") ?? ""}`,
  () => {
    resetState();
    void loadSubscription();
  },
  { immediate: true },
);
</script>

<template>
  <section
    class="card repo-notification-card"
    aria-label="仓库通知"
    data-agent-id="repo.notifications.card"
  >
    <header class="repo-notification-card__header">
      <Bell :size="14" aria-hidden="true" />
      <strong>通知</strong>
    </header>

    <div class="repo-notification-card__body">
      <div v-if="loading" class="repo-notification-card__loading" role="status">
        <LoaderCircle :size="14" aria-hidden="true" class="sb-spin" />
        <span>正在读取通知偏好…</span>
      </div>

      <p v-else-if="unavailable" class="repo-notification-card__unavailable" role="status">
        {{ unavailable }}
      </p>

      <template v-else-if="mode">
        <div class="repo-notification-card__control-label">
          <span>通知方式</span>
          <Dropdown
            :model-value="mode"
            :options="subscriptionOptions"
            :disabled="saving"
            block
            placement="bottom"
            menu-label="仓库通知方式"
            agent-id="repo.notifications.mode"
            @update:model-value="updateMode"
          />
        </div>
        <p class="repo-notification-card__status" role="status">
          <template v-if="saving">
            <LoaderCircle :size="13" aria-hidden="true" class="sb-spin" />
            正在保存…
          </template>
          <template v-else>GitHub 将按此偏好发送仓库通知。</template>
        </p>
      </template>

      <div v-if="error" class="repo-notification-card__error" role="alert">
        <p>{{ error }}</p>
        <UiButton
          size="sm"
          agent-id="repo.notifications.retry"
          :disabled="loading || saving"
          @click="loadSubscription"
        >
          <RotateCw :size="13" aria-hidden="true" />
          重试
        </UiButton>
      </div>
    </div>

    <footer class="repo-notification-card__footer">
      <UiButton
        size="sm"
        agent-id="repo.notifications.customize"
        @click="openCustomization"
      >
        <ExternalLink :size="13" aria-hidden="true" />
        在 GitHub 自定义
      </UiButton>
      <p v-if="customizeError" class="repo-notification-card__customize-error" role="alert">
        {{ customizeError }}
      </p>
    </footer>
  </section>
</template>

<style scoped>
.repo-notification-card {
  display: grid;
  gap: var(--repo-sidebar-card-gap, 8px);
  min-width: 0;
  margin: 0;
  padding: var(--repo-sidebar-card-padding, 12px);
}

.repo-notification-card__header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 20px;
  color: var(--text);
  font-size: 13px;
}

.repo-notification-card__body {
  display: grid;
  gap: 8px;
  min-width: 0;
  min-height: 64px;
  align-content: start;
}

.repo-notification-card__loading,
.repo-notification-card__status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-notification-card__unavailable,
.repo-notification-card__error p,
.repo-notification-card__customize-error {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.repo-notification-card__control-label {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-notification-card__error {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.repo-notification-card__error p,
.repo-notification-card__customize-error {
  color: var(--err);
}

.repo-notification-card__footer {
  display: grid;
  justify-items: start;
  gap: 6px;
  min-height: 30px;
}

@media (prefers-reduced-motion: reduce) {
  .repo-notification-card :deep(*) {
    transition-duration: 0s !important;
  }
}
</style>
