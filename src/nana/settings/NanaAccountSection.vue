<script setup lang="ts">
/**
 * Nana Settings · Account — real workspace-bound panel (not Appearance stub).
 * Uses nanavue SettingsCard/Row so iced evidence sees SettingsRow widgets.
 */
import { computed, onMounted, ref, watch } from "vue";
import {
  NanaButton,
  NanaSegmented,
  NanaSettingsCard,
  NanaSettingsRow,
} from "@nanaui/nanavue-components";
import { useAccountPreferences, cloneAccountPreferences } from "../../composables/useAccountPreferences";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { useWorkspace } from "../../composables/useWorkspace";
import type { AccountPreferences } from "../../services/workspace";
import { hasCompleteGitHubAuthorization } from "../../services/workspace/authScopes";

const workspace = useWorkspace();
const preferences = useAccountPreferences();
const componentEpoch = useComponentEpoch();

const confirmingUnbind = ref(false);
const unbinding = ref(false);
const authError = ref<string | null>(null);
const saving = ref(false);
const prefsError = ref<string | null>(null);
const prefsNotice = ref<string | null>(null);
const draft = ref<AccountPreferences>(cloneAccountPreferences(preferences.value));
const watchedCount = ref(0);
const watchedLoading = ref(false);
const watchedError = ref<string | null>(null);

const binding = computed(() => workspace.githubBinding.value);
const authorizationIncomplete = computed(() =>
  Boolean(binding.value && !hasCompleteGitHubAuthorization(binding.value.scopes)),
);
const authStatusError = computed(
  () =>
    authError.value ||
    (workspace.state.authFlowStatus === "error" || workspace.state.authFlowStatus === "expired"
      ? workspace.state.error
      : null),
);

const repositoryScopeValue = computed({
  get: () => {
    const scope = draft.value.repositoryScope;
    return scope.kind === "personal" ? "personal" : "all";
  },
  set: (value: string) => {
    const login = binding.value?.login ?? "";
    draft.value.repositoryScope =
      value === "personal" ? { kind: "personal", login } : { kind: "all" };
  },
});

const repositoryScopeOptions = [
  { value: "all", label: "全部仓库" },
  { value: "personal", label: "个人仓库" },
];

const repositorySortValue = computed({
  get: () => draft.value.repositorySort.key,
  set: (value: string) => {
    draft.value.repositorySort = {
      ...draft.value.repositorySort,
      key: value as AccountPreferences["repositorySort"]["key"],
    };
  },
});

const repositorySortOptions = [
  { value: "name", label: "名称" },
  { value: "created", label: "创建" },
  { value: "updated", label: "更新" },
];

const repositoryDirectionValue = computed({
  get: () => draft.value.repositorySort.direction,
  set: (value: string) => {
    draft.value.repositorySort = {
      ...draft.value.repositorySort,
      direction: value as AccountPreferences["repositorySort"]["direction"],
    };
  },
});

const directionOptions = [
  { value: "asc", label: "升序" },
  { value: "desc", label: "降序" },
];

watch(
  preferences,
  (next) => {
    draft.value = cloneAccountPreferences(next);
  },
  { deep: true },
);

watch(binding, (next) => {
  if (!next) confirmingUnbind.value = false;
  void refreshWatched();
});

async function startBinding() {
  if (workspace.state.authLoading || unbinding.value) return;
  authError.value = null;
  try {
    await workspace.startAuthFlow();
    if (componentEpoch.assertAlive()) authError.value = workspace.state.error;
  } catch (err) {
    if (componentEpoch.assertAlive()) authError.value = String(err);
  }
}

async function confirmUnbind() {
  if (unbinding.value) return;
  unbinding.value = true;
  authError.value = null;
  try {
    await workspace.unbindGitHub();
    if (!componentEpoch.assertAlive()) return;
    if (workspace.state.error) authError.value = workspace.state.error;
    else confirmingUnbind.value = false;
  } catch (err) {
    if (componentEpoch.assertAlive()) authError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) unbinding.value = false;
  }
}

async function savePreferences() {
  if (saving.value || !binding.value) return;
  saving.value = true;
  prefsError.value = null;
  prefsNotice.value = null;
  try {
    await workspace.updateAccountPreferences(cloneAccountPreferences(draft.value));
    if (componentEpoch.assertAlive()) prefsNotice.value = "账户偏好已保存。";
  } catch (err) {
    if (componentEpoch.assertAlive()) prefsError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) saving.value = false;
  }
}

async function refreshWatched() {
  if (!binding.value) {
    watchedCount.value = 0;
    watchedError.value = null;
    return;
  }
  watchedLoading.value = true;
  watchedError.value = null;
  try {
    const page = await workspace.listGitHubWatchedRepos(1);
    if (!componentEpoch.assertAlive()) return;
    watchedCount.value = Array.isArray(page?.items) ? page.items.length : 0;
  } catch (err) {
    if (componentEpoch.assertAlive()) {
      watchedCount.value = 0;
      watchedError.value = String(err);
    }
  } finally {
    if (componentEpoch.assertAlive()) watchedLoading.value = false;
  }
}

onMounted(() => {
  void refreshWatched();
});
</script>

