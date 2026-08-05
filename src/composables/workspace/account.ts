import type {
  AccountPreferences,
  GitHubActionNotification,
  GitHubAccountIssueItem,
  GitHubAccountProfile,
  GitHubBindingStatus,
  GitHubCreateRepoRequest,
  GitHubOrganizationOverview,
  GitHubOrganizationProfile,
  GitHubOrganizationProfileView,
  GitHubProfileReadmeSection,
  GitHubRepoLicense,
  GitHubRepoOwner,
  GitHubRepoSummary,
  GitHubRepoTemplate,
  GitHubRepoPage,
  GitHubRepositoryScope,
  GitHubRepositorySubscription,
  GitHubRepositorySubscriptionMode,
  GitHubUpdateAccountProfileRequest,
  GitHubUpdateIssueRequest,
  GitHubUpdatePullRequestRequest,
  GitHubIssue,
  GitHubIssueListOptions,
  GitHubPullRequest,
  GitHubMergePullRequestRequest,
  GitHubWatchedRepoPage,
} from "../../services/workspace";
import type {
  HomeAttentionLoadOptions,
  HomeAttentionResult,
} from "../../services/homeAttention/types";
import type { WorkspaceRepositoriesFeature } from "./repositories";
import type { WorkspaceStateFeature } from "./state";
import type { WorkspaceServiceLoader } from "./system";

export function createWorkspaceAccountFeature(
  { replaceRepos, state }: Pick<WorkspaceStateFeature, "replaceRepos" | "state">,
  { refreshRepos }: Pick<WorkspaceRepositoriesFeature, "refreshRepos">,
  loadWorkspaceService: WorkspaceServiceLoader,
) {

async function reloadAccountWorkspace() {
  const service = await loadWorkspaceService();
  state.settings = await service.getWorkspaceSettings();
  if (state.settings.activeWorkspace?.roots.some((root) => root.available)) {
    await refreshRepos();
  } else {
    replaceRepos([]);
  }
  return state.settings;
}

async function updateAccountPreferences(preferences: AccountPreferences) {
  const service = await loadWorkspaceService();
  const settings = await service.updateAccountPreferences(preferences);
  state.settings = settings;
  return settings;
}

async function getAccountProfile(): Promise<GitHubAccountProfile> {
  const service = await loadWorkspaceService();
  return service.getGitHubAccountProfile();
}

async function getAccountReadme(): Promise<GitHubProfileReadmeSection> {
  const service = await loadWorkspaceService();
  return service.getGitHubAccountReadme();
}

async function updateAccountProfile(
  request: GitHubUpdateAccountProfileRequest,
): Promise<GitHubAccountProfile> {
  const service = await loadWorkspaceService();
  return service.updateGitHubAccountProfile(request);
}

async function getOrganizationProfile(login: string): Promise<GitHubOrganizationProfile> {
  const service = await loadWorkspaceService();
  return service.getGitHubOrganizationProfile(login);
}

async function getOrganizationOverview(
  login: string,
  view: GitHubOrganizationProfileView,
): Promise<GitHubOrganizationOverview> {
  const service = await loadWorkspaceService();
  return service.getGitHubOrganizationOverview(login, view);
}

async function getAccountRepositoryOwners(opts: { force?: boolean } = {}): Promise<GitHubRepoOwner[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepoOwners(opts);
}

async function listGitHubWatchedRepos(page: number | null = 1): Promise<GitHubWatchedRepoPage> {
  const service = await loadWorkspaceService();
  return service.listGitHubWatchedRepos(page);
}

async function getGitHubRepositorySubscription(
  repoFullName: string,
): Promise<GitHubRepositorySubscription> {
  const service = await loadWorkspaceService();
  return service.getGitHubRepositorySubscription(repoFullName);
}

async function updateGitHubRepositorySubscription(
  repoFullName: string,
  mode: GitHubRepositorySubscriptionMode,
): Promise<GitHubRepositorySubscription> {
  const service = await loadWorkspaceService();
  return service.updateGitHubRepositorySubscription(repoFullName, mode);
}

async function createGitHubRepo(
  request: GitHubCreateRepoRequest,
): Promise<GitHubRepoSummary> {
  const service = await loadWorkspaceService();
  return service.createGitHubRepo(request);
}

async function listGitHubRepoTemplates(): Promise<GitHubRepoTemplate[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepoTemplates();
}

async function listGitHubRepoLicenses(): Promise<GitHubRepoLicense[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepoLicenses();
}

async function listGitHubRepos(
  scope: GitHubRepositoryScope,
  page?: number | null,
): Promise<GitHubRepoPage> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepos(scope, page ?? null);
}

