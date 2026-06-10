import type { RepoSummary } from "../services/workspace";

type RepoIdentity = Pick<RepoSummary, "name" | "path" | "githubFullName">;

export function repoDisplayName(repo: RepoIdentity | null | undefined) {
  const githubFullName = repo?.githubFullName?.trim();
  if (githubFullName) {
    const parts = githubFullName.split("/").filter(Boolean);
    const repoName = parts[parts.length - 1];
    if (repoName) return repoName;
  }
  return repo?.name ?? "仓库";
}

export function repoDisplayTitle(repo: RepoIdentity) {
  return [repo.githubFullName, repo.path].filter(Boolean).join(" · ") || repo.name;
}
