<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AlertCircle, LoaderCircle, RotateCw, Save, Trash2 } from "@lucide/vue";
import { Dropdown, SettingsRow, UiSwitch } from "@lilia/ui";
import {
  deleteGitHubBranch,
  getGitHubBranchProtection,
  getGitHubRepoSettingsSection,
  getGitHubRepoRuleset,
  listGitHubRepoRulesets,
  updateGitHubBranchProtection,
  updateGitHubRepoActionsPermissions,
  updateGitHubRepoRuleset,
  updateGitHubRepoSettings,
  updateGitHubRepoWorkflowPermissions,
} from "../../../services/workspace/client";
import type {
  BranchSummary,
  GitHubRepoManagement,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
  GitHubRulesetSummary,
} from "../../../services/workspace/types";
import {
  asBoolean,
  asRecord,
  branchFromRecord,
  countLabel,
  editableListText,
  enabledValue,
  itemRecord,
  namedRecords,
  parseEditableList,
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
  canAdminister?: boolean;
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

type BranchProtectionDraft = {
  requirePullRequest: boolean;
  requiredApprovals: number;
  requireCodeOwners: boolean;
  dismissStaleReviews: boolean;
  requireLastPushApproval: boolean;
  requireStatusChecks: boolean;
  strictStatusChecks: boolean;
  statusContexts: string;
  enforceAdmins: boolean;
  requireLinearHistory: boolean;
  requireConversationResolution: boolean;
  allowForcePushes: boolean;
  allowDeletions: boolean;
};

type RulesetDraft = {
  name: string;
  enforcement: string;
  include: string;
  exclude: string;
};

const selectedBranch = ref("");
const branchProtectionRaw = ref<Record<string, unknown> | null>(null);
const branchProtectionDraft = ref<BranchProtectionDraft | null>(null);
const branchProtectionBaseline = ref("");
const branchProtectionLoading = ref(false);
const branchProtectionSaving = ref(false);
const branchProtectionError = ref<string | null>(null);
const branchProtectionNotice = ref<string | null>(null);
const branchProtectionWriteDenied = ref(false);
const selectedRulesetId = ref<number | null>(null);
const rulesetRaw = ref<Record<string, unknown> | null>(null);
const rulesetDraft = ref<RulesetDraft | null>(null);
const rulesetBaseline = ref("");
const rulesetLoading = ref(false);
const rulesetSaving = ref(false);
const rulesetError = ref<string | null>(null);
const rulesetWriteDenied = ref(false);
const rulesetSummaries = ref<GitHubRulesetSummary[]>([]);
const rulesetsLoaded = ref(false);

const sectionKeys = computed<GitHubRepoSettingsSectionKey[]>(() => {
  if (props.kind === "access") return ["collaborators", "deployKeys", "githubApps"];
  if (props.kind === "rules") return [];
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
const rulesetRows = computed(() => rulesetSummaries.value);
const selectedRulesetSummary = computed(() =>
  rulesetRows.value.find((ruleset) => ruleset.id === selectedRulesetId.value) ?? null
);
const selectedBranchRow = computed(() =>
  branchRows.value.find((branch) => branch.name === selectedBranch.value) ?? null
);
const branchProtectionStatus = computed(() => {
  if (branchProtectionRaw.value && Object.keys(branchProtectionRaw.value).length > 0) return "已配置分支保护";
  if (selectedBranchRow.value?.protected) return "受规则保护";
  return "尚未设置保护";
});
const branchProtectionReadOnlyReason = computed(() => {
  if (props.canAdminister === false) return "当前账号没有仓库管理权限，分支保护以只读方式显示。";
  if (branchProtectionWriteDenied.value) return "当前凭据没有修改分支保护的权限。";
  return null;
});
const rulesetReadOnlyReason = computed(() => {
  if (selectedRulesetSummary.value?.repositoryOwned === false) {
    return "此规则集由上级范围提供，只能在来源位置修改。";
  }
  if (props.canAdminister === false) return "当前账号没有编辑仓库规则的权限，规则集以只读方式显示。";
  if (rulesetWriteDenied.value) return "当前凭据没有修改规则集的权限。";
  return null;
});
const branchProtectionPayload = computed(() =>
  branchProtectionDraft.value ? buildBranchProtectionPayload(branchProtectionRaw.value, branchProtectionDraft.value) : null
);
const branchProtectionDirty = computed(() =>
  Boolean(branchProtectionPayload.value) && JSON.stringify(branchProtectionPayload.value) !== branchProtectionBaseline.value
);
const rulesetPayload = computed(() =>
  rulesetDraft.value && rulesetRaw.value ? buildRulesetPayload(rulesetRaw.value, rulesetDraft.value) : null
);
const rulesetDirty = computed(() =>
  Boolean(rulesetPayload.value) && JSON.stringify(rulesetPayload.value) !== rulesetBaseline.value
);
const enforcementOptions = [
  { value: "active", label: "启用" },
  { value: "evaluate", label: "评估" },
  { value: "disabled", label: "停用" },
] as const;

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
    resetBranchProtection();
    resetRuleset();
    void load(true);
  },
  { immediate: true },
);

watch(
  () => branchRows.value.map((branch) => branch.name).join("\n"),
  () => {
    if (props.kind !== "branches" || selectedBranch.value || !branchRows.value.length) return;
    const initial = branchRows.value.find((branch) => branch.defaultBranch)
      ?? branchRows.value.find((branch) => branch.protected)
      ?? branchRows.value[0];
    if (initial) void selectBranch(initial.name);
  },
  { immediate: true },
);

watch(
  () => rulesetRows.value.map((ruleset) => String(ruleset.id ?? "")).join("\n"),
  () => {
    if (props.kind !== "rules" || selectedRulesetId.value !== null || !rulesetRows.value.length) return;
    const firstId = Number(rulesetRows.value[0]?.id);
    if (Number.isFinite(firstId)) void selectRuleset(firstId);
  },
);

async function load(forceRefresh = false) {
  if (!props.repoFullName) return;
  loading.value = true;
  error.value = null;
  try {
    if (props.kind === "rules") {
      rulesetSummaries.value = await listGitHubRepoRulesets(props.repoFullName);
      rulesetsLoaded.value = true;
      return;
    }
    const loaded = await Promise.all(
      sectionKeys.value.map(async (key) => [
        key,
        await getGitHubRepoSettingsSection(props.repoFullName, key, { forceRefresh }),
      ] as const),
    );
    sections.value = Object.fromEntries(loaded);
  } catch (err) {
    error.value = props.kind === "rules" ? accessErrorMessage(err, "读取规则集") : String(err);
  } finally {
    loading.value = false;
  }
}

function resetBranchProtection() {
  selectedBranch.value = "";
  branchProtectionRaw.value = null;
  branchProtectionDraft.value = null;
  branchProtectionBaseline.value = "";
  branchProtectionError.value = null;
  branchProtectionNotice.value = null;
  branchProtectionWriteDenied.value = false;
}

function resetRuleset() {
  selectedRulesetId.value = null;
  rulesetRaw.value = null;
  rulesetDraft.value = null;
  rulesetBaseline.value = "";
  rulesetError.value = null;
  rulesetWriteDenied.value = false;
  rulesetSummaries.value = [];
  rulesetsLoaded.value = false;
}

async function selectBranch(branch: string) {
  if (!branch || branchProtectionSaving.value) return;
  selectedBranch.value = branch;
  branchProtectionRaw.value = null;
  branchProtectionDraft.value = null;
  branchProtectionError.value = null;
  branchProtectionNotice.value = null;
  branchProtectionWriteDenied.value = false;
  branchProtectionLoading.value = true;
  try {
    const response = await getGitHubBranchProtection(props.repoFullName, branch);
    const protection = asRecord(response);
    if (selectedBranch.value !== branch) return;
    branchProtectionRaw.value = protection;
    branchProtectionDraft.value = branchProtectionDraftFromRaw(protection);
    branchProtectionBaseline.value = JSON.stringify(
      buildBranchProtectionPayload(protection, branchProtectionDraft.value),
    );
    if (response === null && selectedBranchRow.value?.protected) {
      branchProtectionNotice.value = "此分支可能由规则集保护，尚无独立分支保护配置。";
    }
  } catch (err) {
    if (selectedBranch.value !== branch) return;
    if (isNotFoundError(err)) {
      const draft = branchProtectionDraftFromRaw({});
      branchProtectionRaw.value = {};
      branchProtectionDraft.value = draft;
      branchProtectionBaseline.value = JSON.stringify(buildBranchProtectionPayload({}, draft));
      if (selectedBranchRow.value?.protected) {
        branchProtectionNotice.value = "此分支可能由规则集保护，尚无独立分支保护配置。";
      }
    } else {
      branchProtectionError.value = accessErrorMessage(err, "读取分支保护");
    }
  } finally {
    if (selectedBranch.value === branch) branchProtectionLoading.value = false;
  }
}

async function saveBranchProtection() {
  const branch = selectedBranch.value;
  const payload = branchProtectionPayload.value;
  if (!branch || !payload || branchProtectionReadOnlyReason.value || branchProtectionSaving.value) return;
  branchProtectionSaving.value = true;
  branchProtectionError.value = null;
  try {
    const updated = asRecord(await updateGitHubBranchProtection(props.repoFullName, branch, payload as never));
    branchProtectionRaw.value = Object.keys(updated).length ? updated : branchProtectionRaw.value;
    const baselineRaw = branchProtectionRaw.value ?? {};
    branchProtectionBaseline.value = JSON.stringify(buildBranchProtectionPayload(baselineRaw, branchProtectionDraft.value!));
  } catch (err) {
    if (isPermissionError(err)) branchProtectionWriteDenied.value = true;
    branchProtectionError.value = accessErrorMessage(err, "保存分支保护");
  } finally {
    branchProtectionSaving.value = false;
  }
}

async function selectRuleset(id: number) {
  if (!Number.isFinite(id) || rulesetSaving.value) return;
  selectedRulesetId.value = id;
  rulesetRaw.value = null;
  rulesetDraft.value = null;
  rulesetError.value = null;
  rulesetWriteDenied.value = false;
  rulesetLoading.value = true;
  try {
    const ruleset = asRecord(await getGitHubRepoRuleset(props.repoFullName, id));
    if (selectedRulesetId.value !== id) return;
    rulesetRaw.value = ruleset;
    rulesetDraft.value = rulesetDraftFromRaw(ruleset);
    rulesetBaseline.value = JSON.stringify(buildRulesetPayload(ruleset, rulesetDraft.value));
  } catch (err) {
    if (selectedRulesetId.value === id) rulesetError.value = accessErrorMessage(err, "读取规则集");
  } finally {
    if (selectedRulesetId.value === id) rulesetLoading.value = false;
  }
}

async function saveRuleset() {
  const id = selectedRulesetId.value;
  const payload = rulesetPayload.value;
  if (id === null || !payload || rulesetReadOnlyReason.value || rulesetSaving.value) return;
  rulesetSaving.value = true;
  rulesetError.value = null;
  try {
    const updated = asRecord(await updateGitHubRepoRuleset(props.repoFullName, id, payload as never));
    rulesetRaw.value = Object.keys(updated).length ? updated : rulesetRaw.value;
    const baselineRaw = rulesetRaw.value ?? {};
    rulesetBaseline.value = JSON.stringify(buildRulesetPayload(baselineRaw, rulesetDraft.value!));
    await load(true);
  } catch (err) {
    if (isPermissionError(err)) rulesetWriteDenied.value = true;
    rulesetError.value = accessErrorMessage(err, "保存规则集");
  } finally {
    rulesetSaving.value = false;
  }
}

function branchProtectionDraftFromRaw(raw: Record<string, unknown>): BranchProtectionDraft {
  const reviews = asRecord(raw.required_pull_request_reviews);
  const checks = asRecord(raw.required_status_checks);
  const checkContexts = Array.isArray(checks.checks)
    ? checks.checks.map((entry) => String(asRecord(entry).context ?? "")).filter(Boolean)
    : [];
  const contexts = Array.isArray(checks.contexts)
    ? checks.contexts.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    requirePullRequest: Object.keys(reviews).length > 0,
    requiredApprovals: Math.max(0, Math.min(6, Number(reviews.required_approving_review_count ?? 0))),
    requireCodeOwners: enabledValue(reviews.require_code_owner_reviews),
    dismissStaleReviews: enabledValue(reviews.dismiss_stale_reviews),
    requireLastPushApproval: enabledValue(reviews.require_last_push_approval),
    requireStatusChecks: Object.keys(checks).length > 0,
    strictStatusChecks: enabledValue(checks.strict),
    statusContexts: [...new Set([...contexts, ...checkContexts])].join("\n"),
    enforceAdmins: enabledValue(raw.enforce_admins),
    requireLinearHistory: enabledValue(raw.required_linear_history),
    requireConversationResolution: enabledValue(raw.required_conversation_resolution),
    allowForcePushes: enabledValue(raw.allow_force_pushes),
    allowDeletions: enabledValue(raw.allow_deletions),
  };
}

