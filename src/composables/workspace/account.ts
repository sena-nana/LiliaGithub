import type {
  AccountPreferences,
  GitHubAccountProfile,
  GitHubRepoOwner,
  GitHubUpdateAccountProfileRequest,
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

export async function updateAccountProfile(
  request: GitHubUpdateAccountProfileRequest,
): Promise<GitHubAccountProfile> {
  const service = await loadWorkspaceService();
  return service.updateGitHubAccountProfile(request);
}

export async function getAccountRepositoryOwners(): Promise<GitHubRepoOwner[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepoOwners();
}
