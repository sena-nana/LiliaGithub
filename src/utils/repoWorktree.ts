import type { RepoSummary, RepoWorktreeRole } from "../services/workspace";
import { githubRepositoryIdentityKey } from "./remoteRepo";

const REPRESENTATIVE_ROLE_PRIORITY: Record<RepoWorktreeRole, number> = {
  main: 0,
  standalone: 1,
  linked: 2,
};

export function isLinkedWorktree(repo: Pick<RepoSummary, "worktree"> | null | undefined) {
  return repo?.worktree.role === "linked";
}

function sharedRepoGroupKey(repo: Pick<RepoSummary, "id" | "worktree">) {
  return repo.worktree.sharedRepoKey || repo.id;
}

function compareRepoRepresentative(
  left: Pick<RepoSummary, "id" | "path" | "relativePath" | "worktree">,
  right: Pick<RepoSummary, "id" | "path" | "relativePath" | "worktree">,
) {
  return REPRESENTATIVE_ROLE_PRIORITY[left.worktree.role] - REPRESENTATIVE_ROLE_PRIORITY[right.worktree.role]
    || left.relativePath.length - right.relativePath.length
    || left.path.length - right.path.length
    || left.id.localeCompare(right.id);
}

export function representativeReposBySharedGroup<T extends RepoSummary>(repos: readonly T[]) {
  const grouped = new Map<string, T>();
  for (const repo of repos) {
    const key = sharedRepoGroupKey(repo);
    const current = grouped.get(key);
    if (!current || compareRepoRepresentative(repo, current) < 0) {
      grouped.set(key, repo);
    }
  }
  return [...grouped.values()];
}

export function representativeReposByGitHubFullName<T extends RepoSummary>(repos: readonly T[]) {
  const grouped = new Map<string, T>();
  for (const repo of representativeReposBySharedGroup(repos)) {
    const fullName = repo.githubFullName?.trim();
    if (!fullName) continue;
    const key = githubRepositoryIdentityKey(fullName);
    const current = grouped.get(key);
    if (!current || compareRepoRepresentative(repo, current) < 0) {
      grouped.set(key, repo);
    }
  }
  return grouped;
}
