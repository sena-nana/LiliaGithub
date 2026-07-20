import type {
  RepoCommitResult,
  RepoConflictState,
  RepoDetail,
  RepoDetailPatch,
  RepoSummary,
  RepoSyncOperationResult,
  WorkspaceBootstrap,
  WorkspaceSettings,
  WorkspaceStartupCache,
} from "../../src/services/workspace";

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
    remoteBranchStates: [],
    remotesNeedingPull: 0,
    remotesNeedingPush: 0,
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

export function repoSyncResult(
  summary: RepoSummary,
  overrides: Partial<Omit<RepoSyncOperationResult, "summary">> = {},
): RepoSyncOperationResult {
  return {
    status: "success",
    message: "完成",
    summary,
    conflicts: conflictState(),
    steps: [],
    ...overrides,
  };
}

export function repoCommitResult(summary: RepoSummary, pushResult: RepoSyncOperationResult | null = null): RepoCommitResult {
  return { summary, pushResult };
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
  const root = {
    id: "root-default",
    path: "C:\\Files\\workspace",
    available: true,
    unavailableReason: null,
  };
  const settings: WorkspaceSettings = {
    workspaceRoot: "C:\\Files\\workspace",
    githubBinding: null,
    accountPreferences: {
      repositoryScope: { kind: "all" },
      repositorySort: { key: "updated", direction: "desc" },
      issues: { state: "open", sort: "created", direction: "desc" },
      pullRequests: { state: "open", sort: "updated", direction: "desc" },
      actions: { state: "all", sort: "updated", direction: "desc" },
    },
    projectLaunchConfigs: {},
    repoSyncPreferences: {},
    repoRemoteSyncPolicies: {},
    hiddenRepoIds,
    managedRepoIds: [],
    systemGitRepoIds: [],
    repoBindings: {},
    favoriteRepoIds: [],
    repoGroups: [],
    organizationGroupingResolvedRepoIds: [],
    remoteRepoShortcuts: [],
    recentLocalRepos: [],
    localContributionCache: {},
    contributionIdentities: [],
    workspaceCatalog: [{
      id: "workspace-default",
      name: "workspace",
      roots: [root],
      primaryRootId: root.id,
    }],
    activeWorkspaceId: "workspace-default",
    activeWorkspace: {
      id: "workspace-default",
      name: "workspace",
      recentContext: null,
      roots: [root],
      primaryRootId: root.id,
      projectLaunchConfigs: {},
      repoSyncPreferences: {},
      repoRemoteSyncPolicies: {},
      hiddenRepoIds,
      managedRepoIds: [],
      systemGitRepoIds: [],
      repoBindings: {},
      favoriteRepoIds: [],
      repoGroups: [],
      organizationGroupingResolvedRepoIds: [],
      remoteRepoShortcuts: [],
      recentLocalRepos: [],
      localContributionCache: {},
      contributionIdentities: [],
      viewPreferences: {
        sidebarRepositorySort: "updated:desc",
        collapsedGroupIds: [],
        homeRepositoryStatusSort: "updated:desc",
      },
    },
  };
  return settings;
}

export function workspaceBootstrap(
  settings: WorkspaceSettings = workspaceSettings(),
  startupCache: WorkspaceStartupCache | null = null,
  contextRevision = 1,
): WorkspaceBootstrap {
  return { settings, startupCache, contextRevision };
}
