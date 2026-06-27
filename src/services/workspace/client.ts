import { invoke } from "../../tauri/runtime";
import { createCachedAsyncModule } from "../../utils/asyncModule";
import { parseRemoteRepoId } from "../../utils/remoteRepo";
import type { WorkspaceCommandArgs, WorkspaceCommandName, WorkspaceCommandResult } from "./contracts";
import { WORKSPACE_COMMAND_MANIFEST } from "./manifest";
import type {
  BulkOperation,
  BulkSyncPreview,
  BulkSyncResult,
  BranchSummary,
  CommitDetail,
  CommitSummary,
  GitHubBindingStatus,
  GitHubAttachWorkflowArtifactAssetRequest,
  GitHubCommitListOptions,
  GitHubContributionResult,
  GitHubCreateIssueRequest,
  GitHubCreateRepoRequest,
  GitHubCreateReleaseRequest,
  GitHubDeviceFlowPollResult,
  GitHubDeviceFlowStart,
  GitHubIssueDiscussion,
  GitHubIssue,
  GitHubIssueFilterMetadata,
  GitHubIssueListOptions,
  GitHubMergePullRequestRequest,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDiscussion,
  GitHubPullRequestListOptions,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubRepoManagement,
  GitHubRepoOwner,
  GitHubRepoPage,
  GitHubRepoSummary,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowJobLog,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  GitHubCreatePullRequestRequest,
  GitHubUpdatePullRequestRequest,
  GitHubUpdateReleaseRequest,
  GitHubUpdateIssueRequest,
  GitHubUpdateRepoSettingsRequest,
  HiddenRepo,
  KeyboardShortcutActionId,
  KeyboardShortcutBinding,
  ProjectLaunchConfig,
  ProjectLaunchCandidate,
  ProjectLaunchHistoryEntry,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoConflictChoice,
  RepoConflictState,
  RepoDetail,
  RepoFilePreview,
  RepoFileTreeEntry,
  RepoMergePullResult,
  RepoOperationResult,
  RepoPullLocalChangesMode,
  RepoRemote,
  RepoRefreshSummaryOptions,
  RepoResetMode,
  RepoSummary,
  RepoSyncPreference,
  RepoStashEntry,
  RepoStashDetail,
  RemoteRepoShortcut,
  SystemOpenTarget,
  WorkspaceTask,
  WorkspaceSettings,
  WorkspaceStartupCache,
  WorkspaceStartupContributions,
  WorkspaceCreateLocalRepoRequest,
} from "./types";

const isTest = typeof import.meta !== "undefined" && import.meta.env?.MODE === "test";
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
const agentDebugMockWorkspace = typeof import.meta !== "undefined"
  && import.meta.env?.DEV === true
  && import.meta.env?.VITE_LILIA_GITHUB_AGENT_DEBUG_MOCK_WORKSPACE === "1";
const GITHUB_REPO_CACHE_TTL_MS = 5 * 60 * 1000;
type WorkspaceFallback = typeof import("./fallback");

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
};

let githubRepoCache: {
  items: GitHubRepoPage["items"];
  nextPage: number | null;
  fetchedAt: number;
} | null = null;
let githubRepoPreloadPromise: Promise<GitHubRepoPage> | null = null;
const githubProjectCache = new Map<string, GitHubProjectRepoClientCache>();
const pendingWorkspaceReads = new Map<string, Promise<unknown>>();
const workspaceFallbackModuleLoader = createCachedAsyncModule(() => import("./fallback"));
let workspaceFallbackModule: WorkspaceFallback | null = null;

export function resolveWorkspaceRuntimeForTests(probe: {
  hasWindow: boolean;
  hasTauriInternals: boolean;
  isDev: boolean;
  isTest: boolean;
  agentDebugMockWorkspace?: boolean;
}): "tauri" | "mock" | "unavailable" {
  if (probe.agentDebugMockWorkspace && probe.hasWindow && probe.isDev) return "mock";
  if (probe.hasTauriInternals && !probe.isTest) return "tauri";
  if (probe.isTest || (probe.hasWindow && probe.isDev)) return "mock";
  return "unavailable";
}

async function loadWorkspaceFallback() {
  if (isDev || isTest) {
    const module = await workspaceFallbackModuleLoader.load();
    workspaceFallbackModule = module;
    return module;
  }
  throw new Error("Workspace mock data is only available in development and test mode.");
}

function workspaceFallback() {
  if (!workspaceFallbackModule) {
    throw new Error("Workspace mock data has not been loaded.");
  }
  return workspaceFallbackModule;
}

export async function workspaceFallbackForTests(): Promise<WorkspaceFallback> {
  if (!isTest) {
    throw new Error("Workspace fallback test helpers are only available in test mode.");
  }
  return loadWorkspaceFallback();
}

export async function resetWorkspaceFallbacksForTests(): Promise<void> {
  if (!isTest) {
    throw new Error("Workspace fallback test helpers are only available in test mode.");
  }
  workspaceFallbackModule?.resetWorkspaceFallbacksForTests();
}

async function call<TCommand extends WorkspaceCommandName>(
  command: TCommand,
  args: WorkspaceCommandArgs<TCommand>,
  fallbackCall: () => Promise<WorkspaceCommandResult<TCommand>>,
): Promise<WorkspaceCommandResult<TCommand>> {
  const commandEntry = WORKSPACE_COMMAND_MANIFEST[command];
  const hasWindow = typeof window !== "undefined";
  const runtime = resolveWorkspaceRuntimeForTests({
    hasWindow,
    hasTauriInternals: hasWindow && "__TAURI_INTERNALS__" in window,
    isDev,
    isTest,
    agentDebugMockWorkspace,
  });
  if (runtime === "tauri") {
    return invoke<WorkspaceCommandResult<TCommand>>(commandEntry.command, args);
  }
  if (runtime === "mock") {
    await loadWorkspaceFallback();
    return fallbackCall();
  }
  throw new Error(
    `Tauri command ${commandEntry.command} is unavailable outside Tauri. Use yarn tauri:dev, or yarn dev for the development mock mode.`,
  );
}

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return call("workspace_get_settings", undefined, () => workspaceFallback().getWorkspaceSettings());
}

