import type { RepoSummary } from "../services/workspace";
import { parseRemoteRepoId } from "./remoteRepo";

export type RepoSourceTag =
  | "local"
  | "managed"
  | "github"
  | "github-authorized"
  | "github-anonymous"
  | "github-remote"
  | "system-git"
  | "linked-worktree";

export type RepoCapabilityProvider = "local" | "github" | "local-first" | "unavailable";

export interface RepoCapability {
  available: boolean;
  provider: RepoCapabilityProvider;
  reason?: string;
}

export type RepoCapabilityKey =
  | "readme"
  | "history"
  | "branchBrowse"
  | "changes"
  | "commit"
  | "branch"
  | "stash"
  | "launch"
  | "open"
  | "deleteLocal"
  | "issues"
  | "pulls"
  | "actions"
  | "settings"
  | "deleteRemote";

export type RepoCapabilities = Record<RepoCapabilityKey, RepoCapability>;

export interface RepoContext {
  repoId: string;
  tags: readonly RepoSourceTag[];
  localRepoId?: string;
  githubFullName?: string;
  localPath?: string;
  preferredProvider: "local" | "github" | "none";
  capabilities: RepoCapabilities;
}

export interface ResolveRepoContextInput {
  repoId: string;
  repoSummary?: Pick<RepoSummary, "id" | "path" | "githubFullName" | "worktree"> | null;
  githubFullName?: string | null;
  localPath?: string | null;
  settings?: {
    readonly managedRepoIds: readonly string[];
    readonly systemGitRepoIds: readonly string[];
  } | null;
  githubAuthorized?: boolean;
}

const LOCAL_ONLY_REASON = "仅支持本地仓库。";
const STASH_LOCAL_ONLY_REASON = "stash 仅支持本地仓库。";
const GITHUB_MISSING_REASON = "当前仓库没有 GitHub 远端，Issues、Actions 和 Settings 不可用。";
const GITHUB_AUTH_REASON = "GitHub 未授权或凭据不可用，请重新绑定 GitHub 后继续使用。";
const SYSTEM_GIT_REASON = "系统 Git 下暂不获取 GitHub 权限内容。";

export function resolveRepoContext(input: ResolveRepoContextInput): RepoContext {
  const remoteFullName = parseRemoteRepoId(input.repoId);
  const isRemoteRepo = Boolean(remoteFullName);
  const summary = input.repoSummary ?? null;
  const hasLocal = !isRemoteRepo;
  const githubFullName = remoteFullName ?? input.githubFullName?.trim() ?? summary?.githubFullName?.trim() ?? "";
  const hasGithub = Boolean(githubFullName);
  const usesSystemGit = hasLocal && (input.settings?.systemGitRepoIds ?? []).includes(input.repoId);
  const githubAuthorized = hasGithub && input.githubAuthorized === true;
  const tags = new Set<RepoSourceTag>();

  if (hasLocal) tags.add("local");
  if (hasLocal && (input.settings?.managedRepoIds ?? []).includes(input.repoId)) tags.add("managed");
  if (hasLocal && summary?.worktree.role === "linked") tags.add("linked-worktree");
  if (usesSystemGit) tags.add("system-git");
  if (hasGithub) {
    tags.add("github");
    tags.add(githubAuthorized ? "github-authorized" : "github-anonymous");
  }
  if (isRemoteRepo) tags.add("github-remote");

  const local = (reason = LOCAL_ONLY_REASON): RepoCapability =>
    hasLocal ? available("local") : unavailable(reason);
  const github = (): RepoCapability => githubCapability(hasGithub, githubAuthorized, usesSystemGit);
  const localFirst = (): RepoCapability => {
    if (hasLocal) return available("local-first");
    return github();
  };

  return {
    repoId: input.repoId,
    tags: [...tags],
    localRepoId: hasLocal ? input.repoId : undefined,
    githubFullName: hasGithub ? githubFullName : undefined,
    localPath: hasLocal ? input.localPath ?? summary?.path : undefined,
    preferredProvider: hasLocal ? "local" : hasGithub ? "github" : "none",
    capabilities: {
      readme: localFirst(),
      history: localFirst(),
      branchBrowse: localFirst(),
      changes: local(),
      commit: local(),
      branch: local(),
      stash: local(STASH_LOCAL_ONLY_REASON),
      launch: local(),
      open: local(),
      deleteLocal: local(),
      issues: github(),
      pulls: github(),
      actions: github(),
      settings: github(),
      deleteRemote: github(),
    },
  };
}

export function hasRepoTag(context: Pick<RepoContext, "tags">, tag: RepoSourceTag) {
  return context.tags.includes(tag);
}

function available(provider: Exclude<RepoCapabilityProvider, "unavailable">): RepoCapability {
  return { available: true, provider };
}

function unavailable(reason: string): RepoCapability {
  return { available: false, provider: "unavailable", reason };
}

function githubCapability(hasGithub: boolean, githubAuthorized: boolean, usesSystemGit: boolean): RepoCapability {
  if (!hasGithub) return unavailable(GITHUB_MISSING_REASON);
  if (usesSystemGit) return unavailable(SYSTEM_GIT_REASON);
  if (!githubAuthorized) return unavailable(GITHUB_AUTH_REASON);
  return available("github");
}
