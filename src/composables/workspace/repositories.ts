import {
  beginRecentSyncRetry,
  beginRepoSync,
  clearRepoActionError,
  finishRecentSyncRetry,
  finishRepoSync,
  rememberRecentSync,
  state,
  replaceRepos,
  removeRepo,
  setRepoDetail,
  setRepoDetailPatch,
  setWorkspaceTasks,
  setRepoActionError,
  upsertRepo,
  upsertReposBatch,
} from "./state";
import { loadWorkspaceService } from "./serviceLoader";
import {
  repoAutoSyncEnabled,
  repoIncludedInHomeContributionStats,
  type RepoSettingKey,
} from "../../config/repoSettingsManifest";
import { scheduleLowPriorityTask, type CancelLowPriorityTask } from "../../utils/lowPriorityScheduler";
import type {
  GitHubContributionDay,
  GitHubContributionMeta,
  GitHubContributionRepository,
  GitHubContributionResult,
  RemoteRepoShortcut,
  RepoConflictChoice,
  RepoPullLocalChangesMode,
  RepoDetailPatch,
  RepoDetailPatchRequest,
  RepoSummary,
  WorkspaceStartupCache,
  WorkspaceCreateLocalRepoRequest,
  BulkSyncPreview,
  BulkSyncResult,
} from "../../services/workspace";
import { representativeReposBySharedGroup } from "../../utils/repoWorktree";

const CONTRIBUTION_REPO_LIMIT = 30;
const REPO_REFRESH_CONCURRENCY = 4;
export const REPO_STATUS_REFRESH_DEBOUNCE_MS = 300;
export const AUTO_REPO_SUMMARY_REFRESH_FRESH_MS = 10 * 60 * 1000;
const BACKGROUND_REPO_SUMMARY_FLUSH_TIMEOUT_MS = 700;
const BACKGROUND_REFRESHING_STATUS_FLUSH_TIMEOUT_MS = 700;
const LOCAL_REPO_CONTRIBUTION_SCOPE = "local:";
type ContributionRefreshScope = {
  scope: string;
  source: GitHubContributionRepository;
};
let repositoryRuntimeGeneration = 0;
let contributionRefreshGeneration = 0;
let contributionRefreshPendingCount = 0;
let contributionRefreshSeenFullNames = new Set<string>();
let contributionRefreshRequestedCount = 0;
let contributionRefreshSampledCount = 0;
let contributionRefreshDays: GitHubContributionDay[] = [];
let contributionRefreshRepoCount = 0;
let contributionRefreshSkippedRepoCount = 0;
let contributionRefreshStartedAt = 0;
let contributionRefreshError: string | null = null;
let workspaceTaskRefreshGeneration = 0;
let languageStatsLoadingGenerations = new Map<string, number>();
let lastRepoSummaryRefreshAt = 0;
const autoSyncRunningRepoIds = new Set<string>();
type RepoStatusRefreshOptions = {
  immediate?: boolean;
};
type RepoStatusRefreshEntry = {
  queuedScope: RepoDetailPatchRequest | null;
  queuedResolvers: Array<{
    resolve: (patch: RepoDetailPatch | null) => void;
    reject: (err: unknown) => void;
  }>;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};
const repoStatusRefreshEntries = new Map<string, RepoStatusRefreshEntry>();

async function applyRepoMutation(
  repoId: string,
  loadSummary: () => Promise<import("../../services/workspace").RepoSummary>,
  refreshScope: RepoDetailPatchRequest = {},
) {
  upsertRepo(await loadSummary());
  clearRepoActionError(repoId);
  await requestRepoStatusRefresh(repoId, refreshScope, { immediate: true });
}

async function applyRepoOperation(
  repoId: string,
  loadOperation: () => Promise<import("../../services/workspace").RepoOperationResult>,
  refreshScope: RepoDetailPatchRequest = {},
) {
  const result = await loadOperation();
  upsertRepo(result.summary);
  clearRepoActionError(repoId);
  await requestRepoStatusRefresh(repoId, refreshScope, { immediate: true });
  return result;
}

function repoStatusRefreshEntry(repoId: string) {
  let entry = repoStatusRefreshEntries.get(repoId);
  if (!entry) {
    entry = {
      queuedScope: null,
      queuedResolvers: [],
      running: false,
      timer: null,
    };
    repoStatusRefreshEntries.set(repoId, entry);
  }
  return entry;
}

