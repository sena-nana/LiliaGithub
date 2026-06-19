import { invoke } from "@tauri-apps/api/core";
import { parseRemoteRepoId } from "../../utils/remoteRepo";
import * as fallback from "./fallback";
import type {
  BulkOperation,
  BulkSyncPreview,
  BulkSyncResult,
  BranchSummary,
  CommitDetail,
  CommitSummary,
  GitHubBindingStatus,
  GitHubCommitListOptions,
  GitHubContributionResult,
  GitHubCreateIssueRequest,
  GitHubCreateRepoRequest,
  GitHubDeviceFlowPollResult,
  GitHubDeviceFlowStart,
  GitHubIssue,
  GitHubIssueListOptions,
  GitHubMergePullRequestRequest,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRepoManagement,
  GitHubRepoOwner,
  GitHubRepoPage,
  GitHubRepoSummary,
  GitHubWorkflowRun,
  GitHubCreatePullRequestRequest,
  GitHubUpdatePullRequestRequest,
  GitHubUpdateIssueRequest,
  GitHubUpdateRepoSettingsRequest,
  HiddenRepo,
  ProjectLaunchConfig,
  ProjectLaunchCandidate,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoConflictChoice,
  RepoConflictState,
  RepoDetail,
  RepoFilePreview,
  RepoFileTreeEntry,
  RepoMergePullResult,
  RepoOperationResult,
  RepoRemote,
  RepoRefreshSummaryOptions,
  RepoReadme,
  RepoResetMode,
  RepoSummary,
  RepoStashEntry,
  RepoStashDetail,
  RemoteRepoShortcut,
  SystemOpenTarget,
  WorkspaceTask,
  WorkspaceSettings,
} from "./types";

const isTest = typeof import.meta !== "undefined" && import.meta.env?.MODE === "test";
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
const GITHUB_REPO_CACHE_TTL_MS = 5 * 60 * 1000;

export type GitHubProjectFetchOptions = {
  forceRefresh?: boolean;
};

type GitHubProjectRepoClientCache = {
  management?: GitHubRepoManagement;
  readmes?: RepoReadme[];
  commits: Record<string, CommitSummary[] | undefined>;
  commitDetails: Record<string, CommitDetail | undefined>;
  issues: Record<string, GitHubIssue[] | undefined>;
  pullRequests: Record<string, GitHubPullRequest[] | undefined>;
  pullRequestChecks: Record<number, GitHubPullRequestCheck[] | undefined>;
  workflowRuns: Record<number, GitHubWorkflowRun[] | undefined>;
};

let githubRepoCache: {
  items: GitHubRepoPage["items"];
  nextPage: number | null;
  fetchedAt: number;
} | null = null;
let githubRepoPreloadPromise: Promise<GitHubRepoPage> | null = null;
const githubProjectCache = new Map<string, GitHubProjectRepoClientCache>();

export function resolveWorkspaceRuntimeForTests(probe: {
  hasWindow: boolean;
  hasTauriInternals: boolean;
  isDev: boolean;
  isTest: boolean;
}): "tauri" | "mock" | "unavailable" {
  if (probe.hasTauriInternals && !probe.isTest) return "tauri";
  if (probe.isTest || (probe.hasWindow && probe.isDev)) return "mock";
  return "unavailable";
}

async function call<T>(command: string, args: Record<string, unknown> | undefined, fallbackCall: () => Promise<T>): Promise<T> {
  const hasWindow = typeof window !== "undefined";
  const runtime = resolveWorkspaceRuntimeForTests({
    hasWindow,
    hasTauriInternals: hasWindow && "__TAURI_INTERNALS__" in window,
    isDev,
    isTest,
  });
  if (runtime === "tauri") {
    return invoke<T>(command, args);
  }
  if (runtime === "mock") {
    return fallbackCall();
  }
  throw new Error(
    `Tauri command ${command} is unavailable outside Tauri. Use yarn tauri:dev, or yarn dev for the development mock mode.`,
  );
}

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return call("workspace_get_settings", undefined, fallback.getWorkspaceSettings);
}

export function setWorkspaceRoot(workspaceRoot: string): Promise<WorkspaceSettings> {
  return call("workspace_set_root", { workspaceRoot }, () => fallback.setWorkspaceRoot(workspaceRoot));
}

export function pickWorkspaceRoot(): Promise<string | null> {
  return call("workspace_pick_root", undefined, fallback.pickWorkspaceRoot);
}