<template>
  <div data-agent-id="settings.account.page" class="nana-account-section">
    <NanaSettingsCard title="GitHub 账户" agent-id="settings.account.github">
      <NanaSettingsRow
        :label="binding?.login ?? 'GitHub 账号'"
        :hint="workspace.authBindingStatusText.value"
        divided
        loose
        first-in-group
        agent-id="settings.account.github.row"
      >
        <NanaButton
          kind="primary"
          size="small"
          :disabled="workspace.state.authLoading || unbinding"
          :loading="workspace.state.authLoading"
          data-agent-id="settings.account.github.bind"
          @press="startBinding"
        >
          {{ workspace.state.authLoading ? "绑定中" : binding ? "更换 GitHub 账号" : "绑定 GitHub" }}
        </NanaButton>
        <template v-if="binding">
          <NanaButton
            v-if="confirmingUnbind"
            kind="danger"
            size="small"
            :loading="unbinding"
            data-agent-id="settings.account.github.unbind.confirm"
            @press="confirmUnbind"
          >
            {{ unbinding ? "解绑中" : "确认解绑" }}
          </NanaButton>
          <NanaButton
            v-else
            size="small"
            :disabled="workspace.state.authLoading || unbinding"
            data-agent-id="settings.account.github.unbind"
            @press="confirmingUnbind = true"
          >
            解绑 GitHub
          </NanaButton>
          <NanaButton
            v-if="confirmingUnbind"
            size="small"
            :disabled="unbinding"
            data-agent-id="settings.account.github.unbind.cancel"
            @press="confirmingUnbind = false"
          >
            取消
          </NanaButton>
        </template>
      </NanaSettingsRow>

      <NanaSettingsRow
        v-if="authorizationIncomplete"
        label="授权待补全"
        hint="部分 GitHub 功能暂不可用。"
        divided
        agent-id="settings.account.github.incomplete"
      >
        <NanaButton
          size="small"
          data-agent-id="settings.account.github.complete-authorization"
          @press="startBinding"
        >
          补全授权
        </NanaButton>
      </NanaSettingsRow>

      <NanaSettingsRow
        v-if="workspace.deviceFlow.value"
        label="设备码"
        :hint="workspace.authRemainingText.value ? `剩余 ${workspace.authRemainingText.value}` : undefined"
        last-in-group
        agent-id="settings.account.github.device-code"
      >
        <code>{{ workspace.deviceFlow.value.userCode }}</code>
      </NanaSettingsRow>

      <p v-if="workspace.state.authNotice" class="nana-account-section__notice" role="status">
        {{ workspace.state.authNotice }}
      </p>
      <p v-if="authStatusError" class="nana-account-section__error" role="alert">
        {{ authStatusError }}
      </p>
    </NanaSettingsCard>

    <NanaSettingsCard
      v-if="binding"
      title="账户偏好"
      agent-id="settings.account.preferences"
    >
      <NanaSettingsRow
        label="仓库范围"
        hint="控制首页与侧栏默认拉取的仓库集合。"
        divided
        first-in-group
        agent-id="settings.account.preferences.scope.row"
      >
        <NanaSegmented
          v-model="repositoryScopeValue"
          :options="repositoryScopeOptions"
          data-agent-id="settings.account.preferences.scope"
        />
      </NanaSettingsRow>
      <NanaSettingsRow
        label="仓库排序"
        hint="名称 / 创建时间 / 更新时间。"
        divided
        agent-id="settings.account.preferences.repository-sort.row"
      >
        <NanaSegmented
          v-model="repositorySortValue"
          :options="repositorySortOptions"
          data-agent-id="settings.account.preferences.repository-sort"
        />
      </NanaSettingsRow>
      <NanaSettingsRow
        label="排序方向"
        divided
        agent-id="settings.account.preferences.repository-direction.row"
      >
        <NanaSegmented
          v-model="repositoryDirectionValue"
          :options="directionOptions"
          data-agent-id="settings.account.preferences.repository-direction"
        />
      </NanaSettingsRow>
      <NanaSettingsRow
        label="Issues / PR / Actions"
        :hint="`Issues ${draft.issues.state} · PR ${draft.pullRequests.state} · Actions ${draft.actions.state}`"
        last-in-group
        agent-id="settings.account.preferences.lists.row"
      >
        <NanaButton
          kind="primary"
          size="small"
          :loading="saving"
          data-agent-id="settings.account.preferences.save"
          @press="savePreferences"
        >
          保存偏好
        </NanaButton>
      </NanaSettingsRow>
      <p v-if="prefsNotice" class="nana-account-section__notice" role="status">{{ prefsNotice }}</p>
      <p v-if="prefsError" class="nana-account-section__error" role="alert">{{ prefsError }}</p>
    </NanaSettingsCard>

    <NanaSettingsCard
      v-if="binding"
      title="仓库通知"
      agent-id="settings.account.notifications"
    >
      <NanaSettingsRow
        label="已关注仓库"
        :hint="watchedLoading ? '加载中…' : watchedError || `共 ${watchedCount} 个（本页）`"
        first-in-group
        last-in-group
        agent-id="settings.account.notifications.summary"
      >
        <NanaButton
          size="small"
          :loading="watchedLoading"
          data-agent-id="settings.account.notifications.refresh"
          @press="refreshWatched"
        >
          刷新
        </NanaButton>
      </NanaSettingsRow>
    </NanaSettingsCard>
  </div>
</template>

<style scoped>
.nana-account-section {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.nana-account-section__notice,
.nana-account-section__error {
  margin: 6px 0 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.nana-account-section__notice {
  color: var(--accent, #4991d7);
}

.nana-account-section__error {
  color: var(--err, #c44);
}

code {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 12px;
}
</style>
