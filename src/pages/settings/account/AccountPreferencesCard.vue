<script setup lang="ts">
import { Dropdown, SettingsRow, UiButton, UiCard } from "../../../ui";
import { computed, ref, watch } from "vue";
import { useAccountPreferences, cloneAccountPreferences } from "../../../composables/useAccountPreferences";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { useWorkspace } from "../../../composables/useWorkspace";
import type { AccountPreferences, GitHubRepoOwner } from "../../../services/workspace";

const workspace = useWorkspace();
const preferences = useAccountPreferences();
const componentEpoch = useComponentEpoch();
const draft = ref<AccountPreferences>(cloneAccountPreferences(preferences.value));
const owners = ref<GitHubRepoOwner[]>([]);
const ownersLoading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const organizations = computed(() => owners.value
  .filter((owner) => owner.kind === "organization")
  .sort((left, right) => left.login.localeCompare(right.login)));
const selectedOrganizationUnavailable = computed(() => {
  const scope = draft.value.repositoryScope;
  return scope.kind === "organization" && !organizations.value.some((owner) =>
    owner.login.toLocaleLowerCase() === scope.login.toLocaleLowerCase());
});
const repositoryScopeValue = computed({
  get: () => {
    const scope = draft.value.repositoryScope;
    return scope.kind === "organization" ? `organization:${scope.login}` : scope.kind;
  },
  set: (value: string) => {
    const login = workspace.githubBinding.value?.login ?? "";
    if (value === "personal") draft.value.repositoryScope = { kind: "personal", login };
    else if (value.startsWith("organization:")) draft.value.repositoryScope = { kind: "organization", login: value.slice(13) };
    else draft.value.repositoryScope = { kind: "all" };
  },
});
const repositoryScopeOptions = computed(() => {
  const options = [
    { value: "all", label: "全部仓库", agentId: "settings.account.preferences.scope.all" },
    { value: "personal", label: "个人仓库", agentId: "settings.account.preferences.scope.personal" },
    ...organizations.value.map((owner) => ({
      value: `organization:${owner.login}`,
      label: owner.login,
      agentId: `settings.account.preferences.scope.organization.${owner.login}`,
    })),
  ];
  const scope = draft.value.repositoryScope;
  if (scope.kind === "organization" && selectedOrganizationUnavailable.value) {
    options.push({ value: `organization:${scope.login}`, label: `${scope.login}（当前不可用）`, agentId: "settings.account.preferences.scope.unavailable" });
  }
  return options;
});

const repositorySortOptions = [
  { value: "name", label: "名称" }, { value: "created", label: "创建时间" }, { value: "updated", label: "更新时间" },
] as const;
const directionOptions = [{ value: "asc", label: "升序" }, { value: "desc", label: "降序" }] as const;
const issueStateOptions = [{ value: "open", label: "开启" }, { value: "closed", label: "已关闭" }, { value: "all", label: "全部" }] as const;
const pullStateOptions = [{ value: "open", label: "开启" }, { value: "closed", label: "已关闭" }, { value: "merged", label: "已合并" }] as const;
const actionStateOptions = [{ value: "all", label: "全部" }, { value: "active", label: "进行中" }, { value: "completed", label: "已完成" }] as const;
const listSortOptions = [{ value: "created", label: "创建时间" }, { value: "updated", label: "更新时间" }, { value: "comments", label: "评论数" }] as const;
const actionSortOptions = [{ value: "updated", label: "更新时间" }, { value: "created", label: "创建时间" }, { value: "run-number", label: "运行编号" }] as const;

async function loadOwners() {
  ownersLoading.value = true;
  try {
    const next = await workspace.getAccountRepositoryOwners();
    if (componentEpoch.assertAlive()) owners.value = next;
  } catch {
    if (componentEpoch.assertAlive()) owners.value = [];
  } finally {
    if (componentEpoch.assertAlive()) ownersLoading.value = false;
  }
}

async function savePreferences() {
  if (saving.value) return;
  saving.value = true;
  error.value = null;
  notice.value = null;
  try {
    const settings = await workspace.updateAccountPreferences(cloneAccountPreferences(draft.value));
    if (!componentEpoch.assertAlive()) return;
    draft.value = cloneAccountPreferences(settings.accountPreferences);
    notice.value = "账户偏好已保存。";
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = String(err).replace(/^Error:\s*/, "");
  } finally {
    if (componentEpoch.assertAlive()) saving.value = false;
  }
}

