import {
  beginRecentSyncRetry,
  beginRepoSync,
  clearRepoActionError,
  finishRecentSyncRetry,
  finishRepoSync,
  rememberRecentSync,
  state,
  replaceRepos,
  setRepoDetail,
  setWorkspaceTasks,
  setRepoActionError,
  upsertRepo,
} from "./state";
import { loadWorkspaceService } from "./serviceLoader";
import {
  repoAutoSyncEnabled,
  repoIncludedInHomeContributionStats,
  type RepoSettingKey,
} from "../../config/repoSettingsManifest";
import type {
  GitHubContributionDay,
  GitHubContributionMeta,
  GitHubContributionRepository,
  RemoteRepoShortcut,
  RepoConflictChoice,
  RepoPullLocalChangesMode,
  RepoSummary,
  WorkspaceCreateLocalRepoRequest,
  BulkSyncPreview,
  BulkSyncResult,
} from "../../services/workspace";
import { representativeReposBySharedGroup } from "../../utils/repoWorktree";

const CONTRIBUTION_REPO_LIMIT = 30;
const REPO_REFRESH_CONCURRENCY = 4;
const LOCAL_REPO_CONTRIBUTION_SCOPE = "local:";
type ContributionRefreshScope = {
  scope: string;
  source: GitHubContributionRepository;
};
let repositoryRuntimeGeneration = 0;
let contributionRefreshGeneration = 0;
let contributionRefreshPendingCount = 0;
let contributionRefreshSeenFullNames = new Set<string>();
let contributionRefreshSampledCount = 0;
let contributionRefreshDays: GitHubContributionDay[] = [];
let contributionRefreshRepoCount = 0;
let contributionRefreshSkippedRepoCount = 0;
let workspaceTaskRefreshGeneration = 0;
let languageStatsLoadingGenerations = new Map<string, number>();
const autoSyncRunningRepoIds = new Set<string>();

async function applyRepoMutation(
  repoId: string,
  loadSummary: () => Promise<import("../../services/workspace").RepoSummary>,
) {
  upsertRepo(await loadSummary());
  clearRepoActionError(repoId);
  await loadRepoDetail(repoId);
}

async function applyRepoOperation(
  repoId: string,
  loadOperation: () => Promise<import("../../services/workspace").RepoOperationResult>,
) {
  const result = await loadOperation();
  upsertRepo(result.summary);
  clearRepoActionError(repoId);
  await loadRepoDetail(repoId);
  return result;
}

function repoNeedsSync(summary: RepoSummary) {
  return summary.ahead > 0 || summary.behind > 0;
}

function repoDirtyCount(summary: RepoSummary) {
  return summary.stagedCount + summary.unstagedCount + summary.untrackedCount;
}

function autoSyncBlockReason(summary: RepoSummary) {
  if (!summary.remoteUrl) return "没有 origin remote，已跳过自动同步";
  if (!summary.currentBranch) return "当前不是命名分支，已跳过自动同步";
  if (summary.conflictCount > 0) return "已有冲突需要先处理，已跳过自动同步";
  if (repoDirtyCount(summary) > 0 && summary.behind <= 0) return "存在未提交变更，已跳过自动同步";
  return null;
}

function autoSyncReason(summary: RepoSummary) {
  if (summary.ahead > 0 && summary.behind > 0) return "需先拉取合并后推送";
  if (summary.behind > 0) return "可拉取远端更新";
  return "有本地提交待推送";
}

function autoSyncPreview(summary: RepoSummary): BulkSyncPreview {
  return {
    operation: "sync",
    eligible: [{ repo: { ...summary }, reason: autoSyncReason(summary) }],
    blocked: [],
    warnings: [],
  };
}

function rememberAutoSyncFailure(summary: RepoSummary, result: BulkSyncResult) {
  rememberRecentSync(autoSyncPreview(summary), [result]);
}

function applyAutoSyncResult(result: BulkSyncResult) {
  if (result.summary) {
    upsertRepo(result.summary);
  }
  if (result.status === "success") {
    clearRepoActionError(result.repoId);
  } else {
    setRepoActionError(result.repoId, result.message);
  }
}

