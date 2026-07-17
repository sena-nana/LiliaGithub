import type {
  GitHubAccountIssueItem,
  GitHubActionNotification,
  GitHubBindingStatus,
  GitHubIssue,
  GitHubIssueDiscussion,
  GitHubIssueFilterMetadata,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDiscussion,
  GitHubRelease,
  GitHubRepoManagement,
  GitHubRepoPage,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
  GitHubRepositoryScope,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowJobLog,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  CommitDetail,
  CommitSummary,
  RepoFilePreview,
  RepoFileTreeEntry,
} from "./types";

export type GitHubProjectFetchOptions = {
  forceRefresh?: boolean;
};

type GitHubProjectRepoClientCache = {
  management?: GitHubRepoManagement;
  files: Record<string, RepoFileTreeEntry[] | undefined>;
  filePreviews: Record<string, RepoFilePreview | undefined>;
  commits: Record<string, CommitSummary[] | undefined>;
  commitDetails: Record<string, CommitDetail | undefined>;
  issueLabels?: string[];
  issueAssignees?: string[];
  issueFilterMetadata?: GitHubIssueFilterMetadata;
  issues: Record<string, GitHubIssue[] | undefined>;
  issueDiscussions: Record<number, GitHubIssueDiscussion | undefined>;
  pullRequests: Record<string, GitHubPullRequest[] | undefined>;
  pullRequestDiscussions: Record<number, GitHubPullRequestDiscussion | undefined>;
  pullRequestChecks: Record<number, GitHubPullRequestCheck[] | undefined>;
  workflowRuns: Record<number, GitHubWorkflowRun[] | undefined>;
  workflowRunDetails: Record<number, GitHubWorkflowRunDetail | undefined>;
  workflowJobLogs: Record<number, GitHubWorkflowJobLog | undefined>;
  workflowArtifactEntries: Record<number, GitHubWorkflowArtifactEntry[] | undefined>;
  workflowArtifactPreviews: Record<string, RepoFilePreview | undefined>;
  releases?: GitHubRelease[];
  settingsSections: Partial<Record<GitHubRepoSettingsSectionKey, GitHubRepoSettingsSection>>;
};

type GitHubRepoCacheEntry = {
  items: GitHubRepoPage["items"];
  nextPage: number | null;
  scope?: GitHubRepositoryScope;
  fetchedAt: number;
};

export const ALL_GITHUB_REPOSITORIES: GitHubRepositoryScope = { kind: "all" };

export const githubRepoCache = new Map<string, GitHubRepoCacheEntry>();
export const githubRepoPreloadPromises = new Map<string, Promise<GitHubRepoPage>>();
export let githubRepoBindingRevision = "unknown";
export let githubAccountIssueCache: {
  key: string;
  items: GitHubAccountIssueItem[];
  fetchedAt: number;
} | null = null;
export let githubAccountIssueCacheGeneration = 0;
export let githubActionNotificationCache: {
  key: string;
  items: GitHubActionNotification[];
  fetchedAt: number;
} | null = null;
export const githubProjectCache = new Map<string, GitHubProjectRepoClientCache>();
export const pendingWorkspaceReads = new Map<string, Promise<unknown>>();

export function setGitHubAccountIssueCache(cache: typeof githubAccountIssueCache) {
  githubAccountIssueCache = cache;
}

export function setGitHubActionNotificationCache(cache: typeof githubActionNotificationCache) {
  githubActionNotificationCache = cache;
}

export function cloneProjectData<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneProjectList<T>(items: readonly T[]): T[] {
  return items.map((item) => cloneProjectData(item));
}

export function cloneRepoPage(page: GitHubRepoPage): GitHubRepoPage {
  return {
    items: page.items.map((repo) => ({
      ...repo,
      owner: repo.owner ? { ...repo.owner } : repo.owner,
      permissions: repo.permissions ? { ...repo.permissions } : repo.permissions,
    })),
    nextPage: page.nextPage,
    scope: page.scope ? { ...page.scope } : page.scope,
  };
}

