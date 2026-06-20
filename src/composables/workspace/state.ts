import { computed, reactive, ref } from "vue";
import type {
  BulkSyncPreview,
  BulkSyncResult,
  GitHubBindingStatus,
  GitHubContributionDay,
  GitHubContributionMeta,
  GitHubDeviceFlowStart,
  ProjectLaunchConfig,
  ProjectLaunchCandidate,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoDetail,
  RepoSummary,
  WorkspaceTask,
  WorkspaceSettings,
} from "../../services/workspace";

export interface WorkspaceState {
  settings: WorkspaceSettings | null;
  bindingStatus: GitHubBindingStatus | null;
  repos: RepoSummary[];
  repoDetails: Record<string, RepoDetail | undefined>;
  launchConfigs: Record<string, ProjectLaunchConfig | null | undefined>;
  launchCandidates: Record<string, ProjectLaunchCandidate[] | undefined>;
  launchStatuses: Record<string, ProjectLaunchStatus | undefined>;
  launchLogs: Record<string, ProjectLaunchLog[] | undefined>;
  loading: boolean;
  scanning: boolean;
  authLoading: boolean;
  authFlowStatus: "idle" | "pending" | "expired" | "error";
  authRemainingSeconds: number | null;
  authNotice: string | null;
  launchLoading: boolean;
  error: string | null;
  bulkPreview: BulkSyncPreview | null;
  bulkResults: BulkSyncResult[];
  bulkRunning: boolean;
  recentSync: RecentBulkSyncState | null;
  repoActionErrors: Record<string, RepoActionErrorState | undefined>;
  repoStatusListRefreshToken: number;
  githubContributions: GitHubContributionsState;
  tasks: WorkspaceTask[];
  languageStatsLoadingRepoIds: string[];
  refreshingRepoIds: string[];
  syncingRepoIds: string[];
}

export interface RecentBulkSyncState {
  preview: BulkSyncPreview;
  results: BulkSyncResult[];
  retryingRepoIds: string[];
  updatedAt: number;
}

export interface RepoActionErrorState {
  message: string;
  updatedAt: number;
}

export interface GitHubContributionsState {
  days: GitHubContributionDay[];
  meta: GitHubContributionMeta | null;
  loading: boolean;
  error: string | null;
}

export const state = reactive<WorkspaceState>({
  settings: null,
  bindingStatus: null,
  repos: [],
  repoDetails: {},
  launchConfigs: {},
  launchCandidates: {},
  launchStatuses: {},
  launchLogs: {},
  loading: false,
  scanning: false,
  authLoading: false,
  authFlowStatus: "idle",
  authRemainingSeconds: null,
  authNotice: null,
  launchLoading: false,
  error: null,
  bulkPreview: null,
  bulkResults: [],
  bulkRunning: false,
  recentSync: null,
  repoActionErrors: {},
  repoStatusListRefreshToken: 0,
  githubContributions: {
    days: [],
    meta: null,
    loading: false,
    error: null,
  },
  tasks: [],
  languageStatsLoadingRepoIds: [],
  refreshingRepoIds: [],
  syncingRepoIds: [],
});

export const deviceFlow = ref<GitHubDeviceFlowStart | null>(null);

export const workspaceRoot = computed(() => state.settings?.workspaceRoot ?? null);
export const githubBinding = computed(() => state.bindingStatus?.binding ?? state.settings?.githubBinding ?? null);
export const isAuthorized = computed(() => state.bindingStatus?.state === "bound" && Boolean(githubBinding.value));
export const isReady = computed(() => Boolean(workspaceRoot.value) && isAuthorized.value);
export const authRemainingText = computed(() => {
  const seconds = state.authRemainingSeconds;
  if (seconds == null) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
});
export const authPendingStatusText = computed(() => {
  switch (state.authFlowStatus) {
    case "pending":
      return "等待 GitHub 授权确认";
    case "expired":
      return "设备码已过期";
    case "error":
      return "授权检查失败";
    default:
      return null;
  }
});
export const authBindingStatusText = computed(() =>
  authPendingStatusText.value ?? (githubBinding.value ? "GitHub 已授权" : "尚未绑定 GitHub"),
);

export function applyBindingStatus(bindingStatus: GitHubBindingStatus) {
  state.bindingStatus = bindingStatus;
  if (state.settings) {
    state.settings = {
      ...state.settings,
      githubBinding: bindingStatus.binding,
    };
  }
}

