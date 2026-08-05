import { parseRemoteRepoId } from "../../utils/remoteRepo";
import {
  isConfirmedMissingResource,
  isGitHubBindingExpiredError,
  githubErrorCode,
  isGitHubPermissionError,
} from "../../utils/githubErrors";
import {
  ALL_GITHUB_REPOSITORIES,
  cloneProjectData,
  cloneProjectList,
  cloneGitHubRepoLicenses,
  cloneGitHubRepoOwners,
  cloneRepoPage,
  githubProjectRepoKey,
  createWorkspaceClientCache,
} from "./cache";
import type { GitHubProjectFetchOptions } from "./cache";
export type { GitHubProjectFetchOptions };
import type { WorkspaceCommandArgs, WorkspaceCommandName, WorkspaceCommandResult } from "./contracts";
import type {
  CreatePullRequestLineCommentRequest,
  ReplyPullRequestReviewThreadRequest,
  SubmitPullRequestCodeReviewRequest,
} from "../codeReview/types";
import type { HomeAttentionLoadOptions, HomeAttentionResult } from "../homeAttention/types";
import type { LiliaCodeTaskHandoff, LiliaCodeTaskHandoffStatus } from "../liliaCodeHandoff/types";
import type {
  GitHubCreateDiscussionCommentRequest,
  GitHubCreateRepositoryDiscussionRequest,
  GitHubDiscussionAnswerRequest,
  GitHubDiscussionReactionRequest,
  GitHubDiscussionStateRequest,
  GitHubRepositoryDiscussionListOptions,
  GitHubRepositoryDiscussionPageOptions,
  GitHubUpdateDiscussionCommentRequest,
} from "./discussions/types";
import { normalizeWorkspaceCommandError } from "./errors";
import {
  createRuntimeWorkspaceTransport,
  resolveWorkspaceRuntime,
  type WorkspaceTransport,
  type WorkspaceInvokeOptions,
  type WorkspaceRuntimeProbe,
} from "./transport";
import type {
  AccountPreferences,
  BulkOperation,
  BulkSyncPreview,
  BulkSyncResult,
  BranchSummary,
  CommitDetail,
  CommitSummary,
  GitHubBindingStatus,
  GitHubBranchProtection,
  GitHubActionNotification,
  GitHubAttachWorkflowArtifactAssetRequest,
  GitHubAccountIssueItem,
  GitHubAccountProfile,
  GitHubCommitListOptions,
  GitHubContributionResult,
  GitHubCreateIssueRequest,
  GitHubCreateRepoRequest,
  GitHubCreateReleaseRequest,
  GitHubDeviceFlowPollResult,
  GitHubDeviceFlowStart,
  GitHubIssueDiscussion,
  GitHubDiscussionTimelineItem,
  GitHubIssueCommentReactionRequest,
  GitHubIssueCommentRequest,
  GitHubIssue,
  GitHubIssueFilterMetadata,
  GitHubIssueListOptions,
  GitHubMergePullRequestRequest,
  GitHubOrganizationOverview,
  GitHubOrganizationProfile,
  GitHubOrganizationProfileView,
  GitHubProfileReadmeSection,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDiscussion,
  GitHubPullRequestListOptions,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubRepoActionsPermissionsRequest,
  GitHubRepoLicense,
  GitHubRepoManagement,
  GitHubRepoOwner,
  GitHubRepoPage,
  GitHubRepositorySubscription,
  GitHubRepositorySubscriptionMode,
  GitHubRepositoryScope,
  GitHubRepoTemplate,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
  GitHubRepoSummary,
  GitHubRuleset,
  GitHubRulesetSummary,
  GitHubWatchedRepoPage,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowJobLog,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  GitHubCreatePullRequestRequest,
  GitHubUpdatePullRequestRequest,
  GitHubUpdateAccountProfileRequest,
  GitHubUpdateReleaseRequest,
  GitHubUpdateIssueRequest,
  GitHubUpdateRepoSettingsRequest,
  GitHubRepoWorkflowPermissionsRequest,
  HiddenRepo,
  ProjectLaunchConfig,
  ProjectLaunchCandidate,
  ProjectLaunchHistoryEntry,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoConflictChoice,
  RepoConflictState,
  RepoCommitResult,
  RepoDetail,
  RepoDetailPatch,
  RepoDetailPatchRequest,
  RepoFilePreview,
  RepoFileTreeEntry,
  RepoMergePullResult,
  RepoOperationResult,
  RepoPullLocalChangesMode,
  RepoRemote,
  RepoRemoteSyncConfig,
  RepoRemoteSyncPolicy,
  RepoRefreshSummaryOptions,
  RepoResetMode,
  RepoSummary,
  RepoSyncOperationResult,
  RepoSyncPreference,
  RepoStashEntry,
  RepoStashDetail,
  RepoStorageStats,
  RemoteRepoShortcut,
  SystemOpenTarget,
  WorkspaceTask,
  WorkspaceBootstrap,
  WorkspaceRecentContextV1,
  WorkspaceViewPreferences,
  WorkspaceCloneResult,
  WorkspaceRepoRefreshRequest,
  WorkspaceSettings,
  WorkspaceStartupCache,
  WorkspaceStartupContributions,
  WorkspaceCloneRepoRequest,
  WorkspaceCreateLocalRepoRequest,
  WorkspaceRepoPathMode,
  WorkspaceRepoRelocationResult,
} from "./types";

const isTest = typeof import.meta !== "undefined" && import.meta.env?.MODE === "test";
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
const agentDebugMockWorkspace = typeof import.meta !== "undefined"
  && import.meta.env?.DEV === true
  && import.meta.env?.VITE_LILIA_GITHUB_AGENT_DEBUG_MOCK_WORKSPACE === "1";
const agentDebugRealHandoff = agentDebugMockWorkspace
  && import.meta.env?.VITE_LILIA_GITHUB_AGENT_DEBUG_REAL_HANDOFF === "1";
const GITHUB_REPO_CACHE_TTL_MS = 5 * 60 * 1000;
type WorkspaceFallback = typeof import("./fallback");

export function resolveWorkspaceRuntimeForTests(probe: WorkspaceRuntimeProbe) {
  return resolveWorkspaceRuntime(probe);
}

export function createDefaultWorkspaceTransport(): WorkspaceTransport {
  return createRuntimeWorkspaceTransport({
    probe: () => {
      const hasWindow = typeof window !== "undefined";
      return {
        hasWindow,
        hasTauriInternals: hasWindow && "__TAURI_INTERNALS__" in window,
        isDev,
        isTest,
        agentDebugMockWorkspace,
      };
    },
    loadMockTransport: async () => {
      const { createWorkspaceMockTransport } = await import("./mockTransport");
      return createWorkspaceMockTransport();
    },
  });
}

export async function workspaceFallbackForTests(): Promise<WorkspaceFallback> {
  if (!isTest) {
    throw new Error("Workspace fallback test helpers are only available in test mode.");
  }
  return (await import("./mockTransport")).loadWorkspaceFallbackModule();
}

export async function resetWorkspaceFallbacksForTests(): Promise<void> {
  if (!isTest) {
    throw new Error("Workspace fallback test helpers are only available in test mode.");
  }
  const fallback = await workspaceFallbackForTests();
  fallback.resetWorkspaceFallbacksForTests();
}

export {
  isConfirmedMissingResource,
  isGitHubBindingExpiredError,
  githubErrorCode,
  isGitHubPermissionError,
};

export function createWorkspaceClient(workspaceTransport: WorkspaceTransport) {
  const workspaceCache = createWorkspaceClientCache();

async function call<TCommand extends WorkspaceCommandName>(
  command: TCommand,
  args: WorkspaceCommandArgs<TCommand>,
  options: WorkspaceInvokeOptions = {},
): Promise<WorkspaceCommandResult<TCommand>> {
  try {
    return await workspaceTransport.invoke(command, args, options);
  } catch (error) {
    throw normalizeWorkspaceCommandError(error);
  }
}

function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return call("workspace_get_settings", undefined);
}

function getWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  return call("workspace_get_bootstrap", undefined);
}

function readStartupCache(): Promise<WorkspaceStartupCache | null> {
  return call("workspace_read_startup_cache", undefined);
}

function clearStartupCache(): Promise<void> {
  return call("workspace_clear_startup_cache", undefined);
}

function writeStartupContributions(contributions: WorkspaceStartupContributions): Promise<WorkspaceStartupCache> {
  return call("workspace_write_startup_contributions", { contributions });
}