function cloneRepoPage(page: GitHubRepoPage): GitHubRepoPage {
  return {
    items: page.items.map((repo) => ({ ...repo })),
    nextPage: page.nextPage,
  };
}

function cloneProjectData<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneProjectList<T>(items: readonly T[]): T[] {
  return items.map((item) => cloneProjectData(item));
}

function githubProjectRepoKey(repoFullName: string) {
  return repoFullName.trim().toLowerCase();
}

function githubProjectRepoCache(repoFullName: string) {
  const key = githubProjectRepoKey(repoFullName);
  let cache = githubProjectCache.get(key);
  if (!cache) {
    cache = {
      commits: {},
      commitDetails: {},
      issues: {},
      pullRequests: {},
      pullRequestChecks: {},
      workflowRuns: {},
    };
    githubProjectCache.set(key, cache);
  }
  return cache;
}

function clearGitHubProjectRepoCache(repoFullName: string) {
  githubProjectCache.delete(githubProjectRepoKey(repoFullName));
}

function githubIssueCacheKey(options: GitHubIssueListOptions) {
  const state = options.state ?? "open";
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 100));
  const sort = options.sort === "updated" || options.sort === "comments" ? options.sort : "created";
  const direction = options.direction === "asc" ? "asc" : "desc";
  const since = options.since?.trim() ?? "";
  return `${state}|${perPage}|${sort}|${direction}|${since}`;
}

function githubPullRequestCacheKey(state?: "open" | "closed" | "all" | null) {
  return state === "closed" || state === "all" ? state : "open";
}

function githubWorkflowRunsCacheKey(perPage?: number | null) {
  return Math.min(100, Math.max(1, perPage ?? 30));
}

function githubCommitListCacheKey(options: GitHubCommitListOptions = {}) {
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 100));
  const sha = options.sha?.trim() ?? "";
  return `${perPage}|${sha}`;
}

function upsertGitHubIssue(repoFullName: string, issue: GitHubIssue) {
  const cache = githubProjectRepoCache(repoFullName);
  for (const [key, items] of Object.entries(cache.issues)) {
    if (!items) continue;
    const [state] = key.split("|");
    const belongs = state === "all" || state === issue.state;
    const withoutIssue = items.filter((item) => item.number !== issue.number);
    cache.issues[key] = belongs
      ? [cloneProjectData(issue), ...cloneProjectList(withoutIssue)]
      : cloneProjectList(withoutIssue);
  }
}

function upsertGitHubPullRequest(repoFullName: string, pull: GitHubPullRequest) {
  const cache = githubProjectRepoCache(repoFullName);
  for (const [key, items] of Object.entries(cache.pullRequests)) {
    if (!items) continue;
    const belongs = key === "all" || key === pull.state;
    const withoutPull = items.filter((item) => item.number !== pull.number);
    cache.pullRequests[key] = belongs
      ? [cloneProjectData(pull), ...cloneProjectList(withoutPull)]
      : cloneProjectList(withoutPull);
  }
}

function clearGitHubProjectPullRequestChecks(repoFullName: string, pullNumber?: number) {
  const cache = githubProjectCache.get(githubProjectRepoKey(repoFullName));
  if (!cache) return;
  if (pullNumber == null) cache.pullRequestChecks = {};
  else delete cache.pullRequestChecks[pullNumber];
}

function writeGitHubRepoCache(page: GitHubRepoPage) {
  githubRepoCache = {
    items: page.items.map((repo) => ({ ...repo })),
    nextPage: page.nextPage,
    fetchedAt: Date.now(),
  };
}

export function readCachedGitHubRepos(): GitHubRepoPage | null {
  if (!githubRepoCache) return null;
  return cloneRepoPage(githubRepoCache);
}

export function clearGitHubRepoCache() {
  githubRepoCache = null;
  githubRepoPreloadPromise = null;
  githubProjectCache.clear();
}

export function isGitHubBindingExpiredError(err: unknown): boolean {
  const message = String(err);
  return message.includes("GitHub 绑定已失效") ||
    message.includes("HTTP 401") ||
    message.includes("HTTP 403") ||
    message.toLowerCase().includes("bad credentials");
}