watch(() => `${workspace.githubBinding.value?.login ?? ""}:${JSON.stringify(preferences.value)}`, () => {
  draft.value = cloneAccountPreferences(preferences.value);
  void loadOwners();
}, { immediate: true });
</script>

<template>
  <UiCard title="账户偏好" aria-label="账户偏好" agent-id="settings.account.preferences">
    <section class="preferences-card__group">
      <h3>仓库列表</h3>
      <SettingsRow label="仓库范围" hint="项目总览和克隆仓库默认使用此范围。" divided>
        <Dropdown v-model="repositoryScopeValue" :options="repositoryScopeOptions" :disabled="ownersLoading" placement="bottom" agent-id="settings.account.preferences.scope" />
      </SettingsRow>
      <p v-if="selectedOrganizationUnavailable" class="preferences-card__warning" role="status">保存的组织当前不可访问，仓库列表会临时显示全部仓库。</p>
      <SettingsRow label="仓库排序" divided>
        <div class="preferences-card__inline">
          <Dropdown v-model="draft.repositorySort.key" :options="repositorySortOptions" placement="bottom" agent-id="settings.account.preferences.repository-sort" />
          <Dropdown v-model="draft.repositorySort.direction" :options="directionOptions" placement="bottom" agent-id="settings.account.preferences.repository-direction" />
        </div>
      </SettingsRow>
    </section>

    <section class="preferences-card__group">
      <h3>列表默认值</h3>
      <SettingsRow label="Issues" divided><div class="preferences-card__inline"><Dropdown v-model="draft.issues.state" :options="issueStateOptions" placement="bottom" agent-id="settings.account.preferences.issues.state" /><Dropdown v-model="draft.issues.sort" :options="listSortOptions" placement="bottom" agent-id="settings.account.preferences.issues.sort" /><Dropdown v-model="draft.issues.direction" :options="directionOptions" placement="bottom" agent-id="settings.account.preferences.issues.direction" /></div></SettingsRow>
      <SettingsRow label="Pull Requests" divided><div class="preferences-card__inline"><Dropdown v-model="draft.pullRequests.state" :options="pullStateOptions" placement="bottom" agent-id="settings.account.preferences.pulls.state" /><Dropdown v-model="draft.pullRequests.sort" :options="listSortOptions" placement="bottom" agent-id="settings.account.preferences.pulls.sort" /><Dropdown v-model="draft.pullRequests.direction" :options="directionOptions" placement="bottom" agent-id="settings.account.preferences.pulls.direction" /></div></SettingsRow>
      <SettingsRow label="Actions"><div class="preferences-card__inline"><Dropdown v-model="draft.actions.state" :options="actionStateOptions" placement="bottom" agent-id="settings.account.preferences.actions.state" /><Dropdown v-model="draft.actions.sort" :options="actionSortOptions" placement="bottom" agent-id="settings.account.preferences.actions.sort" /><Dropdown v-model="draft.actions.direction" :options="directionOptions" placement="bottom" agent-id="settings.account.preferences.actions.direction" /></div></SettingsRow>
    </section>

    <div class="preferences-card__footer">
      <p v-if="error" class="preferences-card__error" role="alert">{{ error }}</p>
      <p v-else-if="notice" class="preferences-card__notice" role="status">{{ notice }}</p>
      <UiButton variant="primary" size="sm" agent-id="settings.account.preferences.save" :busy="saving" @click="savePreferences">保存偏好</UiButton>
    </div>
  </UiCard>
</template>

<style scoped>
.preferences-card__group + .preferences-card__group { margin-top: 14px; }
.preferences-card__group h3 { margin: 0 0 4px; color: var(--text-muted); font-size: 12px; font-weight: 600; }
.preferences-card__inline { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.preferences-card__warning { margin: 6px 0 8px; color: var(--warn); font-size: 12px; }
.preferences-card__footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 12px; }
.preferences-card__error, .preferences-card__notice { flex: 1; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.preferences-card__error { color: var(--err); }
.preferences-card__notice { color: var(--ok); }
@media (max-width: 760px) { .preferences-card__inline { width: 100%; justify-content: flex-start; } }
</style>
