import {
  beginRecentSyncRetry,
  clearRepoActionError,
  finishRecentSyncRetry,
  state,
  replaceRepos,
  setRepoDetail,
  setRepoActionError,
  upsertRepo,
} from "./state";
import { loadWorkspaceService } from "./serviceLoader";
import type { RemoteRepoShortcut, RepoConflictChoice, RepoSummary } from "../../services/workspace";

const CONTRIBUTION_REPO_LIMIT = 30;
let repositoryRuntimeGeneration = 0;

async function applyRepoMutation(
  repoId: string,
  loadSummary: () => Promise<import("../../services/workspace").RepoSummary>,
) {
  upsertRepo(await loadSummary());
  clearRepoActionError(repoId);
  await loadRepoDetail(repoId);
}

async function applyRepoMutationWithLanguageStats(
  repoId: string,
  loadSummary: () => Promise<import("../../services/workspace").RepoSummary>,
) {
  await applyRepoMutation(repoId, loadSummary);
  await refreshRepoLanguageStats(repoId, { silent: true });
}

export async function refreshRepos() {
  const repos = await loadManagedRepoList();
  if (repos) {
    void refreshManagedRepoSummaries(repos.map((repo) => repo.id), { fetchRemote: true });
  }
}

export async function refreshRepoSummaries() {
  const repos = await loadManagedRepoList();
  if (!repos) return null;
  if (!repos.length) return repos;
  try {
    await refreshManagedRepoSummaries(repos.map((repo) => repo.id), { fetchRemote: true });
    return repos;
  } catch (err) {
    state.error = String(err);
    return null;
  }
}

async function loadManagedRepoList() {
  state.error = null;
  try {
    const service = await loadWorkspaceService();
    const repos = await service.listManagedRepos();
    replaceRepos(repos);
    return repos;
  } catch (err) {
    state.error = String(err);
    return null;
  }
}

async function refreshManagedRepoSummaries(
  repoIds: string[],
  options: { fetchRemote?: boolean } = {},
) {
  const generation = ++repositoryRuntimeGeneration;
  const uniqueRepoIds = Array.from(new Set(repoIds));
  if (!uniqueRepoIds.length) {
    scheduleLowPriorityRefresh([]);
    return;
  }
  state.scanning = true;
  state.refreshingRepoIds = uniqueRepoIds;
  try {
    const service = await loadWorkspaceService();
    const refreshedRepoIds: string[] = [];
    for (const repoId of uniqueRepoIds) {
      if (generation !== repositoryRuntimeGeneration) return;
      try {
        const summary = await service.refreshRepoSummary(repoId, { fetchRemote: options.fetchRemote ?? false });
        if (generation !== repositoryRuntimeGeneration) return;
        upsertRepo(summary);
        refreshedRepoIds.push(summary.id);
      } catch {
        // Per-repo failures are recorded in backend workspace tasks; keep the visible list intact.
      } finally {
        state.refreshingRepoIds = state.refreshingRepoIds.filter((id) => id !== repoId);
        void refreshWorkspaceTasks();
      }
    }
    if (generation === repositoryRuntimeGeneration) {
      scheduleLowPriorityRefresh(refreshedRepoIds);
    }
  } finally {
    if (generation === repositoryRuntimeGeneration) {
      state.scanning = false;
      state.refreshingRepoIds = [];
    }
  }
}

export async function discoverRepos() {
  const service = await loadWorkspaceService();
  const repos = await service.discoverRepos();
  applyRepoList(repos);
  return repos;
}

export async function addLocalRepo() {
  const service = await loadWorkspaceService();
  const picked = await service.pickRepo();
  if (!picked) return null;
  const summary = await service.addRepo(picked);
  upsertRepo(summary);
  scheduleLowPriorityRefresh([summary.id]);
  return summary;
}

function applyRepoList(repos: RepoSummary[]) {
  replaceRepos(repos);
  scheduleLowPriorityRefresh(repos.map((repo) => repo.id));
}

function scheduleLowPriorityRefresh(repoIds: string[]) {
  void refreshLanguageStatsForRepos(repoIds);
  void refreshRepoContributions();
  void refreshWorkspaceTasks();
}

function repoFullNames() {
  return Array.from(new Set(
    state.repos
      .map((repo) => repo.githubFullName?.trim())
      .filter((name): name is string => Boolean(name)),
  ));
}

export async function refreshRepoContributions() {
  const fullNames = repoFullNames();
  state.githubContributions.loading = true;
  state.githubContributions.error = null;
  const refreshedAt = Date.now();
  try {
    if (!fullNames.length) {
      state.githubContributions.days = [];
      state.githubContributions.meta = {
        repoCount: 0,
        requestedRepoCount: 0,
        repoLimit: CONTRIBUTION_REPO_LIMIT,
        truncated: false,
        skippedRepoCount: 0,
        refreshedAt,
      };
      return;
    }
    const service = await loadWorkspaceService();
    const result = await service.listRepoContributions(fullNames);
    state.githubContributions.days = result.days;
    state.githubContributions.meta = result.meta;
  } catch (err) {
    state.githubContributions.error = String(err);
  } finally {
    state.githubContributions.loading = false;
  }
}

export async function refreshWorkspaceTasks() {
  const service = await loadWorkspaceService();
  state.tasks = await service.listWorkspaceTasks();
}

