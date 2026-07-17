import {
  beginRecentSyncRetry,
  beginRepoSync,
  clearRepoActionError,
  finishRecentSyncRetry,
  finishRepoSync,
  rememberRecentSync,
  recordRepoSyncResult,
  state,
  replaceRepos,
  removeRepo,
  setRepoDetail,
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
import { scheduleLowPriorityTask } from "../../utils/lowPriorityScheduler";
import type {
  GitHubContributionDay,
  GitHubContributionMeta,
  GitHubContributionRepository,
  GitHubContributionResult,
  RemoteRepoShortcut,
  RepoChange,
  RepoConflictChoice,
  RepoPullLocalChangesMode,
  RepoDetailPatchRequest,
  RepoCommitResult,
  RepoSummary,
  RepoRemoteSyncPolicy,
  RepoSyncOperationResult,
  WorkspaceCreateLocalRepoRequest,
  WorkspaceCloneRepoRequest,
  BulkSyncPreview,
  BulkSyncResult,
  CommitDetail,
  RepoStashDetail,
  GitHubRepoManagement,
  BranchSummary,
  CommitSummary,
  GitHubProjectFetchOptions,
  GitHubCommitListOptions,
} from "../../services/workspace";
import { representativeReposBySharedGroup } from "../../utils/repoWorktree";
import { waitForWorkspaceTask } from "./taskWaiters";

const CONTRIBUTION_REPO_LIMIT = 30;
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
const autoSyncRunningRepoIds = new Set<string>();
let addLocalRepoPromise: Promise<RepoSummary | null> | null = null;
let workspaceSettingsMutationQueue: Promise<void> = Promise.resolve();
type RepoStatusRefreshOptions = {
  immediate?: boolean;
};

type RepoDetailState = NonNullable<typeof state.repoDetails[string]>;
type OptimisticRepoState = {
  changes: RepoChange[];
  summary: RepoSummary;
};

function targetPathSet(files: readonly string[]) {
  return new Set(files.map((file) => file.trim()).filter(Boolean));
}

async function updateWorkspaceSettings(
  mutation: () => Promise<NonNullable<typeof state.settings>>,
) {
  const result = workspaceSettingsMutationQueue.then(mutation);
  workspaceSettingsMutationQueue = result.then(() => undefined, () => undefined);
  state.settings = await result;
  return state.settings;
}

function summaryWithChanges(summary: RepoSummary, changes: readonly RepoChange[]): RepoSummary {
  const counts = changes.reduce(
    (next, change) => {
      if (change.staged) next.stagedCount += 1;
      if (change.unstaged || change.untracked) next.unstagedCount += 1;
      if (change.untracked) next.untrackedCount += 1;
      if (change.conflicted) next.conflictCount += 1;
      return next;
    },
    { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictCount: 0 },
  );
  return {
    ...summary,
    ...counts,
  };
}

function setOptimisticRepoState(
  repoId: string,
  update: (current: RepoDetailState) => OptimisticRepoState,
) {
  const current = state.repoDetails[repoId];
  if (!current) return false;
  const next = update(current);
  state.repoDetails[repoId] = {
    ...current,
    summary: next.summary,
    changes: next.changes,
  };
  upsertRepo(next.summary);
  clearRepoActionError(repoId);
  return true;
}

function applyOptimisticStageState(repoId: string, files: readonly string[], staged: boolean) {
  const targetPaths = targetPathSet(files);
  if (!targetPaths.size) return false;
  return setOptimisticRepoState(repoId, (current) => {
    const changes = current.changes.map((change) =>
      targetPaths.has(change.path)
        ? {
            ...change,
            staged,
            unstaged: !staged,
            ...(staged ? { untracked: false, conflicted: false } : {}),
          }
        : change
    );
    return {
      changes,
      summary: summaryWithChanges(current.summary, changes),
    };
  });
}

function applyOptimisticDiscardState(repoId: string, files: readonly string[]) {
  const targetPaths = targetPathSet(files);
  if (!targetPaths.size) return false;
  return setOptimisticRepoState(repoId, (current) => {
    const changes = current.changes.filter((change) => !targetPaths.has(change.path));
    return {
      changes,
      summary: summaryWithChanges(current.summary, changes),
    };
  });
}

function applyOptimisticCommit(
  repoId: string,
  files: readonly string[],
  message: string,
  pushAfter: boolean,
) {
  const targetPaths = targetPathSet(files);
  if (!targetPaths.size) return false;
  return setOptimisticRepoState(repoId, (current) => {
    const changes = current.changes.flatMap((change) => {
      if (!targetPaths.has(change.path) || !change.staged) return [change];
      if (change.unstaged || change.untracked || change.conflicted) {
        return [{
          ...change,
          staged: false,
        }];
      }
      return [];
    });
    const summary = summaryWithChanges(current.summary, changes);
    return {
      changes,
      summary: {
        ...summary,
        ahead: pushAfter ? 0 : summary.ahead + 1,
        lastCommitAt: Math.floor(Date.now() / 1000),
        lastCommitMessage: message,
      },
    };
  });
}

function applyOptimisticPush(repoId: string) {
  const detail = state.repoDetails[repoId];
  const summary = detail?.summary ?? state.repos.find((repo) => repo.id === repoId);
  if (!summary) return false;
  upsertRepo({
    ...summary,
    ahead: 0,
  });
  clearRepoActionError(repoId);
  return true;
}

async function rollbackOptimisticRepoState(repoId: string, scope: RepoDetailPatchRequest = {}) {
  try {
    await requestRepoStatusRefresh(repoId, scope, { immediate: true });
  } catch {
    // Keep the original mutation failure as the reported error.
  }
}

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

export async function requestRepoStatusRefresh(
  repoId: string,
  scope: RepoDetailPatchRequest = {},
  options: RepoStatusRefreshOptions = {},
) {
  if (!repoId) return null;
  const service = await loadWorkspaceService();
  const taskId = await service.enqueueRepoRefresh({
    repoId,
    mode: "local",
    priority: options.immediate ? "high" : "low",
    force: options.immediate === true,
    detailScope: "detail",
    includeCommits: scope.includeCommits,
    includeBranches: scope.includeBranches,
    trigger: options.immediate ? "foreground" : "watch",
  });
  if (options.immediate) await waitForWorkspaceTask(taskId);
  return null;
}

function repoNeedsSync(summary: RepoSummary) {
  const counts = effectiveRemoteSyncCounts(summary);
  return counts.pull > 0 || counts.push > 0;
}

function effectiveRemoteSyncCounts(summary: RepoSummary) {
  if (!summary.remoteBranchStates.length) {
    return {
      pull: summary.behind > 0 ? 1 : 0,
      push: summary.ahead > 0 ? 1 : 0,
    };
  }
  const configured = state.settings?.repoRemoteSyncPolicies?.[summary.id] ?? null;
  let pullRemotes: Set<string>;
  let pushRemotes: Set<string>;
  if (configured) {
    pullRemotes = new Set(configured.pullRemotes);
    pushRemotes = new Set(configured.pushRemotes);
  } else {
    const remoteNames = Array.from(new Set(summary.remoteBranchStates.map((branch) => branch.remote)));
    const legacyRemote = summary.remoteBranchStates.find((branch) => branch.upstream)?.remote
      ?? remoteNames.find((remote) => remote === "origin")
      ?? (remoteNames.length === 1 ? remoteNames[0] : null);
    pullRemotes = new Set(legacyRemote ? [legacyRemote] : []);
    pushRemotes = new Set(legacyRemote ? [legacyRemote] : []);
  }
  return {
    pull: summary.remoteBranchStates.filter((branch) => pullRemotes.has(branch.remote) && branch.needsPull).length,
    push: summary.remoteBranchStates.filter((branch) => pushRemotes.has(branch.remote) && branch.needsPush).length,
  };
}

function repoDirtyCount(summary: RepoSummary) {
  return summary.stagedCount + summary.unstagedCount + summary.untrackedCount;
}

function autoSyncBlockReason(summary: RepoSummary) {
  const dirty = repoDirtyCount(summary);
  const counts = effectiveRemoteSyncCounts(summary);
  if (!summary.currentBranch) return "当前不是命名分支，已跳过自动同步";
  if (summary.conflictCount > 0) return "已有冲突需要先处理，已跳过自动同步";
  if (dirty > 0 && counts.pull > 0) {
    return "存在未提交变更且远端有更新，已跳过自动同步";
  }
  return null;
}

function autoSyncReason(summary: RepoSummary, operation: "push" | "sync") {
  if (operation === "push") return "有本地提交待推送";
  if (summary.ahead > 0 && summary.behind > 0) return "需先拉取合并后推送";
  if (summary.behind > 0) return "可拉取远端更新";
  return "有本地提交待推送";
}

function autoSyncPreview(summary: RepoSummary, operation: "push" | "sync"): BulkSyncPreview {
  return {
    operation,
    eligible: [{ repo: { ...summary }, reason: autoSyncReason(summary, operation) }],
    blocked: [],
    warnings: [],
  };
}

function rememberAutoSyncFailure(summary: RepoSummary, operation: "push" | "sync", result: BulkSyncResult) {
  rememberRecentSync(autoSyncPreview(summary, operation), [result]);
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
  const operation = effectiveRemoteSyncCounts(summary).pull > 0 ? "sync" : "push";
  const localChangesMode: RepoPullLocalChangesMode = operation === "push" ? "reject" : "stash";

  autoSyncRunningRepoIds.add(summary.id);
  beginRepoSync(summary.id);
  try {
    let result: BulkSyncResult | undefined;
    try {
      const service = await loadWorkspaceService();
      [result] = await service.bulkSyncExecute(operation, [summary.id], localChangesMode, "autoSync");
    } catch (err) {
      const failedResult: BulkSyncResult = {
        repoId: summary.id,
        status: "error",
        message: String(err),
        summary: null,
        steps: [],
      };
      rememberAutoSyncFailure(summary, operation, failedResult);
      setRepoActionError(summary.id, failedResult.message);
      if (options.throwOnError) throw err;
      return null;
    }
    if (!result) return null;
    applyAutoSyncResult(result);
    if (result.status !== "success") {
      rememberAutoSyncFailure(summary, operation, result);
      if (options.throwOnError) throw new Error(result.message);
      return result;
    }
    const syncedRepoId = result.summary?.id ?? summary.id;
    if (options.refreshDetail || state.repoDetails[syncedRepoId]) {
      await requestRepoStatusRefresh(syncedRepoId, { includeCommits: true }, { immediate: true })
        .catch(() => undefined);
    }
    return result;
  } finally {
    autoSyncRunningRepoIds.delete(summary.id);
    finishRepoSync(summary.id);
  }
}

export async function refreshRepos() {
  return loadManagedRepoList();
}

export async function refreshRepoSummaries(options: { automatic?: boolean } = {}) {
  const repos = state.repos.length ? state.repos : await loadManagedRepoList();
  if (!repos) return null;
  if (!repos.length) return repos;
  try {
    await enqueueManagedRepoLocalRefreshes(
      repos.map((repo) => repo.id),
      options.automatic ? "startup" : "manualList",
    );
    return repos;
  } catch (err) {
    state.error = String(err);
    return null;
  }
}

async function enqueueManagedRepoLocalRefreshes(repoIds: string[], trigger: string) {
  if (!repoIds.length) return;
  const service = await loadWorkspaceService();
  const submissions = Array.from(new Set(repoIds)).map((repoId) =>
    service.enqueueRepoRefresh({
      repoId,
      mode: "local",
      priority: "low",
      force: false,
      detailScope: "summary",
      trigger,
    })
  );
  const failures = (await Promise.allSettled(submissions))
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length) {
    throw new Error(`${failures.length} 个仓库刷新任务提交失败：${failures.map(String).join("；")}`);
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

export async function discoverRepos() {
  const service = await loadWorkspaceService();
  state.scanning = true;
  try {
    const repos = await service.discoverRepos();
    applyRepoList(repos);
    return repos;
  } finally {
    state.scanning = false;
  }
}

export function addLocalRepo() {
  if (addLocalRepoPromise) return addLocalRepoPromise;

  const pending = (async () => {
    const service = await loadWorkspaceService();
    const picked = await service.pickRepo();
    if (!picked) return null;
    const summary = await service.addRepo(picked);
    const repos = await loadManagedRepoList();
    if (!repos) upsertRepo(summary);
    return summary;
  })().finally(() => {
    if (addLocalRepoPromise === pending) addLocalRepoPromise = null;
  });
  addLocalRepoPromise = pending;
  return pending;
}

function applyRepoList(repos: RepoSummary[]) {
  replaceRepos(repos);
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
}

export async function refreshLanguageStatsForRepos(
  repoIds: string[],
  options: { silent?: boolean; background?: boolean } = { silent: true },
) {
  const generation = repositoryRuntimeGeneration;
  const uniqueRepoIds = Array.from(new Set(repoIds));
  let firstError: unknown = null;
  const pendingSummaries = new Map<string, RepoSummary>();
  await Promise.all(uniqueRepoIds.map(async (repoId) => {
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
  }));
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
  contributionRefreshPendingCount = 0;
  contributionRefreshSeenFullNames = new Set();
  contributionRefreshRequestedCount = 0;
  contributionRefreshSampledCount = 0;
  contributionRefreshDays = [];
  contributionRefreshRepoCount = 0;
  contributionRefreshSkippedRepoCount = 0;
  contributionRefreshStartedAt = 0;
  contributionRefreshError = null;
  addLocalRepoPromise = null;
  workspaceSettingsMutationQueue = Promise.resolve();
}

export async function cloneRepo(request: WorkspaceCloneRepoRequest) {
  state.error = null;
  const service = await loadWorkspaceService();
  const result = await service.cloneRepo(request);
  state.settings = result.settings;
  upsertRepo(result.repo);
  return result.repo;
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
  return updateWorkspaceSettings(() => service.createRepoGroup(name));
}

export async function renameRepoGroup(groupId: string, name: string) {
  const service = await loadWorkspaceService();
  return updateWorkspaceSettings(() => service.renameRepoGroup(groupId, name));
}

export async function deleteRepoGroup(groupId: string) {
  const service = await loadWorkspaceService();
  return updateWorkspaceSettings(() => service.deleteRepoGroup(groupId));
}

export async function moveRepoToGroup(repoId: string, groupId: string | null) {
  const service = await loadWorkspaceService();
  return updateWorkspaceSettings(() => service.moveRepoToGroup(repoId, groupId));
}

export async function reconcileOrganizationRepoGroups(organizationLogins: string[]) {
  const service = await loadWorkspaceService();
  return updateWorkspaceSettings(() => service.reconcileOrganizationRepoGroups(organizationLogins));
}

export async function setLocalRepoFavorite(repoId: string, favorite: boolean) {
  const service = await loadWorkspaceService();
  return updateWorkspaceSettings(() => service.setLocalRepoFavorite(repoId, favorite));
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
  delete state.repoSyncResults[repoId];
}

export async function rememberRemoteRepo(repo: RemoteRepoShortcut) {
  const service = await loadWorkspaceService();
  return updateWorkspaceSettings(() => service.rememberRemoteRepo(repo));
}

export async function recordRecentLocalRepo(repoId: string) {
  const service = await loadWorkspaceService();
  return updateWorkspaceSettings(() => service.recordRecentLocalRepo(repoId));
}

export async function setRemoteRepoFavorite(repo: RemoteRepoShortcut, favorite: boolean) {
  const service = await loadWorkspaceService();
  return updateWorkspaceSettings(() => service.setRemoteRepoFavorite(repo, favorite));
}

export async function setRepoSetting(repoId: string, key: RepoSettingKey, value: boolean) {
  const service = await loadWorkspaceService();
  state.settings = await service.setRepoSetting(repoId, key, value);
  clearRepoActionError(repoId);
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
  return updateWorkspaceSettings(() => service.forgetRemoteRepo(fullName));
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

export async function stage(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  applyOptimisticStageState(repoId, files, true);
  try {
    await service.stageFiles(repoId, files);
    clearRepoActionError(repoId);
    await requestRepoStatusRefresh(repoId, {}, { immediate: true });
  } catch (err) {
    await rollbackOptimisticRepoState(repoId);
    throw err;
  }
}

export async function unstage(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  applyOptimisticStageState(repoId, files, false);
  try {
    await service.unstageFiles(repoId, files);
    clearRepoActionError(repoId);
    await requestRepoStatusRefresh(repoId, {}, { immediate: true });
  } catch (err) {
    await rollbackOptimisticRepoState(repoId);
    throw err;
  }
}

export async function discardChanges(repoId: string, files: string[]) {
  const service = await loadWorkspaceService();
  const optimistic = applyOptimisticDiscardState(repoId, files);
  try {
    await applyRepoMutation(repoId, () => service.discardFiles(repoId, files));
  } catch (err) {
    if (optimistic) await rollbackOptimisticRepoState(repoId);
    throw err;
  }
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
  applyOptimisticCommit(repoId, files, message, pushAfter);
  try {
    let commitResult: RepoCommitResult | null = null;
    await applyRepoMutation(
      repoId,
      async () => {
        commitResult = await service.commitRepo(repoId, files, message, pushAfter);
        return commitResult.summary;
      },
      { includeCommits: true, includeBranches: pushAfter },
    );
    const result = commitResult as RepoCommitResult | null;
    if (result?.pushResult) {
      recordRepoSyncResult(repoId, result.pushResult);
      if (result.pushResult.status === "success") clearRepoActionError(repoId);
      else setRepoActionError(repoId, result.pushResult.message);
    }
    return result;
  } catch (err) {
    await rollbackOptimisticRepoState(repoId, { includeCommits: true });
    throw err;
  }
}

export async function pull(repoId: string, localChangesMode: RepoPullLocalChangesMode = "reject") {
  const service = await loadWorkspaceService();
  return applyRepoSyncOperation(repoId, () => service.pullRepo(repoId, localChangesMode), { includeCommits: true });
}

export async function mergePull(repoId: string, localChangesMode: RepoPullLocalChangesMode = "reject") {
  const service = await loadWorkspaceService();
  clearRepoActionError(repoId);
  try {
    return await applyRepoSyncOperation(
      repoId,
      () => service.mergePullRepo(repoId, localChangesMode),
      { includeCommits: true },
    );
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

async function applyRepoSyncOperation(
  repoId: string,
  loadResult: () => Promise<RepoSyncOperationResult>,
  refreshScope: RepoDetailPatchRequest = {},
) {
  const result = await loadResult();
  upsertRepo(result.summary);
  recordRepoSyncResult(repoId, result);
  if (result.status === "success") clearRepoActionError(repoId);
  else setRepoActionError(repoId, result.message);
  await requestRepoStatusRefresh(repoId, refreshScope, { immediate: true });
  return result;
}

async function runPushMutation(repoId: string, pushRepo: () => Promise<RepoSyncOperationResult>) {
  const updateRecentSync = beginRecentSyncRetry(repoId);
  applyOptimisticPush(repoId);
  try {
    const result = await applyRepoSyncOperation(
      repoId,
      pushRepo,
      { includeCommits: true, includeBranches: true },
    );
    if (updateRecentSync) {
      finishRecentSyncRetry({
        repoId,
        status: result.status,
        message: result.message,
        summary: result.summary,
        steps: result.steps,
      });
    }
    return result;
  } catch (err) {
    await rollbackOptimisticRepoState(repoId, { includeCommits: true });
    if (updateRecentSync) {
      finishRecentSyncRetry({
        repoId,
        status: "error",
        message: String(err),
        summary: null,
        steps: [],
      });
    }
    throw err;
  }
}

export async function push(repoId: string, remoteNames?: string[] | null) {
  const service = await loadWorkspaceService();
  return runPushMutation(repoId, () => service.pushRepo(repoId, remoteNames));
}

export async function pushNewBranch(repoId: string, remoteNames?: string[] | null, branchName?: string | null) {
  const service = await loadWorkspaceService();
  return runPushMutation(repoId, () => service.pushNewBranchRepo(repoId, remoteNames, branchName));
}

export async function pushWithSystemGit(repoId: string, remoteNames?: string[] | null) {
  const service = await loadWorkspaceService();
  const result = await runPushMutation(repoId, () => service.pushRepoWithSystemGit(repoId, remoteNames));
  state.settings = await service.getWorkspaceSettings();
  return result;
}

export async function getRemoteSyncConfig(repoId: string) {
  const service = await loadWorkspaceService();
  return service.getRepoRemoteSyncConfig(repoId);
}

export async function setRemoteSyncPolicy(repoId: string, policy: RepoRemoteSyncPolicy) {
  const service = await loadWorkspaceService();
  const config = await service.setRepoRemoteSyncPolicy(repoId, policy);
  state.settings = await service.getWorkspaceSettings();
  clearRepoActionError(repoId);
  return config;
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

export async function getRepoCommitDetail(
  repoId: string,
  hash: string,
  options: GitHubProjectFetchOptions = {},
): Promise<CommitDetail> {
  const service = await loadWorkspaceService();
  return service.getRepoCommitDetail(repoId, hash, options);
}

export async function getRepoStashDetail(repoId: string, stashId: string): Promise<RepoStashDetail> {
  const service = await loadWorkspaceService();
  return service.getRepoStashDetail(repoId, stashId);
}

export async function getGitHubRepoManagement(
  repoFullName: string,
  options: GitHubProjectFetchOptions = {},
): Promise<GitHubRepoManagement> {
  const service = await loadWorkspaceService();
  return service.getGitHubRepoManagement(repoFullName, options);
}

export async function listGitHubBranches(repoFullName: string): Promise<BranchSummary[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubBranches(repoFullName);
}

export async function listGitHubRepoCommits(
  repoFullName: string,
  options: GitHubCommitListOptions = {},
  fetchOptions: GitHubProjectFetchOptions = {},
): Promise<CommitSummary[]> {
  const service = await loadWorkspaceService();
  return service.listGitHubRepoCommits(repoFullName, options, fetchOptions);
}

export async function deleteGitHubBranch(repoFullName: string, branchName: string): Promise<void> {
  const service = await loadWorkspaceService();
  return service.deleteGitHubBranch(repoFullName, branchName);
}