function mergeRepoStatusRefreshScope(
  current: RepoDetailPatchRequest | null,
  next: RepoDetailPatchRequest,
): RepoDetailPatchRequest {
  return {
    includeCommits: Boolean(current?.includeCommits || next.includeCommits),
    includeBranches: Boolean(current?.includeBranches || next.includeBranches),
  };
}

function clearRepoStatusRefreshTimer(entry: RepoStatusRefreshEntry) {
  if (entry.timer == null) return;
  clearTimeout(entry.timer);
  entry.timer = null;
}

function scheduleRepoStatusRefresh(repoId: string, entry: RepoStatusRefreshEntry, immediate: boolean) {
  if (entry.running) return;
  clearRepoStatusRefreshTimer(entry);
  if (immediate) {
    void runQueuedRepoStatusRefresh(repoId, entry);
    return;
  }
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void runQueuedRepoStatusRefresh(repoId, entry);
  }, REPO_STATUS_REFRESH_DEBOUNCE_MS);
}

async function runQueuedRepoStatusRefresh(repoId: string, entry: RepoStatusRefreshEntry) {
  if (entry.running || !entry.queuedScope) return;
  entry.running = true;
  const scope = entry.queuedScope;
  const resolvers = entry.queuedResolvers;
  entry.queuedScope = null;
  entry.queuedResolvers = [];
  try {
    const patch = await refreshRepoStatusNow(repoId, scope);
    for (const resolver of resolvers) resolver.resolve(patch);
  } catch (err) {
    for (const resolver of resolvers) resolver.reject(err);
  } finally {
    entry.running = false;
    if (entry.queuedScope) {
      scheduleRepoStatusRefresh(repoId, entry, true);
    } else if (!entry.timer) {
      repoStatusRefreshEntries.delete(repoId);
    }
  }
}

async function refreshRepoStatusNow(repoId: string, scope: RepoDetailPatchRequest) {
  const service = await loadWorkspaceService();
  const patch = await service.refreshRepoDetailPatch(repoId, scope);
  setRepoDetailPatch(patch, repoId);
  return patch;
}

export function requestRepoStatusRefresh(
  repoId: string,
  scope: RepoDetailPatchRequest = {},
  options: RepoStatusRefreshOptions = {},
) {
  if (!repoId) return Promise.resolve(null);
  const entry = repoStatusRefreshEntry(repoId);
  entry.queuedScope = mergeRepoStatusRefreshScope(entry.queuedScope, scope);
  const promise = new Promise<RepoDetailPatch | null>((resolve, reject) => {
    entry.queuedResolvers.push({ resolve, reject });
  });
  scheduleRepoStatusRefresh(repoId, entry, options.immediate === true);
  return promise;
}

function repoNeedsSync(summary: RepoSummary) {
  return summary.ahead > 0 || summary.behind > 0;
}

function repoDirtyCount(summary: RepoSummary) {
  return summary.stagedCount + summary.unstagedCount + summary.untrackedCount;
}

function repoNeedsAutomaticSummaryRefresh(summary: RepoSummary) {
  return summary.ahead > 0 || summary.conflictCount > 0 || repoDirtyCount(summary) > 0;
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
      await requestRepoStatusRefresh(syncedRepoId, { includeCommits: true }, { immediate: true })
        .catch(() => undefined);
    }
    void refreshRepoLanguageStats(syncedRepoId, { silent: true });
    return result;
  } finally {
    autoSyncRunningRepoIds.delete(summary.id);
    finishRepoSync(summary.id);
  }
}

type RepoSummaryRefreshOptions = {
  automatic?: boolean;
  startupCache?: WorkspaceStartupCache | null;
};
type RowRefreshingMode = "none" | "single" | "all";

export async function refreshRepos(options: RepoSummaryRefreshOptions = {}) {
  const repos = await loadManagedRepoList();
  if (repos) {
    if (options.automatic && automaticRepoSummaryRefreshCanSkip(repos, options.startupCache)) {
      markRepoSummaryRefreshFresh();
      return;
    }
    const repoIds = repoSummaryRefreshTargetIds(repos, options.automatic === true);
    if (options.automatic && !repoIds.length) {
      markRepoSummaryRefreshFresh();
      return;
    }
    void refreshManagedRepoSummaries(repoIds, { fetchRemote: true });
  }
}