export function readStartupCache(): Promise<WorkspaceStartupCache | null> {
  return call("workspace_read_startup_cache", undefined, () => workspaceFallback().readStartupCache());
}

export function clearStartupCache(): Promise<void> {
  return call("workspace_clear_startup_cache", undefined, () => workspaceFallback().clearStartupCache());
}

export function writeStartupContributions(contributions: WorkspaceStartupContributions): Promise<WorkspaceStartupCache> {
  return call("workspace_write_startup_contributions", { contributions }, () =>
    workspaceFallback().writeStartupContributions(contributions)
  );
}

export function setWorkspaceRoot(workspaceRoot: string): Promise<WorkspaceSettings> {
  return call("workspace_set_root", { workspaceRoot }, () => workspaceFallback().setWorkspaceRoot(workspaceRoot));
}

export function setKeyboardShortcut(
  actionId: KeyboardShortcutActionId,
  shortcut: KeyboardShortcutBinding | null,
): Promise<WorkspaceSettings> {
  return call("workspace_set_keyboard_shortcut", { actionId, shortcut }, () =>
    workspaceFallback().setKeyboardShortcut(actionId, shortcut)
  );
}

export function setRepoSetting(repoId: string, key: keyof RepoSyncPreference, value: boolean): Promise<WorkspaceSettings> {
  return call("repo_set_preference", { repoId, key, value }, () => workspaceFallback().setRepoSetting(repoId, key, value));
}

export function setRepoAutoSync(repoId: string, autoSync: boolean): Promise<WorkspaceSettings> {
  return call("repo_set_auto_sync", { repoId, autoSync }, () => workspaceFallback().setRepoAutoSync(repoId, autoSync));
}

export function pickWorkspaceRoot(): Promise<string | null> {
  return call("workspace_pick_root", undefined, () => workspaceFallback().pickWorkspaceRoot());
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

function workspaceReadCacheKey(command: string, args: unknown) {
  return `${command}:${JSON.stringify(args)}`;
}

function cachedWorkspaceRead<T>(
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

function cachedCall<TCommand extends WorkspaceCommandName>(
  command: TCommand,
  args: WorkspaceCommandArgs<TCommand>,
  fallback: () => Promise<WorkspaceCommandResult<TCommand>>,
  cacheArgs: unknown = args,
): Promise<WorkspaceCommandResult<TCommand>> {
  return cachedWorkspaceRead(command, cacheArgs, () => call(command, args, fallback));
}

function githubProjectRepoCache(repoFullName: string) {
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
  const creator = options.creator?.trim() ?? "";
  const assignee = options.assignee?.trim() ?? "";
  const labels = [...(options.labels ?? [])].map((label) => label.trim()).filter(Boolean).sort();
  const milestone = String(options.milestone ?? "").trim();
  const project = options.project?.trim() ?? "";
  const query = options.query?.trim() ?? "";
  return JSON.stringify({ state, perPage, sort, direction, since, creator, assignee, labels, milestone, project, query });
}

function normalizeGitHubPullRequestListOptions(
  stateOrOptions?: "open" | "closed" | "merged" | "all" | string | null | GitHubPullRequestListOptions,
): GitHubPullRequestListOptions {
  return typeof stateOrOptions === "object" && stateOrOptions != null
    ? stateOrOptions
    : { state: stateOrOptions ?? null };
}

function githubPullRequestCacheKey(options: GitHubPullRequestListOptions) {
  const state = options.state === "closed" || options.state === "merged" || options.state === "all"
    ? options.state
    : "open";
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 100));
  const sort = options.sort === "created" || options.sort === "comments" ? options.sort : "updated";
  const direction = options.direction === "asc" ? "asc" : "desc";
  const creator = options.creator?.trim() ?? "";
  const assignee = options.assignee?.trim() ?? "";
  const labels = [...(options.labels ?? [])].map((label) => label.trim()).filter(Boolean).sort();
  const milestone = String(options.milestone ?? "").trim();
  const project = options.project?.trim() ?? "";
  const review = options.review?.trim() ?? "";
  const query = options.query?.trim() ?? "";
  return JSON.stringify({ state, perPage, sort, direction, creator, assignee, labels, milestone, project, review, query });
}

function githubWorkflowRunsCacheKey(perPage?: number | null) {
  return Math.min(100, Math.max(1, perPage ?? 30));
}

function githubCommitListCacheKey(options: GitHubCommitListOptions = {}) {
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 100));
  const sha = options.sha?.trim() ?? "";
  return `${perPage}|${sha}`;
}

function githubFileListCacheKey(parentPath?: string | null, refName?: string | null) {
  return `${refName?.trim() ?? ""}|${parentPath?.trim() ?? ""}`;
}

function githubFilePreviewCacheKey(path: string, refName?: string | null) {
  return `${refName?.trim() ?? ""}|${path.trim()}`;
}

function upsertGitHubIssue(repoFullName: string, issue: GitHubIssue) {
  const cache = githubProjectRepoCache(repoFullName);
  for (const [key, items] of Object.entries(cache.issues)) {
    if (!items) continue;
    let state = "open";
    try {
      state = JSON.parse(key).state ?? "open";
    } catch {
      [state] = key.split("|");
    }
    const belongs = state === "all" || state === issue.state;
    const existing = items.some((item) => item.number === issue.number);
    if (!existing) continue;
    cache.issues[key] = belongs
      ? items.map((item) => item.number === issue.number ? cloneProjectData(issue) : cloneProjectData(item))
      : items.filter((item) => item.number !== issue.number).map((item) => cloneProjectData(item));
  }
}

