<script setup lang="ts">
import { SettingsRow, UiButton, UiCard } from "../../../ui";
import { computed, ref, watch } from "vue";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { useWorkspace } from "../../../composables/useWorkspace";
import { hasCompleteGitHubAuthorization } from "../../../services/workspace/authScopes";

const workspace = useWorkspace();
const confirmingUnbind = ref(false);
const unbinding = ref(false);
const error = ref<string | null>(null);
const componentEpoch = useComponentEpoch();

const authError = computed(() => error.value || (
  workspace.state.authFlowStatus === "error" || workspace.state.authFlowStatus === "expired"
    ? workspace.state.error
    : null
));
const authorizationIncomplete = computed(() =>
  Boolean(workspace.githubBinding.value && !hasCompleteGitHubAuthorization(workspace.githubBinding.value.scopes)),
);

async function startBinding() {
  if (workspace.state.authLoading || unbinding.value) return;
  error.value = null;
  try {
    await workspace.startAuthFlow();
    if (componentEpoch.assertAlive()) error.value = workspace.state.error;
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = String(err);
  }
}

async function confirmUnbind() {
  if (unbinding.value) return;
  unbinding.value = true;
  error.value = null;
  try {
    await workspace.unbindGitHub();
    if (!componentEpoch.assertAlive()) return;
    if (workspace.state.error) error.value = workspace.state.error;
    else confirmingUnbind.value = false;
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) unbinding.value = false;
  }
}

watch(() => workspace.githubBinding.value, (binding) => {
  if (!binding) confirmingUnbind.value = false;
});
</script>

<template>
  <UiCard title="GitHub 账户" aria-label="GitHub 账户" agent-id="settings.account.github">
    <SettingsRow :label="workspace.githubBinding.value?.login ?? 'GitHub 账号'" :hint="workspace.authBindingStatusText.value" divided loose>
      <div class="github-card__actions">
        <UiButton variant="primary" size="sm" agent-id="settings.account.github.bind" :disabled="workspace.state.authLoading || unbinding" :busy="workspace.state.authLoading" @click="startBinding">
          {{ workspace.state.authLoading ? "绑定中" : workspace.githubBinding.value ? "更换 GitHub 账号" : "绑定 GitHub" }}
        </UiButton>
        <template v-if="workspace.githubBinding.value">
          <UiButton v-if="confirmingUnbind" variant="danger" size="sm" agent-id="settings.account.github.unbind.confirm" :busy="unbinding" @click="confirmUnbind">
            {{ unbinding ? "解绑中" : "确认解绑" }}
          </UiButton>
          <UiButton v-else size="sm" agent-id="settings.account.github.unbind" :disabled="workspace.state.authLoading || unbinding" @click="confirmingUnbind = true">解绑 GitHub</UiButton>
          <UiButton v-if="confirmingUnbind" size="sm" agent-id="settings.account.github.unbind.cancel" :disabled="unbinding" @click="confirmingUnbind = false">取消</UiButton>
        </template>
      </div>
    </SettingsRow>
    <SettingsRow v-if="authorizationIncomplete" label="授权待补全" hint="部分 GitHub 功能暂不可用。">
      <UiButton size="sm" agent-id="settings.account.github.complete-authorization" @click="startBinding">补全授权</UiButton>
    </SettingsRow>
    <SettingsRow v-if="workspace.deviceFlow.value" label="设备码" :hint="workspace.authRemainingText.value ? `剩余 ${workspace.authRemainingText.value}` : undefined">
      <code class="github-card__device-code">{{ workspace.deviceFlow.value.userCode }}</code>
    </SettingsRow>
    <p v-if="workspace.state.authNotice" class="github-card__notice" role="status">{{ workspace.state.authNotice }}</p>
    <p v-if="authError" class="github-card__error" role="alert">{{ authError }}</p>
  </UiCard>
</template>

<style scoped>
.github-card__actions { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.github-card__device-code { max-width: 100%; overflow-wrap: anywhere; }
.github-card__notice, .github-card__error { margin: 6px 0 0; font-size: 12px; overflow-wrap: anywhere; }
.github-card__notice { color: var(--accent); }
.github-card__error { color: var(--err); }
@media (max-width: 900px) { .github-card__actions { width: 100%; align-items: flex-start; justify-content: flex-start; flex-direction: column; } }
</style>