export async function refreshLanguageStatsForRepos(
  repoIds: string[],
  options: { silent?: boolean } = { silent: true },
) {
  const generation = repositoryRuntimeGeneration;
  const uniqueRepoIds = Array.from(new Set(repoIds));
  let firstError: unknown = null;
  for (const repoId of uniqueRepoIds) {
    if (generation !== repositoryRuntimeGeneration) return;
    try {
      await refreshRepoLanguageStats(repoId, options);
    } catch (err) {
      firstError ??= err;
    }
  }
  if (firstError && !options.silent) {
    throw firstError;
  }
}

export async function refreshRepoLanguageStats(
  repoId: string,
  options: { silent?: boolean } = {},
) {
  const generation = repositoryRuntimeGeneration;
  if (state.languageStatsLoadingRepoIds.includes(repoId)) return null;
  state.languageStatsLoadingRepoIds = [...state.languageStatsLoadingRepoIds, repoId];
  try {
    const service = await loadWorkspaceService();
    const summary = await service.refreshRepoLanguageStats(repoId);
    if (generation !== repositoryRuntimeGeneration) return null;
    upsertRepo(summary);
    return summary;
  } catch (err) {
    if (options.silent) return null;
    throw err;
  } finally {
    state.languageStatsLoadingRepoIds = state.languageStatsLoadingRepoIds.filter((id) => id !== repoId);
    void refreshWorkspaceTasks();
  }
}

export function resetRepositoryRuntimeForTests() {
  repositoryRuntimeGeneration += 1;
}

export async function cloneRepo(remoteUrl: string, directoryName?: string | null) {
  state.error = null;
  const service = await loadWorkspaceService();
  const summary = await service.cloneRepo(remoteUrl, directoryName);
  upsertRepo(summary);
  return summary;
}

export async function hideRepo(repoId: string) {
  repositoryRuntimeGeneration += 1;
  const service = await loadWorkspaceService();
  state.settings = await service.hideRepo(repoId);
  state.repos = state.repos.filter((repo) => repo.id !== repoId);
  delete state.repoDetails[repoId];
  delete state.launchConfigs[repoId];
  delete state.launchStatuses[repoId];
  delete state.launchLogs[repoId];
}

export async function rememberRemoteRepo(repo: RemoteRepoShortcut) {
  const service = await loadWorkspaceService();
  state.settings = await service.rememberRemoteRepo(repo);
  return state.settings;
}

export async function forgetRemoteRepo(fullName: string) {
  const service = await loadWorkspaceService();
  state.settings = await service.forgetRemoteRepo(fullName);
  return state.settings;
}

export function refreshRepoStatusList() {
  state.repoStatusListRefreshToken += 1;
}

export async function unhideRepo(repoId: string) {
  const service = await loadWorkspaceService();
  state.settings = await service.unhideRepo(repoId);
  upsertRepo(await service.getRepoSummary(repoId));
}

export async function listHiddenRepos() {
  const service = await loadWorkspaceService();
  return service.listHiddenRepos();
}

export async function loadRepoDetail(repoId: string) {
  state.error = null;
  const service = await loadWorkspaceService();
  const detail = await service.getRepoDetail(repoId);
  setRepoDetail(detail);
  return detail;
}

export async function stage(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await service.stageFiles(repoId, files);
  clearRepoActionError(repoId);
  await loadRepoDetail(repoId);
}

export async function unstage(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await service.unstageFiles(repoId, files);
  clearRepoActionError(repoId);
  await loadRepoDetail(repoId);
}

export async function commit(repoId: string, files: string[], message: string, pushAfter: boolean) {
  const service = await loadWorkspaceService();
  await applyRepoMutationWithLanguageStats(repoId, () => service.commitRepo(repoId, files, message, pushAfter));
}

export async function pull(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutationWithLanguageStats(repoId, () => service.pullRepo(repoId));
}

export async function mergePull(repoId: string) {
  const service = await loadWorkspaceService();
  clearRepoActionError(repoId);
  try {
    await applyRepoMutation(repoId, async () => {
      const result = await service.mergePullRepo(repoId);
      return result.summary;
    });
  } catch (err) {
    setRepoActionError(repoId, String(err));
    throw err;
  }
}

export async function push(repoId: string) {
  const service = await loadWorkspaceService();
  const updateRecentSync = beginRecentSyncRetry(repoId);
  try {
    await applyRepoMutationWithLanguageStats(repoId, async () => {
      const summary = await service.pushRepo(repoId);
      if (updateRecentSync) {
        finishRecentSyncRetry({
          repoId,
          status: "success",
          message: "完成",
          summary,
        });
      }
      return summary;
    });
  } catch (err) {
    if (updateRecentSync) {
      finishRecentSyncRetry({
        repoId,
        status: "error",
        message: String(err),
        summary: null,
      });
    }
    throw err;
  }
}

export async function checkout(repoId: string, branch: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutationWithLanguageStats(repoId, () => service.checkoutBranch(repoId, branch));
}

export async function acceptConflictFile(
  repoId: string,
  path: string,
  side: "ours" | "theirs",
  stage = true,
) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.acceptConflictFile(repoId, path, side, stage));
}

export async function resolveConflictFile(
  repoId: string,
  path: string,
  choices: RepoConflictChoice[],
  stage = true,
) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.resolveConflictFile(repoId, path, choices, stage));
}

export async function markConflictFileResolved(repoId: string, path: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.markFileResolved(repoId, path));
}

export async function abortConflictOperation(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.abortConflictOperation(repoId));
}

export async function continueConflictOperation(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.continueConflictOperation(repoId));
}
