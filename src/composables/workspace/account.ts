import type {
  AccountPreferences,
  GitHubAccountProfile,
  GitHubBindingStatus,
  GitHubCreateRepoRequest,
  GitHubOrganizationOverview,
  GitHubOrganizationProfile,
  GitHubOrganizationProfileView,
  GitHubProfileReadmeSection,
  GitHubRepoOwner,
  GitHubRepoSummary,
  GitHubRepoTemplate,
  GitHubRepoPage,
  GitHubRepositoryScope,
  GitHubRepositorySubscription,
  GitHubRepositorySubscriptionMode,
  GitHubUpdateAccountProfileRequest,
  GitHubWatchedRepoPage,
} from "../../services/workspace";
import { loadWorkspaceService } from "./serviceLoader";
import { refreshRepos } from "./repositories";
import { replaceRepos, state } from "./state";

export async function reloadAccountWorkspace() {
  const service = await loadWorkspaceService();
  state.settings = await service.getWorkspaceSettings();
  if (state.settings.activeWorkspace?.roots.some((root) => root.available)) {
    await refreshRepos();
  } else {
    replaceRepos([]);
  }
  return state.settings;
}

export async function updateAccountPreferences(preferences: AccountPreferences) {
  const service = await loadWorkspaceService();
  const settings = await service.updateAccountPreferences(preferences);
  state.settings = settings;
  return settings;
}

export async function getAccountProfile(): Promise<GitHubAccountProfile> {
  const service = await loadWorkspaceService();
  return service.getGitHubAccountProfile();
}

export async function getAccountReadme(): Promise<GitHubProfileReadmeSection> {
  const service = await loadWorkspaceService();
  return service.getGitHubAccountReadme();
}

export async function updateAccountProfile(
  request: GitHubUpdateAccountProfileRequest,
): Promise<GitHubAccountProfile> {
  const service = await loadWorkspaceService();
  return service.updateGitHubAccountProfile(request);
}

export async function getOrganizationProfile(login: string): Promise<GitHubOrganizationProfile> {
  const service = await loadWorkspaceService();
  return service.getGitHubOrganizationProfile(login);
}

export async function getOrganizationOverview(
  login: string,
  view: GitHubOrganizationProfileView,
): Promise<GitHubOrganizationOverview> {
  const service = await loadWorkspaceService();
  return service.getGitHubOrganizationOverview(login, view);
}

export async function getAccountRepositoryOwners(): Promise<GitHubRepoOwner[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepoOwners();
}

export async function listGitHubWatchedRepos(page: number | null = 1): Promise<GitHubWatchedRepoPage> {
  const service = await loadWorkspaceService();
  return service.listGitHubWatchedRepos(page);
}

export async function getGitHubRepositorySubscription(
  repoFullName: string,
): Promise<GitHubRepositorySubscription> {
  const service = await loadWorkspaceService();
  return service.getGitHubRepositorySubscription(repoFullName);
}

export async function updateGitHubRepositorySubscription(
  repoFullName: string,
  mode: GitHubRepositorySubscriptionMode,
): Promise<GitHubRepositorySubscription> {
  const service = await loadWorkspaceService();
  return service.updateGitHubRepositorySubscription(repoFullName, mode);
}

export async function createGitHubRepo(
  request: GitHubCreateRepoRequest,
): Promise<GitHubRepoSummary> {
  const service = await loadWorkspaceService();
  return service.createGitHubRepo(request);
}

export async function listGitHubRepoTemplates(): Promise<GitHubRepoTemplate[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepoTemplates();
}

export async function listGitHubRepos(
  scope: GitHubRepositoryScope,
  page?: number | null,
): Promise<GitHubRepoPage> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepos(scope, page ?? null);
}

export async function preloadGitHubRepos(
  opts: { force?: boolean; scope?: GitHubRepositoryScope } = {},
): Promise<GitHubRepoPage> {
  const service = await loadWorkspaceService();
  return service.preloadGitHubRepos(opts);
}

export async function getGitHubBindingStatus(): Promise<GitHubBindingStatus> {
  const service = await loadWorkspaceService();
  return service.getGitHubBindingStatus();
}