async function preloadGitHubRepos(
  opts: { force?: boolean; scope?: GitHubRepositoryScope } = {},
): Promise<GitHubRepoPage> {
  const service = await loadWorkspaceService();
  return service.preloadGitHubRepos(opts);
}

async function getGitHubBindingStatus(): Promise<GitHubBindingStatus> {
  const service = await loadWorkspaceService();
  return service.getGitHubBindingStatus();
}

async function listGitHubAccountIssues(
  options: Pick<GitHubIssueListOptions, "state" | "perPage" | "sort" | "direction"> = {},
  fetchOptions: { forceRefresh?: boolean } = {},
): Promise<GitHubAccountIssueItem[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubAccountIssues(options, fetchOptions);
}

async function listGitHubActionNotifications(
  perPage = 50,
  fetchOptions: { forceRefresh?: boolean } = {},
): Promise<GitHubActionNotification[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubActionNotifications(perPage, fetchOptions);
}

async function updateGitHubIssue(
  repoFullName: string,
  issueNumber: number,
  request: GitHubUpdateIssueRequest,
): Promise<GitHubIssue> {
  const service = await loadWorkspaceService();
  return service.updateGitHubIssue(repoFullName, issueNumber, request);
}

async function updateGitHubPullRequest(
  repoFullName: string,
  pullNumber: number,
  request: GitHubUpdatePullRequestRequest,
): Promise<GitHubPullRequest> {
  const service = await loadWorkspaceService();
  return service.updateGitHubPullRequest(repoFullName, pullNumber, request);
}

async function mergeGitHubPullRequest(
  repoFullName: string,
  pullNumber: number,
  request: GitHubMergePullRequestRequest,
): Promise<GitHubPullRequest> {
  const service = await loadWorkspaceService();
  return service.mergeGitHubPullRequest(repoFullName, pullNumber, request);
}

async function rerunFailedGitHubWorkflowRun(repoFullName: string, runId: number): Promise<void> {
  const service = await loadWorkspaceService();
  return service.rerunFailedGitHubWorkflowRun(repoFullName, runId);
}

async function cancelGitHubWorkflowRun(repoFullName: string, runId: number): Promise<void> {
  const service = await loadWorkspaceService();
  return service.cancelGitHubWorkflowRun(repoFullName, runId);
}

async function listGitHubHomeAttention(
  repoFullNames: readonly string[],
  options: HomeAttentionLoadOptions = {},
): Promise<HomeAttentionResult> {
  const service = await loadWorkspaceService();
  return service.listGitHubHomeAttention(repoFullNames, options);
}

return {
  reloadAccountWorkspace,
  updateAccountPreferences,
  getAccountProfile,
  getAccountReadme,
  updateAccountProfile,
  getOrganizationProfile,
  getOrganizationOverview,
  getAccountRepositoryOwners,
  listGitHubWatchedRepos,
  getGitHubRepositorySubscription,
  updateGitHubRepositorySubscription,
  createGitHubRepo,
  listGitHubRepoTemplates,
  listGitHubRepoLicenses,
  listGitHubRepos,
  preloadGitHubRepos,
  getGitHubBindingStatus,
  listGitHubAccountIssues,
  listGitHubActionNotifications,
  updateGitHubIssue,
  updateGitHubPullRequest,
  mergeGitHubPullRequest,
  rerunFailedGitHubWorkflowRun,
  cancelGitHubWorkflowRun,
  listGitHubHomeAttention,
};
}

export type WorkspaceAccountFeature = ReturnType<typeof createWorkspaceAccountFeature>;