export async function refreshRepoSummaries(options: RepoSummaryRefreshOptions = {}) {
  if (options.automatic && repoSummaryRefreshIsFresh()) return state.repos;
  const repos = await loadManagedRepoList();
  if (!repos) return null;
  if (!repos.length) return repos;
  if (options.automatic && automaticRepoSummaryRefreshCanSkip(repos, options.startupCache)) {
    markRepoSummaryRefreshFresh();
    return repos;
  }
  const repoIds = repoSummaryRefreshTargetIds(repos, options.automatic === true);
  if (options.automatic && !repoIds.length) {
    markRepoSummaryRefreshFresh();
    return repos;
  }
  try {
    await refreshManagedRepoSummaries(repoIds, { fetchRemote: true, refreshBackground: false });
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

function repoSummaryRefreshTargetIds(repos: readonly RepoSummary[], automatic: boolean) {
  const targets = automatic ? repos.filter(repoNeedsAutomaticSummaryRefresh) : repos;
  return targets.map((repo) => repo.id);
}

async function refreshManagedRepoSummaries(
  repoIds: string[],
  options: { fetchRemote?: boolean; refreshBackground?: boolean; rowRefreshing?: RowRefreshingMode } = {},
) {
  const generation = ++repositoryRuntimeGeneration;
  const uniqueRepoIds = Array.from(new Set(repoIds));
  if (!uniqueRepoIds.length) {
    scheduleLowPriorityRefresh([]);
    return;
  }
  state.scanning = true;
  const refreshingRepoIds = initialRefreshingRepoIds(uniqueRepoIds, options.rowRefreshing ?? "none");
  const pendingRepoSummaries = new Map<string, RepoSummary>();
  let refreshingStatusFlushCancel: CancelLowPriorityTask | null = null;
  let repoSummaryFlushPending = false;
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
    refreshingStatusFlushCancel = null;
    if (generation === repositoryRuntimeGeneration) applyRefreshingRepoIds();
  };
  const scheduleRefreshingRepoIdsFlush = () => {
    if (refreshingStatusFlushCancel) return;
    refreshingStatusFlushCancel = scheduleLowPriorityTask(flushRefreshingRepoIds, {
      timeout: BACKGROUND_REFRESHING_STATUS_FLUSH_TIMEOUT_MS,
    });
  };
  const applyPendingRepoSummaries = () => {
    if (generation !== repositoryRuntimeGeneration || !pendingRepoSummaries.size) return;
    const summaries = [...pendingRepoSummaries.values()];
    pendingRepoSummaries.clear();
    upsertReposBatch(summaries);
  };
  const flushPendingRepoSummaries = () => {
    repoSummaryFlushPending = false;
    applyPendingRepoSummaries();
  };
  const scheduleRepoSummaryFlush = () => {
    if (repoSummaryFlushPending) return;
    repoSummaryFlushPending = true;
    scheduleLowPriorityTask(flushPendingRepoSummaries, {
      timeout: BACKGROUND_REPO_SUMMARY_FLUSH_TIMEOUT_MS,
    });
  };
  applyRefreshingRepoIds();
  const shouldRefreshBackground = options.refreshBackground ?? true;
  if (shouldRefreshBackground) startRepoContributionRefresh(repoContributionScopes());
  try {
    const service = await loadWorkspaceService();
    const refreshedRepoIds: string[] = [];
    await runBoundedParallel(uniqueRepoIds, REPO_REFRESH_CONCURRENCY, async (repoId) => {
      if (generation !== repositoryRuntimeGeneration) return;
      try {
        const summary = await service.refreshRepoSummary(repoId, { fetchRemote: options.fetchRemote ?? false });
        if (generation !== repositoryRuntimeGeneration) return;
        pendingRepoSummaries.set(summary.id, summary);
        scheduleRepoSummaryFlush();
        refreshedRepoIds.push(summary.id);
        const syncResult = await autoSyncRepoIfNeeded(summary.id, { summary });
        if (syncResult?.summary) {
          pendingRepoSummaries.delete(summary.id);
        }
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
      void refreshLanguageStatsForRepos(refreshedRepoIds, { background: true });
    }
    if (generation === repositoryRuntimeGeneration) markRepoSummaryRefreshFresh();
  } finally {
    if (generation === repositoryRuntimeGeneration) {
      cancelScheduledTask(refreshingStatusFlushCancel);
      refreshingStatusFlushCancel = null;
      flushPendingRepoSummaries();
      refreshingRepoIds.clear();
      flushRefreshingRepoIds();
      state.scanning = false;
    }
  }
}

function initialRefreshingRepoIds(repoIds: string[], mode: RowRefreshingMode) {
  if (mode === "all") return new Set(repoIds);
  if (mode === "single" && repoIds.length === 1) return new Set(repoIds);
  return new Set<string>();
}

function cancelScheduledTask(cancel: CancelLowPriorityTask | null) {
  if (cancel) cancel();
}

export function repoSummaryRefreshIsFresh(now = Date.now()) {
  return lastRepoSummaryRefreshAt > 0 &&
    now - lastRepoSummaryRefreshAt >= 0 &&
    now - lastRepoSummaryRefreshAt < AUTO_REPO_SUMMARY_REFRESH_FRESH_MS;
}

function markRepoSummaryRefreshFresh() {
  lastRepoSummaryRefreshAt = Date.now();
}

function automaticRepoSummaryRefreshCanSkip(
  repos: readonly RepoSummary[],
  startupCache: WorkspaceStartupCache | null | undefined,
  now = Date.now(),
) {
  if (!repos.length) return true;
  if (repoSummaryRefreshIsFresh(now)) return true;
  if (!startupCache?.reposById) return false;
  return repos.every((repo) => {
    const entry = startupCache.reposById[repo.id];
    if (!entry) return false;
    const age = now - entry.cachedAt;
    return age >= 0 &&
      age < AUTO_REPO_SUMMARY_REFRESH_FRESH_MS &&
      isUsableCachedRepoSummary(entry.summary);
  });
}

function isUsableCachedRepoSummary(summary: RepoSummary) {
  return Boolean(
    summary.currentBranch ||
    summary.remoteUrl ||
    summary.githubFullName ||
    summary.lastCommitAt ||
    summary.lastCommitMessage ||
    summary.ahead > 0 ||
    summary.behind > 0 ||
    summary.stagedCount > 0 ||
    summary.unstagedCount > 0 ||
    summary.untrackedCount > 0 ||
    summary.conflictCount > 0
  );
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
  const repos = await loadManagedRepoList();
  if (!repos) upsertRepo(summary);
  scheduleLowPriorityRefresh([summary.id]);
  return summary;
}

function applyRepoList(repos: RepoSummary[]) {
  replaceRepos(repos);
  scheduleLowPriorityRefresh(repos.map((repo) => repo.id));
}

function scheduleLowPriorityRefresh(repoIds: string[]) {
  void refreshLanguageStatsForRepos(repoIds, { background: true });
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
  startRepoContributionRefresh(repoContributionScopes());
}

function beginContributionRefresh() {
  const generation = ++contributionRefreshGeneration;
  const refreshedAt = Date.now();
  contributionRefreshPendingCount = 0;
  contributionRefreshSeenFullNames = new Set();
  contributionRefreshRequestedCount = 0;
  contributionRefreshSampledCount = 0;
  contributionRefreshRepoCount = 0;
  contributionRefreshSkippedRepoCount = 0;
  contributionRefreshDays = emptyContributionDays(refreshedAt);
  contributionRefreshStartedAt = refreshedAt;
  contributionRefreshError = null;
  return generation;
}

function startRepoContributionRefresh(scopes: ContributionRefreshScope[]) {
  const generation = beginContributionRefresh();
  const selectedScopes = selectContributionRefreshScopes(scopes);
  if (!selectedScopes.length) {
    finishEmptyContributionRefresh(generation);
    return;
  }

  contributionRefreshPendingCount = selectedScopes.length;
  state.githubContributions = {
    ...state.githubContributions,
    loading: true,
    error: null,
    meta: contributionRefreshMeta(0, 0),
  };
  for (const scope of selectedScopes) {
    void refreshSingleRepoContribution(scope, generation);
  }
}

function selectContributionRefreshScopes(scopes: ContributionRefreshScope[]) {
  const selected: ContributionRefreshScope[] = [];
  for (const item of scopes) {
    const normalized = item.scope.trim();
    if (!normalized || contributionRefreshSeenFullNames.has(normalized)) continue;
    contributionRefreshSeenFullNames.add(normalized);
    contributionRefreshRequestedCount += 1;
    if (selected.length >= CONTRIBUTION_REPO_LIMIT) continue;
    selected.push({ ...item, scope: normalized });
  }
  contributionRefreshSampledCount = selected.length;
  return selected;
}

function contributionRefreshMeta(repoCount: number, skippedRepoCount: number): GitHubContributionMeta {
  return {
    repoCount: Math.min(contributionRefreshSampledCount, repoCount),
    requestedRepoCount: contributionRefreshRequestedCount,
    repoLimit: CONTRIBUTION_REPO_LIMIT,
    truncated: contributionRefreshRequestedCount > contributionRefreshSampledCount,
    skippedRepoCount,
    refreshedAt: contributionRefreshStartedAt || Date.now(),
  };
}

function commitContributionRefreshResult(generation: number) {
  if (generation !== contributionRefreshGeneration) return;
  const meta = contributionRefreshMeta(contributionRefreshRepoCount, contributionRefreshSkippedRepoCount);
  state.githubContributions = {
    days: contributionRefreshDays,
    meta,
    loading: false,
    error: contributionRefreshError,
  };
  void persistStartupContributions();
}

function commitEmptyContributionRefresh(generation: number) {
  if (generation !== contributionRefreshGeneration) return;
  if (state.githubContributions.days.length) {
    state.githubContributions = {
      ...state.githubContributions,
      loading: false,
      error: null,
    };
    return;
  }
  state.githubContributions = {
    days: contributionRefreshDays,
    loading: false,
    error: null,
    meta: {
      repoCount: 0,
      requestedRepoCount: contributionRefreshRequestedCount,
      repoLimit: CONTRIBUTION_REPO_LIMIT,
      truncated: false,
      skippedRepoCount: 0,
      refreshedAt: Date.now(),
    },
  };
  void persistStartupContributions();
}

function mergeContributionResult(
  item: ContributionRefreshScope,
  result: GitHubContributionResult,
) {
  contributionRefreshDays = mergeContributionDays(
    contributionRefreshDays,
    result.days,
    item.source,
  );
  contributionRefreshRepoCount += result.meta.repoCount ?? 1;
  contributionRefreshSkippedRepoCount += result.meta.skippedRepoCount ?? 0;
}

function recordContributionError(err: unknown) {
  contributionRefreshError = String(err);
}

async function refreshSingleRepoContribution(item: ContributionRefreshScope, generation: number) {
  try {
    const service = await loadWorkspaceService();
    const result = await service.listRepoContribution(item.scope);
    if (generation !== contributionRefreshGeneration) return;
    mergeContributionResult(item, result);
  } catch (err) {
    if (generation !== contributionRefreshGeneration) return;
    recordContributionError(err);
  } finally {
    finishRepoContributionRefresh(generation);
  }
}

function finishEmptyContributionRefresh(generation: number) {
  commitEmptyContributionRefresh(generation);
}

function finishRepoContributionRefresh(generation: number) {
  if (generation !== contributionRefreshGeneration) return;
  contributionRefreshPendingCount = Math.max(0, contributionRefreshPendingCount - 1);
  if (contributionRefreshPendingCount === 0) commitContributionRefreshResult(generation);
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
  options: { silent?: boolean; background?: boolean } = { silent: true },
) {
  const generation = repositoryRuntimeGeneration;
  const uniqueRepoIds = Array.from(new Set(repoIds));
  let firstError: unknown = null;
  const pendingSummaries = new Map<string, RepoSummary>();
  await runBoundedParallel(uniqueRepoIds, REPO_REFRESH_CONCURRENCY, async (repoId) => {
    if (generation !== repositoryRuntimeGeneration) return;
    try {
      const summary = await loadRepoLanguageStatsSummary(repoId, generation, options);
      if (!summary) return;
      if (options.background) {
        pendingSummaries.set(summary.id, summary);
      } else {
        upsertRepo(summary);
      }
    } catch (err) {
      firstError ??= err;
    }
  });
  if (pendingSummaries.size) {
    const summaries = [...pendingSummaries.values()];
    scheduleLowPriorityTask(() => {
      if (generation === repositoryRuntimeGeneration) upsertReposBatch(summaries);
    });
  }
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
  const summary = await loadRepoLanguageStatsSummary(repoId, generation, options);
  if (summary) upsertRepo(summary);
  return summary;
}

async function loadRepoLanguageStatsSummary(
  repoId: string,
  generation: number,
  options: { silent?: boolean } = {},
) {
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
  for (const entry of repoStatusRefreshEntries.values()) {
    clearRepoStatusRefreshTimer(entry);
    for (const resolver of entry.queuedResolvers) resolver.resolve(null);
  }
  repoStatusRefreshEntries.clear();
  contributionRefreshPendingCount = 0;
  contributionRefreshSeenFullNames = new Set();
  contributionRefreshRequestedCount = 0;
  contributionRefreshSampledCount = 0;
  contributionRefreshDays = [];
  contributionRefreshRepoCount = 0;
  contributionRefreshSkippedRepoCount = 0;
  contributionRefreshStartedAt = 0;
  contributionRefreshError = null;
  lastRepoSummaryRefreshAt = 0;
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
  removeRepo(repoId);
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

export async function scanContributionIdentities() {
  const service = await loadWorkspaceService();
  return service.scanContributionIdentities();
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
  await requestRepoStatusRefresh(repoId, {}, { immediate: true });
}

export async function unstage(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await service.unstageFiles(repoId, files);
  clearRepoActionError(repoId);
  await requestRepoStatusRefresh(repoId, {}, { immediate: true });
}

export async function discardChanges(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.discardFiles(repoId, files));
}

export async function deleteRepoFile(repoId: string, path: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.deleteRepoFile(repoId, path));
}

export async function addFilesToGitignore(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.addFilesToGitignore(repoId, files));
}

export async function commit(repoId: string, files: string[], message: string, pushAfter: boolean) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(
    repoId,
    () => service.commitRepo(repoId, files, message, pushAfter),
    { includeCommits: true },
  );
}