export function preloadGitHubRepos(opts: { force?: boolean } = {}): Promise<GitHubRepoPage> {
  const now = Date.now();
  if (
    !opts.force &&
    githubRepoCache &&
    now - githubRepoCache.fetchedAt < GITHUB_REPO_CACHE_TTL_MS
  ) {
    return Promise.resolve(cloneRepoPage(githubRepoCache));
  }
  if (!opts.force && githubRepoPreloadPromise) return githubRepoPreloadPromise;
  githubRepoPreloadPromise = listGitHubRepos(1).finally(() => {
    githubRepoPreloadPromise = null;
  });
  return githubRepoPreloadPromise;
}

export function pickRepo(): Promise<string | null> {
  return call("workspace_pick_repo", undefined, fallback.pickRepo);
}

export function refreshRepos(): Promise<RepoSummary[]> {
  return call("workspace_refresh_repos", undefined, fallback.refreshRepos);
}

export function listManagedRepos(): Promise<RepoSummary[]> {
  return call("workspace_list_managed_repos", undefined, fallback.listManagedRepos);
}

export function discoverRepos(): Promise<RepoSummary[]> {
  return call("workspace_discover_repos", undefined, fallback.discoverRepos);
}

export function addRepo(repoPath: string): Promise<RepoSummary> {
  return call("workspace_add_repo", { repoPath }, () => fallback.addRepo(repoPath));
}

export function cloneRepo(remoteUrl: string, directoryName?: string | null): Promise<RepoSummary> {
  return call("workspace_clone_repo", { remoteUrl, directoryName: directoryName ?? null }, () =>
    fallback.cloneRepo(remoteUrl, directoryName),
  );
}

export function getRepoSummary(repoId: string): Promise<RepoSummary> {
  return call("repo_get_summary", { repoId }, () => fallback.getRepoSummary(repoId));
}

export function refreshRepoSummary(
  repoId: string,
  options: RepoRefreshSummaryOptions = {},
): Promise<RepoSummary> {
  return call("repo_refresh_summary", { repoId, options }, () => fallback.refreshRepoSummary(repoId, options));
}

export function hideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_hide_repo", { repoId }, () => fallback.hideRepo(repoId));
}

export function createRepoGroup(name: string): Promise<WorkspaceSettings> {
  return call("workspace_create_repo_group", { name }, () => fallback.createRepoGroup(name));
}

export function renameRepoGroup(groupId: string, name: string): Promise<WorkspaceSettings> {
  return call("workspace_rename_repo_group", { groupId, name }, () => fallback.renameRepoGroup(groupId, name));
}

export function deleteRepoGroup(groupId: string): Promise<WorkspaceSettings> {
  return call("workspace_delete_repo_group", { groupId }, () => fallback.deleteRepoGroup(groupId));
}

export function moveRepoToGroup(repoId: string, groupId: string | null): Promise<WorkspaceSettings> {
  return call("workspace_move_repo_to_group", { repoId, groupId }, () => fallback.moveRepoToGroup(repoId, groupId));
}

export function deleteLocalRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_delete_local_repo", { repoId }, () => fallback.deleteLocalRepo(repoId));
}

export function rememberRemoteRepo(repo: RemoteRepoShortcut): Promise<WorkspaceSettings> {
  return call("workspace_remember_remote_repo", { repo }, () => fallback.rememberRemoteRepo(repo));
}

export function forgetRemoteRepo(fullName: string): Promise<WorkspaceSettings> {
  return call("workspace_forget_remote_repo", { fullName }, () => fallback.forgetRemoteRepo(fullName));
}

export function unhideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_unhide_repo", { repoId }, () => fallback.unhideRepo(repoId));
}

export function listHiddenRepos(): Promise<HiddenRepo[]> {
  return call("workspace_list_hidden_repos", undefined, fallback.listHiddenRepos);
}

export function listWorkspaceTasks(): Promise<WorkspaceTask[]> {
  return call("workspace_list_tasks", undefined, fallback.listWorkspaceTasks);
}

export function cancelWorkspaceTask(taskId: string): Promise<void> {
  return call("workspace_cancel_task", { taskId }, () => fallback.cancelWorkspaceTask(taskId));
}

export async function getGitHubBindingStatus(): Promise<GitHubBindingStatus> {
  const status = await call("github_get_binding_status", undefined, fallback.getGitHubBindingStatus);
  if (status.state !== "bound") clearGitHubRepoCache();
  return status;
}

export function startGitHubDeviceFlow(): Promise<GitHubDeviceFlowStart> {
  return call("github_start_device_flow", undefined, fallback.startGitHubDeviceFlow);
}