function rulesetDraftFromRaw(raw: Record<string, unknown>): RulesetDraft {
  const refName = asRecord(asRecord(raw.conditions).ref_name);
  return {
    name: String(raw.name ?? ""),
    enforcement: String(raw.enforcement ?? "active"),
    include: editableListText(refName.include),
    exclude: editableListText(refName.exclude),
  };
}

function buildBranchProtectionPayload(raw: Record<string, unknown> | null, draft: BranchProtectionDraft) {
  const source = raw ?? {};
  const currentReviews = asRecord(source.required_pull_request_reviews);
  const currentChecks = asRecord(source.required_status_checks);
  const payload: Record<string, unknown> = {
    required_status_checks: draft.requireStatusChecks ? {
      strict: draft.strictStatusChecks,
      contexts: parseEditableList(draft.statusContexts),
      ...(Array.isArray(currentChecks.checks) ? { checks: currentChecks.checks } : {}),
    } : null,
    enforce_admins: draft.enforceAdmins,
    required_pull_request_reviews: draft.requirePullRequest ? {
      dismiss_stale_reviews: draft.dismissStaleReviews,
      require_code_owner_reviews: draft.requireCodeOwners,
      required_approving_review_count: Math.max(0, Math.min(6, Number(draft.requiredApprovals) || 0)),
      require_last_push_approval: draft.requireLastPushApproval,
      ...normalizedRestrictionField(currentReviews, "dismissal_restrictions"),
      ...normalizedRestrictionField(currentReviews, "bypass_pull_request_allowances"),
    } : null,
    restrictions: normalizeActorRestrictions(source.restrictions),
    required_linear_history: draft.requireLinearHistory,
    allow_force_pushes: draft.allowForcePushes,
    allow_deletions: draft.allowDeletions,
    required_conversation_resolution: draft.requireConversationResolution,
  };
  for (const key of ["block_creations", "lock_branch", "allow_fork_syncing"] as const) {
    if (key in source) payload[key] = enabledValue(source[key]);
  }
  return payload;
}

