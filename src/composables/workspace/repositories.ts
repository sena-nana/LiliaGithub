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
import type {
  GitHubContributionDay,
  GitHubContributionMeta,
  RemoteRepoShortcut,
  RepoConflictChoice,
  RepoSummary,
} from "../../services/workspace";

const CONTRIBUTION_REPO_LIMIT = 30;
const REPO_REFRESH_CONCURRENCY = 4;
const LOCAL_REPO_CONTRIBUTION_SCOPE = "local:";
let repositoryRuntimeGeneration = 0;
let contributionRefreshGeneration = 0;
let contributionRefreshPendingCount = 0;
let contributionRefreshSeenFullNames = new Set<string>();
let contributionRefreshSampledCount = 0;

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
    await refreshManagedRepoSummaries(repos.map((repo) => repo.id), { fetchRemote: true, refreshBackground: false });
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
  options: { fetchRemote?: boolean; refreshBackground?: boolean } = {},
) {
  const generation = ++repositoryRuntimeGeneration;
  const uniqueRepoIds = Array.from(new Set(repoIds));
  if (!uniqueRepoIds.length) {
    scheduleLowPriorityRefresh([]);
    return;
  }
  state.scanning = true;
  state.refreshingRepoIds = uniqueRepoIds;
  const shouldRefreshBackground = options.refreshBackground ?? true;
  const contributionGeneration = shouldRefreshBackground ? beginContributionRefresh() : null;
  if (contributionGeneration != null) {
    for (const scope of repoContributionScopes()) {
      scheduleRepoContributionRefresh(scope, contributionGeneration);
    }
  }
  try {
    const service = await loadWorkspaceService();
    const refreshedRepoIds: string[] = [];
    await runBoundedParallel(uniqueRepoIds, REPO_REFRESH_CONCURRENCY, async (repoId) => {
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
    });
    if (generation === repositoryRuntimeGeneration && shouldRefreshBackground) {
      void refreshLanguageStatsForRepos(refreshedRepoIds);
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

function repoContributionScope(repo: {
  id: string;
}) {
  return `${LOCAL_REPO_CONTRIBUTION_SCOPE}${repo.id}`;
}

function repoContributionScopes() {
  return Array.from(new Set(
    state.repos.map((repo) => repoContributionScope(repo)),
  ));
}

export async function refreshRepoContributions() {
  const generation = beginContributionRefresh();
  for (const scope of repoContributionScopes()) {
    scheduleRepoContributionRefresh(scope, generation);
  }
}

function beginContributionRefresh() {
  const generation = ++contributionRefreshGeneration;
  const refreshedAt = Date.now();
  contributionRefreshPendingCount = 0;
  contributionRefreshSeenFullNames = new Set();
  contributionRefreshSampledCount = 0;
  state.githubContributions.loading = false;
  state.githubContributions.error = null;
  state.githubContributions.days = emptyContributionDays(refreshedAt);
  state.githubContributions.meta = {
    repoCount: 0,
    requestedRepoCount: 0,
    repoLimit: CONTRIBUTION_REPO_LIMIT,
    truncated: false,
    skippedRepoCount: 0,
    refreshedAt,
  };
  return generation;
}

function scheduleRepoContributionRefresh(scope: string, generation: number) {
  const normalized = scope.trim();
  if (!normalized || contributionRefreshSeenFullNames.has(normalized) || generation !== contributionRefreshGeneration) {
    return;
  }
  if (contributionRefreshSampledCount >= CONTRIBUTION_REPO_LIMIT) return;
  contributionRefreshSeenFullNames.add(normalized);
  contributionRefreshSampledCount += 1;
  updateContributionMeta({
    requestedRepoCount: contributionRefreshSeenFullNames.size,
    sampledRepoCount: contributionRefreshSampledCount,
  });
  contributionRefreshPendingCount += 1;
  state.githubContributions.loading = true;
  void refreshSingleRepoContribution(normalized, generation);
}

async function refreshSingleRepoContribution(scope: string, generation: number) {
  try {
    const service = await loadWorkspaceService();
    const result = await service.listRepoContribution(scope);
    if (generation !== contributionRefreshGeneration) return;
    state.githubContributions.days = mergeContributionDays(state.githubContributions.days, result.days);
    updateContributionMeta({
      repoCount: (state.githubContributions.meta?.repoCount ?? 0) + (result.meta.repoCount ?? 1),
      requestedRepoCount: contributionRefreshSeenFullNames.size,
      sampledRepoCount: contributionRefreshSampledCount,
      skippedRepoCount: (state.githubContributions.meta?.skippedRepoCount ?? 0) + (result.meta.skippedRepoCount ?? 0),
    });
  } catch (err) {
    if (generation !== contributionRefreshGeneration) return;
    state.githubContributions.error = String(err);
  } finally {
    finishRepoContributionRefresh(generation);
  }
}

function finishRepoContributionRefresh(generation: number) {
  if (generation !== contributionRefreshGeneration) return;
  contributionRefreshPendingCount = Math.max(0, contributionRefreshPendingCount - 1);
  state.githubContributions.loading = contributionRefreshPendingCount > 0;
}

function emptyContributionDays(now = Date.now()) {
  const endDay = Math.floor(now / 86_400_000);
  return Array.from({ length: 371 }, (_, index) => ({
    date: new Date((endDay - 370 + index) * 86_400_000).toISOString().slice(0, 10),
    count: 0,
  }));
}

function mergeContributionDays(
  current: GitHubContributionDay[],
  incoming: GitHubContributionDay[],
) {
  const counts = new Map(current.map((day) => [day.date, day.count]));
  for (const day of incoming) {
    counts.set(day.date, (counts.get(day.date) ?? 0) + day.count);
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function updateContributionMeta(update: Partial<GitHubContributionMeta> & {
  sampledRepoCount?: number;
}) {
  const current = state.githubContributions.meta;
  const requestedRepoCount = update.requestedRepoCount ?? current?.requestedRepoCount ?? 0;
  const sampledRepoCount = update.sampledRepoCount ?? Math.min(requestedRepoCount, CONTRIBUTION_REPO_LIMIT);
  state.githubContributions.meta = {
    repoCount: Math.min(sampledRepoCount, update.repoCount ?? current?.repoCount ?? 0),
    requestedRepoCount,
    repoLimit: CONTRIBUTION_REPO_LIMIT,
    truncated: requestedRepoCount > sampledRepoCount,
    skippedRepoCount: update.skippedRepoCount ?? current?.skippedRepoCount ?? 0,
    refreshedAt: update.refreshedAt ?? current?.refreshedAt ?? Date.now(),
  };
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
  await runBoundedParallel(uniqueRepoIds, REPO_REFRESH_CONCURRENCY, async (repoId) => {
    if (generation !== repositoryRuntimeGeneration) return;
    try {
      await refreshRepoLanguageStats(repoId, options);
    } catch (err) {
      firstError ??= err;
    }
  });
  if (firstError && !options.silent) {
    throw firstError;
  }
}

async function runBoundedParallel<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }));
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
    const current = state.repos.find((repo) => repo.id === summary.id);
    const nextSummary = current
      ? {
        ...current,
        languageStats: summary.languageStats,
        workingTreeLanguageStats: summary.workingTreeLanguageStats,
        languageStatsUpdatedAt: summary.languageStatsUpdatedAt,
      }
      : summary;
    upsertRepo(nextSummary);
    return nextSummary;
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
  contributionRefreshGeneration += 1;
  contributionRefreshPendingCount = 0;
  contributionRefreshSeenFullNames = new Set();
  contributionRefreshSampledCount = 0;
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
  removeLocalRepoState(repoId);
}

export async function deleteLocalRepo(repoId: string) {
  repositoryRuntimeGeneration += 1;
  const service = await loadWorkspaceService();
  state.settings = await service.deleteLocalRepo(repoId);
  removeLocalRepoState(repoId);
}

function removeLocalRepoState(repoId: string) {
  state.repos = state.repos.filter((repo) => repo.id !== repoId);
  delete state.repoDetails[repoId];
  delete state.launchConfigs[repoId];
  delete state.launchCandidates[repoId];
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

export async function discardChanges(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.discardFiles(repoId, files));
}

export async function addFilesToGitignore(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.addFilesToGitignore(repoId, files));
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

export async function mergeBranch(repoId: string, branch: string) {
  const service = await loadWorkspaceService();
  clearRepoActionError(repoId);
  try {
    await applyRepoMutation(repoId, async () => {
      const result = await service.mergeBranch(repoId, branch);
      return result.summary;
    });
  } catch (err) {
    setRepoActionError(repoId, String(err));
    throw err;
  }
}

async function runPushMutation(repoId: string, pushRepo: () => Promise<RepoSummary>) {
  const updateRecentSync = beginRecentSyncRetry(repoId);
  try {
    await applyRepoMutationWithLanguageStats(repoId, async () => {
      const summary = await pushRepo();
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

export async function push(repoId: string) {
  const service = await loadWorkspaceService();
  await runPushMutation(repoId, () => service.pushRepo(repoId));
}

export async function pushWithSystemGit(repoId: string) {
  const service = await loadWorkspaceService();
  await runPushMutation(repoId, () => service.pushRepoWithSystemGit(repoId));
  state.settings = await service.getWorkspaceSettings();
}

export async function useDefaultTokenAuthForRepo(repoId: string) {
  const service = await loadWorkspaceService();
  state.settings = await service.useDefaultTokenAuthForRepo(repoId);
}

export async function checkout(repoId: string, branch: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutationWithLanguageStats(repoId, () => service.checkoutBranch(repoId, branch));
}

export async function deleteBranch(repoId: string, branch: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutationWithLanguageStats(repoId, () => service.deleteBranch(repoId, branch));
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
