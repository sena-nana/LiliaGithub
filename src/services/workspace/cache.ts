import type {
  CommitDetail,
  CommitSummary,
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
  GitHubRepoLicense,
  GitHubRepoManagement,
  GitHubRepoOwner,
  GitHubRepoPage,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
  GitHubRepositoryScope,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowJobLog,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
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

type GitHubRepoOwnerCacheEntry = {
  revision: string;
  owners: GitHubRepoOwner[];
};

type HeavyCacheEntry = {
  size: number;
  remove: () => void;
};

export const GITHUB_PROJECT_CACHE_LIMITS = {
  repos: 8,
  collectionEntries: 12,
  heavyBytes: 16 * 1024 * 1024,
} as const;

export const ALL_GITHUB_REPOSITORIES: GitHubRepositoryScope = { kind: "all" };

const cacheTextEncoder = new TextEncoder();

function estimateCacheValueSize(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return serialized == null ? 0 : cacheTextEncoder.encode(serialized).byteLength;
  } catch {
    return GITHUB_PROJECT_CACHE_LIMITS.heavyBytes + 1;
  }
}

class HeavyCacheBudget {
  private readonly entries = new Map<string, HeavyCacheEntry>();
  private totalSize = 0;

  touch(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  set(key: string, value: unknown, remove: () => void) {
    this.delete(key);
    const entry = { size: estimateCacheValueSize(value), remove };
    this.entries.set(key, entry);
    this.totalSize += entry.size;
    while (this.totalSize > GITHUB_PROJECT_CACHE_LIMITS.heavyBytes) {
      const oldest = this.entries.entries().next().value as [string, HeavyCacheEntry] | undefined;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.totalSize -= oldest[1].size;
      oldest[1].remove();
    }
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalSize -= entry.size;
  }

  deleteRepo(repoKey: string) {
    const prefix = `${repoKey}\0`;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.delete(key);
    }
  }

  clear() {
    this.entries.clear();
    this.totalSize = 0;
  }
}

export function cloneProjectData<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
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

export function cloneGitHubRepoOwners(owners: readonly GitHubRepoOwner[]): GitHubRepoOwner[] {
  return owners.map((owner) => ({ ...owner }));
}

export function cloneGitHubRepoLicenses(licenses: readonly GitHubRepoLicense[]): GitHubRepoLicense[] {
  return licenses.map((license) => ({ ...license }));
}

export function githubProjectRepoKey(repoFullName: string) {
  return repoFullName.trim().toLowerCase();
}

export function workspaceReadCacheKey(command: string, args: unknown) {
  return `${command}:${JSON.stringify(args)}`;
}

export function githubScopeCacheKey(scope: GitHubRepositoryScope) {
  return scope.kind === "all" ? "all" : `${scope.kind}:${scope.login.trim().toLocaleLowerCase()}`;
}

export function bindingRevision(status: GitHubBindingStatus) {
  if (status.state !== "bound" || !status.binding) return "unbound";
  const scopes = [...status.binding.scopes].sort().join(",");
  return `${status.binding.login.toLocaleLowerCase()}:${status.binding.boundAt}:${scopes}`;
}