function buildRulesetPayload(raw: Record<string, unknown>, draft: RulesetDraft) {
  const conditions = asRecord(raw.conditions);
  const refName = asRecord(conditions.ref_name);
  return {
    name: draft.name.trim(),
    target: String(raw.target ?? "branch"),
    enforcement: draft.enforcement,
    ...(Array.isArray(raw.bypass_actors) ? { bypass_actors: raw.bypass_actors } : {}),
    conditions: {
      ...conditions,
      ref_name: {
        ...refName,
        include: parseEditableList(draft.include),
        exclude: parseEditableList(draft.exclude),
      },
    },
    rules: Array.isArray(raw.rules) ? raw.rules : [],
  };
}

function normalizedRestrictionField(source: Record<string, unknown>, key: string) {
  if (!(key in source)) return {};
  return { [key]: normalizeActorRestrictions(source[key]) ?? { users: [], teams: [], apps: [] } };
}

function normalizeActorRestrictions(value: unknown) {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  return {
    users: actorNames(record.users, "login"),
    teams: actorNames(record.teams, "slug"),
    apps: actorNames(record.apps, "slug"),
  };
}

function actorNames(value: unknown, field: string) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    return String(asRecord(entry)[field] ?? asRecord(entry).name ?? "");
  }).filter(Boolean);
}

