import type { RepoSyncPreference, WorkspaceSettings } from "../services/workspace/types";

const AUTO_SYNC_DEFAULT = false;

export const REPO_SETTINGS_MANIFEST = {
  autoSync: {
    key: "autoSync",
    label: "自动同步",
    description: "刷新发现待同步提交时自动处理。",
    defaultValue: AUTO_SYNC_DEFAULT,
  },
} as const satisfies Record<
  keyof RepoSyncPreference,
  {
    key: keyof RepoSyncPreference;
    label: string;
    description: string;
    defaultValue: boolean;
  }
>;

export function repoAutoSyncEnabled(
  settings: Pick<WorkspaceSettings, "repoSyncPreferences"> | null | undefined,
  repoId: string,
) {
  const normalizedRepoId = repoId.trim();
  return normalizedRepoId
    ? settings?.repoSyncPreferences?.[normalizedRepoId]?.autoSync ?? AUTO_SYNC_DEFAULT
    : AUTO_SYNC_DEFAULT;
}

export function withRepoAutoSyncPreference(
  preferences: WorkspaceSettings["repoSyncPreferences"] | undefined,
  repoId: string,
  autoSync: boolean,
) {
  const normalizedRepoId = repoId.trim();
  if (!normalizedRepoId) return { ...(preferences ?? {}) };
  const nextPreferences = { ...(preferences ?? {}) };
  if (autoSync === AUTO_SYNC_DEFAULT) delete nextPreferences[normalizedRepoId];
  else nextPreferences[normalizedRepoId] = { autoSync } satisfies RepoSyncPreference;
  return nextPreferences;
}
