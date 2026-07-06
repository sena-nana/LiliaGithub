<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AlertCircle, LoaderCircle, RotateCw, Trash2 } from "@lucide/vue";
import { Dropdown, SettingsRow, UiSwitch } from "@lilia/ui";
import {
  deleteGitHubBranch,
  getGitHubRepoSettingsSection,
  updateGitHubRepoActionsPermissions,
  updateGitHubRepoSettings,
  updateGitHubRepoWorkflowPermissions,
} from "../../../services/workspace/client";
import type {
  BranchSummary,
  GitHubRepoManagement,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
} from "../../../services/workspace/types";
import {
  asBoolean,
  asRecord,
  branchFromRecord,
  countLabel,
  itemRecord,
  namedRecords,
  sectionItem,
  statusLabel,
  type RepoSettingsBranchRow,
  type RepoSettingsDetailKind,
} from "./repoSettingsDisplay";

const props = defineProps<{
  kind: RepoSettingsDetailKind;
  title: string;
  repoFullName: string;
  defaultBranch: string;
  branches: readonly BranchSummary[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "updated-management": [value: GitHubRepoManagement];
  "branch-deleted": [branch: string];
}>();

type ConfirmAction = {
  title: string;
  body: string;
  expected: string;
  actionLabel: string;
  agentId: string;
  run: () => Promise<void>;
};

const sections = ref<Partial<Record<GitHubRepoSettingsSectionKey, GitHubRepoSettingsSection>>>({});
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const confirmAction = ref<ConfirmAction | null>(null);
const confirmInput = ref("");

const sectionKeys = computed<GitHubRepoSettingsSectionKey[]>(() => {
  if (props.kind === "access") return ["collaborators", "deployKeys", "githubApps"];
  return [props.kind];
});

const primarySection = computed(() => sections.value[sectionKeys.value[0]] ?? null);
const securityRecord = computed(() => itemRecord(sectionItem(primarySection.value, "repository")));
const securityAnalysis = computed(() => asRecord(securityRecord.value.security_and_analysis));
const securityFeatures = computed(() => {
  const keys = Object.keys(securityAnalysis.value);
  return keys.map((key) => {
    const feature = asRecord(securityAnalysis.value[key]);
    const enabled = asBoolean(feature.status);
    return {
      key,
      label: securityFeatureLabel(key),
      enabled,
      valueLabel: statusLabel(enabled),
    };
  });
});

const vulnerabilityRows = computed(() => [
  sectionItem(primarySection.value, "vulnerabilityAlerts"),
  sectionItem(primarySection.value, "dependabotSecurityUpdates"),
  sectionItem(primarySection.value, "privateVulnerabilityReporting"),
  sectionItem(primarySection.value, "immutableReleases"),
].filter(Boolean).map((item) => {
  const record = itemRecord(item);
  const enabled = asBoolean(record.status ?? item?.value ?? (item?.error ? false : null));
  return {
    key: item?.key ?? "",
    label: item?.label ?? "",
    valueLabel: item?.error ? "不可用" : statusLabel(enabled),
    error: item?.error ?? null,
  };
}));

const branchRows = computed(() => {
  if (props.branches.length) {
    return props.branches.map((branch) => ({
      name: branch.name,
      protected: branch.protected,
      defaultBranch: branch.name === props.defaultBranch,
    }));
  }
  const records = namedRecords(sectionItem(primarySection.value, "branches")?.value);
  return records.map((record) => branchFromRecord(record, props.defaultBranch));
});

const actionsPermissions = computed(() => itemRecord(sectionItem(primarySection.value, "permissions")));
const workflowPermissions = computed(() => itemRecord(sectionItem(primarySection.value, "workflowPermissions")));
const actionsEnabled = computed(() => asBoolean(actionsPermissions.value.enabled) !== false);
const allowedActions = computed(() => String(actionsPermissions.value.allowed_actions ?? "all"));
const shaPinningRequired = computed(() => asBoolean(actionsPermissions.value.sha_pinning_required) === true);
const workflowDefaultPermission = computed(() => String(workflowPermissions.value.default_workflow_permissions ?? "read"));
const workflowCanApprove = computed(() => asBoolean(workflowPermissions.value.can_approve_pull_request_reviews) === true);
const allowedActionOptions = [
  { value: "all", label: "全部" },
  { value: "local_only", label: "仅本仓库" },
  { value: "selected", label: "选定范围" },
] as const;
const workflowPermissionOptions = [
  { value: "read", label: "只读" },
  { value: "write", label: "读写" },
] as const;
const workflowCount = computed(() => {
  const record = itemRecord(sectionItem(primarySection.value, "workflows"));
  return Number(record.total_count ?? namedRecords(record.workflows).length ?? 0);
});

const environmentRows = computed(() =>
  namedRecords(sectionItem(primarySection.value, "environments")?.value)
);
const webhookRows = computed(() =>
  namedRecords(sectionItem(primarySection.value, "webhooks")?.value)
);
const collaboratorRows = computed(() =>
  namedRecords(sectionItem(sections.value.collaborators ?? null, "collaborators")?.value)
);
const teamRows = computed(() =>
  namedRecords(sectionItem(sections.value.collaborators ?? null, "teams")?.value)
);
const deployKeyRows = computed(() =>
  namedRecords(sectionItem(sections.value.deployKeys ?? null, "deployKeys")?.value)
);
const appRows = computed(() =>
  namedRecords(sectionItem(sections.value.githubApps ?? null, "installations")?.value)
);

const confirmMatches = computed(() => {
  const action = confirmAction.value;
  return Boolean(action) && confirmInput.value.trim() === action?.expected;
});

watch(
  () => [props.repoFullName, props.kind] as const,
  () => {
    sections.value = {};
    void load(true);
  },
  { immediate: true },
);

async function load(forceRefresh = false) {
  if (!props.repoFullName) return;
  loading.value = true;
  error.value = null;
  try {
    const loaded = await Promise.all(
      sectionKeys.value.map(async (key) => [
        key,
        await getGitHubRepoSettingsSection(props.repoFullName, key, { forceRefresh }),
      ] as const),
    );
    sections.value = Object.fromEntries(loaded);
  } catch (err) {
    error.value = String(err);
  } finally {
    loading.value = false;
  }
}

function securityFeatureLabel(key: string) {
  const labels: Record<string, string> = {
    advanced_security: "高级安全",
    secret_scanning: "Secret scanning",
    secret_scanning_push_protection: "Push protection",
    secret_scanning_ai_detection: "AI secret detection",
  };
  return labels[key] ?? key.replace(/_/g, " ");
}

function openConfirm(action: ConfirmAction) {
  confirmAction.value = action;
  confirmInput.value = "";
}

function closeConfirm() {
  if (saving.value) return;
  confirmAction.value = null;
  confirmInput.value = "";
}

async function runConfirmedAction() {
  if (!confirmAction.value || !confirmMatches.value || saving.value) return;
  const action = confirmAction.value;
  await action.run();
}

async function withSave(task: () => Promise<void>) {
  saving.value = true;
  error.value = null;
  try {
    await task();
    confirmAction.value = null;
    confirmInput.value = "";
    await load(true);
  } catch (err) {
    error.value = String(err);
  } finally {
    saving.value = false;
  }
}

function requestSecurityToggle(key: string, enabled: boolean) {
  const run = () => saveSecurityFeature(key, enabled);
  if (!enabled) {
    openConfirm({
      title: "关闭安全能力",
      body: `这会关闭 ${securityFeatureLabel(key)}。`,
      expected: props.repoFullName,
      actionLabel: "确认关闭",
      agentId: `repo.settings.security.${key}.confirm`,
      run,
    });
    return;
  }
  void run();
}

async function saveSecurityFeature(key: string, enabled: boolean) {
  await withSave(async () => {
    const nextAnalysis = { ...securityAnalysis.value };
    nextAnalysis[key] = {
      ...asRecord(nextAnalysis[key]),
      status: enabled ? "enabled" : "disabled",
    };
    const next = await updateGitHubRepoSettings(props.repoFullName, { securityAndAnalysis: nextAnalysis });
    emit("updated-management", next);
  });
}

function requestActionsEnabled(enabled: boolean) {
  const run = () => saveActionsPermissions({ enabled });
  if (!enabled) {
    openConfirm({
      title: "关闭 Actions",
      body: "这会停止仓库工作流运行。",
      expected: props.repoFullName,
      actionLabel: "确认关闭",
      agentId: "repo.settings.actions.disable.confirm",
      run,
    });
    return;
  }
  void run();
}

async function saveActionsPermissions(next: {
  enabled?: boolean;
  allowedActions?: string;
  shaPinningRequired?: boolean;
}) {
  await withSave(async () => {
    await updateGitHubRepoActionsPermissions(props.repoFullName, {
      enabled: next.enabled ?? actionsEnabled.value,
      allowedActions: next.allowedActions ?? allowedActions.value,
      shaPinningRequired: next.shaPinningRequired ?? shaPinningRequired.value,
    });
  });
}

async function saveWorkflowPermissions(next: {
  defaultWorkflowPermissions?: string;
  canApprovePullRequestReviews?: boolean;
}) {
  await withSave(async () => {
    await updateGitHubRepoWorkflowPermissions(props.repoFullName, {
      defaultWorkflowPermissions: next.defaultWorkflowPermissions ?? workflowDefaultPermission.value,
      canApprovePullRequestReviews: next.canApprovePullRequestReviews ?? workflowCanApprove.value,
    });
  });
}

function onAllowedActionsChange(value: string) {
  void saveActionsPermissions({ allowedActions: value });
}

function onWorkflowPermissionChange(value: string) {
  void saveWorkflowPermissions({ defaultWorkflowPermissions: value });
}

function requestDeleteBranch(branch: RepoSettingsBranchRow) {
  if (!branch.name || branch.defaultBranch || branch.protected) return;
  openConfirm({
    title: "删除远端分支",
    body: `这会删除远端分支 ${branch.name}。`,
    expected: branch.name,
    actionLabel: "确认删除",
    agentId: `repo.settings.branches.${branch.name}.delete.confirm`,
    run: async () => {
      await withSave(async () => {
        await deleteGitHubBranch(props.repoFullName, branch.name);
        emit("branch-deleted", branch.name);
      });
    },
  });
}

function recordName(record: Record<string, unknown>) {
  return String(record.name ?? record.login ?? record.title ?? record.slug ?? record.id ?? "未命名");
}
</script>

<template>
  <section class="repo-settings-detail-section" :data-agent-id="`repo.settings.${kind}`">
    <div class="repo-settings-detail-section__head">
      <div>
        <h4>{{ title }}</h4>
        <span v-if="primarySection && !loading">已读取最新状态</span>
      </div>
      <button
        type="button"
        class="ghost project-icon-action"
        :disabled="loading || saving || disabled"
        aria-label="刷新"
        title="刷新"
        :data-agent-id="`repo.settings.${kind}.refresh`"
        @click="load(true)"
      >
        <LoaderCircle v-if="loading" :size="14" class="sb-spin" aria-hidden="true" />
        <RotateCw v-else :size="14" aria-hidden="true" />
      </button>
    </div>

    <p v-if="error" class="repo-settings-detail-section__error">
      <AlertCircle :size="14" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>
    <p v-else-if="loading && !primarySection" class="muted repo-empty project-empty">加载中</p>

    <div v-if="kind === 'security' && primarySection" class="repo-settings-detail-section__body">
      <div v-if="securityFeatures.length" class="repo-settings-display-list">
        <SettingsRow
          v-for="feature in securityFeatures"
          :key="feature.key"
          class="project-settings-switch"
          :label="feature.label"
          :hint="feature.valueLabel"
        >
          <UiSwitch
            :model-value="feature.enabled === true"
            :aria-label="feature.label"
            :agent-id="`repo.settings.security.${feature.key}`"
            :disabled="saving || disabled || feature.enabled === null"
            @update:model-value="requestSecurityToggle(feature.key, $event)"
          />
        </SettingsRow>
      </div>
      <p v-else class="muted repo-empty project-empty">没有返回安全分析状态。</p>
      <div class="repo-settings-display-grid">
        <SettingsRow v-for="row in vulnerabilityRows" :key="row.key" class="repo-settings-display-row" :label="row.label">
          <span class="settings-row__status-text">{{ row.error ?? row.valueLabel }}</span>
        </SettingsRow>
      </div>
    </div>

    <div v-else-if="kind === 'branches' && primarySection" class="repo-settings-detail-section__body">
      <p v-if="!branchRows.length" class="muted repo-empty project-empty">没有可显示的远端分支。</p>
      <div v-else class="repo-settings-table" role="table" aria-label="远端分支">
        <SettingsRow
          v-for="branch in branchRows"
          :key="branch.name"
          class="repo-settings-table__row"
          :label="branch.name"
          :hint="branch.defaultBranch ? '默认分支' : branch.protected ? '受保护' : '可管理'"
          role="row"
        >
          <button
            v-if="!branch.defaultBranch && !branch.protected"
            type="button"
            class="ghost danger project-icon-action"
            :aria-label="`删除 ${branch.name}`"
            :title="`删除 ${branch.name}`"
            :data-agent-id="`repo.settings.branches.${branch.name}.delete`"
            :disabled="saving || disabled"
            @click="requestDeleteBranch(branch)"
          >
            <Trash2 :size="14" aria-hidden="true" />
          </button>
        </SettingsRow>
      </div>
    </div>

    <div v-else-if="kind === 'actions' && primarySection" class="repo-settings-detail-section__body">
      <div class="repo-settings-display-list">
        <SettingsRow class="project-settings-switch" label="Actions" :hint="actionsEnabled ? '允许运行工作流' : '已关闭'">
          <UiSwitch
            :model-value="actionsEnabled"
            aria-label="Actions"
            agent-id="repo.settings.actions.enabled"
            :disabled="saving || disabled"
            @update:model-value="requestActionsEnabled"
          />
        </SettingsRow>
        <SettingsRow
          class="project-settings-switch"
          label="允许工作流审批 Pull Request"
          :hint="workflowCanApprove ? '已允许' : '未允许'"
        >
          <UiSwitch
            :model-value="workflowCanApprove"
            aria-label="允许工作流审批 Pull Request"
            agent-id="repo.settings.actions.approve-pr"
            :disabled="saving || disabled || !actionsEnabled"
            @update:model-value="saveWorkflowPermissions({ canApprovePullRequestReviews: $event })"
          />
        </SettingsRow>
      </div>
      <div class="project-settings-fields">
        <SettingsRow class="project-settings-field" label="允许的 Actions">
          <span class="project-settings-field__control">
            <Dropdown
              :model-value="allowedActions"
              :options="allowedActionOptions"
              block
              size="large"
              placement="bottom"
              agent-id="repo.settings.actions.allowed-actions"
              menu-label="允许的 Actions"
              :disabled="saving || disabled || !actionsEnabled"
              @update:model-value="onAllowedActionsChange"
            />
          </span>
        </SettingsRow>
        <SettingsRow class="project-settings-field" label="默认工作流权限">
          <span class="project-settings-field__control">
            <Dropdown
              :model-value="workflowDefaultPermission"
              :options="workflowPermissionOptions"
              block
              size="large"
              placement="bottom"
              agent-id="repo.settings.actions.workflow-permission"
              menu-label="默认工作流权限"
              :disabled="saving || disabled || !actionsEnabled"
              @update:model-value="onWorkflowPermissionChange"
            />
          </span>
        </SettingsRow>
        <SettingsRow class="project-settings-field" label="工作流数量">
          <span class="settings-row__status-text">{{ countLabel(workflowCount, "个") }}</span>
        </SettingsRow>
      </div>
    </div>

    <div v-else-if="kind === 'environments' && primarySection" class="repo-settings-detail-section__body">
      <p v-if="!environmentRows.length" class="muted repo-empty project-empty">没有环境。</p>
      <div v-else class="repo-settings-display-grid">
        <SettingsRow
          v-for="environment in environmentRows"
          :key="String(environment.id ?? environment.name)"
          class="repo-settings-display-row"
          :label="recordName(environment)"
        >
          <span class="settings-row__status-text">{{ Number(environment.protection_rules_count ?? 0) }} 条保护规则</span>
        </SettingsRow>
      </div>
    </div>

    <div v-else-if="kind === 'webhooks' && primarySection" class="repo-settings-detail-section__body">
      <p v-if="!webhookRows.length" class="muted repo-empty project-empty">没有 Webhook。</p>
      <div v-else class="repo-settings-display-grid">
        <SettingsRow
          v-for="hook in webhookRows"
          :key="String(hook.id ?? hook.name)"
          class="repo-settings-display-row"
          :label="recordName(hook)"
        >
          <span class="settings-row__status-text">
            {{ asBoolean(hook.active) === false ? "已停用" : "运行中" }} · {{ Array.isArray(hook.events) ? hook.events.length : 0 }} 个事件
          </span>
        </SettingsRow>
      </div>
    </div>

    <div v-else-if="kind === 'access' && primarySection" class="repo-settings-detail-section__body">
      <div class="repo-settings-display-grid">
        <SettingsRow class="repo-settings-display-row" label="协作者">
          <span class="settings-row__status-text">{{ countLabel(collaboratorRows.length, "人") }}</span>
        </SettingsRow>
        <SettingsRow class="repo-settings-display-row" label="团队">
          <span class="settings-row__status-text">{{ countLabel(teamRows.length, "个") }}</span>
        </SettingsRow>
        <SettingsRow class="repo-settings-display-row" label="部署密钥">
          <span class="settings-row__status-text">{{ countLabel(deployKeyRows.length, "个") }}</span>
        </SettingsRow>
        <SettingsRow class="repo-settings-display-row" label="GitHub Apps">
          <span class="settings-row__status-text">{{ countLabel(appRows.length, "个") }}</span>
        </SettingsRow>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="confirmAction"
          class="project-delete-overlay"
          role="dialog"
          aria-modal="true"
          :aria-label="confirmAction.title"
          @click.self="closeConfirm"
        >
          <div class="project-delete-dialog">
            <div class="project-delete-dialog__head">
              <AlertCircle :size="15" aria-hidden="true" />
              <strong>{{ confirmAction.title }}</strong>
            </div>
            <p>{{ confirmAction.body }}</p>
            <label>
              <span>输入 {{ confirmAction.expected }} 以确认</span>
              <input
                v-model="confirmInput"
                type="text"
                :data-agent-id="`${confirmAction.agentId}.input`"
                :placeholder="confirmAction.expected"
                :disabled="saving"
              />
            </label>
            <div class="project-delete-dialog__actions">
              <button type="button" class="ghost" :disabled="saving" @click="closeConfirm">
                取消
              </button>
              <button
                type="button"
                class="ghost danger"
                :data-agent-id="confirmAction.agentId"
                :disabled="saving || !confirmMatches"
                @click="runConfirmedAction"
              >
                <LoaderCircle v-if="saving" :size="14" class="sb-spin" aria-hidden="true" />
                <Trash2 v-else :size="14" aria-hidden="true" />
                {{ confirmAction.actionLabel }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.repo-settings-detail-section {
  display: grid;
  gap: 8px;
}

.repo-settings-detail-section__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 28px;
}

.repo-settings-detail-section__head h4 {
  min-width: 0;
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.repo-settings-detail-section__head span {
  color: var(--text-muted);
  font-size: 12px;
}

.repo-settings-detail-section__body,
.repo-settings-display-list,
.repo-settings-table {
  display: grid;
  gap: 0;
}

.project-settings-switch {
  min-width: 0;
}

.project-settings-fields {
  display: grid;
  gap: 0;
}

.project-settings-field {
  min-width: 0;
}

.project-settings-field__control {
  width: min(260px, 100%);
}

.repo-settings-detail-section__error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--err);
  font-size: 12px;
}

.repo-settings-display-grid {
  display: grid;
  gap: 0;
}

.repo-settings-display-row,
.repo-settings-table__row {
  min-width: 0;
}

.repo-settings-detail-section :deep(.settings-row__label) {
  flex: 1 1 auto;
  white-space: normal;
}

.project-delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 2500;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.4);
}

.project-delete-dialog {
  display: grid;
  gap: 14px;
  width: min(420px, 100%);
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  box-shadow: 0 18px 50px -24px rgba(0, 0, 0, 0.7);
}

.project-delete-dialog__head,
.project-delete-dialog__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-delete-dialog__head {
  color: var(--err);
}

.project-delete-dialog p {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.project-delete-dialog label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.project-delete-dialog input {
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
}

.project-delete-dialog__actions {
  justify-content: flex-end;
}
</style>