export function upsertRepo(summary: RepoSummary) {
  const index = state.repos.findIndex((repo) => repo.id === summary.id);
  let nextSummary = summary;
  if (index >= 0) {
    nextSummary = mergeRepoSummary(state.repos[index], summary);
    state.repos[index] = nextSummary;
  } else {
    state.repos.push(summary);
  }
  const detail = state.repoDetails[summary.id];
  if (detail) {
    state.repoDetails[summary.id] = {
      ...detail,
      summary: nextSummary,
    };
  }
}

export function replaceRepos(summaries: RepoSummary[]) {
  const currentById = new Map(state.repos.map((repo) => [repo.id, repo]));
  for (const detail of Object.values(state.repoDetails)) {
    if (detail && !currentById.has(detail.summary.id)) {
      currentById.set(detail.summary.id, detail.summary);
    }
  }
  state.repos = summaries.map((summary) => {
    const current = currentById.get(summary.id);
    return current ? mergeRepoSummary(current, summary) : summary;
  });
  for (const summary of state.repos) {
    const detail = state.repoDetails[summary.id];
    if (detail) {
      state.repoDetails[summary.id] = {
        ...detail,
        summary,
      };
    }
  }
}

function mergeRepoSummary(current: RepoSummary, next: RepoSummary) {
  const nextIsLightweight = !next.currentBranch &&
    !next.remoteUrl &&
    !next.githubFullName &&
    next.ahead === 0 &&
    next.behind === 0 &&
    next.stagedCount === 0 &&
    next.unstagedCount === 0 &&
    next.untrackedCount === 0 &&
    next.conflictCount === 0 &&
    next.lastCommitAt == null &&
    next.lastCommitMessage == null;
  const base = nextIsLightweight
    ? {
      ...current,
      id: next.id,
      name: next.name,
      path: next.path,
      relativePath: next.relativePath,
      worktree: next.worktree,
    }
    : next;
  const hasLanguageStats = next.languageStatsUpdatedAt > 0 || next.languageStats.length > 0 || next.workingTreeLanguageStats.length > 0;
  return {
    ...base,
    languageStats: hasLanguageStats ? next.languageStats : current.languageStats,
    workingTreeLanguageStats: hasLanguageStats ? next.workingTreeLanguageStats : current.workingTreeLanguageStats,
    languageStatsUpdatedAt: hasLanguageStats ? next.languageStatsUpdatedAt : current.languageStatsUpdatedAt,
  };
}

export function setRepoDetail(detail: RepoDetail) {
  state.repoDetails[detail.summary.id] = detail;
  upsertRepo(detail.summary);
}

export function repoById(repoId: string) {
  return state.repos.find((repo) => repo.id === repoId) ?? null;
}

export function repoUsesSystemGit(repoId: string) {
  return state.settings?.systemGitRepoIds.includes(repoId) ?? false;
}

export function bulkSyncRepoIds(preview: BulkSyncPreview | null = state.bulkPreview) {
  if (!preview || !["push", "sync"].includes(preview.operation)) return new Set<string>();
  const ids = new Set<string>();
  const items = preview.operation === "push" ? [...preview.eligible, ...preview.blocked] : preview.eligible;
  for (const item of items) {
    if (item.repo.ahead > 0 || item.repo.behind > 0) ids.add(item.repo.id);
  }
  return ids;
}

export function bulkSyncRunningRepoIds() {
  const ids = new Set(state.syncingRepoIds);
  if (!state.bulkRunning) return ids;
  for (const repoId of bulkSyncRepoIds()) ids.add(repoId);
  return ids;
}

export function syncErrorByRepoId() {
  return new Map(
    [...syncErrorDetailsByRepoId()].map(([repoId, error]) => [repoId, error.message]),
  );
}

export function syncErrorDetailsByRepoId() {
  const recentErrors = recentSyncErrorsByRepoId();
  if (recentErrors.size) return recentErrors;
  if (!state.bulkPreview || !["push", "sync"].includes(state.bulkPreview.operation)) {
    return new Map<string, RepoActionErrorState>();
  }
  return new Map(
    state.bulkResults
      .filter((result) => result.status === "error")
      .map((result) => [result.repoId, { message: result.message, updatedAt: state.recentSync?.updatedAt ?? 0 }]),
  );
}