export function githubProjectRepoKey(repoFullName: string) {
  return repoFullName.trim().toLowerCase();
}

export function githubProjectRepoCache(repoFullName: string) {
  const key = githubProjectRepoKey(repoFullName);
  let cache = githubProjectCache.get(key);
  if (!cache) {
    cache = {
      files: {},
      filePreviews: {},
      commits: {},
      commitDetails: {},
      issues: {},
      issueDiscussions: {},
      pullRequests: {},
      pullRequestDiscussions: {},
      pullRequestChecks: {},
      workflowRuns: {},
      workflowRunDetails: {},
      workflowJobLogs: {},
      workflowArtifactEntries: {},
      workflowArtifactPreviews: {},
      releases: undefined,
      settingsSections: {},
    };
    githubProjectCache.set(key, cache);
  }
  return cache;
}

export function clearGitHubProjectRepoCache(repoFullName: string) {
  githubProjectCache.delete(githubProjectRepoKey(repoFullName));
}

export function workspaceReadCacheKey(command: string, args: unknown) {
  return `${command}:${JSON.stringify(args)}`;
}

export function cachedWorkspaceRead<T>(
  command: string,
  args: unknown,
  request: () => Promise<T>,
): Promise<T> {
  const key = workspaceReadCacheKey(command, args);
  const pending = pendingWorkspaceReads.get(key);
  if (pending) return pending as Promise<T>;
  const next = request().finally(() => {
    if (pendingWorkspaceReads.get(key) === next) pendingWorkspaceReads.delete(key);
  });
  pendingWorkspaceReads.set(key, next);
  return next;
}

export function invalidateGitHubAccountIssueCache() {
  githubAccountIssueCache = null;
  githubAccountIssueCacheGeneration += 1;
  const commandPrefix = "github_list_account_issues:";
  for (const key of pendingWorkspaceReads.keys()) {
    if (key.startsWith(commandPrefix)) pendingWorkspaceReads.delete(key);
  }
}

export function githubScopeCacheKey(scope: GitHubRepositoryScope) {
  if (scope.kind === "all") return "all";
  return `${scope.kind}:${scope.login.trim().toLocaleLowerCase()}`;
}

export function githubRepositoryCacheKey(scope: GitHubRepositoryScope, page: number) {
  return `${githubRepoBindingRevision}:${githubScopeCacheKey(scope)}:${page}`;
}

export function bindingRevision(status: GitHubBindingStatus) {
  if (status.state !== "bound" || !status.binding) return "unbound";
  const scopes = [...status.binding.scopes].sort().join(",");
  return `${status.binding.login.toLocaleLowerCase()}:${status.binding.boundAt}:${scopes}`;
}

export function applyGitHubBindingRevision(status: GitHubBindingStatus) {
  const next = bindingRevision(status);
  if (next === githubRepoBindingRevision) return;
  clearGitHubRepoCache();
  githubRepoBindingRevision = next;
}

export function writeGitHubRepoCache(cacheKey: string, scope: GitHubRepositoryScope, page: GitHubRepoPage) {
  githubRepoCache.set(cacheKey, {
    items: page.items.map((repo) => ({ ...repo })),
    nextPage: page.nextPage,
    scope: page.scope ?? scope,
    fetchedAt: Date.now(),
  });
}

export function readCachedGitHubRepos(
  scope: GitHubRepositoryScope = ALL_GITHUB_REPOSITORIES,
  page = 1,
): GitHubRepoPage | null {
  const cached = githubRepoCache.get(githubRepositoryCacheKey(scope, page));
  return cached ? cloneRepoPage(cached) : null;
}

export function clearGitHubRepoCache() {
  githubRepoCache.clear();
  githubRepoPreloadPromises.clear();
  invalidateGitHubAccountIssueCache();
  githubActionNotificationCache = null;
  githubProjectCache.clear();
  pendingWorkspaceReads.clear();
}
