import type {
  RepoRemoteSyncPolicy,
  RepoSyncPreference,
  WorkspaceSettings,
} from "../services/workspace/types";

export type RepoSettingKey = keyof RepoSyncPreference;

export const REPO_SETTINGS_MANIFEST = {
  autoSync: {
    key: "autoSync",
    label: "自动同步",
    description: "刷新发现待同步提交时自动处理。",
    defaultValue: false,
  },
  includeInHomeCodeStats: {
    key: "includeInHomeCodeStats",
    label: "计入主页代码统计",
    description: "参与主页语言与项目代码占比。",
    defaultValue: true,
  },
  includeInHomeContributionStats: {
    key: "includeInHomeContributionStats",
    label: "计入主页贡献统计",
    description: "参与主页贡献热力图计算。",
    defaultValue: true,
  },
  calculateHomeTimeline: {
    key: "calculateHomeTimeline",
    label: "计算主页时间线",
    description: "参与主页 GitHub 时间线加载。",
    defaultValue: true,
  },
} as const satisfies Record<
  RepoSettingKey,
  {
    key: RepoSettingKey;
    label: string;
    description: string;
    defaultValue: boolean;
  }
>;

export const REPO_SETTING_ITEMS = Object.values(REPO_SETTINGS_MANIFEST);

export function repoSettingValue(
  settings: Pick<WorkspaceSettings, "repoSyncPreferences"> | null | undefined,
  repoId: string,
  key: RepoSettingKey,
) {
  const normalizedRepoId = repoId.trim();
  return normalizedRepoId
    ? settings?.repoSyncPreferences?.[normalizedRepoId]?.[key] ?? REPO_SETTINGS_MANIFEST[key].defaultValue
    : REPO_SETTINGS_MANIFEST[key].defaultValue;
}

export function repoAutoSyncEnabled(
  settings: Pick<WorkspaceSettings, "repoSyncPreferences"> | null | undefined,
  repoId: string,
) {
  return repoSettingValue(settings, repoId, "autoSync");
}

export function repoIncludedInHomeCodeStats(
  settings: Pick<WorkspaceSettings, "repoSyncPreferences"> | null | undefined,
  repoId: string,
) {
  return repoSettingValue(settings, repoId, "includeInHomeCodeStats");
}

export function repoIncludedInHomeContributionStats(
  settings: Pick<WorkspaceSettings, "repoSyncPreferences"> | null | undefined,
  repoId: string,
) {
  return repoSettingValue(settings, repoId, "includeInHomeContributionStats");
}

export function repoCalculatesHomeTimeline(
  settings: Pick<WorkspaceSettings, "repoSyncPreferences"> | null | undefined,
  repoId: string,
) {
  return repoSettingValue(settings, repoId, "calculateHomeTimeline");
}

export function withRepoSettingPreference(
  preferences: WorkspaceSettings["repoSyncPreferences"] | undefined,
  repoId: string,
  key: RepoSettingKey,
  value: boolean,
) {
  const normalizedRepoId = repoId.trim();
  const nextPreferences = cloneRepoSyncPreferences(preferences);
  if (!normalizedRepoId) return nextPreferences;

  const current = nextPreferences[normalizedRepoId] ?? {};
  const nextPreference = { ...current, [key]: value } satisfies RepoSyncPreference;
  if (value === REPO_SETTINGS_MANIFEST[key].defaultValue) delete nextPreference[key];

  if (Object.keys(nextPreference).length) nextPreferences[normalizedRepoId] = nextPreference;
  else delete nextPreferences[normalizedRepoId];
  return nextPreferences;
}

export function withRepoAutoSyncPreference(
  preferences: WorkspaceSettings["repoSyncPreferences"] | undefined,
  repoId: string,
  autoSync: boolean,
) {
  return withRepoSettingPreference(preferences, repoId, "autoSync", autoSync);
}

export function withRepoRemoteSyncPolicy(
  policies: WorkspaceSettings["repoRemoteSyncPolicies"] | undefined,
  repoId: string,
  policy: RepoRemoteSyncPolicy,
) {
  const normalizedRepoId = repoId.trim();
  const nextPolicies = Object.fromEntries(
    Object.entries(policies ?? {}).map(([id, current]) => [id, cloneRepoRemoteSyncPolicy(current)]),
  );
  if (normalizedRepoId) nextPolicies[normalizedRepoId] = cloneRepoRemoteSyncPolicy(policy);
  return nextPolicies;
}

export function cloneRepoRemoteSyncPolicy(policy: RepoRemoteSyncPolicy): RepoRemoteSyncPolicy {
  return {
    primaryRemote: policy.primaryRemote,
    pullRemotes: [...policy.pullRemotes],
    pushRemotes: [...policy.pushRemotes],
  };
}

function cloneRepoSyncPreferences(preferences: WorkspaceSettings["repoSyncPreferences"] | undefined) {
  return Object.fromEntries(
    Object.entries(preferences ?? {}).map(([repoId, preference]) => [repoId, { ...preference }]),
  );
}