function createWorkspace(name: string, rootPath: string): Promise<WorkspaceBootstrap> {
  return call("workspace_create", { name, rootPath });
}

function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSettings> {
  return call("workspace_rename", { workspaceId, name });
}

function deleteWorkspace(workspaceId: string): Promise<WorkspaceBootstrap> {
  return call("workspace_delete", { workspaceId });
}

function switchWorkspace(workspaceId: string): Promise<WorkspaceBootstrap> {
  return call("workspace_switch", { workspaceId });
}

function addWorkspaceRoot(workspaceId: string, rootPath: string): Promise<WorkspaceBootstrap> {
  return call("workspace_add_root", { workspaceId, rootPath });
}

function removeWorkspaceRoot(workspaceId: string, rootId: string): Promise<WorkspaceBootstrap> {
  return call("workspace_remove_root", { workspaceId, rootId });
}

function setPrimaryWorkspaceRoot(workspaceId: string, rootId: string): Promise<WorkspaceBootstrap> {
  return call("workspace_set_primary_root", { workspaceId, rootId });
}

function updateWorkspaceViewPreferences(preferences: WorkspaceViewPreferences): Promise<WorkspaceSettings> {
  return call("workspace_update_view_preferences", { preferences });
}

function updateWorkspaceRecentContext(
  workspaceId: string,
  context: WorkspaceRecentContextV1 | null,
): Promise<void> {
  return call("workspace_update_recent_context", { workspaceId, context });
}

function updateAccountPreferences(preferences: AccountPreferences): Promise<WorkspaceSettings> {
  return call("workspace_update_account_preferences", { preferences });
}

function setContributionIdentities(identities: import("./types").ContributionIdentity[]): Promise<WorkspaceSettings> {
  return call("workspace_set_contribution_identities", { identities });
}

function scanContributionIdentities(): Promise<import("./types").ContributionIdentityRecommendationResult> {
  return call("workspace_scan_contribution_identities", undefined);
}

function setRepoSetting(repoId: string, key: keyof RepoSyncPreference, value: boolean): Promise<WorkspaceSettings> {
  return call("repo_set_preference", { repoId, key, value });
}

function setRepoAutoSync(repoId: string, autoSync: boolean): Promise<WorkspaceSettings> {
  return call("repo_set_auto_sync", { repoId, autoSync });
}

function pickWorkspaceRoot(): Promise<string | null> {
  return call("workspace_pick_root", undefined);
}

function cachedCall<TCommand extends WorkspaceCommandName>(
  command: TCommand,
  args: WorkspaceCommandArgs<TCommand>,
  cacheArgs: unknown = args,
): Promise<WorkspaceCommandResult<TCommand>> {
  return workspaceCache.cachedWorkspaceRead(command, cacheArgs, () => call(command, args));
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
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
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
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
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
  const cache = workspaceCache.githubProjectCache.get(githubProjectRepoKey(repoFullName));
  if (!cache) return;
  if (pullNumber == null) {
    for (const key of Object.keys(cache.pullRequestChecks)) delete cache.pullRequestChecks[Number(key)];
  }
  else delete cache.pullRequestChecks[pullNumber];
}

function upsertGitHubRelease(repoFullName: string, release: GitHubRelease) {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  if (!cache.releases) return;
  const withoutRelease = cache.releases.filter((item) => item.id !== release.id);
  cache.releases = [cloneProjectData(release), ...cloneProjectList(withoutRelease)]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function upsertGitHubReleaseAsset(repoFullName: string, releaseId: number, asset: GitHubReleaseAsset) {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
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
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  if (!cache.releases) return;
  cache.releases = cache.releases.filter((release) => release.id !== releaseId).map((release) => cloneProjectData(release));
}

function removeGitHubReleaseAsset(repoFullName: string, releaseId: number, assetId: number) {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  if (!cache.releases) return;
  cache.releases = cache.releases.map((release) => {
    if (release.id !== releaseId) return cloneProjectData(release);
    return {
      ...cloneProjectData(release),
      assets: release.assets.filter((asset) => asset.id !== assetId).map((asset) => cloneProjectData(asset)),
    };
  });
}

function preloadGitHubRepos(
  opts: { force?: boolean; scope?: GitHubRepositoryScope } = {},
): Promise<GitHubRepoPage> {
  const scope = opts.scope ?? ALL_GITHUB_REPOSITORIES;
  const cacheKey = workspaceCache.githubRepositoryCacheKey(scope, 1);
  const now = Date.now();
  const cached = workspaceCache.githubRepoCache.get(cacheKey);
  if (!opts.force && cached && now - cached.fetchedAt < GITHUB_REPO_CACHE_TTL_MS) {
    return Promise.resolve(cloneRepoPage(cached));
  }
  const pending = workspaceCache.githubRepoPreloadPromises.get(cacheKey);
  if (!opts.force && pending) return pending;
  const promise = listGitHubRepos(scope, 1).finally(() => {
    if (workspaceCache.githubRepoPreloadPromises.get(cacheKey) === promise) {
      workspaceCache.githubRepoPreloadPromises.delete(cacheKey);
    }
  });
  workspaceCache.githubRepoPreloadPromises.set(cacheKey, promise);
  return promise;
}

function pickRepo(): Promise<string | null> {
  return call("workspace_pick_repo", undefined);
}

function pickFiles(): Promise<string[]> {
  return call("workspace_pick_files", undefined);
}

function refreshRepos(): Promise<RepoSummary[]> {
  return call("workspace_refresh_repos", undefined);
}

function listManagedRepos(): Promise<RepoSummary[]> {
  return call("workspace_list_managed_repos", undefined);
}

function discoverRepos(): Promise<RepoSummary[]> {
  return call("workspace_discover_repos", undefined);
}

function addRepo(repoPath: string): Promise<RepoSummary> {
  return call("workspace_add_repo", { repoPath });
}

function createLocalRepo(request: WorkspaceCreateLocalRepoRequest): Promise<RepoSummary> {
  return call("workspace_create_local_repo", { request });
}

function cloneRepo(request: WorkspaceCloneRepoRequest): Promise<WorkspaceCloneResult> {
  return call("workspace_clone_repo", { request });
}

function getRepoSummary(repoId: string): Promise<RepoSummary> {
  return call("repo_get_summary", { repoId });
}

function getRepoStorageStats(repoId: string): Promise<RepoStorageStats> {
  return call("repo_get_storage_stats", { repoId });
}

function refreshRepoSummary(
  repoId: string,
  options: RepoRefreshSummaryOptions = {},
): Promise<RepoSummary> {
  return call("repo_refresh_summary", { repoId, options });
}

function hideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_hide_repo", { repoId });
}

function reconcileOrganizationRepoGroups(organizationLogins: string[]): Promise<WorkspaceSettings> {
  return call("workspace_reconcile_organization_repo_groups", { organizationLogins });
}

function createRepoGroup(name: string): Promise<WorkspaceSettings> {
  return call("workspace_create_repo_group", { name });
}

function renameRepoGroup(groupId: string, name: string): Promise<WorkspaceSettings> {
  return call("workspace_rename_repo_group", { groupId, name });
}

function deleteRepoGroup(groupId: string): Promise<WorkspaceSettings> {
  return call("workspace_delete_repo_group", { groupId });
}

function moveRepoToGroup(
  repoId: string,
  groupId: string | null,
  pathMode: WorkspaceRepoPathMode | null = "keep",
): Promise<WorkspaceRepoRelocationResult> {
  return call("workspace_move_repo_to_group", { repoId, groupId, pathMode });
}

function relocateLocalRepo(
  repoId: string,
  targetPath: string | null = null,
): Promise<WorkspaceRepoRelocationResult> {
  return call("workspace_relocate_local_repo", { repoId, targetPath });
}

function setLocalRepoFavorite(repoId: string, favorite: boolean): Promise<WorkspaceSettings> {
  return call("workspace_set_local_repo_favorite", { repoId, favorite });
}

function deleteLocalRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_delete_local_repo", { repoId });
}

function rememberRemoteRepo(repo: RemoteRepoShortcut): Promise<WorkspaceSettings> {
  return call("workspace_remember_remote_repo", { repo });
}

function setRemoteRepoFavorite(repo: RemoteRepoShortcut, favorite: boolean): Promise<WorkspaceSettings> {
  return call("workspace_set_remote_repo_favorite", { repo, favorite });
}

function forgetRemoteRepo(fullName: string): Promise<WorkspaceSettings> {
  return call("workspace_forget_remote_repo", { fullName });
}

function unhideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_unhide_repo", { repoId });
}

function listHiddenRepos(): Promise<HiddenRepo[]> {
  return call("workspace_list_hidden_repos", undefined);
}

function listWorkspaceTasks(): Promise<WorkspaceTask[]> {
  return call("workspace_list_tasks", undefined);
}

function cancelWorkspaceTask(taskId: string): Promise<void> {
  return call("workspace_cancel_task", { taskId });
}

function setActiveWorkspaceRepo(repoId: string | null): Promise<void> {
  return call("workspace_set_active_repo", { repoId });
}

function recordRecentLocalRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_record_recent_local_repo", { repoId });
}

function setWorkspaceRefreshPaused(paused: boolean): Promise<void> {
  return call("workspace_set_refresh_paused", { paused });
}

function enqueueRepoRefresh(request: WorkspaceRepoRefreshRequest): Promise<string> {
  return call("workspace_enqueue_repo_refresh", { request });
}

async function getGitHubBindingStatus(): Promise<GitHubBindingStatus> {
  const status = await call("github_get_binding_status", undefined);
  workspaceCache.applyGitHubBindingRevision(status);
  return status;
}

function startGitHubDeviceFlow(): Promise<GitHubDeviceFlowStart> {
  return call("github_start_device_flow", undefined);
}

async function pollGitHubDeviceFlow(
  deviceCode: string,
  intervalSeconds?: number | null,
): Promise<GitHubDeviceFlowPollResult> {
  const result = await call("github_poll_device_flow", { deviceCode, intervalSeconds: intervalSeconds ?? null });
  if (result.status === "authorized" && result.bindingStatus) {
    workspaceCache.applyGitHubBindingRevision(result.bindingStatus);
  }
  return result;
}

async function unbindGitHub(): Promise<void> {
  await call("github_unbind", undefined);
  workspaceCache.clearGitHubRepoCache();
  workspaceCache.clearGitHubRepoOwnerCache();
}

function getGitHubAccountProfile(): Promise<GitHubAccountProfile> {
  return call("github_get_account_profile", undefined);
}

function getGitHubAccountReadme(): Promise<GitHubProfileReadmeSection> {
  return call("github_get_account_readme", undefined);
}

function updateGitHubAccountProfile(
  request: GitHubUpdateAccountProfileRequest,
): Promise<GitHubAccountProfile> {
  return call("github_update_account_profile", { request });
}

function getGitHubOrganizationProfile(login: string): Promise<GitHubOrganizationProfile> {
  return cachedCall("github_get_organization_profile", { login }).then(cloneProjectData);
}

function getGitHubOrganizationOverview(
  login: string,
  view: GitHubOrganizationProfileView,
): Promise<GitHubOrganizationOverview> {
  return cachedCall("github_get_organization_overview", { login, view }).then(cloneProjectData);
}

function listRepoContribution(repoScope: string): Promise<GitHubContributionResult> {
  return call("github_list_repo_contribution", { repoFullName: repoScope });
}

function listGitHubRepos(page?: number | null): Promise<GitHubRepoPage>;
function listGitHubRepos(
  scope: GitHubRepositoryScope,
  page?: number | null,
): Promise<GitHubRepoPage>;
async function listGitHubRepos(
  scopeOrPage: GitHubRepositoryScope | number | null = ALL_GITHUB_REPOSITORIES,
  requestedPage?: number | null,
): Promise<GitHubRepoPage> {
  const scope = typeof scopeOrPage === "object" && scopeOrPage !== null
    ? scopeOrPage
    : ALL_GITHUB_REPOSITORIES;
  const pageNo = typeof scopeOrPage === "number" ? scopeOrPage : requestedPage ?? 1;
  const requestRevision = workspaceCache.githubRepoBindingRevision;
  const cacheKey = workspaceCache.githubRepositoryCacheKey(scope, pageNo);
  const cached = workspaceCache.githubRepoCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < GITHUB_REPO_CACHE_TTL_MS) {
    return cloneRepoPage(cached);
  }
  const result = await cachedCall("github_list_repos", { scope, page: pageNo }).catch((err) => {
    if (isGitHubBindingExpiredError(err)) workspaceCache.clearGitHubRepoCache();
    throw err;
  });
  if (requestRevision === workspaceCache.githubRepoBindingRevision) {
    workspaceCache.writeGitHubRepoCache(cacheKey, scope, result);
  }
  return cloneRepoPage(result);
}

function listGitHubWatchedRepos(page: number | null = 1): Promise<GitHubWatchedRepoPage> {
  const pageNo = Math.max(1, page ?? 1);
  return cachedCall("github_list_watched_repos", { page: pageNo });
}

function getGitHubRepositorySubscription(
  repoFullName: string,
): Promise<GitHubRepositorySubscription> {
  return cachedCall("github_get_repo_subscription", { repoFullName });
}

function updateGitHubRepositorySubscription(
  repoFullName: string,
  mode: GitHubRepositorySubscriptionMode,
): Promise<GitHubRepositorySubscription> {
  return call("github_update_repo_subscription", { repoFullName, mode });
}