/** Creates all short-lived client caches for one workspace application instance. */
export function createWorkspaceClientCache() {
  const heavyCacheBudget = new HeavyCacheBudget();

  function createBoundedRecord<T>(repoKey: string, collection: string, heavy = false) {
    const target: Record<string, T | undefined> = {};
    const recency = new Map<string, true>();
    const budgetKey = (key: string) => `${repoKey}\0${collection}\0${key}`;
    const forget = (key: string) => {
      recency.delete(key);
      Reflect.deleteProperty(target, key);
      if (heavy) heavyCacheBudget.delete(budgetKey(key));
    };
    return new Proxy(target, {
      get(current, property, receiver) {
        if (typeof property === "string" && Object.prototype.hasOwnProperty.call(current, property)) {
          recency.delete(property);
          recency.set(property, true);
          if (heavy) heavyCacheBudget.touch(budgetKey(property));
        }
        return Reflect.get(current, property, receiver);
      },
      set(current, property, value, receiver) {
        if (typeof property !== "string") return Reflect.set(current, property, value, receiver);
        Reflect.set(current, property, value, receiver);
        recency.delete(property);
        recency.set(property, true);
        if (heavy) {
          heavyCacheBudget.set(budgetKey(property), value, () => {
            recency.delete(property);
            Reflect.deleteProperty(target, property);
          });
        }
        while (recency.size > GITHUB_PROJECT_CACHE_LIMITS.collectionEntries) {
          const oldest = recency.keys().next().value as string | undefined;
          if (oldest == null) break;
          forget(oldest);
        }
        return true;
      },
      deleteProperty(_current, property) {
        if (typeof property === "string") forget(property);
        return true;
      },
    });
  }

  function createRepoCache(repoKey: string): GitHubProjectRepoClientCache {
    return {
      files: createBoundedRecord(repoKey, "files"),
      filePreviews: createBoundedRecord(repoKey, "filePreviews", true),
      commits: createBoundedRecord(repoKey, "commits"),
      commitDetails: createBoundedRecord(repoKey, "commitDetails"),
      issues: createBoundedRecord(repoKey, "issues"),
      issueDiscussions: createBoundedRecord(repoKey, "issueDiscussions"),
      pullRequests: createBoundedRecord(repoKey, "pullRequests"),
      pullRequestDiscussions: createBoundedRecord(repoKey, "pullRequestDiscussions"),
      pullRequestChecks: createBoundedRecord(repoKey, "pullRequestChecks"),
      workflowRuns: createBoundedRecord(repoKey, "workflowRuns"),
      workflowRunDetails: createBoundedRecord(repoKey, "workflowRunDetails"),
      workflowJobLogs: createBoundedRecord(repoKey, "workflowJobLogs", true),
      workflowArtifactEntries: createBoundedRecord(repoKey, "workflowArtifactEntries"),
      workflowArtifactPreviews: createBoundedRecord(repoKey, "workflowArtifactPreviews", true),
      releases: undefined,
      settingsSections: {},
    };
  }

  class GitHubProjectCache extends Map<string, GitHubProjectRepoClientCache> {
    override get(key: string) {
      const value = super.get(key);
      if (!value) return undefined;
      super.delete(key);
      super.set(key, value);
      return value;
    }

    override set(key: string, value: GitHubProjectRepoClientCache) {
      if (super.has(key)) super.delete(key);
      super.set(key, value);
      while (this.size > GITHUB_PROJECT_CACHE_LIMITS.repos) {
        const oldest = super.keys().next().value as string | undefined;
        if (oldest == null) break;
        this.delete(oldest);
      }
      return this;
    }

    override delete(key: string) {
      heavyCacheBudget.deleteRepo(key);
      return super.delete(key);
    }

    override clear() {
      heavyCacheBudget.clear();
      super.clear();
    }
  }

  const githubRepoCache = new Map<string, GitHubRepoCacheEntry>();
  const githubRepoPreloadPromises = new Map<string, Promise<GitHubRepoPage>>();
  const githubRepoOwnerPromises = new Map<string, Promise<GitHubRepoOwner[]>>();
  const githubProjectCache = new GitHubProjectCache();
  const pendingWorkspaceReads = new Map<string, Promise<unknown>>();
  let githubRepoBindingRevision = "unknown";
  let githubRepoOwnerCache: GitHubRepoOwnerCacheEntry | null = null;
  let githubRepoOwnerCacheGeneration = 0;
  let githubRepoLicenseCache: GitHubRepoLicense[] | null = null;
  let githubAccountIssueCache: { key: string; items: GitHubAccountIssueItem[]; fetchedAt: number } | null = null;
  let githubAccountIssueCacheGeneration = 0;
  let githubActionNotificationCache: { key: string; items: GitHubActionNotification[]; fetchedAt: number } | null = null;

  function githubRepositoryCacheKey(scope: GitHubRepositoryScope, page: number) {
    return `${githubRepoBindingRevision}:${githubScopeCacheKey(scope)}:${page}`;
  }

  function githubProjectRepoCache(repoFullName: string) {
    const key = githubProjectRepoKey(repoFullName);
    let cache = githubProjectCache.get(key);
    if (!cache) {
      cache = createRepoCache(key);
      githubProjectCache.set(key, cache);
    }
    return cache;
  }

  function clearGitHubProjectRepoCache(repoFullName: string) {
    githubProjectCache.delete(githubProjectRepoKey(repoFullName));
  }

  function cachedWorkspaceRead<T>(command: string, args: unknown, request: () => Promise<T>): Promise<T> {
    const key = workspaceReadCacheKey(command, args);
    const pending = pendingWorkspaceReads.get(key);
    if (pending) return pending as Promise<T>;
    const next = request().finally(() => {
      if (pendingWorkspaceReads.get(key) === next) pendingWorkspaceReads.delete(key);
    });
    pendingWorkspaceReads.set(key, next);
    return next;
  }

  function invalidateGitHubAccountIssueCache() {
    githubAccountIssueCache = null;
    githubAccountIssueCacheGeneration += 1;
    for (const key of pendingWorkspaceReads.keys()) {
      if (key.startsWith("github_list_account_issues:")) pendingWorkspaceReads.delete(key);
    }
  }

  function clearGitHubRepoOwnerCache() {
    githubRepoOwnerCache = null;
    githubRepoOwnerCacheGeneration += 1;
    githubRepoOwnerPromises.clear();
  }

  function clearGitHubRepoCache() {
    githubRepoCache.clear();
    githubRepoPreloadPromises.clear();
    invalidateGitHubAccountIssueCache();
    githubActionNotificationCache = null;
    githubProjectCache.clear();
    pendingWorkspaceReads.clear();
  }

  function applyGitHubBindingRevision(status: GitHubBindingStatus) {
    const next = bindingRevision(status);
    if (next === githubRepoBindingRevision) return;
    clearGitHubRepoCache();
    clearGitHubRepoOwnerCache();
    githubRepoBindingRevision = next;
  }

  function writeGitHubRepoCache(cacheKey: string, scope: GitHubRepositoryScope, page: GitHubRepoPage) {
    githubRepoCache.set(cacheKey, {
      items: page.items.map((repo) => ({ ...repo })),
      nextPage: page.nextPage,
      scope: page.scope ?? scope,
      fetchedAt: Date.now(),
    });
  }

  function readCachedGitHubRepos(scope = ALL_GITHUB_REPOSITORIES, page = 1) {
    const cached = githubRepoCache.get(githubRepositoryCacheKey(scope, page));
    return cached ? cloneRepoPage(cached) : null;
  }

  function readCachedGitHubRepoOwners() {
    return githubRepoOwnerCache?.revision === githubRepoBindingRevision
      ? cloneGitHubRepoOwners(githubRepoOwnerCache.owners)
      : null;
  }

  function writeGitHubRepoOwnerCache(owners: readonly GitHubRepoOwner[]) {
    githubRepoOwnerCache = { revision: githubRepoBindingRevision, owners: cloneGitHubRepoOwners(owners) };
  }

  function readCachedGitHubRepoLicenses() {
    return githubRepoLicenseCache ? cloneGitHubRepoLicenses(githubRepoLicenseCache) : null;
  }

  function writeGitHubRepoLicenseCache(licenses: readonly GitHubRepoLicense[]) {
    githubRepoLicenseCache = cloneGitHubRepoLicenses(licenses);
  }

  function clearGitHubRepoLicenseCache() {
    githubRepoLicenseCache = null;
  }

  return {
    githubRepoCache,
    githubRepoPreloadPromises,
    githubRepoOwnerPromises,
    githubProjectCache,
    get githubRepoBindingRevision() { return githubRepoBindingRevision; },
    get githubRepoOwnerCacheGeneration() { return githubRepoOwnerCacheGeneration; },
    get githubAccountIssueCache() { return githubAccountIssueCache; },
    get githubAccountIssueCacheGeneration() { return githubAccountIssueCacheGeneration; },
    get githubActionNotificationCache() { return githubActionNotificationCache; },
    setGitHubAccountIssueCache(cache: typeof githubAccountIssueCache) { githubAccountIssueCache = cache; },
    setGitHubActionNotificationCache(cache: typeof githubActionNotificationCache) { githubActionNotificationCache = cache; },
    githubRepositoryCacheKey,
    githubProjectRepoCache,
    clearGitHubProjectRepoCache,
    cachedWorkspaceRead,
    invalidateGitHubAccountIssueCache,
    applyGitHubBindingRevision,
    writeGitHubRepoCache,
    clearGitHubRepoCache,
    readCachedGitHubRepos,
    readCachedGitHubRepoOwners,
    writeGitHubRepoOwnerCache,
    clearGitHubRepoOwnerCache,
    readCachedGitHubRepoLicenses,
    writeGitHubRepoLicenseCache,
    clearGitHubRepoLicenseCache,
  };
}

export type WorkspaceClientCache = ReturnType<typeof createWorkspaceClientCache>;
