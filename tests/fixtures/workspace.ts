import type { RepoConflictState, RepoDetail, RepoSummary, WorkspaceSettings } from "../../src/services/workspace";

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

export function workspaceSettings(hiddenRepoIds: string[] = []): WorkspaceSettings {
  return {
    workspaceRoot: "C:\\Files\\workspace",
    githubBinding: null,
    projectLaunchConfigs: {},
    hiddenRepoIds,
  };
}