export function pollGitHubDeviceFlow(
  deviceCode: string,
  intervalSeconds?: number | null,
): Promise<GitHubDeviceFlowPollResult> {
  return call("github_poll_device_flow", { deviceCode, intervalSeconds: intervalSeconds ?? null }, () =>
    fallback.pollGitHubDeviceFlow(deviceCode, intervalSeconds),
  );
}

export function listRepoContribution(repoScope: string): Promise<GitHubContributionResult> {
  return call("github_list_repo_contribution", { repoFullName: repoScope }, () =>
    fallback.listRepoContribution(repoScope),
  );
}

export async function listGitHubRepos(page?: number | null): Promise<GitHubRepoPage> {
  const pageNo = page ?? null;
  const result = await call("github_list_repos", { page: pageNo }, () =>
    fallback.listGitHubRepos(pageNo),
  ).catch((err) => {
    if (isGitHubBindingExpiredError(err)) clearGitHubRepoCache();
    throw err;
  });
  if ((pageNo ?? 1) === 1) writeGitHubRepoCache(result);
  return cloneRepoPage(result);
}

export function listGitHubRepoOwners(): Promise<GitHubRepoOwner[]> {
  return call("github_list_repo_owners", undefined, fallback.listGitHubRepoOwners);
}

export async function createGitHubRepo(request: GitHubCreateRepoRequest): Promise<GitHubRepoSummary> {
  const repo = await call("github_create_repo", { request }, () => fallback.createGitHubRepo(request));
  clearGitHubRepoCache();
  return repo;
}