export async function autoSyncRepoIfNeeded(
  repoId: string,
  options: { summary?: RepoSummary; refreshDetail?: boolean; throwOnError?: boolean } = {},
) {
  const summary = options.summary ?? state.repos.find((repo) => repo.id === repoId) ?? null;
  if (!summary) return null;
  const autoSyncEnabled = repoAutoSyncEnabled(state.settings, summary.id);
  if (!autoSyncEnabled) return null;
  if (!repoNeedsSync(summary)) {
    clearRepoActionError(summary.id);
    return null;
  }
  if (autoSyncRunningRepoIds.has(summary.id)) return null;

  const blockReason = autoSyncBlockReason(summary);
  if (blockReason) {
    setRepoActionError(summary.id, blockReason);
    return null;
  }

  autoSyncRunningRepoIds.add(summary.id);
  beginRepoSync(summary.id);
  try {
    let result: BulkSyncResult | undefined;
    try {
      const service = await loadWorkspaceService();
      [result] = await service.bulkSyncExecute("sync", [summary.id], "stash");
    } catch (err) {
      const failedResult: BulkSyncResult = {
        repoId: summary.id,
        status: "error",
        message: String(err),
        summary: null,
      };
      rememberAutoSyncFailure(summary, failedResult);
      setRepoActionError(summary.id, failedResult.message);
      if (options.throwOnError) throw err;
      return null;
    }
    if (!result) return null;
    applyAutoSyncResult(result);
    if (result.status !== "success") {
      rememberAutoSyncFailure(summary, result);
      if (options.throwOnError) throw new Error(result.message);
      return result;
    }
    const syncedRepoId = result.summary?.id ?? summary.id;
    if (options.refreshDetail || state.repoDetails[syncedRepoId]) {
      await loadRepoDetail(syncedRepoId).catch(() => undefined);
    }
    void refreshRepoLanguageStats(syncedRepoId, { silent: true });
    return result;
  } finally {
    autoSyncRunningRepoIds.delete(summary.id);
    finishRepoSync(summary.id);
  }
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

export async function fetchAll() {
  return refreshRepoSummaries();
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
  const refreshingRepoIds = new Set(uniqueRepoIds);
  let refreshingStatusFlushPending = false;
  const applyRefreshingRepoIds = () => {
    const nextRepoIds = [...refreshingRepoIds];
    if (
      nextRepoIds.length === state.refreshingRepoIds.length &&
      nextRepoIds.every((repoId, index) => state.refreshingRepoIds[index] === repoId)
    ) {
      return;
    }
    state.refreshingRepoIds = nextRepoIds;
  };
  const flushRefreshingRepoIds = () => {
    refreshingStatusFlushPending = false;
    if (generation === repositoryRuntimeGeneration) applyRefreshingRepoIds();
  };
  const scheduleRefreshingRepoIdsFlush = () => {
    if (refreshingStatusFlushPending) return;
    refreshingStatusFlushPending = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(flushRefreshingRepoIds);
    } else {
      setTimeout(flushRefreshingRepoIds, 0);
    }
  };
  applyRefreshingRepoIds();
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
        await autoSyncRepoIfNeeded(summary.id, { summary });
      } catch {
        // Per-repo failures are recorded in backend workspace tasks; keep the visible list intact.
      } finally {
        if (generation !== repositoryRuntimeGeneration) return;
        refreshingRepoIds.delete(repoId);
        scheduleRefreshingRepoIdsFlush();
        void refreshWorkspaceTasks();
      }
    });
    if (generation === repositoryRuntimeGeneration && shouldRefreshBackground) {
      void refreshLanguageStatsForRepos(refreshedRepoIds);
    }
  } finally {
    if (generation === repositoryRuntimeGeneration) {
      refreshingRepoIds.clear();
      flushRefreshingRepoIds();
      state.scanning = false;
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

function repoContributionScope(repo: Pick<RepoSummary, "id" | "name" | "githubFullName">): ContributionRefreshScope {
  return {
    scope: `${LOCAL_REPO_CONTRIBUTION_SCOPE}${repo.id}`,
    source: {
      repoId: repo.id,
      repoName: repo.name.trim() || repo.id,
      repoFullName: repo.githubFullName?.trim() || null,
      count: 0,
    },
  };
}

function repoContributionScopes() {
  const scopes = new Map<string, ContributionRefreshScope>();
  for (const repo of representativeReposBySharedGroup(state.repos)) {
    if (!repoIncludedInHomeContributionStats(state.settings, repo.id)) continue;
    const item = repoContributionScope(repo);
    scopes.set(item.scope, item);
  }
  return [...scopes.values()];
}

export async function refreshRepoContributions() {
  const generation = beginContributionRefresh();
  const scopes = repoContributionScopes();
  if (!scopes.length) {
    finishEmptyContributionRefresh(generation);
    return;
  }
  for (const scope of scopes) {
    scheduleRepoContributionRefresh(scope, generation);
  }
}

function beginContributionRefresh() {
  const generation = ++contributionRefreshGeneration;
  const refreshedAt = Date.now();
  contributionRefreshPendingCount = 0;
  contributionRefreshSeenFullNames = new Set();
  contributionRefreshSampledCount = 0;
  contributionRefreshRepoCount = 0;
  contributionRefreshSkippedRepoCount = 0;
  contributionRefreshDays = emptyContributionDays(refreshedAt);
  state.githubContributions.loading = false;
  state.githubContributions.error = null;
  if (!state.githubContributions.meta) {
    state.githubContributions.meta = {
      repoCount: 0,
      requestedRepoCount: 0,
      repoLimit: CONTRIBUTION_REPO_LIMIT,
      truncated: false,
      skippedRepoCount: 0,
      refreshedAt,
    };
  }
  return generation;
}

function scheduleRepoContributionRefresh(item: ContributionRefreshScope, generation: number) {
  const normalized = item.scope.trim();
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
  void refreshSingleRepoContribution({ ...item, scope: normalized }, generation);
}

async function refreshSingleRepoContribution(item: ContributionRefreshScope, generation: number) {
  try {
    const service = await loadWorkspaceService();
    const result = await service.listRepoContribution(item.scope);
    if (generation !== contributionRefreshGeneration) return;
    contributionRefreshDays = mergeContributionDays(
      contributionRefreshDays,
      result.days,
      item.source,
    );
    contributionRefreshRepoCount += result.meta.repoCount ?? 1;
    contributionRefreshSkippedRepoCount += result.meta.skippedRepoCount ?? 0;
    state.githubContributions.days = contributionRefreshDays;
    updateContributionMeta({
      repoCount: contributionRefreshRepoCount,
      requestedRepoCount: contributionRefreshSeenFullNames.size,
      sampledRepoCount: contributionRefreshSampledCount,
      skippedRepoCount: contributionRefreshSkippedRepoCount,
    });
  } catch (err) {
    if (generation !== contributionRefreshGeneration) return;
    state.githubContributions.error = String(err);
  } finally {
    finishRepoContributionRefresh(generation);
  }
}

function finishEmptyContributionRefresh(generation: number) {
  if (generation !== contributionRefreshGeneration) return;
  if (state.githubContributions.days.length) {
    state.githubContributions.loading = false;
    return;
  }
  state.githubContributions.days = contributionRefreshDays;
  state.githubContributions.loading = false;
  state.githubContributions.meta = {
    repoCount: 0,
    requestedRepoCount: 0,
    repoLimit: CONTRIBUTION_REPO_LIMIT,
    truncated: false,
    skippedRepoCount: 0,
    refreshedAt: Date.now(),
  };
  void persistStartupContributions();
}

function finishRepoContributionRefresh(generation: number) {
  if (generation !== contributionRefreshGeneration) return;
  contributionRefreshPendingCount = Math.max(0, contributionRefreshPendingCount - 1);
  state.githubContributions.loading = contributionRefreshPendingCount > 0;
  if (contributionRefreshPendingCount === 0 && state.githubContributions.meta) {
    void persistStartupContributions();
  }
}

async function persistStartupContributions() {
  const meta = state.githubContributions.meta;
  if (!meta) return;
  try {
    const service = await loadWorkspaceService();
    await service.writeStartupContributions({
      days: state.githubContributions.days,
      meta,
    });
  } catch {
    // Startup cache persistence is an optimization; visible refresh state is already updated.
  }
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
  source: GitHubContributionRepository,
) {
  const daysByDate = new Map(current.map((day) => [day.date, {
    ...day,
    repositories: normalizeContributionRepositories(day.repositories ?? []),
  }]));
  for (const day of incoming) {
    const currentDay = daysByDate.get(day.date);
    const count = (currentDay?.count ?? 0) + day.count;
    const repositories = day.count > 0
      ? day.repositories?.length
        ? day.repositories
        : [{ ...source, count: day.count }]
      : [];
    daysByDate.set(day.date, {
      date: day.date,
      count,
      repositories: normalizeContributionRepositories([
        ...(currentDay?.repositories ?? []),
        ...repositories,
      ]),
    });
  }
  return [...daysByDate.values()]
    .map((day) => ({
      date: day.date,
      count: day.count,
      repositories: day.repositories?.length ? day.repositories : undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeContributionRepositories(repositories: readonly GitHubContributionRepository[]) {
  const byRepo = new Map<string, GitHubContributionRepository>();
  for (const repo of repositories) {
    if (repo.count <= 0) continue;
    const repoId = repo.repoId.trim();
    if (!repoId) continue;
    const current = byRepo.get(repoId);
    byRepo.set(repoId, {
      repoId,
      repoName: repo.repoName.trim() || repoId,
      repoFullName: repo.repoFullName?.trim() || null,
      count: (current?.count ?? 0) + repo.count,
    });
  }
  return [...byRepo.values()].sort((a, b) =>
    contributionRepositoryLabel(a).localeCompare(contributionRepositoryLabel(b)),
  );
}

function contributionRepositoryLabel(repo: GitHubContributionRepository) {
  return repo.repoFullName || repo.repoName || repo.repoId;
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
  const generation = ++workspaceTaskRefreshGeneration;
  const service = await loadWorkspaceService();
  const tasks = await service.listWorkspaceTasks();
  if (generation !== workspaceTaskRefreshGeneration) return;
  setWorkspaceTasks(tasks);
}

export async function cancelWorkspaceTask(taskId: string) {
  const service = await loadWorkspaceService();
  await service.cancelWorkspaceTask(taskId);
  await refreshWorkspaceTasks();
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
  if (languageStatsLoadingGenerations.get(repoId) === generation) return null;
  languageStatsLoadingGenerations.set(repoId, generation);
  if (!state.languageStatsLoadingRepoIds.includes(repoId)) {
    state.languageStatsLoadingRepoIds = [...state.languageStatsLoadingRepoIds, repoId];
  }
  try {
    const service = await loadWorkspaceService();
    const summary = await service.refreshRepoLanguageStats(repoId);
    if (generation !== repositoryRuntimeGeneration) return null;
    const current = state.repos.find((repo) => repo.id === summary.id);
    const nextSummary = current
      ? {
        ...current,
        languageStats: summary.languageStats,
        languageStatsUpdatedAt: summary.languageStatsUpdatedAt,
      }
      : summary;
    upsertRepo(nextSummary);
    return nextSummary;
  } catch (err) {
    if (options.silent) return null;
    throw err;
  } finally {
    if (languageStatsLoadingGenerations.get(repoId) === generation) {
      languageStatsLoadingGenerations.delete(repoId);
      state.languageStatsLoadingRepoIds = state.languageStatsLoadingRepoIds.filter((id) => id !== repoId);
      void refreshWorkspaceTasks();
    }
  }
}

export function resetRepositoryRuntimeForTests() {
  repositoryRuntimeGeneration += 1;
  contributionRefreshGeneration += 1;
  languageStatsLoadingGenerations = new Map();
  autoSyncRunningRepoIds.clear();
  contributionRefreshPendingCount = 0;
  contributionRefreshSeenFullNames = new Set();
  contributionRefreshSampledCount = 0;
  contributionRefreshDays = [];
  contributionRefreshRepoCount = 0;
  contributionRefreshSkippedRepoCount = 0;
}

export async function cloneRepo(remoteUrl: string, directoryName?: string | null) {
  state.error = null;
  const service = await loadWorkspaceService();
  const summary = await service.cloneRepo(remoteUrl, directoryName);
  upsertRepo(summary);
  return summary;
}

export async function createLocalRepo(request: WorkspaceCreateLocalRepoRequest) {
  state.error = null;
  const service = await loadWorkspaceService();
  const summary = await service.createLocalRepo(request);
  upsertRepo(summary);
  return summary;
}

export async function hideRepo(repoId: string) {
  repositoryRuntimeGeneration += 1;
  const service = await loadWorkspaceService();
  state.settings = await service.hideRepo(repoId);
  removeLocalRepoState(repoId);
}

export async function createRepoGroup(name: string) {
  const service = await loadWorkspaceService();
  state.settings = await service.createRepoGroup(name);
  return state.settings;
}

export async function renameRepoGroup(groupId: string, name: string) {
  const service = await loadWorkspaceService();
  state.settings = await service.renameRepoGroup(groupId, name);
  return state.settings;
}

export async function deleteRepoGroup(groupId: string) {
  const service = await loadWorkspaceService();
  state.settings = await service.deleteRepoGroup(groupId);
  return state.settings;
}

export async function moveRepoToGroup(repoId: string, groupId: string | null) {
  const service = await loadWorkspaceService();
  state.settings = await service.moveRepoToGroup(repoId, groupId);
  return state.settings;
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
  delete state.launchHistory[repoId];
}

export async function rememberRemoteRepo(repo: RemoteRepoShortcut) {
  const service = await loadWorkspaceService();
  state.settings = await service.rememberRemoteRepo(repo);
  return state.settings;
}

export async function setRepoSetting(repoId: string, key: RepoSettingKey, value: boolean) {
  const service = await loadWorkspaceService();
  state.settings = await service.setRepoSetting(repoId, key, value);
  clearRepoActionError(repoId);
  refreshRepoStatusList();
  return state.settings;
}

export async function setRepoAutoSync(repoId: string, autoSync: boolean) {
  return setRepoSetting(repoId, "autoSync", autoSync);
}

export async function setContributionIdentities(
  identities: import("../../services/workspace").ContributionIdentity[],
) {
  const service = await loadWorkspaceService();
  state.settings = await service.setContributionIdentities(identities);
  state.githubContributions = {
    days: [],
    meta: null,
    loading: false,
    error: null,
  };
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
  setRepoDetail(detail, repoId);
  return detail;
}

export async function clearRepoLocalCache(repoId: string, repoFullName?: string | null) {
  const service = await loadWorkspaceService();
  await service.clearRepoLocalCache(repoId, repoFullName ?? null);
  clearRepoActionError(repoId);
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
  await applyRepoMutation(repoId, () => service.commitRepo(repoId, files, message, pushAfter));
}

export async function pull(repoId: string, localChangesMode: RepoPullLocalChangesMode = "reject") {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.pullRepo(repoId, localChangesMode));
}

export async function fetch(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.fetchRepo(repoId));
}

export async function mergePull(repoId: string, localChangesMode: RepoPullLocalChangesMode = "reject") {
  const service = await loadWorkspaceService();
  clearRepoActionError(repoId);
  try {
    await applyRepoMutation(repoId, async () => {
      const result = await service.mergePullRepo(repoId, localChangesMode);
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

export async function startRebase(
  repoId: string,
  ontoRef?: string | null,
  localChangesMode: RepoPullLocalChangesMode = "reject",
) {
  const service = await loadWorkspaceService();
  return applyRepoOperation(repoId, () =>
    service.startRebaseRepo(repoId, ontoRef, localChangesMode)
  );
}

async function runPushMutation(repoId: string, pushRepo: () => Promise<RepoSummary>) {
  const updateRecentSync = beginRecentSyncRetry(repoId);
  try {
    await applyRepoMutation(repoId, async () => {
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

export async function pushNewBranch(repoId: string, remoteName?: string | null, branchName?: string | null) {
  const service = await loadWorkspaceService();
  await runPushMutation(repoId, () => service.pushNewBranchRepo(repoId, remoteName, branchName));
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
  await applyRepoMutation(repoId, () => service.checkoutBranch(repoId, branch));
}

export async function createBranch(repoId: string, name: string, fromRef: string, checkoutAfter: boolean) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.createBranch(repoId, name, fromRef, checkoutAfter));
}

export async function renameBranch(repoId: string, oldName: string, newName: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.renameBranch(repoId, oldName, newName));
}

export async function deleteBranch(repoId: string, branch: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.deleteBranch(repoId, branch));
}

export async function setUpstream(repoId: string, branch: string, upstream: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.setBranchUpstream(repoId, branch, upstream));
}

export async function listStashes(repoId: string) {
  const service = await loadWorkspaceService();
  return service.listRepoStashes(repoId);
}

export async function saveStash(repoId: string, message?: string | null) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.saveRepoStash(repoId, message));
}

export async function applyStash(repoId: string, stashId: string) {
  const service = await loadWorkspaceService();
  return applyRepoOperation(repoId, () => service.applyRepoStash(repoId, stashId));
}

export async function popStash(repoId: string, stashId: string) {
  const service = await loadWorkspaceService();
  return applyRepoOperation(repoId, () => service.popRepoStash(repoId, stashId));
}

export async function dropStash(repoId: string, stashId: string) {
  const service = await loadWorkspaceService();
  return service.dropRepoStash(repoId, stashId);
}

export async function listRemotes(repoId: string) {
  const service = await loadWorkspaceService();
  return service.listRepoRemotes(repoId);
}

export async function cherryPickCommit(repoId: string, hash: string) {
  const service = await loadWorkspaceService();
  return applyRepoOperation(repoId, () => service.cherryPickRepoCommit(repoId, hash));
}

export async function revertCommit(repoId: string, hash: string) {
  const service = await loadWorkspaceService();
  return applyRepoOperation(repoId, () => service.revertRepoCommit(repoId, hash));
}

export async function resetToCommit(
  repoId: string,
  hash: string,
  mode: import("../../services/workspace").RepoResetMode = "mixed",
) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.resetRepoToCommit(repoId, hash, mode));
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