function listGitHubAccountIssues(
  options: Pick<GitHubIssueListOptions, "state" | "perPage" | "sort" | "direction"> = {},
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<GitHubAccountIssueItem[]> {
  const now = Date.now();
  const args = {
    state: options.state ?? "open",
    perPage: options.perPage ?? 100,
    sort: options.sort ?? "updated",
    direction: options.direction ?? "desc",
    forceRefresh: fetchOptions.forceRefresh ?? null,
  };
  const cacheKey = JSON.stringify({
    state: args.state,
    perPage: args.perPage,
    sort: args.sort,
    direction: args.direction,
  });
  if (
    !fetchOptions.forceRefresh &&
    workspaceCache.githubAccountIssueCache?.key === cacheKey &&
    now - workspaceCache.githubAccountIssueCache.fetchedAt < GITHUB_REPO_CACHE_TTL_MS
  ) {
    return Promise.resolve(cloneProjectList(workspaceCache.githubAccountIssueCache.items));
  }
  const cacheGeneration = workspaceCache.githubAccountIssueCacheGeneration;
  return cachedCall("github_list_account_issues", args)
    .then((items) => {
      if (cacheGeneration === workspaceCache.githubAccountIssueCacheGeneration) {
        workspaceCache.setGitHubAccountIssueCache({
          key: cacheKey,
          items: cloneProjectList(items),
          fetchedAt: Date.now(),
        });
      }
      return cloneProjectList(items);
    });
}

function listGitHubActionNotifications(
  perPage = 50,
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<GitHubActionNotification[]> {
  const now = Date.now();
  const args = {
    perPage,
    forceRefresh: fetchOptions.forceRefresh ?? null,
  };
  const cacheKey = JSON.stringify({ perPage: args.perPage });
  if (
    !fetchOptions.forceRefresh &&
    workspaceCache.githubActionNotificationCache?.key === cacheKey &&
    now - workspaceCache.githubActionNotificationCache.fetchedAt < GITHUB_REPO_CACHE_TTL_MS
  ) {
    return Promise.resolve(cloneProjectList(workspaceCache.githubActionNotificationCache.items));
  }
  return cachedCall("github_list_action_notifications", args)
    .then((items) => {
      workspaceCache.setGitHubActionNotificationCache({
        key: cacheKey,
        items: cloneProjectList(items),
        fetchedAt: Date.now(),
      });
      return cloneProjectList(items);
    });
}

function listGitHubRepoOwners(opts: { force?: boolean } = {}): Promise<GitHubRepoOwner[]> {
  if (opts.force) {
    workspaceCache.clearGitHubRepoOwnerCache();
  } else {
    const cached = workspaceCache.readCachedGitHubRepoOwners();
    if (cached) return Promise.resolve(cached);
    const pending = workspaceCache.githubRepoOwnerPromises.get(workspaceCache.githubRepoBindingRevision);
    if (pending) return pending.then(cloneGitHubRepoOwners);
  }

  const requestRevision = workspaceCache.githubRepoBindingRevision;
  const requestGeneration = workspaceCache.githubRepoOwnerCacheGeneration;
  const request = call("github_list_repo_owners", undefined)
    .then((owners) => {
      if (
        requestRevision === workspaceCache.githubRepoBindingRevision
        && requestGeneration === workspaceCache.githubRepoOwnerCacheGeneration
      ) {
        workspaceCache.writeGitHubRepoOwnerCache(owners);
      }
      return owners;
    })
    .catch((err) => {
      if (isGitHubBindingExpiredError(err)) {
        workspaceCache.clearGitHubRepoCache();
        workspaceCache.clearGitHubRepoOwnerCache();
      }
      throw err;
    })
    .finally(() => {
      if (workspaceCache.githubRepoOwnerPromises.get(requestRevision) === request) {
        workspaceCache.githubRepoOwnerPromises.delete(requestRevision);
      }
    });
  workspaceCache.githubRepoOwnerPromises.set(requestRevision, request);
  return request.then(cloneGitHubRepoOwners);
}

function listGitHubRepoTemplates(): Promise<GitHubRepoTemplate[]> {
  return call("github_list_repo_templates", undefined);
}

async function listGitHubRepoLicenses(): Promise<GitHubRepoLicense[]> {
  const cached = workspaceCache.readCachedGitHubRepoLicenses();
  if (cached) return cached;
  const result = await cachedCall("github_list_repo_licenses", undefined);
  workspaceCache.writeGitHubRepoLicenseCache(result);
  return cloneGitHubRepoLicenses(result);
}

async function createGitHubRepo(request: GitHubCreateRepoRequest): Promise<GitHubRepoSummary> {
  const repo = await call("github_create_repo", { request });
  workspaceCache.clearGitHubRepoCache();
  return repo;
}

function getGitHubRepoManagement(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubRepoManagement> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  if (!options.forceRefresh && cache.management) {
    return Promise.resolve(cloneProjectData(cache.management));
  }
  const args = {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_repo_management", args)
    .then((repo) => {
      cache.management = cloneProjectData(repo);
      return cloneProjectData(repo);
    });
}

function updateGitHubRepoSettings(
  repoFullName: string,
  request: GitHubUpdateRepoSettingsRequest,
): Promise<GitHubRepoManagement> {
  return call("github_update_repo_settings", { repoFullName, request }).then((repo) => {
    workspaceCache.githubRepoCache.clear();
    workspaceCache.githubRepoPreloadPromises.clear();
    if (githubProjectRepoKey(repo.fullName) !== githubProjectRepoKey(repoFullName)) {
      workspaceCache.clearGitHubProjectRepoCache(repoFullName);
    }
    const cache = workspaceCache.githubProjectRepoCache(repo.fullName);
    cache.management = cloneProjectData(repo);
    if ("securityAndAnalysis" in request || "archived" in request) {
      cache.settingsSections.security = undefined;
    }
    if ("defaultBranch" in request) {
      cache.settingsSections.branches = undefined;
    }
    return cloneProjectData(repo);
  });
}

function getGitHubRepoSettingsSection(
  repoFullName: string,
  section: GitHubRepoSettingsSectionKey,
  options: { forceRefresh?: boolean } = {},
): Promise<GitHubRepoSettingsSection> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  if (!options.forceRefresh && cache.settingsSections[section]) {
    return Promise.resolve(cloneProjectData(cache.settingsSections[section]));
  }
  const args = {
    repoFullName,
    section,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_repo_settings_section", args).then((result) => {
    workspaceCache.githubProjectRepoCache(repoFullName).settingsSections[section] = cloneProjectData(result);
    return cloneProjectData(result);
  });
}

async function updateGitHubRepoActionsPermissions(
  repoFullName: string,
  request: GitHubRepoActionsPermissionsRequest,
): Promise<void> {
  await call("github_update_repo_actions_permissions", { repoFullName, request });
  workspaceCache.githubProjectRepoCache(repoFullName).settingsSections.actions = undefined;
}

async function updateGitHubRepoWorkflowPermissions(
  repoFullName: string,
  request: GitHubRepoWorkflowPermissionsRequest,
): Promise<void> {
  await call("github_update_repo_workflow_permissions", { repoFullName, request });
  workspaceCache.githubProjectRepoCache(repoFullName).settingsSections.actions = undefined;
}

async function deleteGitHubRepo(repoFullName: string): Promise<void> {
  await call("github_delete_repo", { repoFullName });
  workspaceCache.clearGitHubRepoCache();
  workspaceCache.clearGitHubProjectRepoCache(repoFullName);
}

function listGitHubBranches(repoFullName: string): Promise<BranchSummary[]> {
  return call("github_list_branches", { repoFullName });
}

function getGitHubBranchProtection(
  repoFullName: string,
  branchName: string,
): Promise<GitHubBranchProtection | null> {
  return call("github_get_branch_protection", { repoFullName, branchName });
}

function updateGitHubBranchProtection(
  repoFullName: string,
  branchName: string,
  request: GitHubBranchProtection,
): Promise<GitHubBranchProtection> {
  return call("github_update_branch_protection", { repoFullName, branchName, request }).then((protection) => {
    workspaceCache.githubProjectRepoCache(repoFullName).settingsSections.branches = undefined;
    return protection;
  });
}

function listGitHubRepoRulesets(repoFullName: string): Promise<GitHubRulesetSummary[]> {
  return call("github_list_repo_rulesets", { repoFullName });
}

function getGitHubRepoRuleset(repoFullName: string, rulesetId: number): Promise<GitHubRuleset> {
  return call("github_get_repo_ruleset", { repoFullName, rulesetId });
}

function updateGitHubRepoRuleset(
  repoFullName: string,
  rulesetId: number,
  request: GitHubRuleset,
): Promise<GitHubRuleset> {
  return call("github_update_repo_ruleset", { repoFullName, rulesetId, request }).then((ruleset) => {
    workspaceCache.githubProjectRepoCache(repoFullName).settingsSections.rules = undefined;
    return ruleset;
  });
}

function deleteGitHubBranch(repoFullName: string, branchName: string): Promise<void> {
  return call("github_delete_branch", { repoFullName, branchName }).then(() => {
    workspaceCache.githubProjectRepoCache(repoFullName).settingsSections.branches = undefined;
  });
}

function listGitHubPullRequests(
  repoFullName: string,
  stateOrOptions?: "open" | "closed" | "merged" | "all" | string | null | GitHubPullRequestListOptions,
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<GitHubPullRequest[]> {
  const options = normalizeGitHubPullRequestListOptions(stateOrOptions);
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
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
  return cachedCall("github_list_pull_requests", args)
    .then((pulls) => {
      cache.pullRequests[key] = cloneProjectList(pulls);
      return cloneProjectList(pulls);
    });
}

function getGitHubPullRequest(repoFullName: string, pullNumber: number): Promise<GitHubPullRequest> {
  return call("github_get_pull_request", { repoFullName, pullNumber });
}

function getGitHubPullRequestDiscussion(
  repoFullName: string,
  pullNumber: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubPullRequestDiscussion> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const cached = cache.pullRequestDiscussions[pullNumber];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    pullNumber,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_pull_request_discussion", args)
    .then((discussion) => {
      cache.pullRequestDiscussions[pullNumber] = cloneProjectData(discussion);
      upsertGitHubPullRequest(repoFullName, discussion.pullRequest);
      return cloneProjectData(discussion);
    });
}

function createGitHubPullRequest(
  repoFullName: string,
  request: GitHubCreatePullRequestRequest,
): Promise<GitHubPullRequest> {
  return call("github_create_pull_request", { repoFullName, request }).then((pull) => {
    upsertGitHubPullRequest(repoFullName, pull);
    clearGitHubProjectPullRequestChecks(repoFullName, pull.number);
    workspaceCache.invalidateGitHubAccountIssueCache();
    return cloneProjectData(pull);
  });
}

function updateGitHubPullRequest(
  repoFullName: string,
  pullNumber: number,
  request: GitHubUpdatePullRequestRequest,
): Promise<GitHubPullRequest> {
  return call("github_update_pull_request", { repoFullName, pullNumber, request }).then((pull) => {
    upsertGitHubPullRequest(repoFullName, pull);
    clearGitHubProjectPullRequestChecks(repoFullName, pull.number);
    workspaceCache.invalidateGitHubAccountIssueCache();
    return cloneProjectData(pull);
  });
}

function mergeGitHubPullRequest(
  repoFullName: string,
  pullNumber: number,
  request: GitHubMergePullRequestRequest = {},
): Promise<GitHubPullRequest> {
  return call("github_merge_pull_request", { repoFullName, pullNumber, request }).then((pull) => {
    upsertGitHubPullRequest(repoFullName, pull);
    clearGitHubProjectPullRequestChecks(repoFullName, pull.number);
    workspaceCache.invalidateGitHubAccountIssueCache();
    return cloneProjectData(pull);
  });
}

function listGitHubPullRequestChecks(
  repoFullName: string,
  pullNumber: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubPullRequestCheck[]> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const cached = cache.pullRequestChecks[pullNumber];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  const args = {
    repoFullName,
    pullNumber,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_list_pull_request_checks", args)
    .then((checks) => {
      cache.pullRequestChecks[pullNumber] = cloneProjectList(checks);
      return cloneProjectList(checks);
    });
}

function listGitHubIssues(
  repoFullName: string,
  stateOrOptions?: string | null | GitHubIssueListOptions,
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<GitHubIssue[]> {
  const options = typeof stateOrOptions === "object" && stateOrOptions != null
    ? stateOrOptions
    : { state: stateOrOptions ?? null };
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
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
  return cachedCall("github_list_issues", args)
    .then((issues) => {
      cache.issues[key] = cloneProjectList(issues);
      return cloneProjectList(issues);
    });
}

function getGitHubIssueDiscussion(
  repoFullName: string,
  issueNumber: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubIssueDiscussion> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const cached = cache.issueDiscussions[issueNumber];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    issueNumber,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_issue_discussion", args)
    .then((discussion) => {
      cache.issueDiscussions[issueNumber] = cloneProjectData(discussion);
      upsertGitHubIssue(repoFullName, discussion.issue);
      return cloneProjectData(discussion);
    });
}

function getGitHubIssueFilterMetadata(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubIssueFilterMetadata> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  if (!options.forceRefresh && cache.issueFilterMetadata) {
    return Promise.resolve(cloneProjectData(cache.issueFilterMetadata));
  }
  const args = {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_issue_filter_metadata", args)
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
): Promise<string[]> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const cached = cache[cacheKey];
  if (!options.forceRefresh && cached) return Promise.resolve([...cached]);
  const args = {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall(command, args)
    .then((values) => {
      cache[cacheKey] = [...values];
      return [...values];
    });
}

function listGitHubIssueLabels(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<string[]> {
  return listGitHubIssueValues(repoFullName, options, "issueLabels", "github_list_issue_labels");
}

function listGitHubIssueAssignees(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<string[]> {
  return listGitHubIssueValues(repoFullName, options, "issueAssignees", "github_list_issue_assignees");
}

function createGitHubIssue(
  repoFullName: string,
  request: GitHubCreateIssueRequest,
): Promise<GitHubIssue> {
  return call("github_create_issue", { repoFullName, request }).then((issue) => {
    upsertGitHubIssue(repoFullName, issue);
    workspaceCache.invalidateGitHubAccountIssueCache();
    return cloneProjectData(issue);
  });
}

function updateGitHubIssue(
  repoFullName: string,
  issueNumber: number,
  request: GitHubUpdateIssueRequest,
): Promise<GitHubIssue> {
  return call("github_update_issue", { repoFullName, issueNumber, request }).then((issue) => {
    upsertGitHubIssue(repoFullName, issue);
    workspaceCache.invalidateGitHubAccountIssueCache();
    return cloneProjectData(issue);
  });
}

function createGitHubIssueComment(
  repoFullName: string,
  issueNumber: number,
  request: GitHubIssueCommentRequest,
): Promise<GitHubDiscussionTimelineItem> {
  return call("github_create_issue_comment", { repoFullName, issueNumber, request });
}

function updateGitHubIssueComment(
  repoFullName: string,
  commentId: number,
  request: GitHubIssueCommentRequest,
): Promise<GitHubDiscussionTimelineItem> {
  return call("github_update_issue_comment", { repoFullName, commentId, request });
}

function deleteGitHubIssueComment(repoFullName: string, commentId: number): Promise<void> {
  return call("github_delete_issue_comment", { repoFullName, commentId });
}

function addGitHubIssueCommentReaction(
  repoFullName: string,
  commentId: number,
  request: GitHubIssueCommentReactionRequest,
): Promise<void> {
  return call("github_add_issue_comment_reaction", { repoFullName, commentId, request });
}

function listGitHubWorkflowRuns(
  repoFullName: string,
  perPage?: number | null,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubWorkflowRun[]> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const key = githubWorkflowRunsCacheKey(perPage);
  const cached = cache.workflowRuns[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  const args = {
    repoFullName,
    perPage: perPage ?? null,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_list_workflow_runs", args)
    .then((runs) => {
      cache.workflowRuns[key] = cloneProjectList(runs);
      return cloneProjectList(runs);
    });
}

function getGitHubWorkflowRunDetail(
  repoFullName: string,
  runId: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubWorkflowRunDetail> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const cached = cache.workflowRunDetails[runId];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    runId,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_workflow_run_detail", args)
    .then((detail) => {
      cache.workflowRunDetails[runId] = cloneProjectData(detail);
      return cloneProjectData(detail);
    });
}

function getGitHubWorkflowJobLog(
  repoFullName: string,
  jobId: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubWorkflowJobLog> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const cached = cache.workflowJobLogs[jobId];
  if (!options.forceRefresh && cached) return Promise.resolve({ ...cached });
  const args = {
    repoFullName,
    jobId,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_workflow_job_log", args)
    .then((log) => {
      cache.workflowJobLogs[jobId] = { ...log };
      return { ...log };
    });
}

async function rerunFailedGitHubWorkflowRun(repoFullName: string, runId: number): Promise<void> {
  await call("github_rerun_failed_workflow_run", { repoFullName, runId });
  workspaceCache.clearGitHubProjectRepoCache(repoFullName);
}

async function cancelGitHubWorkflowRun(repoFullName: string, runId: number): Promise<void> {
  await call("github_cancel_workflow_run", { repoFullName, runId });
  workspaceCache.clearGitHubProjectRepoCache(repoFullName);
}

async function rerunGitHubWorkflowJob(repoFullName: string, jobId: number): Promise<void> {
  await call("github_rerun_workflow_job", { repoFullName, jobId });
  workspaceCache.clearGitHubProjectRepoCache(repoFullName);
}

function listGitHubWorkflowArtifactFiles(
  repoFullName: string,
  artifactId: number,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubWorkflowArtifactEntry[]> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const cached = cache.workflowArtifactEntries[artifactId];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  const args = {
    repoFullName,
    artifactId,
  };
  return cachedCall("github_list_workflow_artifact_files", args)
    .then((entries) => {
      cache.workflowArtifactEntries[artifactId] = cloneProjectList(entries);
      return cloneProjectList(entries);
    });
}

function getGitHubWorkflowArtifactFilePreview(
  repoFullName: string,
  artifactId: number,
  path: string,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoFilePreview> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const key = `${artifactId}:${path}`;
  const cached = cache.workflowArtifactPreviews[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    artifactId,
    path,
  };
  return cachedCall("github_get_workflow_artifact_file_preview", args)
    .then((preview) => {
      cache.workflowArtifactPreviews[key] = cloneProjectData(preview);
      return cloneProjectData(preview);
    });
}

function listGitHubRepoCommits(
  repoFullName: string,
  options: GitHubCommitListOptions = {},
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<CommitSummary[]> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const key = githubCommitListCacheKey(options);
  const cached = cache.commits[key];
  if (!fetchOptions.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  const args = {
    repoFullName,
    perPage: options.perPage ?? null,
    sha: options.sha ?? null,
    forceRefresh: fetchOptions.forceRefresh ?? null,
  };
  return cachedCall("github_list_repo_commits", args)
    .then((commits) => {
      cache.commits[key] = cloneProjectList(commits);
      return cloneProjectList(commits);
    });
}

function getGitHubRepoCommitDetail(
  repoFullName: string,
  hash: string,
  options: GitHubProjectFetchOptions = {},
): Promise<CommitDetail> {
  const normalizedHash = hash.trim();
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const cached = cache.commitDetails[normalizedHash];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    hash: normalizedHash,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_repo_commit_detail", args)
    .then((detail) => {
      cache.commitDetails[detail.hash] = cloneProjectData(detail);
      if (normalizedHash && normalizedHash !== detail.hash) {
        cache.commitDetails[normalizedHash] = cloneProjectData(detail);
      }
      return cloneProjectData(detail);
    });
}

function listGitHubReleases(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubRelease[]> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  if (!options.forceRefresh && cache.releases) return Promise.resolve(cloneProjectList(cache.releases));
  const args = {
    repoFullName,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_list_releases", args)
    .then((releases) => {
      cache.releases = cloneProjectList(releases);
      return cloneProjectList(releases);
    });
}

function getGitHubReleaseByTag(
  repoFullName: string,
  tagName: string,
): Promise<GitHubRelease> {
  const normalizedTag = tagName.trim();
  return call("github_get_release_by_tag", { repoFullName, tagName: normalizedTag }).then((release) => {
    upsertGitHubRelease(repoFullName, release);
    return cloneProjectData(release);
  });
}

function createGitHubRelease(
  repoFullName: string,
  request: GitHubCreateReleaseRequest,
): Promise<GitHubRelease> {
  return call("github_create_release", { repoFullName, request }).then((release) => {
    upsertGitHubRelease(repoFullName, release);
    return cloneProjectData(release);
  });
}

function updateGitHubRelease(
  repoFullName: string,
  releaseId: number,
  request: GitHubUpdateReleaseRequest,
): Promise<GitHubRelease> {
  return call("github_update_release", { repoFullName, releaseId, request }).then((release) => {
    upsertGitHubRelease(repoFullName, release);
    return cloneProjectData(release);
  });
}

async function deleteGitHubRelease(repoFullName: string, releaseId: number): Promise<void> {
  await call("github_delete_release", { repoFullName, releaseId });
  removeGitHubRelease(repoFullName, releaseId);
}

function uploadGitHubReleaseAsset(
  repoFullName: string,
  releaseId: number,
  filePath: string,
  label?: string | null,
): Promise<GitHubReleaseAsset> {
  return call("github_upload_release_asset", { repoFullName, releaseId, filePath, label: label ?? null }).then((asset) => {
    upsertGitHubReleaseAsset(repoFullName, releaseId, asset);
    return cloneProjectData(asset);
  });
}

function attachGitHubWorkflowArtifactAsset(
  repoFullName: string,
  request: GitHubAttachWorkflowArtifactAssetRequest,
): Promise<GitHubReleaseAsset> {
  return call("github_attach_workflow_artifact_asset", { repoFullName, request }).then((asset) => {
    upsertGitHubReleaseAsset(repoFullName, request.releaseId, asset);
    return cloneProjectData(asset);
  });
}

async function deleteGitHubReleaseAsset(
  repoFullName: string,
  releaseId: number,
  assetId: number,
): Promise<void> {
  await call("github_delete_release_asset", { repoFullName, releaseId, assetId });
  removeGitHubReleaseAsset(repoFullName, releaseId, assetId);
}

function getRepoDetail(repoId: string): Promise<RepoDetail> {
  return cachedCall("repo_get_detail", { repoId });
}

function refreshRepoDetailPatch(
  repoId: string,
  request: RepoDetailPatchRequest = {},
): Promise<RepoDetailPatch> {
  return call("repo_refresh_detail_patch", { repoId, request });
}

function listGitHubRepoFiles(
  repoFullName: string,
  parentPath?: string | null,
  refName?: string | null,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoFileTreeEntry[]> {
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const key = githubFileListCacheKey(parentPath, refName);
  const cached = cache.files[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectList(cached));
  const args = {
    repoFullName,
    parentPath: parentPath ?? null,
    refName: refName ?? null,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_list_repo_files", args)
    .then((entries) => {
      cache.files[key] = cloneProjectList(entries);
      return cloneProjectList(entries);
    });
}

function getGitHubRepoFilePreview(
  repoFullName: string,
  path: string,
  refName?: string | null,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoFilePreview> {
  const normalizedPath = path.trim();
  const cache = workspaceCache.githubProjectRepoCache(repoFullName);
  const key = githubFilePreviewCacheKey(normalizedPath, refName);
  const cached = cache.filePreviews[key];
  if (!options.forceRefresh && cached) return Promise.resolve(cloneProjectData(cached));
  const args = {
    repoFullName,
    path: normalizedPath,
    refName: refName ?? null,
    forceRefresh: options.forceRefresh ?? null,
  };
  return cachedCall("github_get_repo_file_preview", args)
    .then((preview) => {
      cache.filePreviews[key] = cloneProjectData(preview);
      return cloneProjectData(preview);
    });
}

function listRepoFiles(
  repoId: string,
  parentPath?: string | null,
  repoRef?: string | null,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoFileTreeEntry[]> {
  const remoteFullName = parseRemoteRepoId(repoId);
  if (remoteFullName) return listGitHubRepoFiles(remoteFullName, parentPath, repoRef, options);
  const args = { repoId, parentPath: parentPath ?? null };
  const cacheArgs = { ...args, repoRef: repoRef ?? null };
  return cachedCall("repo_list_files", args, cacheArgs);
}

function getRepoFilePreview(
  repoId: string,
  path: string,
  repoRef?: string | null,
  options: GitHubProjectFetchOptions = {},
): Promise<RepoFilePreview> {
  const remoteFullName = parseRemoteRepoId(repoId);
  if (remoteFullName) return getGitHubRepoFilePreview(remoteFullName, path, repoRef, options);
  const args = { repoId, path };
  const cacheArgs = { ...args, repoRef: repoRef ?? null };
  return cachedCall("repo_get_file_preview", args, cacheArgs);
}

function deleteRepoFile(repoId: string, path: string): Promise<RepoSummary> {
  if (parseRemoteRepoId(repoId)) {
    return Promise.reject(new Error("远程仓库文件不能从本地删除"));
  }
  return call("repo_delete_file", { repoId, path });
}

function refreshRepoLanguageStats(repoId: string): Promise<RepoSummary> {
  return call("repo_refresh_language_stats", { repoId });
}

function getRepoCommitDetail(
  repoId: string,
  hash: string,
  options: GitHubProjectFetchOptions = {},
): Promise<CommitDetail> {
  const remoteFullName = parseRemoteRepoId(repoId);
  if (remoteFullName) return getGitHubRepoCommitDetail(remoteFullName, hash, options);
  return cachedCall("repo_get_commit_detail", { repoId, hash });
}

function getRepoLaunchConfig(repoId: string): Promise<ProjectLaunchConfig | null> {
  return call("repo_get_launch_config", { repoId });
}

function getRepoRemoteSyncConfig(repoId: string): Promise<RepoRemoteSyncConfig> {
  return call("repo_get_remote_sync_config", { repoId });
}

function setRepoRemoteSyncPolicy(
  repoId: string,
  policy: RepoRemoteSyncPolicy,
): Promise<RepoRemoteSyncConfig> {
  return call("repo_set_remote_sync_policy", { repoId, policy });
}

function listRepoLaunchCandidates(repoId: string): Promise<ProjectLaunchCandidate[]> {
  return call("repo_list_launch_candidates", { repoId });
}

function saveRepoLaunchConfig(
  repoId: string,
  command: string,
  cwd?: string | null,
): Promise<ProjectLaunchConfig> {
  return call("repo_save_launch_config", { repoId, command, cwd: cwd ?? null });
}

function getRepoLaunchStatus(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_get_launch_status", { repoId });
}

function getRepoLaunchLogs(repoId: string, since?: number | null): Promise<ProjectLaunchLog[]> {
  return call("repo_get_launch_logs", { repoId, since: since ?? null });
}

function listRepoLaunchHistory(repoId: string): Promise<ProjectLaunchHistoryEntry[]> {
  return call("repo_list_launch_history", { repoId });
}

function startRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_start_launch", { repoId });
}

function stopRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_stop_launch", { repoId });
}

function stageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_stage_files", { repoId, files });
}

function unstageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_unstage_files", { repoId, files });
}

function discardFiles(repoId: string, files: string[]): Promise<RepoSummary> {
  return call("repo_discard_files", { repoId, files });
}

function addFilesToGitignore(repoId: string, files: string[]): Promise<RepoSummary> {
  return call("repo_add_files_to_gitignore", { repoId, files });
}

function commitRepo(
  repoId: string,
  files: string[],
  message: string,
  pushAfter: boolean,
): Promise<RepoCommitResult> {
  return call("repo_commit", { repoId, files, message, pushAfter });
}

function pullRepo(
  repoId: string,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoSyncOperationResult> {
  return call("repo_pull", { repoId, localChangesMode });
}

function mergePullRepo(
  repoId: string,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoSyncOperationResult> {
  return call("repo_merge_pull", { repoId, localChangesMode });
}

function fetchRepo(repoId: string): Promise<RepoSyncOperationResult> {
  return call("repo_fetch", { repoId });
}

function startRebaseRepo(
  repoId: string,
  ontoRef?: string | null,
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<RepoOperationResult> {
  return call("repo_start_rebase", { repoId, ontoRef: ontoRef ?? null, localChangesMode });
}

function mergeBranch(repoId: string, branch: string): Promise<RepoMergePullResult> {
  return call("repo_merge_branch", { repoId, branch });
}

function pushRepo(repoId: string, remoteNames?: string[] | null): Promise<RepoSyncOperationResult> {
  return call("repo_push", { repoId, remoteNames: remoteNames ?? null });
}

function pushNewBranchRepo(
  repoId: string,
  remoteNames?: string[] | null,
  branchName?: string | null,
): Promise<RepoSyncOperationResult> {
  return call("repo_push_new_branch", { repoId, remoteNames: remoteNames ?? null, branchName: branchName ?? null });
}

function pushRepoWithSystemGit(
  repoId: string,
  remoteNames?: string[] | null,
): Promise<RepoSyncOperationResult> {
  return call("repo_push_with_system_git", { repoId, remoteNames: remoteNames ?? null });
}

function useDefaultTokenAuthForRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("repo_use_default_token_auth", { repoId });
}

function checkoutBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_checkout_branch", { repoId, branch });
}

function createBranch(
  repoId: string,
  name: string,
  fromRef: string,
  checkoutAfter: boolean,
): Promise<RepoSummary> {
  return call("repo_create_branch", { repoId, name, fromRef, checkoutAfter });
}

function renameBranch(
  repoId: string,
  oldName: string,
  newName: string,
): Promise<RepoSummary> {
  return call("repo_rename_branch", { repoId, oldName, newName });
}

function deleteBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_delete_branch", { repoId, branch });
}

function setBranchUpstream(
  repoId: string,
  branch: string,
  upstream: string,
): Promise<RepoSummary> {
  return call("repo_set_upstream", { repoId, branch, upstream });
}

function listRepoStashes(repoId: string): Promise<RepoStashEntry[]> {
  return call("repo_list_stashes", { repoId });
}

function getRepoStashDetail(repoId: string, stashId: string): Promise<RepoStashDetail> {
  return call("repo_get_stash_detail", { repoId, stashId });
}

function saveRepoStash(repoId: string, message?: string | null): Promise<RepoSummary> {
  return call("repo_stash_save", { repoId, message: message ?? null });
}

function applyRepoStash(repoId: string, stashId: string): Promise<RepoOperationResult> {
  return call("repo_stash_apply", { repoId, stashId });
}

function popRepoStash(repoId: string, stashId: string): Promise<RepoOperationResult> {
  return call("repo_stash_pop", { repoId, stashId });
}

function dropRepoStash(repoId: string, stashId: string): Promise<RepoStashEntry[]> {
  return call("repo_stash_drop", { repoId, stashId });
}

function listRepoRemotes(repoId: string): Promise<RepoRemote[]> {
  return call("repo_list_remotes", { repoId });
}

function cherryPickRepoCommit(repoId: string, hash: string): Promise<RepoOperationResult> {
  return call("repo_cherry_pick_commit", { repoId, hash });
}

function revertRepoCommit(repoId: string, hash: string): Promise<RepoOperationResult> {
  return call("repo_revert_commit", { repoId, hash });
}

function resetRepoToCommit(
  repoId: string,
  hash: string,
  mode: RepoResetMode = "mixed",
): Promise<RepoSummary> {
  return call("repo_reset_to_commit", { repoId, hash, mode });
}

function getRepoConflicts(repoId: string): Promise<RepoConflictState> {
  return call("repo_get_conflicts", { repoId });
}

function acceptConflictFile(
  repoId: string,
  path: string,
  side: "ours" | "theirs",
  stage = true,
): Promise<RepoSummary> {
  return call("repo_accept_conflict_file", { repoId, path, side, stage });
}

function resolveConflictFile(
  repoId: string,
  path: string,
  choices: RepoConflictChoice[],
  stage = true,
): Promise<RepoSummary> {
  return call("repo_resolve_conflict_file", { repoId, path, choices, stage });
}

function markFileResolved(repoId: string, path: string): Promise<RepoSummary> {
  return call("repo_mark_file_resolved", { repoId, path });
}

function abortConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_abort_conflict_operation", { repoId });
}

function continueConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_continue_conflict_operation", { repoId });
}

function bulkSyncPreview(
  operation: BulkOperation,
  repoIds: string[],
  localChangesMode: RepoPullLocalChangesMode = "reject",
): Promise<BulkSyncPreview> {
  return call("bulk_sync_preview", { operation, repoIds, localChangesMode });
}

function bulkSyncExecute(
  operation: BulkOperation,
  repoIds: string[],
  localChangesMode: RepoPullLocalChangesMode = "reject",
  trigger: "manual" | "syncAll" | "autoSync" = "manual",
): Promise<BulkSyncResult[]> {
  return call("bulk_sync_execute", { operation, repoIds, localChangesMode, trigger });
}

function openPath(path: string): Promise<void> {
  return call("system_open_path", { path });
}

function openPathTarget(path: string, target: SystemOpenTarget): Promise<void> {
  return call("system_open_path_target", { path, target });
}

function openUrl(url: string): Promise<void> {
  return call("system_open_url", { url });
}

function listGitHubHomeAttention(
  repoFullNames: readonly string[],
  options: HomeAttentionLoadOptions = {},
): Promise<HomeAttentionResult> {
  const seen = new Set<string>();
  const repositories = repoFullNames.flatMap((value) => {
    const repoFullName = value.trim();
    const key = repoFullName.toLocaleLowerCase();
    if (!repoFullName || seen.has(key)) return [];
    seen.add(key);
    return [repoFullName];
  });
  return call("github_list_home_attention", {
    repoFullNames: repositories,
    forceRefresh: options.forceRefresh ?? null,
  });
}

function getPullRequestCodeReview(repoFullName: string, pullNumber: number) {
  return call("github_get_pull_request_code_review", { repoFullName, pullNumber });
}

function createPullRequestLineComment(
  repoFullName: string,
  pullNumber: number,
  request: CreatePullRequestLineCommentRequest,
) {
  return call("github_create_pull_request_line_comment", { repoFullName, pullNumber, request });
}

function replyPullRequestReviewThread(
  repoFullName: string,
  request: ReplyPullRequestReviewThreadRequest,
) {
  return call("github_reply_pull_request_review_thread", { repoFullName, request });
}

function submitPullRequestCodeReview(
  repoFullName: string,
  pullNumber: number,
  request: SubmitPullRequestCodeReviewRequest,
) {
  return call("github_submit_pull_request_code_review", { repoFullName, pullNumber, request });
}

function getGitHubRepositoryDiscussionMetadata(repoFullName: string) {
  return call("github_get_discussion_metadata", { repoFullName });
}

function listGitHubRepositoryDiscussions(
  repoFullName: string,
  options: GitHubRepositoryDiscussionListOptions = {},
) {
  return call("github_list_discussions", {
    repoFullName,
    first: options.first ?? null,
    after: options.after ?? null,
    categoryId: options.categoryId ?? null,
    answered: options.answered ?? null,
    state: options.state ?? null,
    sort: options.sort ?? null,
    direction: options.direction ?? null,
  });
}

function getGitHubRepositoryDiscussion(repoFullName: string, discussionNumber: number) {
  return call("github_get_discussion", { repoFullName, discussionNumber });
}

function listGitHubRepositoryDiscussionComments(
  repoFullName: string,
  discussionNumber: number,
  options: GitHubRepositoryDiscussionPageOptions = {},
) {
  return call("github_list_discussion_comments", {
    repoFullName,
    discussionNumber,
    first: options.first ?? null,
    after: options.after ?? null,
  });
}

function listGitHubRepositoryDiscussionCommentReplies(
  repoFullName: string,
  commentId: string,
  options: GitHubRepositoryDiscussionPageOptions = {},
) {
  return call("github_list_discussion_comment_replies", {
    repoFullName,
    commentId,
    first: options.first ?? null,
    after: options.after ?? null,
  });
}

function createGitHubRepositoryDiscussion(
  repoFullName: string,
  request: GitHubCreateRepositoryDiscussionRequest,
) {
  return call("github_create_discussion", { repoFullName, request });
}

function createGitHubDiscussionComment(request: GitHubCreateDiscussionCommentRequest) {
  return call("github_create_discussion_comment", { request });
}

function updateGitHubDiscussionComment(request: GitHubUpdateDiscussionCommentRequest) {
  return call("github_update_discussion_comment", { request });
}

function deleteGitHubDiscussionComment(commentId: string) {
  return call("github_delete_discussion_comment", { commentId });
}

function updateGitHubDiscussionReaction(request: GitHubDiscussionReactionRequest) {
  return call("github_update_discussion_reaction", { request });
}

function updateGitHubDiscussionState(request: GitHubDiscussionStateRequest) {
  return call("github_update_discussion_state", { request });
}

function updateGitHubDiscussionAnswer(request: GitHubDiscussionAnswerRequest) {
  return call("github_update_discussion_answer", { request });
}

function createLiliaCodeTaskHandoff(handoff: LiliaCodeTaskHandoff) {
  return call("lilia_code_create_task_handoff", { handoff }, { requireTauri: agentDebugRealHandoff });
}

function getLiliaCodeTaskHandoffStatus(handoffId: string) {
  return call("lilia_code_get_task_handoff_status", { handoffId }, { requireTauri: agentDebugRealHandoff });
}

function openLiliaCodeTaskHandoffResult(handoffId: string) {
  return call("lilia_code_open_task_handoff_result", { handoffId }, { requireTauri: agentDebugRealHandoff });
}

async function waitForLiliaCodeTaskHandoff(
  handoffId: string,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<LiliaCodeTaskHandoffStatus> {
  const attempts = Math.max(1, options.attempts ?? 20);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await getLiliaCodeTaskHandoffStatus(handoffId);
    if (status.status !== "pending") return status;
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
    }
  }
  return getLiliaCodeTaskHandoffStatus(handoffId);
}

  return {
    call,
    readCachedGitHubRepos: workspaceCache.readCachedGitHubRepos,
    clearGitHubRepoCache: workspaceCache.clearGitHubRepoCache,
    clearGitHubRepoOwnerCache: workspaceCache.clearGitHubRepoOwnerCache,
    clearGitHubRepoLicenseCache: workspaceCache.clearGitHubRepoLicenseCache,
    getWorkspaceSettings,
    getWorkspaceBootstrap,
    readStartupCache,
    clearStartupCache,
    writeStartupContributions,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    switchWorkspace,
    addWorkspaceRoot,
    removeWorkspaceRoot,
    setPrimaryWorkspaceRoot,
    updateWorkspaceViewPreferences,
    updateWorkspaceRecentContext,
    updateAccountPreferences,
    setContributionIdentities,
    scanContributionIdentities,
    setRepoSetting,
    setRepoAutoSync,
    pickWorkspaceRoot,
    preloadGitHubRepos,
    pickRepo,
    pickFiles,
    refreshRepos,
    listManagedRepos,
    discoverRepos,
    addRepo,
    createLocalRepo,
    cloneRepo,
    getRepoSummary,
    getRepoStorageStats,
    refreshRepoSummary,
    hideRepo,
    reconcileOrganizationRepoGroups,
    createRepoGroup,
    renameRepoGroup,
    deleteRepoGroup,
    moveRepoToGroup,
    relocateLocalRepo,
    setLocalRepoFavorite,
    deleteLocalRepo,
    rememberRemoteRepo,
    setRemoteRepoFavorite,
    forgetRemoteRepo,
    unhideRepo,
    listHiddenRepos,
    listWorkspaceTasks,
    cancelWorkspaceTask,
    setActiveWorkspaceRepo,
    recordRecentLocalRepo,
    setWorkspaceRefreshPaused,
    enqueueRepoRefresh,
    getGitHubBindingStatus,
    startGitHubDeviceFlow,
    pollGitHubDeviceFlow,
    unbindGitHub,
    getGitHubAccountProfile,
    getGitHubAccountReadme,
    updateGitHubAccountProfile,
    getGitHubOrganizationProfile,
    getGitHubOrganizationOverview,
    listRepoContribution,
    listGitHubRepos,
    listGitHubWatchedRepos,
    getGitHubRepositorySubscription,
    updateGitHubRepositorySubscription,
    listGitHubAccountIssues,
    listGitHubHomeAttention,
    listGitHubActionNotifications,
    listGitHubRepoOwners,
    listGitHubRepoTemplates,
    listGitHubRepoLicenses,
    createGitHubRepo,
    getGitHubRepoManagement,
    updateGitHubRepoSettings,
    getGitHubRepoSettingsSection,
    updateGitHubRepoActionsPermissions,
    updateGitHubRepoWorkflowPermissions,
    deleteGitHubRepo,
    listGitHubBranches,
    getGitHubBranchProtection,
    updateGitHubBranchProtection,
    listGitHubRepoRulesets,
    getGitHubRepoRuleset,
    updateGitHubRepoRuleset,
    deleteGitHubBranch,
    listGitHubPullRequests,
    getGitHubPullRequest,
    getGitHubPullRequestDiscussion,
    createGitHubPullRequest,
    updateGitHubPullRequest,
    mergeGitHubPullRequest,
    listGitHubPullRequestChecks,
    getPullRequestCodeReview,
    createPullRequestLineComment,
    replyPullRequestReviewThread,
    submitPullRequestCodeReview,
    listGitHubIssues,
    getGitHubIssueDiscussion,
    getGitHubIssueFilterMetadata,
    listGitHubIssueLabels,
    listGitHubIssueAssignees,
    createGitHubIssue,
    updateGitHubIssue,
    createGitHubIssueComment,
    updateGitHubIssueComment,
    deleteGitHubIssueComment,
    addGitHubIssueCommentReaction,
    getGitHubRepositoryDiscussionMetadata,
    listGitHubRepositoryDiscussions,
    getGitHubRepositoryDiscussion,
    listGitHubRepositoryDiscussionComments,
    listGitHubRepositoryDiscussionCommentReplies,
    createGitHubRepositoryDiscussion,
    createGitHubDiscussionComment,
    updateGitHubDiscussionComment,
    deleteGitHubDiscussionComment,
    updateGitHubDiscussionReaction,
    updateGitHubDiscussionState,
    updateGitHubDiscussionAnswer,
    listGitHubWorkflowRuns,
    getGitHubWorkflowRunDetail,
    getGitHubWorkflowJobLog,
    rerunFailedGitHubWorkflowRun,
    cancelGitHubWorkflowRun,
    rerunGitHubWorkflowJob,
    listGitHubWorkflowArtifactFiles,
    getGitHubWorkflowArtifactFilePreview,
    listGitHubRepoCommits,
    getGitHubRepoCommitDetail,
    listGitHubReleases,
    getGitHubReleaseByTag,
    createGitHubRelease,
    updateGitHubRelease,
    deleteGitHubRelease,
    uploadGitHubReleaseAsset,
    attachGitHubWorkflowArtifactAsset,
    deleteGitHubReleaseAsset,
    getRepoDetail,
    refreshRepoDetailPatch,
    listGitHubRepoFiles,
    getGitHubRepoFilePreview,
    listRepoFiles,
    getRepoFilePreview,
    deleteRepoFile,
    refreshRepoLanguageStats,
    getRepoCommitDetail,
    getRepoLaunchConfig,
    getRepoRemoteSyncConfig,
    setRepoRemoteSyncPolicy,
    listRepoLaunchCandidates,
    saveRepoLaunchConfig,
    getRepoLaunchStatus,
    getRepoLaunchLogs,
    listRepoLaunchHistory,
    startRepoLaunch,
    stopRepoLaunch,
    stageFiles,
    unstageFiles,
    discardFiles,
    addFilesToGitignore,
    commitRepo,
    pullRepo,
    mergePullRepo,
    fetchRepo,
    startRebaseRepo,
    mergeBranch,
    pushRepo,
    pushNewBranchRepo,
    pushRepoWithSystemGit,
    useDefaultTokenAuthForRepo,
    checkoutBranch,
    createBranch,
    renameBranch,
    deleteBranch,
    setBranchUpstream,
    listRepoStashes,
    getRepoStashDetail,
    saveRepoStash,
    applyRepoStash,
    popRepoStash,
    dropRepoStash,
    listRepoRemotes,
    cherryPickRepoCommit,
    revertRepoCommit,
    resetRepoToCommit,
    getRepoConflicts,
    acceptConflictFile,
    resolveConflictFile,
    markFileResolved,
    abortConflictOperation,
    continueConflictOperation,
    bulkSyncPreview,
    bulkSyncExecute,
    openPath,
    openPathTarget,
    openUrl,
    createLiliaCodeTaskHandoff,
    getLiliaCodeTaskHandoffStatus,
    openLiliaCodeTaskHandoffResult,
    waitForLiliaCodeTaskHandoff,
  };
}

export type WorkspaceClient = ReturnType<typeof createWorkspaceClient>;