export function getGitHubRepoManagement(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubRepoManagement> {
  const cache = githubProjectRepoCache(repoFullName);
  if (!options.forceRefresh && cache.management) {
    return Promise.resolve(cloneProjectData(cache.management));
  }
  return call("github_get_repo_management", {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  }, () => fallback.getGitHubRepoManagement(repoFullName))
    .then((repo) => {
      cache.management = cloneProjectData(repo);
      return cloneProjectData(repo);
    });
}

export function updateGitHubRepoSettings(
  repoFullName: string,
  request: GitHubUpdateRepoSettingsRequest,
): Promise<GitHubRepoManagement> {
  return call("github_update_repo_settings", { repoFullName, request }, () =>
    fallback.updateGitHubRepoSettings(repoFullName, request),
  ).then((repo) => {
    githubProjectRepoCache(repoFullName).management = cloneProjectData(repo);
    return cloneProjectData(repo);
  });
}

export async function deleteGitHubRepo(repoFullName: string): Promise<void> {
  await call("github_delete_repo", { repoFullName }, () => fallback.deleteGitHubRepo(repoFullName));
  clearGitHubRepoCache();
  clearGitHubProjectRepoCache(repoFullName);
}

export function listGitHubBranches(repoFullName: string): Promise<BranchSummary[]> {
  return call("github_list_branches", { repoFullName }, () => fallback.listGitHubBranches(repoFullName));
}

export function deleteGitHubBranch(repoFullName: string, branchName: string): Promise<void> {
  return call("github_delete_branch", { repoFullName, branchName }, () =>
    fallback.deleteGitHubBranch(repoFullName, branchName)
  );
}

export function listGitHubPullRequests(
  repoFullName: string,
  state?: "open" | "closed" | "all" | null,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubPullRequest[]> {
  const cache = githubProjectRepoCache(repoFullName);
  const key = githubPullRequestCacheKey(state);
  const cached = cache.pullRequests[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  return call("github_list_pull_requests", {
    repoFullName,
    state: state ?? null,
    forceRefresh: options.forceRefresh ?? null,
  }, () => fallback.listGitHubPullRequests(repoFullName, state))
    .then((pulls) => {
      cache.pullRequests[key] = cloneProjectList(pulls);
      return cloneProjectList(pulls);
    });
}

export function getGitHubPullRequest(repoFullName: string, pullNumber: number): Promise<GitHubPullRequest> {
  return call("github_get_pull_request", { repoFullName, pullNumber }, () =>
    fallback.getGitHubPullRequest(repoFullName, pullNumber),
  );
}

export function createGitHubPullRequest(
  repoFullName: string,
  request: GitHubCreatePullRequestRequest,
): Promise<GitHubPullRequest> {
  return call("github_create_pull_request", { repoFullName, request }, () =>
    fallback.createGitHubPullRequest(repoFullName, request),
  ).then((pull) => {
    upsertGitHubPullRequest(repoFullName, pull);
    clearGitHubProjectPullRequestChecks(repoFullName, pull.number);
    return cloneProjectData(pull);
  });
}

export function updateGitHubPullRequest(
  repoFullName: string,
  pullNumber: number,
  request: GitHubUpdatePullRequestRequest,
): Promise<GitHubPullRequest> {
  return call("github_update_pull_request", { repoFullName, pullNumber, request }, () =>
    fallback.updateGitHubPullRequest(repoFullName, pullNumber, request),
  ).then((pull) => {
    upsertGitHubPullRequest(repoFullName, pull);
    clearGitHubProjectPullRequestChecks(repoFullName, pull.number);
    return cloneProjectData(pull);
  });
}

export function mergeGitHubPullRequest(
  repoFullName: string,
  pullNumber: number,
  request: GitHubMergePullRequestRequest = {},
): Promise<GitHubPullRequest> {
  return call("github_merge_pull_request", { repoFullName, pullNumber, request }, () =>
    fallback.mergeGitHubPullRequest(repoFullName, pullNumber, request),
  ).then((pull) => {
    upsertGitHubPullRequest(repoFullName, pull);
    clearGitHubProjectPullRequestChecks(repoFullName, pull.number);
    return cloneProjectData(pull);
  });
}

export function listGitHubPullRequestChecks(
  repoFullName: string,
  pullNumber: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubPullRequestCheck[]> {
  const cache = githubProjectRepoCache(repoFullName);
  const cached = cache.pullRequestChecks[pullNumber];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  return call("github_list_pull_request_checks", {
    repoFullName,
    pullNumber,
    forceRefresh: options.forceRefresh ?? null,
  }, () => fallback.listGitHubPullRequestChecks(repoFullName, pullNumber))
    .then((checks) => {
      cache.pullRequestChecks[pullNumber] = cloneProjectList(checks);
      return cloneProjectList(checks);
    });
}

export function listGitHubIssues(
  repoFullName: string,
  stateOrOptions?: string | null | GitHubIssueListOptions,
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<GitHubIssue[]> {
  const options = typeof stateOrOptions === "object" && stateOrOptions != null
    ? stateOrOptions
    : { state: stateOrOptions ?? null };
  const cache = githubProjectRepoCache(repoFullName);
  const key = githubIssueCacheKey(options);
  const cached = cache.issues[key];
  if (!fetchOptions.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  return call("github_list_issues", {
    repoFullName,
    state: options.state ?? null,
    perPage: options.perPage ?? null,
    sort: options.sort ?? null,
    direction: options.direction ?? null,
    since: options.since ?? null,
    forceRefresh: fetchOptions.forceRefresh ?? null,
  }, () => fallback.listGitHubIssues(repoFullName, options))
    .then((issues) => {
      cache.issues[key] = cloneProjectList(issues);
      return cloneProjectList(issues);
    });
}

export function createGitHubIssue(
  repoFullName: string,
  request: GitHubCreateIssueRequest,
): Promise<GitHubIssue> {
  return call("github_create_issue", { repoFullName, request }, () =>
    fallback.createGitHubIssue(repoFullName, request),
  ).then((issue) => {
    upsertGitHubIssue(repoFullName, issue);
    return cloneProjectData(issue);
  });
}

export function updateGitHubIssue(
  repoFullName: string,
  issueNumber: number,
  request: GitHubUpdateIssueRequest,
): Promise<GitHubIssue> {
  return call("github_update_issue", { repoFullName, issueNumber, request }, () =>
    fallback.updateGitHubIssue(repoFullName, issueNumber, request),
  ).then((issue) => {
    upsertGitHubIssue(repoFullName, issue);
    return cloneProjectData(issue);
  });
}

export function listGitHubWorkflowRuns(
  repoFullName: string,
  perPage?: number | null,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubWorkflowRun[]> {
  const cache = githubProjectRepoCache(repoFullName);
  const key = githubWorkflowRunsCacheKey(perPage);
  const cached = cache.workflowRuns[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  return call("github_list_workflow_runs", {
    repoFullName,
    perPage: perPage ?? null,
    forceRefresh: options.forceRefresh ?? null,
  }, () => fallback.listGitHubWorkflowRuns(repoFullName, perPage))
    .then((runs) => {
      cache.workflowRuns[key] = cloneProjectList(runs);
      return cloneProjectList(runs);
    });
}

export function listGitHubRepoCommits(
  repoFullName: string,
  options: GitHubCommitListOptions = {},
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<CommitSummary[]> {
  const cache = githubProjectRepoCache(repoFullName);
  const key = githubCommitListCacheKey(options);
  const cached = cache.commits[key];
  if (!fetchOptions.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  return call("github_list_repo_commits", {
    repoFullName,
    perPage: options.perPage ?? null,
    sha: options.sha ?? null,
    forceRefresh: fetchOptions.forceRefresh ?? null,
  }, () => fallback.listGitHubRepoCommits(repoFullName, options))
    .then((commits) => {
      cache.commits[key] = cloneProjectList(commits);
      return cloneProjectList(commits);
    });
}

export function getGitHubRepoCommitDetail(
  repoFullName: string,
  hash: string,
  options: GitHubProjectFetchOptions = {},
): Promise<CommitDetail> {
  const normalizedHash = hash.trim();
  const cache = githubProjectRepoCache(repoFullName);
  const cached = cache.commitDetails[normalizedHash];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  return call("github_get_repo_commit_detail", {
    repoFullName,
    hash: normalizedHash,
    forceRefresh: options.forceRefresh ?? null,
  }, () => fallback.getGitHubRepoCommitDetail(repoFullName, normalizedHash))
    .then((detail) => {
      cache.commitDetails[detail.hash] = cloneProjectData(detail);
      if (normalizedHash && normalizedHash !== detail.hash) {
        cache.commitDetails[normalizedHash] = cloneProjectData(detail);
      }
      return cloneProjectData(detail);
    });
}

export function getRepoDetail(repoId: string): Promise<RepoDetail> {
  return call("repo_get_detail", { repoId }, () => fallback.getRepoDetail(repoId));
}

export function getRepoReadme(repoId: string): Promise<RepoReadme | null> {
  return call("repo_get_readme", { repoId }, () => fallback.getRepoReadme(repoId));
}

export function listRepoReadmes(repoId: string): Promise<RepoReadme[]> {
  return call("repo_list_readmes", { repoId }, () => fallback.listRepoReadmes(repoId));
}

export function listGitHubRepoReadmes(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoReadme[]> {
  const cache = githubProjectRepoCache(repoFullName);
  if (!options.forceRefresh && cache.readmes) return Promise.resolve(cloneProjectList(cache.readmes));
  return call("github_list_repo_readmes", {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  }, () => fallback.listGitHubRepoReadmes(repoFullName))
    .then((readmes) => {
      cache.readmes = cloneProjectList(readmes);
      return cloneProjectList(readmes);
    });
}

export function listRepoFiles(repoId: string, parentPath?: string | null): Promise<RepoFileTreeEntry[]> {
  return call("repo_list_files", { repoId, parentPath: parentPath ?? null }, () => fallback.listRepoFiles(repoId, parentPath));
}

export function getRepoFilePreview(repoId: string, path: string): Promise<RepoFilePreview> {
  return call("repo_get_file_preview", { repoId, path }, () => fallback.getRepoFilePreview(repoId, path));
}

export function refreshRepoLanguageStats(repoId: string): Promise<RepoSummary> {
  return call("repo_refresh_language_stats", { repoId }, () => fallback.refreshRepoLanguageStats(repoId));
}

export function getRepoCommitDetail(repoId: string, hash: string): Promise<CommitDetail> {
  const remoteFullName = parseRemoteRepoId(repoId);
  if (remoteFullName) return getGitHubRepoCommitDetail(remoteFullName, hash);
  return call("repo_get_commit_detail", { repoId, hash }, () => fallback.getRepoCommitDetail(repoId, hash));
}

export function getRepoLaunchConfig(repoId: string): Promise<ProjectLaunchConfig | null> {
  return call("repo_get_launch_config", { repoId }, () => fallback.getRepoLaunchConfig(repoId));
}

export function listRepoLaunchCandidates(repoId: string): Promise<ProjectLaunchCandidate[]> {
  return call("repo_list_launch_candidates", { repoId }, () => fallback.listRepoLaunchCandidates(repoId));
}

export function saveRepoLaunchConfig(
  repoId: string,
  command: string,
  cwd?: string | null,
): Promise<ProjectLaunchConfig> {
  return call("repo_save_launch_config", { repoId, command, cwd: cwd ?? null }, () =>
    fallback.saveRepoLaunchConfig(repoId, command, cwd),
  );
}

export function getRepoLaunchStatus(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_get_launch_status", { repoId }, () => fallback.getRepoLaunchStatus(repoId));
}

export function getRepoLaunchLogs(repoId: string, since?: number | null): Promise<ProjectLaunchLog[]> {
  return call("repo_get_launch_logs", { repoId, since: since ?? null }, () => fallback.getRepoLaunchLogs(repoId, since));
}

export function startRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_start_launch", { repoId }, () => fallback.startRepoLaunch(repoId));
}

export function stopRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_stop_launch", { repoId }, () => fallback.stopRepoLaunch(repoId));
}

export function stageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_stage_files", { repoId, files }, () => fallback.stageFiles(repoId, files));
}

export function unstageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_unstage_files", { repoId, files }, () => fallback.unstageFiles(repoId, files));
}

export function discardFiles(repoId: string, files: string[]): Promise<RepoSummary> {
  return call("repo_discard_files", { repoId, files }, () => fallback.discardFiles(repoId, files));
}

export function addFilesToGitignore(repoId: string, files: string[]): Promise<RepoSummary> {
  return call("repo_add_files_to_gitignore", { repoId, files }, () => fallback.addFilesToGitignore(repoId, files));
}

export function commitRepo(
  repoId: string,
  files: string[],
  message: string,
  pushAfter: boolean,
): Promise<RepoSummary> {
  return call("repo_commit", { repoId, files, message, pushAfter }, () =>
    fallback.commitRepo(repoId, files, message, pushAfter),
  );
}

export function pullRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_pull", { repoId }, () => fallback.pullRepo(repoId));
}

export function mergePullRepo(repoId: string): Promise<RepoMergePullResult> {
  return call("repo_merge_pull", { repoId }, () => fallback.mergePullRepo(repoId));
}

export function fetchRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_fetch", { repoId }, () => fallback.fetchRepo(repoId));
}

export function startRebaseRepo(
  repoId: string,
  ontoRef?: string | null,
): Promise<RepoOperationResult> {
  return call("repo_start_rebase", { repoId, ontoRef: ontoRef ?? null }, () =>
    fallback.startRebaseRepo(repoId, ontoRef),
  );
}

export function mergeBranch(repoId: string, branch: string): Promise<RepoMergePullResult> {
  return call("repo_merge_branch", { repoId, branch }, () => fallback.mergeBranch(repoId, branch));
}

export function pushRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_push", { repoId }, () => fallback.pushRepo(repoId));
}

export function pushNewBranchRepo(
  repoId: string,
  remoteName?: string | null,
  branchName?: string | null,
): Promise<RepoSummary> {
  return call("repo_push_new_branch", { repoId, remoteName: remoteName ?? null, branchName: branchName ?? null }, () =>
    fallback.pushNewBranchRepo(repoId, remoteName, branchName),
  );
}

export function pushRepoWithSystemGit(repoId: string): Promise<RepoSummary> {
  return call("repo_push_with_system_git", { repoId }, () => fallback.pushRepoWithSystemGit(repoId));
}

export function useDefaultTokenAuthForRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("repo_use_default_token_auth", { repoId }, () => fallback.useDefaultTokenAuthForRepo(repoId));
}

export function checkoutBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_checkout_branch", { repoId, branch }, () => fallback.checkoutBranch(repoId, branch));
}

export function createBranch(
  repoId: string,
  name: string,
  fromRef: string,
  checkoutAfter: boolean,
): Promise<RepoSummary> {
  return call("repo_create_branch", { repoId, name, fromRef, checkoutAfter }, () =>
    fallback.createBranch(repoId, name, fromRef, checkoutAfter),
  );
}

export function renameBranch(
  repoId: string,
  oldName: string,
  newName: string,
): Promise<RepoSummary> {
  return call("repo_rename_branch", { repoId, oldName, newName }, () =>
    fallback.renameBranch(repoId, oldName, newName),
  );
}

export function deleteBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_delete_branch", { repoId, branch }, () => fallback.deleteBranch(repoId, branch));
}

export function setBranchUpstream(
  repoId: string,
  branch: string,
  upstream: string,
): Promise<RepoSummary> {
  return call("repo_set_upstream", { repoId, branch, upstream }, () =>
    fallback.setBranchUpstream(repoId, branch, upstream),
  );
}

export function listRepoStashes(repoId: string): Promise<RepoStashEntry[]> {
  return call("repo_list_stashes", { repoId }, () => fallback.listRepoStashes(repoId));
}

export function getRepoStashDetail(repoId: string, stashId: string): Promise<RepoStashDetail> {
  return call("repo_get_stash_detail", { repoId, stashId }, () => fallback.getRepoStashDetail(repoId, stashId));
}

export function saveRepoStash(repoId: string, message?: string | null): Promise<RepoSummary> {
  return call("repo_stash_save", { repoId, message: message ?? null }, () =>
    fallback.saveRepoStash(repoId, message),
  );
}

export function applyRepoStash(repoId: string, stashId: string): Promise<RepoOperationResult> {
  return call("repo_stash_apply", { repoId, stashId }, () => fallback.applyRepoStash(repoId, stashId));
}

export function popRepoStash(repoId: string, stashId: string): Promise<RepoOperationResult> {
  return call("repo_stash_pop", { repoId, stashId }, () => fallback.popRepoStash(repoId, stashId));
}

export function dropRepoStash(repoId: string, stashId: string): Promise<RepoStashEntry[]> {
  return call("repo_stash_drop", { repoId, stashId }, () => fallback.dropRepoStash(repoId, stashId));
}

export function listRepoRemotes(repoId: string): Promise<RepoRemote[]> {
  return call("repo_list_remotes", { repoId }, () => fallback.listRepoRemotes(repoId));
}

export function cherryPickRepoCommit(repoId: string, hash: string): Promise<RepoOperationResult> {
  return call("repo_cherry_pick_commit", { repoId, hash }, () => fallback.cherryPickRepoCommit(repoId, hash));
}

export function revertRepoCommit(repoId: string, hash: string): Promise<RepoOperationResult> {
  return call("repo_revert_commit", { repoId, hash }, () => fallback.revertRepoCommit(repoId, hash));
}

export function resetRepoToCommit(
  repoId: string,
  hash: string,
  mode: RepoResetMode = "mixed",
): Promise<RepoSummary> {
  return call("repo_reset_to_commit", { repoId, hash, mode }, () => fallback.resetRepoToCommit(repoId, hash, mode));
}

export function getRepoConflicts(repoId: string): Promise<RepoConflictState> {
  return call("repo_get_conflicts", { repoId }, () => fallback.getRepoConflicts(repoId));
}

export function acceptConflictFile(
  repoId: string,
  path: string,
  side: "ours" | "theirs",
  stage = true,
): Promise<RepoSummary> {
  return call("repo_accept_conflict_file", { repoId, path, side, stage }, () =>
    fallback.acceptConflictFile(repoId, path, side, stage),
  );
}

export function resolveConflictFile(
  repoId: string,
  path: string,
  choices: RepoConflictChoice[],
  stage = true,
): Promise<RepoSummary> {
  return call("repo_resolve_conflict_file", { repoId, path, choices, stage }, () =>
    fallback.resolveConflictFile(repoId, path, choices, stage),
  );
}

export function markFileResolved(repoId: string, path: string): Promise<RepoSummary> {
  return call("repo_mark_file_resolved", { repoId, path }, () => fallback.markFileResolved(repoId, path));
}

export function abortConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_abort_conflict_operation", { repoId }, () => fallback.abortConflictOperation(repoId));
}

export function continueConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_continue_conflict_operation", { repoId }, () => fallback.continueConflictOperation(repoId));
}

export function bulkSyncPreview(operation: BulkOperation, repos: RepoSummary[]): Promise<BulkSyncPreview> {
  return call("bulk_sync_preview", { operation, repos }, () => fallback.bulkSyncPreview(operation, repos));
}

export function bulkSyncExecute(operation: BulkOperation, repoIds: string[]): Promise<BulkSyncResult[]> {
  return call("bulk_sync_execute", { operation, repoIds }, () => fallback.bulkSyncExecute(operation, repoIds));
}

export function openPath(path: string): Promise<void> {
  return call("system_open_path", { path }, () => fallback.openPath(path));
}

export function openPathTarget(path: string, target: SystemOpenTarget): Promise<void> {
  return call("system_open_path_target", { path, target }, () => fallback.openPathTarget(path, target));
}

export function openUrl(url: string): Promise<void> {
  return call("system_open_url", { url }, () => fallback.openUrl(url));
}
