import type {
  AccountPreferences,
  GitHubAccountProfile,
  GitHubOrganizationOverview,
  GitHubOrganizationProfile,
  GitHubOrganizationProfileView,
  GitHubProfileReadmeSection,
  GitHubRepoOwner,
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
  if (state.settings.workspaceRoot) {
    await refreshRepos();
  } else {
    replaceRepos([]);
  }
  return state.settings;
}

export async function pickAccountWorkspaceRoot() {
  const service = await loadWorkspaceService();
  return service.pickWorkspaceRoot();
}

export async function updateAccountPreferences(preferences: AccountPreferences) {
  const previousRoot = state.settings?.workspaceRoot ?? null;
  const service = await loadWorkspaceService();
  const settings = await service.updateAccountPreferences(preferences);
  state.settings = settings;
  if (settings.workspaceRoot !== previousRoot) {
    if (settings.workspaceRoot) {
      await refreshRepos();
    } else {
      replaceRepos([]);
    }
  }
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