export async function pull(repoId: string, localChangesMode: RepoPullLocalChangesMode = "reject") {
  const service = await loadWorkspaceService();
  await applyRepoMutation(
    repoId,
    () => service.pullRepo(repoId, localChangesMode),
    { includeCommits: true },
  );
}

export async function fetch(repoId: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(repoId, () => service.fetchRepo(repoId), { includeCommits: true });
}

export async function mergePull(repoId: string, localChangesMode: RepoPullLocalChangesMode = "reject") {
  const service = await loadWorkspaceService();
  clearRepoActionError(repoId);
  try {
    await applyRepoMutation(repoId, async () => {
      const result = await service.mergePullRepo(repoId, localChangesMode);
      return result.summary;
    }, { includeCommits: true });
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
    }, { includeCommits: true });
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
  return applyRepoOperation(
    repoId,
    () => service.startRebaseRepo(repoId, ontoRef, localChangesMode),
    { includeCommits: true },
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
    }, { includeCommits: true });
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
  await applyRepoMutation(
    repoId,
    () => service.checkoutBranch(repoId, branch),
    { includeCommits: true, includeBranches: true },
  );
}

export async function createBranch(repoId: string, name: string, fromRef: string, checkoutAfter: boolean) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(
    repoId,
    () => service.createBranch(repoId, name, fromRef, checkoutAfter),
    { includeCommits: checkoutAfter, includeBranches: true },
  );
}