function upsertGitHubPullRequest(repoFullName: string, pull: GitHubPullRequest) {
  const cache = githubProjectRepoCache(repoFullName);
  for (const [key, items] of Object.entries(cache.pullRequests)) {
    if (!items) continue;
    let state = "open";
    try {
      state = JSON.parse(key).state ?? "open";
    } catch {
      state = key;
    }
    const belongs =
      state === "all" ||
      (state === "merged" ? pull.merged : state === pull.state && (state !== "closed" || !pull.merged));
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

function upsertGitHubRelease(repoFullName: string, release: GitHubRelease) {
  const cache = githubProjectRepoCache(repoFullName);
  if (!cache.releases) return;
  const withoutRelease = cache.releases.filter((item) => item.id !== release.id);
  cache.releases = [cloneProjectData(release), ...cloneProjectList(withoutRelease)]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function upsertGitHubReleaseAsset(repoFullName: string, releaseId: number, asset: GitHubReleaseAsset) {
  const cache = githubProjectRepoCache(repoFullName);
  if (!cache.releases) return;
  cache.releases = cache.releases.map((release) => {
    if (release.id !== releaseId) return cloneProjectData(release);
    const assets = [
      cloneProjectData(asset),
      ...release.assets.filter((item) => item.id !== asset.id).map((item) => cloneProjectData(item)),
    ];
    return { ...cloneProjectData(release), assets };
  });
}

function removeGitHubRelease(repoFullName: string, releaseId: number) {
  const cache = githubProjectRepoCache(repoFullName);
  if (!cache.releases) return;
  cache.releases = cache.releases.filter((release) => release.id !== releaseId).map((release) => cloneProjectData(release));
}

function removeGitHubReleaseAsset(repoFullName: string, releaseId: number, assetId: number) {
  const cache = githubProjectRepoCache(repoFullName);
  if (!cache.releases) return;
  cache.releases = cache.releases.map((release) => {
    if (release.id !== releaseId) return cloneProjectData(release);
    return {
      ...cloneProjectData(release),
      assets: release.assets.filter((asset) => asset.id !== assetId).map((asset) => cloneProjectData(asset)),
    };
  });
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
  pendingWorkspaceReads.clear();
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
  return call("workspace_pick_repo", undefined, () => workspaceFallback().pickRepo());
}

export function pickFiles(): Promise<string[]> {
  return call("workspace_pick_files", undefined, () => workspaceFallback().pickFiles());
}

export function refreshRepos(): Promise<RepoSummary[]> {
  return call("workspace_refresh_repos", undefined, () => workspaceFallback().refreshRepos());
}

export function listManagedRepos(): Promise<RepoSummary[]> {
  return call("workspace_list_managed_repos", undefined, () => workspaceFallback().listManagedRepos());
}

export function discoverRepos(): Promise<RepoSummary[]> {
  return call("workspace_discover_repos", undefined, () => workspaceFallback().discoverRepos());
}

export function addRepo(repoPath: string): Promise<RepoSummary> {
  return call("workspace_add_repo", { repoPath }, () => workspaceFallback().addRepo(repoPath));
}

export function createLocalRepo(request: WorkspaceCreateLocalRepoRequest): Promise<RepoSummary> {
  return call("workspace_create_local_repo", { request }, () => workspaceFallback().createLocalRepo(request));
}

export function cloneRepo(remoteUrl: string, directoryName?: string | null): Promise<RepoSummary> {
  return call("workspace_clone_repo", { remoteUrl, directoryName: directoryName ?? null }, () =>
    workspaceFallback().cloneRepo(remoteUrl, directoryName),
  );
}

export function getRepoSummary(repoId: string): Promise<RepoSummary> {
  return call("repo_get_summary", { repoId }, () => workspaceFallback().getRepoSummary(repoId));
}

export function refreshRepoSummary(
  repoId: string,
  options: RepoRefreshSummaryOptions = {},
): Promise<RepoSummary> {
  return call("repo_refresh_summary", { repoId, options }, () => workspaceFallback().refreshRepoSummary(repoId, options));
}

export function hideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_hide_repo", { repoId }, () => workspaceFallback().hideRepo(repoId));
}

export function createRepoGroup(name: string): Promise<WorkspaceSettings> {
  return call("workspace_create_repo_group", { name }, () => workspaceFallback().createRepoGroup(name));
}

export function renameRepoGroup(groupId: string, name: string): Promise<WorkspaceSettings> {
  return call("workspace_rename_repo_group", { groupId, name }, () => workspaceFallback().renameRepoGroup(groupId, name));
}

export function deleteRepoGroup(groupId: string): Promise<WorkspaceSettings> {
  return call("workspace_delete_repo_group", { groupId }, () => workspaceFallback().deleteRepoGroup(groupId));
}

export function moveRepoToGroup(repoId: string, groupId: string | null): Promise<WorkspaceSettings> {
  return call("workspace_move_repo_to_group", { repoId, groupId }, () => workspaceFallback().moveRepoToGroup(repoId, groupId));
}

export function deleteLocalRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_delete_local_repo", { repoId }, () => workspaceFallback().deleteLocalRepo(repoId));
}

export function rememberRemoteRepo(repo: RemoteRepoShortcut): Promise<WorkspaceSettings> {
  return call("workspace_remember_remote_repo", { repo }, () => workspaceFallback().rememberRemoteRepo(repo));
}

export function forgetRemoteRepo(fullName: string): Promise<WorkspaceSettings> {
  return call("workspace_forget_remote_repo", { fullName }, () => workspaceFallback().forgetRemoteRepo(fullName));
}

export function unhideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_unhide_repo", { repoId }, () => workspaceFallback().unhideRepo(repoId));
}

export function listHiddenRepos(): Promise<HiddenRepo[]> {
  return call("workspace_list_hidden_repos", undefined, () => workspaceFallback().listHiddenRepos());
}

export function listWorkspaceTasks(): Promise<WorkspaceTask[]> {
  return call("workspace_list_tasks", undefined, () => workspaceFallback().listWorkspaceTasks());
}

