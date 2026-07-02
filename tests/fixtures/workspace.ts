import type { RepoConflictState, RepoDetail, RepoDetailPatch, RepoSummary, WorkspaceSettings } from "../../src/services/workspace";

export function repoSummary(id: string, overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id,
    name: id,
    path: `C:\\Files\\workspace\\${id}`,
    relativePath: id,
    currentBranch: "main",
    remoteUrl: `https://github.com/sena-nana/${id}.git`,
    githubFullName: `sena-nana/${id}`,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: null,
    lastCommitMessage: null,
    languageStats: [],
    languageStatsUpdatedAt: 0,
    worktree: {
      role: "standalone",
      sharedRepoKey: `repo:${id}`,
      mainRepoId: null,
    },
    ...overrides,
  };
}

export function conflictState(overrides: Partial<RepoConflictState> = {}): RepoConflictState {
  return {
    operation: "none",
    files: [],
    allResolved: true,
    ...overrides,
  };
}

export function repoDetail(summary: RepoSummary, overrides: Partial<Omit<RepoDetail, "summary">> = {}): RepoDetail {
  return {
    summary,
    changes: [],
    commits: [],
    branches: [],
    conflicts: conflictState(),
    ...overrides,
  };
}

export function repoDetailPatch(
  summary: RepoSummary,
  overrides: Partial<Omit<RepoDetailPatch, "summary">> = {},
): RepoDetailPatch {
  const detail = repoDetail(summary);
  return {
    summary,
    changes: detail.changes,
    conflicts: detail.conflicts,
    commits: null,
    branches: null,
    ...overrides,
  };
}

export function workspaceSettings(hiddenRepoIds: string[] = []): WorkspaceSettings {
  return {
    workspaceRoot: "C:\\Files\\workspace",
    githubBinding: null,
    projectLaunchConfigs: {},
    repoSyncPreferences: {},
    hiddenRepoIds,
    managedRepoIds: [],
    systemGitRepoIds: [],
    repoGroups: [],
    remoteRepoShortcuts: [],
    localContributionCache: {},
    contributionIdentities: [],
  };
}
