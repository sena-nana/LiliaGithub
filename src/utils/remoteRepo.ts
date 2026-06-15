import type { GitHubRepoSummary, RemoteRepoShortcut } from "../services/workspace";

const REMOTE_REPO_ID_PREFIX = "github:";

export function remoteRepoId(fullName: string) {
  return `${REMOTE_REPO_ID_PREFIX}${normalizeRemoteRepoFullName(fullName)}`;
}

export function parseRemoteRepoId(repoId: string): string | null {
  if (!repoId.startsWith(REMOTE_REPO_ID_PREFIX)) return null;
  const fullName = normalizeRemoteRepoFullName(repoId.slice(REMOTE_REPO_ID_PREFIX.length));
  return isRemoteRepoFullName(fullName) ? fullName : null;
}

export function remoteRepoRoute(fullName: string) {
  return `/repos/${encodeURIComponent(remoteRepoId(fullName))}?view=project`;
}

export function normalizeRemoteRepoFullName(fullName: string) {
  return fullName.trim().replace(/^\/+|\/+$/g, "");
}

export function isRemoteRepoFullName(fullName: string) {
  const parts = normalizeRemoteRepoFullName(fullName).split("/").filter(Boolean);
  return parts.length === 2;
}

export function remoteRepoName(fullName: string) {
  const parts = normalizeRemoteRepoFullName(fullName).split("/").filter(Boolean);
  return parts[parts.length - 1] || fullName;
}

export function shortcutFromGitHubRepo(repo: GitHubRepoSummary): RemoteRepoShortcut {
  return {
    fullName: normalizeRemoteRepoFullName(repo.fullName),
    name: repo.name || remoteRepoName(repo.fullName),
    private: repo.private,
    archived: repo.archived,
    defaultBranch: repo.defaultBranch,
    htmlUrl: repo.htmlUrl,
    cloneUrl: repo.cloneUrl,
    openedAt: Date.now(),
  };
}