export function recentSyncErrorForRepo(repoId: string) {
  const result = state.recentSync?.results.find((item) => item.repoId === repoId && item.status === "error");
  if (!result) return null;
  return {
    message: result.message,
    retrying: state.recentSync?.retryingRepoIds.includes(repoId) ?? false,
  };
}

export function repoActionErrorForRepo(repoId: string) {
  return repoActionErrorDetailForRepo(repoId)?.message ?? null;
}

export function repoActionErrorDetailForRepo(repoId: string) {
  return state.repoActionErrors[repoId] ?? null;
}

export function setRepoActionError(repoId: string, message: string) {
  state.repoActionErrors = {
    ...state.repoActionErrors,
    [repoId]: {
      message,
      updatedAt: Date.now(),
    },
  };
}

export function clearRepoActionError(repoId: string) {
  if (!state.repoActionErrors[repoId]) return;
  const next = { ...state.repoActionErrors };
  delete next[repoId];
  state.repoActionErrors = next;
}

export function beginRepoSync(repoId: string) {
  if (state.syncingRepoIds.includes(repoId)) return;
  state.syncingRepoIds = [...state.syncingRepoIds, repoId];
}

export function finishRepoSync(repoId: string) {
  if (!state.syncingRepoIds.includes(repoId)) return;
  state.syncingRepoIds = state.syncingRepoIds.filter((id) => id !== repoId);
}

export function rememberRecentSync(preview: BulkSyncPreview, results: BulkSyncResult[]) {
  if (!["push", "sync"].includes(preview.operation)) return;
  state.recentSync = {
    preview,
    results,
    retryingRepoIds: state.recentSync?.retryingRepoIds.filter((id) =>
      results.some((result) => result.repoId === id && result.status === "error"),
    ) ?? [],
    updatedAt: Date.now(),
  };
}

export function beginRecentSyncRetry(repoId: string) {
  if (!state.recentSync) return false;
  if (!isRecentSyncIssue(repoId)) return false;
  if (!state.recentSync.retryingRepoIds.includes(repoId)) {
    state.recentSync.retryingRepoIds = [...state.recentSync.retryingRepoIds, repoId];
  }
  return true;
}

export function finishRecentSyncRetry(result: BulkSyncResult) {
  if (!state.recentSync) return;
  const existingResult = state.recentSync.results.some((item) => item.repoId === result.repoId);
  const nextResults = existingResult
    ? state.recentSync.results.map((item) => (item.repoId === result.repoId ? result : item))
    : [...state.recentSync.results, result];
  state.recentSync = {
    ...state.recentSync,
    preview: {
      ...state.recentSync.preview,
      blocked: state.recentSync.preview.blocked.filter((item) => item.repo.id !== result.repoId),
    },
    results: nextResults,
    retryingRepoIds: state.recentSync.retryingRepoIds.filter((id) => id !== result.repoId),
    updatedAt: Date.now(),
  };
}

function isRecentSyncIssue(repoId: string) {
  return Boolean(recentSyncErrorForRepo(repoId));
}

function recentSyncErrorsByRepoId() {
  const errors = new Map<string, RepoActionErrorState>();
  for (const result of state.recentSync?.results ?? []) {
    if (result.status === "error") {
      errors.set(result.repoId, {
        message: result.message,
        updatedAt: state.recentSync?.updatedAt ?? 0,
      });
    }
  }
  return errors;
}

export function resetWorkspaceStateForTests() {
  state.settings = null;
  state.bindingStatus = null;
  state.repos = [];
  state.repoDetails = {};
  state.launchConfigs = {};
  state.launchCandidates = {};
  state.launchStatuses = {};
  state.launchLogs = {};
  state.loading = false;
  state.scanning = false;
  state.authLoading = false;
  state.authFlowStatus = "idle";
  state.authRemainingSeconds = null;
  state.authNotice = null;
  state.launchLoading = false;
  state.error = null;
  state.bulkPreview = null;
  state.bulkResults = [];
  state.bulkRunning = false;
  state.recentSync = null;
  state.repoActionErrors = {};
  state.repoStatusListRefreshToken = 0;
  state.githubContributions = {
    days: [],
    meta: null,
    loading: false,
    error: null,
  };
  state.tasks = [];
  state.languageStatsLoadingRepoIds = [];
  state.refreshingRepoIds = [];
  state.syncingRepoIds = [];
  deviceFlow.value = null;
}
