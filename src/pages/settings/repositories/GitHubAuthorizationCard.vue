<script setup lang="ts">
import { SettingsRow, UiButton, UiCard } from "@lilia/ui";
import { computed, ref, watch } from "vue";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { useWorkspace } from "../../../composables/useWorkspace";

const workspace = useWorkspace();
const confirmingGitHubUnbind = ref(false);
const unbindingGitHub = ref(false);
const error = ref<string | null>(null);
const componentEpoch = useComponentEpoch();

const authError = computed(() => {
  if (error.value) return error.value;
  if (workspace.state.authFlowStatus === "error" || workspace.state.authFlowStatus === "expired") {
    return workspace.state.error;
  }
  return null;
});
const organizationAccessLimited = computed(() => {
  const binding = workspace.githubBinding.value;
  return Boolean(binding && !binding.scopes.includes("read:org"));
});

async function startGitHubAuth() {
  if (workspace.state.authLoading || unbindingGitHub.value) return;
  error.value = null;
  try {
    await workspace.startAuthFlow();
    if (!componentEpoch.assertAlive()) return;
    error.value = workspace.state.error;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  }
}

async function confirmGitHubUnbind() {
  if (unbindingGitHub.value) return;
  unbindingGitHub.value = true;
  error.value = null;
  try {
    await workspace.unbindGitHub();
    if (!componentEpoch.assertAlive()) return;
    if (workspace.state.error) {
      error.value = workspace.state.error;
      return;
    }
    confirmingGitHubUnbind.value = false;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) unbindingGitHub.value = false;
  }
}

watch(
  () => workspace.githubBinding.value,
  (binding) => {
    if (!binding) confirmingGitHubUnbind.value = false;
  },
);
</script>

<template>
  <UiCard
    title="GitHub 授权"
    aria-label="GitHub 授权"
    agent-id="settings.repositories.github"
  >
    <SettingsRow
      :label="workspace.githubBinding.value?.login ?? 'GitHub 账号'"
      :hint="workspace.authBindingStatusText.value"
      divided
      loose
    >
      <div class="github-card__actions">
        <UiButton
          variant="primary"
          size="sm"
          agent-id="settings.repositories.github.bind"
          :disabled="workspace.state.authLoading || unbindingGitHub"
          :busy="workspace.state.authLoading"
          @click="startGitHubAuth"
        >
          {{ workspace.state.authLoading
            ? "绑定中"
            : workspace.githubBinding.value || workspace.deviceFlow.value ? "重新绑定 GitHub" : "绑定 GitHub" }}
        </UiButton>

        <template v-if="workspace.githubBinding.value">
          <UiButton
            v-if="confirmingGitHubUnbind"
            variant="danger"
            size="sm"
            agent-id="settings.repositories.github.unbind.confirm"
            :busy="unbindingGitHub"
            @click="confirmGitHubUnbind"
          >
            {{ unbindingGitHub ? "解绑中" : "确认解绑" }}
          </UiButton>
          <UiButton
            v-else
            size="sm"
            agent-id="settings.repositories.github.unbind"
            :disabled="workspace.state.authLoading || unbindingGitHub"
            @click="confirmingGitHubUnbind = true"
          >
            解绑 GitHub
          </UiButton>
          <UiButton
            v-if="confirmingGitHubUnbind"
            size="sm"
            agent-id="settings.repositories.github.unbind.cancel"
            :disabled="unbindingGitHub"
            @click="confirmingGitHubUnbind = false"
          >
            取消
          </UiButton>
        </template>
      </div>
    </SettingsRow>

    <SettingsRow
      v-if="organizationAccessLimited"
      label="组织信息可能不完整"
      hint="现有仓库仍可继续使用；补充授权后可读取完整的关联组织。"
    >
      <UiButton
        size="sm"
        agent-id="settings.repositories.github.organization-authorize"
        :disabled="workspace.state.authLoading || unbindingGitHub"
        :busy="workspace.state.authLoading"
        @click="startGitHubAuth"
      >
        补充组织权限
      </UiButton>
    </SettingsRow>

    <SettingsRow
      v-if="workspace.deviceFlow.value"
      label="设备码"
      :hint="workspace.authRemainingText.value ? `剩余 ${workspace.authRemainingText.value}` : undefined"
    >
      <code class="github-card__device-code">{{ workspace.deviceFlow.value.userCode }}</code>
    </SettingsRow>

    <p v-if="workspace.state.authNotice" class="github-card__notice" role="status">
      {{ workspace.state.authNotice }}
    </p>
    <p v-if="authError" class="github-card__error" role="alert">{{ authError }}</p>
  </UiCard>
</template>

<style scoped>
.github-card__actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.github-card__device-code {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.github-card__notice,
.github-card__error {
  margin: 6px 0 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.github-card__notice {
  color: var(--accent);
}

.github-card__error {
  color: var(--err);
}

@media (max-width: 900px) {
  .github-card__actions {
    width: 100%;
    align-items: flex-start;
    justify-content: flex-start;
    flex-direction: column;
  }
}
</style>