export async function renameBranch(repoId: string, oldName: string, newName: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(
    repoId,
    () => service.renameBranch(repoId, oldName, newName),
    { includeBranches: true },
  );
}

export async function deleteBranch(repoId: string, branch: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(
    repoId,
    () => service.deleteBranch(repoId, branch),
    { includeBranches: true },
  );
}

export async function setUpstream(repoId: string, branch: string, upstream: string) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(
    repoId,
    () => service.setBranchUpstream(repoId, branch, upstream),
    { includeBranches: true },
  );
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
  return applyRepoOperation(
    repoId,
    () => service.cherryPickRepoCommit(repoId, hash),
    { includeCommits: true },
  );
}

export async function revertCommit(repoId: string, hash: string) {
  const service = await loadWorkspaceService();
  return applyRepoOperation(
    repoId,
    () => service.revertRepoCommit(repoId, hash),
    { includeCommits: true },
  );
}

export async function resetToCommit(
  repoId: string,
  hash: string,
  mode: import("../../services/workspace").RepoResetMode = "mixed",
) {
  const service = await loadWorkspaceService();
  await applyRepoMutation(
    repoId,
    () => service.resetRepoToCommit(repoId, hash, mode),
    { includeCommits: true },
  );
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
  await applyRepoMutation(
    repoId,
    () => service.continueConflictOperation(repoId),
    { includeCommits: true },
  );
}