export function cancelWorkspaceTask(taskId: string): Promise<void> {
  return call("workspace_cancel_task", { taskId }, () => workspaceFallback().cancelWorkspaceTask(taskId));
}

export async function getGitHubBindingStatus(): Promise<GitHubBindingStatus> {
  const status = await call("github_get_binding_status", undefined, () => workspaceFallback().getGitHubBindingStatus());
  if (status.state !== "bound") clearGitHubRepoCache();
  return status;
}

export function startGitHubDeviceFlow(): Promise<GitHubDeviceFlowStart> {
  return call("github_start_device_flow", undefined, () => workspaceFallback().startGitHubDeviceFlow());
}

export function pollGitHubDeviceFlow(
  deviceCode: string,
  intervalSeconds?: number | null,
): Promise<GitHubDeviceFlowPollResult> {
  return call("github_poll_device_flow", { deviceCode, intervalSeconds: intervalSeconds ?? null }, () =>
    workspaceFallback().pollGitHubDeviceFlow(deviceCode, intervalSeconds),
  );
}

export function listRepoContribution(repoScope: string): Promise<GitHubContributionResult> {
  return call("github_list_repo_contribution", { repoFullName: repoScope }, () =>
    workspaceFallback().listRepoContribution(repoScope),
  );
}

export async function listGitHubRepos(page?: number | null): Promise<GitHubRepoPage> {
  const pageNo = page ?? null;
  const result = await cachedCall("github_list_repos", { page: pageNo }, () =>
    workspaceFallback().listGitHubRepos(pageNo),
  ).catch((err) => {
    if (isGitHubBindingExpiredError(err)) clearGitHubRepoCache();
    throw err;
  });
  if ((pageNo ?? 1) === 1) writeGitHubRepoCache(result);
  return cloneRepoPage(result);
}

export function listGitHubRepoOwners(): Promise<GitHubRepoOwner[]> {
  return call("github_list_repo_owners", undefined, () => workspaceFallback().listGitHubRepoOwners());
}

export async function createGitHubRepo(request: GitHubCreateRepoRequest): Promise<GitHubRepoSummary> {
  const repo = await call("github_create_repo", { request }, () => workspaceFallback().createGitHubRepo(request));
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
  const args = {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_repo_management", args, () => workspaceFallback().getGitHubRepoManagement(repoFullName))
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
    workspaceFallback().updateGitHubRepoSettings(repoFullName, request),
  ).then((repo) => {
    githubProjectRepoCache(repoFullName).management = cloneProjectData(repo);
    return cloneProjectData(repo);
  });
}

export async function deleteGitHubRepo(repoFullName: string): Promise<void> {
  await call("github_delete_repo", { repoFullName }, () => workspaceFallback().deleteGitHubRepo(repoFullName));
  clearGitHubRepoCache();
  clearGitHubProjectRepoCache(repoFullName);
}

export function listGitHubBranches(repoFullName: string): Promise<BranchSummary[]> {
  return call("github_list_branches", { repoFullName }, () => workspaceFallback().listGitHubBranches(repoFullName));
}

export function deleteGitHubBranch(repoFullName: string, branchName: string): Promise<void> {
  return call("github_delete_branch", { repoFullName, branchName }, () =>
    workspaceFallback().deleteGitHubBranch(repoFullName, branchName)
  );
}