function isPermissionError(error: unknown) {
  return /HTTP 403|forbidden|permission|权限/i.test(String(error));
}

function isNotFoundError(error: unknown) {
  return /HTTP 404|not found|不存在/i.test(String(error));
}

function accessErrorMessage(error: unknown, action: string) {
  if (isPermissionError(error)) return `${action}失败：当前凭据权限不足。`;
  if (isNotFoundError(error)) return `${action}失败：GitHub 未返回对应配置。`;
  return String(error).replace(/^Error:\s*/, "");
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
        <span v-if="(primarySection || (kind === 'rules' && rulesetsLoaded)) && !loading">已读取最新状态</span>
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
          :class="{ 'is-selected': selectedBranch === branch.name }"
        >
          <span class="repo-settings-row-actions">
            <button
              type="button"
              class="ghost repo-settings-text-action"
              :data-agent-id="`repo.settings.branches.${branch.name}.open-protection`"
              :disabled="branchProtectionSaving || disabled"
              @click="selectBranch(branch.name)"
            >
              {{ selectedBranch === branch.name ? "已选择" : "配置" }}
            </button>
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
          </span>
        </SettingsRow>
      </div>
      <div v-if="selectedBranch" class="repo-settings-editor" data-agent-id="repo.settings.branches.protection-editor">
        <div class="repo-settings-editor__head">
          <div>
            <strong>{{ selectedBranch }}</strong>
            <span>{{ branchProtectionStatus }}</span>
          </div>
          <button
            v-if="branchProtectionDirty && !branchProtectionReadOnlyReason"
            type="button"
            class="primary project-icon-action project-icon-action--primary"
            data-agent-id="repo.settings.branches.protection.save"
            :disabled="branchProtectionSaving || branchProtectionLoading || disabled"
            aria-label="保存分支保护"
            title="保存分支保护"
            @click="saveBranchProtection"
          >
            <LoaderCircle v-if="branchProtectionSaving" :size="14" class="sb-spin" aria-hidden="true" />
            <Save v-else :size="14" aria-hidden="true" />
          </button>
        </div>
        <p v-if="branchProtectionReadOnlyReason" class="repo-settings-readonly-notice">{{ branchProtectionReadOnlyReason }}</p>
        <p v-if="branchProtectionNotice" class="repo-settings-readonly-notice">{{ branchProtectionNotice }}</p>
        <p v-if="branchProtectionError" class="repo-settings-detail-section__error">
          <AlertCircle :size="14" aria-hidden="true" />
          <span>{{ branchProtectionError }}</span>
        </p>
        <p v-if="branchProtectionLoading" class="muted repo-empty project-empty">正在读取分支保护。</p>
        <div v-else-if="branchProtectionDraft" class="repo-settings-display-list">
          <SettingsRow class="project-settings-switch" label="Pull Request 审批" hint="合并前必须通过 Pull Request。">
            <UiSwitch
              v-model="branchProtectionDraft.requirePullRequest"
              aria-label="Pull Request 审批"
              agent-id="repo.settings.branches.protection.pull-request"
              :disabled="Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled"
            />
          </SettingsRow>
          <SettingsRow class="project-settings-field" label="所需审批数">
            <input
              v-model.number="branchProtectionDraft.requiredApprovals"
              class="repo-settings-number-input"
              type="number"
              min="0"
              max="6"
              data-agent-id="repo.settings.branches.protection.approvals"
              :disabled="!branchProtectionDraft.requirePullRequest || Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled"
            />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="需要 Code Owner 审批">
            <UiSwitch v-model="branchProtectionDraft.requireCodeOwners" aria-label="需要 Code Owner 审批" agent-id="repo.settings.branches.protection.code-owners" :disabled="!branchProtectionDraft.requirePullRequest || Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled" />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="新提交使旧审批失效">
            <UiSwitch v-model="branchProtectionDraft.dismissStaleReviews" aria-label="新提交使旧审批失效" agent-id="repo.settings.branches.protection.dismiss-stale" :disabled="!branchProtectionDraft.requirePullRequest || Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled" />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="最后推送者之外的审批">
            <UiSwitch v-model="branchProtectionDraft.requireLastPushApproval" aria-label="最后推送者之外的审批" agent-id="repo.settings.branches.protection.last-push" :disabled="!branchProtectionDraft.requirePullRequest || Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled" />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="状态检查" hint="合并前要求指定检查通过。">
            <UiSwitch
              v-model="branchProtectionDraft.requireStatusChecks"
              aria-label="状态检查"
              agent-id="repo.settings.branches.protection.status-checks"
              :disabled="Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled"
            />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="要求分支保持最新">
            <UiSwitch
              v-model="branchProtectionDraft.strictStatusChecks"
              aria-label="要求分支保持最新"
              agent-id="repo.settings.branches.protection.strict-status-checks"
              :disabled="!branchProtectionDraft.requireStatusChecks || Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled"
            />
          </SettingsRow>
          <label class="repo-settings-editor__field">
            <span>状态检查名称</span>
            <textarea
              v-model="branchProtectionDraft.statusContexts"
              rows="3"
              placeholder="每行一个检查名称"
              data-agent-id="repo.settings.branches.protection.contexts"
              :disabled="!branchProtectionDraft.requireStatusChecks || Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled"
            />
          </label>
          <SettingsRow class="project-settings-switch" label="同时约束管理员">
            <UiSwitch v-model="branchProtectionDraft.enforceAdmins" aria-label="同时约束管理员" agent-id="repo.settings.branches.protection.enforce-admins" :disabled="Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled" />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="需要线性提交历史">
            <UiSwitch v-model="branchProtectionDraft.requireLinearHistory" aria-label="需要线性提交历史" agent-id="repo.settings.branches.protection.linear-history" :disabled="Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled" />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="需要解决所有对话">
            <UiSwitch v-model="branchProtectionDraft.requireConversationResolution" aria-label="需要解决所有对话" agent-id="repo.settings.branches.protection.conversation-resolution" :disabled="Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled" />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="允许强制推送">
            <UiSwitch v-model="branchProtectionDraft.allowForcePushes" aria-label="允许强制推送" agent-id="repo.settings.branches.protection.force-pushes" :disabled="Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled" />
          </SettingsRow>
          <SettingsRow class="project-settings-switch" label="允许删除分支">
            <UiSwitch v-model="branchProtectionDraft.allowDeletions" aria-label="允许删除分支" agent-id="repo.settings.branches.protection.deletions" :disabled="Boolean(branchProtectionReadOnlyReason) || branchProtectionSaving || disabled" />
          </SettingsRow>
        </div>
      </div>
    </div>

    <div v-else-if="kind === 'rules' && rulesetsLoaded" class="repo-settings-detail-section__body">
      <p v-if="!rulesetRows.length" class="muted repo-empty project-empty">没有仓库规则集。</p>
      <div v-else class="repo-settings-table" role="table" aria-label="仓库规则集">
        <SettingsRow
          v-for="ruleset in rulesetRows"
          :key="String(ruleset.id)"
          class="repo-settings-table__row"
          :class="{ 'is-selected': selectedRulesetId === Number(ruleset.id) }"
          :label="String(ruleset.name ?? '未命名规则集')"
          :hint="ruleset.repositoryOwned ? `${ruleset.target} · ${ruleset.enforcement}` : `${ruleset.target} · 继承自 ${ruleset.source}`"
          role="row"
        >
          <button
            type="button"
            class="ghost repo-settings-text-action"
            :data-agent-id="`repo.settings.rules.${String(ruleset.id)}.open`"
            :disabled="rulesetSaving || disabled"
            @click="selectRuleset(Number(ruleset.id))"
          >
            {{ selectedRulesetId === Number(ruleset.id) ? "已选择" : "配置" }}
          </button>
        </SettingsRow>
      </div>
      <div v-if="selectedRulesetId !== null" class="repo-settings-editor" data-agent-id="repo.settings.rules.editor">
        <div class="repo-settings-editor__head">
          <div>
            <strong>{{ rulesetDraft?.name || `规则集 ${selectedRulesetId}` }}</strong>
            <span>{{ String(rulesetRaw?.target ?? "branch") }}</span>
          </div>
          <button
            v-if="rulesetDirty && !rulesetReadOnlyReason"
            type="button"
            class="primary project-icon-action project-icon-action--primary"
            data-agent-id="repo.settings.rules.save"
            :disabled="rulesetSaving || rulesetLoading || !rulesetDraft?.name.trim() || disabled"
            aria-label="保存规则集"
            title="保存规则集"
            @click="saveRuleset"
          >
            <LoaderCircle v-if="rulesetSaving" :size="14" class="sb-spin" aria-hidden="true" />
            <Save v-else :size="14" aria-hidden="true" />
          </button>
        </div>
        <p v-if="rulesetReadOnlyReason" class="repo-settings-readonly-notice">{{ rulesetReadOnlyReason }}</p>
        <p v-if="rulesetError" class="repo-settings-detail-section__error">
          <AlertCircle :size="14" aria-hidden="true" />
          <span>{{ rulesetError }}</span>
        </p>
        <p v-if="rulesetLoading" class="muted repo-empty project-empty">正在读取规则集。</p>
        <div v-else-if="rulesetDraft" class="repo-settings-editor__fields">
          <label class="repo-settings-editor__field">
            <span>名称</span>
            <input
              v-model="rulesetDraft.name"
              type="text"
              data-agent-id="repo.settings.rules.name"
              :disabled="Boolean(rulesetReadOnlyReason) || rulesetSaving || disabled"
            />
          </label>
          <SettingsRow class="project-settings-field" label="执行状态">
            <span class="project-settings-field__control">
              <Dropdown
                v-model="rulesetDraft.enforcement"
                :options="enforcementOptions"
                block
                size="large"
                placement="bottom"
                agent-id="repo.settings.rules.enforcement"
                menu-label="执行状态"
                :disabled="Boolean(rulesetReadOnlyReason) || rulesetSaving || disabled"
              />
            </span>
          </SettingsRow>
          <label class="repo-settings-editor__field">
            <span>包含的引用</span>
            <textarea
              v-model="rulesetDraft.include"
              rows="3"
              placeholder="每行一个引用模式"
              data-agent-id="repo.settings.rules.include"
              :disabled="Boolean(rulesetReadOnlyReason) || rulesetSaving || disabled"
            />
          </label>
          <label class="repo-settings-editor__field">
            <span>排除的引用</span>
            <textarea
              v-model="rulesetDraft.exclude"
              rows="3"
              placeholder="每行一个引用模式"
              data-agent-id="repo.settings.rules.exclude"
              :disabled="Boolean(rulesetReadOnlyReason) || rulesetSaving || disabled"
            />
          </label>
          <SettingsRow class="repo-settings-display-row" label="规则">
            <span class="settings-row__status-text">{{ Array.isArray(rulesetRaw?.rules) ? rulesetRaw.rules.length : 0 }} 条，保存时保持不变</span>
          </SettingsRow>
        </div>
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

.repo-settings-table__row.is-selected {
  background: var(--bg-active);
}

.repo-settings-row-actions,
.repo-settings-editor__head,
.repo-settings-editor__head > div {
  display: flex;
  align-items: center;
}

.repo-settings-row-actions {
  gap: 6px;
}

.repo-settings-text-action {
  min-height: 28px;
  padding: 0 8px;
  font-size: 12px;
}

.repo-settings-editor {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.repo-settings-editor__head {
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
}

.repo-settings-editor__head > div {
  min-width: 0;
  gap: 8px;
}

.repo-settings-editor__head strong {
  overflow-wrap: anywhere;
  font-size: 13px;
}

.repo-settings-editor__head span {
  color: var(--text-muted);
  font-size: 12px;
}

.repo-settings-editor__fields {
  display: grid;
  gap: 8px;
}

.repo-settings-editor__field {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-settings-editor__field input,
.repo-settings-editor__field textarea,
.repo-settings-number-input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}

.repo-settings-editor__field input,
.repo-settings-number-input {
  min-height: 32px;
}

.repo-settings-editor__field textarea {
  min-height: 72px;
  padding: 8px 10px;
  resize: vertical;
}

.repo-settings-number-input {
  width: 72px;
}

.repo-settings-readonly-notice {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
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