export function listGitHubPullRequests(
  repoFullName: string,
  stateOrOptions?: "open" | "closed" | "merged" | "all" | string | null | GitHubPullRequestListOptions,
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<GitHubPullRequest[]> {
  const options = normalizeGitHubPullRequestListOptions(stateOrOptions);
  const cache = githubProjectRepoCache(repoFullName);
  const key = githubPullRequestCacheKey(options);
  const cached = cache.pullRequests[key];
  if (!fetchOptions.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  const args = {
    repoFullName,
    state: options.state ?? null,
    perPage: options.perPage ?? null,
    sort: options.sort ?? null,
    direction: options.direction ?? null,
    creator: options.creator ?? null,
    assignee: options.assignee ?? null,
    labels: options.labels ?? null,
    milestone: options.milestone ?? null,
    project: options.project ?? null,
    review: options.review ?? null,
    query: options.query ?? null,
    forceRefresh: fetchOptions.forceRefresh ?? null,
  };
  return cachedCall("github_list_pull_requests", args, () => workspaceFallback().listGitHubPullRequests(repoFullName, options))
    .then((pulls) => {
      cache.pullRequests[key] = cloneProjectList(pulls);
      return cloneProjectList(pulls);
    });
}

export function getGitHubPullRequest(repoFullName: string, pullNumber: number): Promise<GitHubPullRequest> {
  return call("github_get_pull_request", { repoFullName, pullNumber }, () =>
    workspaceFallback().getGitHubPullRequest(repoFullName, pullNumber),
  );
}

export function getGitHubPullRequestDiscussion(
  repoFullName: string,
  pullNumber: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubPullRequestDiscussion> {
  const cache = githubProjectRepoCache(repoFullName);
  const cached = cache.pullRequestDiscussions[pullNumber];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    pullNumber,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_pull_request_discussion", args, () =>
    workspaceFallback().getGitHubPullRequestDiscussion(repoFullName, pullNumber)
  )
    .then((discussion) => {
      cache.pullRequestDiscussions[pullNumber] = cloneProjectData(discussion);
      upsertGitHubPullRequest(repoFullName, discussion.pullRequest);
      return cloneProjectData(discussion);
    });
}

export function createGitHubPullRequest(
  repoFullName: string,
  request: GitHubCreatePullRequestRequest,
): Promise<GitHubPullRequest> {
  return call("github_create_pull_request", { repoFullName, request }, () =>
    workspaceFallback().createGitHubPullRequest(repoFullName, request),
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
    workspaceFallback().updateGitHubPullRequest(repoFullName, pullNumber, request),
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
    workspaceFallback().mergeGitHubPullRequest(repoFullName, pullNumber, request),
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
  const args = {
    repoFullName,
    pullNumber,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_list_pull_request_checks", args, () =>
    workspaceFallback().listGitHubPullRequestChecks(repoFullName, pullNumber)
  )
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
  const args = {
    repoFullName,
    state: options.state ?? null,
    perPage: options.perPage ?? null,
    sort: options.sort ?? null,
    direction: options.direction ?? null,
    since: options.since ?? null,
    creator: options.creator ?? null,
    assignee: options.assignee ?? null,
    labels: options.labels ?? null,
    milestone: options.milestone ?? null,
    project: options.project ?? null,
    query: options.query ?? null,
    forceRefresh: fetchOptions.forceRefresh ?? null,
  };
  return cachedCall("github_list_issues", args, () => workspaceFallback().listGitHubIssues(repoFullName, options))
    .then((issues) => {
      cache.issues[key] = cloneProjectList(issues);
      return cloneProjectList(issues);
    });
}

export function getGitHubIssueDiscussion(
  repoFullName: string,
  issueNumber: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubIssueDiscussion> {
  const cache = githubProjectRepoCache(repoFullName);
  const cached = cache.issueDiscussions[issueNumber];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    issueNumber,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_issue_discussion", args, () =>
    workspaceFallback().getGitHubIssueDiscussion(repoFullName, issueNumber)
  )
    .then((discussion) => {
      cache.issueDiscussions[issueNumber] = cloneProjectData(discussion);
      upsertGitHubIssue(repoFullName, discussion.issue);
      return cloneProjectData(discussion);
    });
}

export function getGitHubIssueFilterMetadata(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubIssueFilterMetadata> {
  const cache = githubProjectRepoCache(repoFullName);
  if (!options.forceRefresh && cache.issueFilterMetadata) {
    return Promise.resolve(cloneProjectData(cache.issueFilterMetadata));
  }
  const args = {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_issue_filter_metadata", args, () =>
    workspaceFallback().getGitHubIssueFilterMetadata(repoFullName)
  )
    .then((metadata) => {
      cache.issueFilterMetadata = cloneProjectData(metadata);
      return cloneProjectData(metadata);
    });
}

function listGitHubIssueValues(
  repoFullName: string,
  options: GitHubProjectFetchOptions,
  cacheKey: "issueLabels" | "issueAssignees",
  command: "github_list_issue_labels" | "github_list_issue_assignees",
  fallbackCall: () => Promise<string[]>,
): Promise<string[]> {
  const cache = githubProjectRepoCache(repoFullName);
  const cached = cache[cacheKey];
  if (!options.forceRefresh && cached) return Promise.resolve([...cached]);
  const args = {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall(command, args, fallbackCall)
    .then((values) => {
      cache[cacheKey] = [...values];
      return [...values];
    });
}

export function listGitHubIssueLabels(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<string[]> {
  return listGitHubIssueValues(repoFullName, options, "issueLabels", "github_list_issue_labels", () =>
    workspaceFallback().listGitHubIssueLabels(repoFullName)
  );
}

export function listGitHubIssueAssignees(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<string[]> {
  return listGitHubIssueValues(repoFullName, options, "issueAssignees", "github_list_issue_assignees", () =>
    workspaceFallback().listGitHubIssueAssignees(repoFullName)
  );
}

export function createGitHubIssue(
  repoFullName: string,
  request: GitHubCreateIssueRequest,
): Promise<GitHubIssue> {
  return call("github_create_issue", { repoFullName, request }, () =>
    workspaceFallback().createGitHubIssue(repoFullName, request),
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
    workspaceFallback().updateGitHubIssue(repoFullName, issueNumber, request),
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
  const args = {
    repoFullName,
    perPage: perPage ?? null,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_list_workflow_runs", args, () =>
    workspaceFallback().listGitHubWorkflowRuns(repoFullName, perPage)
  )
    .then((runs) => {
      cache.workflowRuns[key] = cloneProjectList(runs);
      return cloneProjectList(runs);
    });
}

export function getGitHubWorkflowRunDetail(
  repoFullName: string,
  runId: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubWorkflowRunDetail> {
  const cache = githubProjectRepoCache(repoFullName);
  const cached = cache.workflowRunDetails[runId];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    runId,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_workflow_run_detail", args, () =>
    workspaceFallback().getGitHubWorkflowRunDetail(repoFullName, runId)
  )
    .then((detail) => {
      cache.workflowRunDetails[runId] = cloneProjectData(detail);
      return cloneProjectData(detail);
    });
}

export function getGitHubWorkflowJobLog(
  repoFullName: string,
  jobId: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubWorkflowJobLog> {
  const cache = githubProjectRepoCache(repoFullName);
  const cached = cache.workflowJobLogs[jobId];
  if (!options.forceRefresh && cached) return Promise.resolve({ ...cached });
  const args = {
    repoFullName,
    jobId,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_workflow_job_log", args, () =>
    workspaceFallback().getGitHubWorkflowJobLog(repoFullName, jobId)
  )
    .then((log) => {
      cache.workflowJobLogs[jobId] = { ...log };
      return { ...log };
    });
}

export function listGitHubWorkflowArtifactFiles(
  repoFullName: string,
  artifactId: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubWorkflowArtifactEntry[]> {
  const cache = githubProjectRepoCache(repoFullName);
  const cached = cache.workflowArtifactEntries[artifactId];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  const args = {
    repoFullName,
    artifactId,
  };
  return cachedCall("github_list_workflow_artifact_files", args, () =>
    workspaceFallback().listGitHubWorkflowArtifactFiles(repoFullName, artifactId)
  )
    .then((entries) => {
      cache.workflowArtifactEntries[artifactId] = cloneProjectList(entries);
      return cloneProjectList(entries);
    });
}

export function getGitHubWorkflowArtifactFilePreview(
  repoFullName: string,
  artifactId: number,
  path: string,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoFilePreview> {
  const cache = githubProjectRepoCache(repoFullName);
  const key = `${artifactId}:${path}`;
  const cached = cache.workflowArtifactPreviews[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    artifactId,
    path,
  };
  return cachedCall("github_get_workflow_artifact_file_preview", args, () =>
    workspaceFallback().getGitHubWorkflowArtifactFilePreview(repoFullName, artifactId, path)
  )
    .then((preview) => {
      cache.workflowArtifactPreviews[key] = cloneProjectData(preview);
      return cloneProjectData(preview);
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
  const args = {
    repoFullName,
    perPage: options.perPage ?? null,
    sha: options.sha ?? null,
    forceRefresh: fetchOptions.forceRefresh ?? null,
  };
  return cachedCall("github_list_repo_commits", args, () =>
    workspaceFallback().listGitHubRepoCommits(repoFullName, options)
  )
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
  const args = {
    repoFullName,
    hash: normalizedHash,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_repo_commit_detail", args, () =>
    workspaceFallback().getGitHubRepoCommitDetail(repoFullName, normalizedHash)
  )
    .then((detail) => {
      cache.commitDetails[detail.hash] = cloneProjectData(detail);
      if (normalizedHash && normalizedHash !== detail.hash) {
        cache.commitDetails[normalizedHash] = cloneProjectData(detail);
      }
      return cloneProjectData(detail);
    });
}

export function listGitHubReleases(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubRelease[]> {
  const cache = githubProjectRepoCache(repoFullName);
  if (!options.forceRefresh && cache.releases) return Promise.resolve(cloneProjectList(cache.releases));
  const args = {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_list_releases", args, () => workspaceFallback().listGitHubReleases(repoFullName))
    .then((releases) => {
      cache.releases = cloneProjectList(releases);
      return cloneProjectList(releases);
    });
}

export function createGitHubRelease(
  repoFullName: string,
  request: GitHubCreateReleaseRequest,
): Promise<GitHubRelease> {
  return call("github_create_release", { repoFullName, request }, () =>
    workspaceFallback().createGitHubRelease(repoFullName, request)
  ).then((release) => {
    upsertGitHubRelease(repoFullName, release);
    return cloneProjectData(release);
  });
}

export function updateGitHubRelease(
  repoFullName: string,
  releaseId: number,
  request: GitHubUpdateReleaseRequest,
): Promise<GitHubRelease> {
  return call("github_update_release", { repoFullName, releaseId, request }, () =>
    workspaceFallback().updateGitHubRelease(repoFullName, releaseId, request)
  ).then((release) => {
    upsertGitHubRelease(repoFullName, release);
    return cloneProjectData(release);
  });
}

export async function deleteGitHubRelease(repoFullName: string, releaseId: number): Promise<void> {
  await call("github_delete_release", { repoFullName, releaseId }, () =>
    workspaceFallback().deleteGitHubRelease(repoFullName, releaseId)
  );
  removeGitHubRelease(repoFullName, releaseId);
}

export function uploadGitHubReleaseAsset(
  repoFullName: string,
  releaseId: number,
  filePath: string,
  label?: string | null,
): Promise<GitHubReleaseAsset> {
  return call("github_upload_release_asset", { repoFullName, releaseId, filePath, label: label ?? null }, () =>
    workspaceFallback().uploadGitHubReleaseAsset(repoFullName, releaseId, filePath, label)
  ).then((asset) => {
    upsertGitHubReleaseAsset(repoFullName, releaseId, asset);
    return cloneProjectData(asset);
  });
}

export function attachGitHubWorkflowArtifactAsset(
  repoFullName: string,
  request: GitHubAttachWorkflowArtifactAssetRequest,
): Promise<GitHubReleaseAsset> {
  return call("github_attach_workflow_artifact_asset", { repoFullName, request }, () =>
    workspaceFallback().attachGitHubWorkflowArtifactAsset(repoFullName, request)
  ).then((asset) => {
    upsertGitHubReleaseAsset(repoFullName, request.releaseId, asset);
    return cloneProjectData(asset);
  });
}

export async function deleteGitHubReleaseAsset(
  repoFullName: string,
  releaseId: number,
  assetId: number,
): Promise<void> {
  await call("github_delete_release_asset", { repoFullName, releaseId, assetId }, () =>
    workspaceFallback().deleteGitHubReleaseAsset(repoFullName, releaseId, assetId)
  );
  removeGitHubReleaseAsset(repoFullName, releaseId, assetId);
}

export function getRepoDetail(repoId: string): Promise<RepoDetail> {
  return cachedCall("repo_get_detail", { repoId }, () => workspaceFallback().getRepoDetail(repoId));
}

export function listGitHubRepoFiles(
  repoFullName: string,
  parentPath?: string | null,
  refName?: string | null,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoFileTreeEntry[]> {
  const cache = githubProjectRepoCache(repoFullName);
  const key = githubFileListCacheKey(parentPath, refName);
  const cached = cache.files[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  const args = {
    repoFullName,
    parentPath: parentPath ?? null,
    refName: refName ?? null,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_list_repo_files", args, () =>
    workspaceFallback().listGitHubRepoFiles(repoFullName, parentPath, refName)
  )
    .then((entries) => {
      cache.files[key] = cloneProjectList(entries);
      return cloneProjectList(entries);
    });
}

export function getGitHubRepoFilePreview(
  repoFullName: string,
  path: string,
  refName?: string | null,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoFilePreview> {
  const normalizedPath = path.trim();
  const cache = githubProjectRepoCache(repoFullName);
  const key = githubFilePreviewCacheKey(normalizedPath, refName);
  const cached = cache.filePreviews[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    path: normalizedPath,
    refName: refName ?? null,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_repo_file_preview", args, () =>
    workspaceFallback().getGitHubRepoFilePreview(repoFullName, normalizedPath, refName)
  )
    .then((preview) => {
      cache.filePreviews[key] = cloneProjectData(preview);
      return cloneProjectData(preview);
    });
}

export function listRepoFiles(repoId: string, parentPath?: string | null, repoRef?: string | null): Promise<RepoFileTreeEntry[]> {
  const remoteFullName = parseRemoteRepoId(repoId);
  if (remoteFullName) return listGitHubRepoFiles(remoteFullName, parentPath, repoRef);
  const args = { repoId, parentPath: parentPath ?? null };
  const cacheArgs = { ...args, repoRef: repoRef ?? null };
  return cachedCall("repo_list_files", args, () =>
    workspaceFallback().listRepoFiles(repoId, parentPath, repoRef),
    cacheArgs,
  );
}

export function getRepoFilePreview(repoId: string, path: string, repoRef?: string | null): Promise<RepoFilePreview> {
  const remoteFullName = parseRemoteRepoId(repoId);
  if (remoteFullName) return getGitHubRepoFilePreview(remoteFullName, path, repoRef);
  const args = { repoId, path };
  const cacheArgs = { ...args, repoRef: repoRef ?? null };
  return cachedCall("repo_get_file_preview", args, () =>
    workspaceFallback().getRepoFilePreview(repoId, path, repoRef),
    cacheArgs,
  );
}

export function refreshRepoLanguageStats(repoId: string): Promise<RepoSummary> {
  return call("repo_refresh_language_stats", { repoId }, () => workspaceFallback().refreshRepoLanguageStats(repoId));
}

export function getRepoCommitDetail(repoId: string, hash: string): Promise<CommitDetail> {
  const remoteFullName = parseRemoteRepoId(repoId);
  if (remoteFullName) return getGitHubRepoCommitDetail(remoteFullName, hash);
  return cachedCall("repo_get_commit_detail", { repoId, hash }, () =>
    workspaceFallback().getRepoCommitDetail(repoId, hash)
  );
}

export function getRepoLaunchConfig(repoId: string): Promise<ProjectLaunchConfig | null> {
  return call("repo_get_launch_config", { repoId }, () => workspaceFallback().getRepoLaunchConfig(repoId));
}

export function listRepoLaunchCandidates(repoId: string): Promise<ProjectLaunchCandidate[]> {
  return call("repo_list_launch_candidates", { repoId }, () => workspaceFallback().listRepoLaunchCandidates(repoId));
}

export function saveRepoLaunchConfig(
  repoId: string,
  command: string,
  cwd?: string | null,
): Promise<ProjectLaunchConfig> {
  return call("repo_save_launch_config", { repoId, command, cwd: cwd ?? null }, () =>
    workspaceFallback().saveRepoLaunchConfig(repoId, command, cwd),
  );
}

export function getRepoLaunchStatus(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_get_launch_status", { repoId }, () => workspaceFallback().getRepoLaunchStatus(repoId));
}

export function getRepoLaunchLogs(repoId: string, since?: number | null): Promise<ProjectLaunchLog[]> {
  return call("repo_get_launch_logs", { repoId, since: since ?? null }, () => workspaceFallback().getRepoLaunchLogs(repoId, since));
}

export function listRepoLaunchHistory(repoId: string): Promise<ProjectLaunchHistoryEntry[]> {
  return call("repo_list_launch_history", { repoId }, () => workspaceFallback().listRepoLaunchHistory(repoId));
}

export function startRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_start_launch", { repoId }, () => workspaceFallback().startRepoLaunch(repoId));
}

export function stopRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_stop_launch", { repoId }, () => workspaceFallback().stopRepoLaunch(repoId));
}

export function stageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_stage_files", { repoId, files }, () => workspaceFallback().stageFiles(repoId, files));
}

export function unstageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_unstage_files", { repoId, files }, () => workspaceFallback().unstageFiles(repoId, files));
}

export function discardFiles(repoId: string, files: string[]): Promise<RepoSummary> {
  return call("repo_discard_files", { repoId, files }, () => workspaceFallback().discardFiles(repoId, files));
}

export function addFilesToGitignore(repoId: string, files: string[]): Promise<RepoSummary> {
  return call("repo_add_files_to_gitignore", { repoId, files }, () => workspaceFallback().addFilesToGitignore(repoId, files));
}

export function commitRepo(
  repoId: string,
  files: string[],
  message: string,
  pushAfter: boolean,
): Promise<RepoSummary> {
  return call("repo_commit", { repoId, files, message, pushAfter }, () =>
    workspaceFallback().commitRepo(repoId, files, message, pushAfter),
  );
}

export function pullRepo(
  repoId: string,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoSummary> {
  return call("repo_pull", { repoId, localChangesMode }, () => workspaceFallback().pullRepo(repoId, localChangesMode));
}

export function mergePullRepo(
  repoId: string,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoMergePullResult> {
  return call("repo_merge_pull", { repoId, localChangesMode }, () => workspaceFallback().mergePullRepo(repoId, localChangesMode));
}

export function fetchRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_fetch", { repoId }, () => workspaceFallback().fetchRepo(repoId));
}

export function startRebaseRepo(
  repoId: string,
  ontoRef?: string | null,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoOperationResult> {
  return call("repo_start_rebase", { repoId, ontoRef: ontoRef ?? null, localChangesMode }, () =>
    workspaceFallback().startRebaseRepo(repoId, ontoRef, localChangesMode),
  );
}

export function mergeBranch(repoId: string, branch: string): Promise<RepoMergePullResult> {
  return call("repo_merge_branch", { repoId, branch }, () => workspaceFallback().mergeBranch(repoId, branch));
}

export function pushRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_push", { repoId }, () => workspaceFallback().pushRepo(repoId));
}

export function pushNewBranchRepo(
  repoId: string,
  remoteName?: string | null,
  branchName?: string | null,
): Promise<RepoSummary> {
  return call("repo_push_new_branch", { repoId, remoteName: remoteName ?? null, branchName: branchName ?? null }, () =>
    workspaceFallback().pushNewBranchRepo(repoId, remoteName, branchName),
  );
}

export function pushRepoWithSystemGit(repoId: string): Promise<RepoSummary> {
  return call("repo_push_with_system_git", { repoId }, () => workspaceFallback().pushRepoWithSystemGit(repoId));
}

export function useDefaultTokenAuthForRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("repo_use_default_token_auth", { repoId }, () => workspaceFallback().useDefaultTokenAuthForRepo(repoId));
}

export function checkoutBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_checkout_branch", { repoId, branch }, () => workspaceFallback().checkoutBranch(repoId, branch));
}

export function createBranch(
  repoId: string,
  name: string,
  fromRef: string,
  checkoutAfter: boolean,
): Promise<RepoSummary> {
  return call("repo_create_branch", { repoId, name, fromRef, checkoutAfter }, () =>
    workspaceFallback().createBranch(repoId, name, fromRef, checkoutAfter),
  );
}

export function renameBranch(
  repoId: string,
  oldName: string,
  newName: string,
): Promise<RepoSummary> {
  return call("repo_rename_branch", { repoId, oldName, newName }, () =>
    workspaceFallback().renameBranch(repoId, oldName, newName),
  );
}

export function deleteBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_delete_branch", { repoId, branch }, () => workspaceFallback().deleteBranch(repoId, branch));
}

export function setBranchUpstream(
  repoId: string,
  branch: string,
  upstream: string,
): Promise<RepoSummary> {
  return call("repo_set_upstream", { repoId, branch, upstream }, () =>
    workspaceFallback().setBranchUpstream(repoId, branch, upstream),
  );
}

export function listRepoStashes(repoId: string): Promise<RepoStashEntry[]> {
  return call("repo_list_stashes", { repoId }, () => workspaceFallback().listRepoStashes(repoId));
}

export function getRepoStashDetail(repoId: string, stashId: string): Promise<RepoStashDetail> {
  return call("repo_get_stash_detail", { repoId, stashId }, () => workspaceFallback().getRepoStashDetail(repoId, stashId));
}

export function saveRepoStash(repoId: string, message?: string | null): Promise<RepoSummary> {
  return call("repo_stash_save", { repoId, message: message ?? null }, () =>
    workspaceFallback().saveRepoStash(repoId, message),
  );
}

export function applyRepoStash(repoId: string, stashId: string): Promise<RepoOperationResult> {
  return call("repo_stash_apply", { repoId, stashId }, () => workspaceFallback().applyRepoStash(repoId, stashId));
}

export function popRepoStash(repoId: string, stashId: string): Promise<RepoOperationResult> {
  return call("repo_stash_pop", { repoId, stashId }, () => workspaceFallback().popRepoStash(repoId, stashId));
}

export function dropRepoStash(repoId: string, stashId: string): Promise<RepoStashEntry[]> {
  return call("repo_stash_drop", { repoId, stashId }, () => workspaceFallback().dropRepoStash(repoId, stashId));
}

export function listRepoRemotes(repoId: string): Promise<RepoRemote[]> {
  return call("repo_list_remotes", { repoId }, () => workspaceFallback().listRepoRemotes(repoId));
}

export function cherryPickRepoCommit(repoId: string, hash: string): Promise<RepoOperationResult> {
  return call("repo_cherry_pick_commit", { repoId, hash }, () => workspaceFallback().cherryPickRepoCommit(repoId, hash));
}

export function revertRepoCommit(repoId: string, hash: string): Promise<RepoOperationResult> {
  return call("repo_revert_commit", { repoId, hash }, () => workspaceFallback().revertRepoCommit(repoId, hash));
}

export function resetRepoToCommit(
  repoId: string,
  hash: string,
  mode: RepoResetMode = "mixed",
): Promise<RepoSummary> {
  return call("repo_reset_to_commit", { repoId, hash, mode }, () => workspaceFallback().resetRepoToCommit(repoId, hash, mode));
}

export function getRepoConflicts(repoId: string): Promise<RepoConflictState> {
  return call("repo_get_conflicts", { repoId }, () => workspaceFallback().getRepoConflicts(repoId));
}

export function acceptConflictFile(
  repoId: string,
  path: string,
  side: "ours" | "theirs",
  stage = true,
): Promise<RepoSummary> {
  return call("repo_accept_conflict_file", { repoId, path, side, stage }, () =>
    workspaceFallback().acceptConflictFile(repoId, path, side, stage),
  );
}

export function resolveConflictFile(
  repoId: string,
  path: string,
  choices: RepoConflictChoice[],
  stage = true,
): Promise<RepoSummary> {
  return call("repo_resolve_conflict_file", { repoId, path, choices, stage }, () =>
    workspaceFallback().resolveConflictFile(repoId, path, choices, stage),
  );
}

export function markFileResolved(repoId: string, path: string): Promise<RepoSummary> {
  return call("repo_mark_file_resolved", { repoId, path }, () => workspaceFallback().markFileResolved(repoId, path));
}

export function abortConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_abort_conflict_operation", { repoId }, () => workspaceFallback().abortConflictOperation(repoId));
}

export function continueConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_continue_conflict_operation", { repoId }, () => workspaceFallback().continueConflictOperation(repoId));
}

export function bulkSyncPreview(
  operation: BulkOperation,
  repos: RepoSummary[],
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<BulkSyncPreview> {
  return call("bulk_sync_preview", { operation, repos, localChangesMode }, () =>
    workspaceFallback().bulkSyncPreview(operation, repos, localChangesMode)
  );
}

export function bulkSyncExecute(
  operation: BulkOperation,
  repoIds: string[],
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<BulkSyncResult[]> {
  return call("bulk_sync_execute", { operation, repoIds, localChangesMode }, () =>
    workspaceFallback().bulkSyncExecute(operation, repoIds, localChangesMode)
  );
}

export function openPath(path: string): Promise<void> {
  return call("system_open_path", { path }, () => workspaceFallback().openPath(path));
}

export function openPathTarget(path: string, target: SystemOpenTarget): Promise<void> {
  return call("system_open_path_target", { path, target }, () => workspaceFallback().openPathTarget(path, target));
}

export function openUrl(url: string): Promise<void> {
  return call("system_open_url", { url }, () => workspaceFallback().openUrl(url));
}
