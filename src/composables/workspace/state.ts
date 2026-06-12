import { computed, reactive, ref } from "vue";
import type {
  BulkSyncPreview,
  BulkSyncResult,
  GitHubBindingStatus,
  GitHubContributionDay,
  GitHubContributionMeta,
  GitHubDeviceFlowStart,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoDetail,
  RepoSummary,
  WorkspaceSettings,
} from "../../services/workspace";

export interface WorkspaceState {
  settings: WorkspaceSettings | null;
  bindingStatus: GitHubBindingStatus | null;
  repos: RepoSummary[];
  repoDetails: Record<string, RepoDetail | undefined>;
  launchConfigs: Record<string, ProjectLaunchConfig | null | undefined>;
  launchStatuses: Record<string, ProjectLaunchStatus | undefined>;
  launchLogs: Record<string, ProjectLaunchLog[] | undefined>;
  loading: boolean;
  scanning: boolean;
  authLoading: boolean;
  authFlowStatus: "idle" | "pending" | "expired" | "error";
  authRemainingSeconds: number | null;
  launchLoading: boolean;
  error: string | null;
  bulkPreview: BulkSyncPreview | null;
  bulkResults: BulkSyncResult[];
  bulkRunning: boolean;
  recentSync: RecentBulkSyncState | null;
  githubContributions: GitHubContributionsState;
}

export interface RecentBulkSyncState {
  preview: BulkSyncPreview;
  results: BulkSyncResult[];
  retryingRepoIds: string[];
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
  launchStatuses: {},
  launchLogs: {},
  loading: false,
  scanning: false,
  authLoading: false,
  authFlowStatus: "idle",
  authRemainingSeconds: null,
  launchLoading: false,
  error: null,
  bulkPreview: null,
  bulkResults: [],
  bulkRunning: false,
  recentSync: null,
  githubContributions: {
    days: [],
    meta: null,
    loading: false,
    error: null,
  },
});

export const deviceFlow = ref<GitHubDeviceFlowStart | null>(null);

export const workspaceRoot = computed(() => state.settings?.workspaceRoot ?? null);
export const githubBinding = computed(() => state.bindingStatus?.binding ?? state.settings?.githubBinding ?? null);
export const isAuthorized = computed(() => state.bindingStatus?.state === "bound" && Boolean(githubBinding.value));
export const isReady = computed(() => Boolean(workspaceRoot.value) && isAuthorized.value);

export const overviewStats = computed(() => {
  const dirtyRepos = state.repos.filter((repo) =>
    repo.stagedCount + repo.unstagedCount + repo.untrackedCount > 0
  ).length;
  const pullable = state.repos.filter((repo) => repo.behind > 0).length;
  const pushable = state.repos.filter((repo) => repo.ahead > 0).length;
  return {
    totalRepos: state.repos.length,
    dirtyRepos,
    pullable,
    pushable,
  };
});

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
  if (index >= 0) {
    state.repos[index] = summary;
  } else {
    state.repos.push(summary);
  }
  const detail = state.repoDetails[summary.id];
  if (detail) {
    state.repoDetails[summary.id] = {
      ...detail,
      summary,
    };
  }
}

export function setRepoDetail(detail: RepoDetail) {
  state.repoDetails[detail.summary.id] = detail;
  upsertRepo(detail.summary);
}

export function repoById(repoId: string) {
  return state.repos.find((repo) => repo.id === repoId) ?? null;
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
  if (!state.bulkRunning) return new Set<string>();
  return bulkSyncRepoIds();
}

export function syncErrorByRepoId() {
  const recentErrors = recentSyncErrorMap();
  if (recentErrors.size) return recentErrors;
  if (!state.bulkPreview || !["push", "sync"].includes(state.bulkPreview.operation)) {
    return new Map<string, string>();
  }
  return new Map(
    state.bulkResults
      .filter((result) => result.status === "error")
      .map((result) => [result.repoId, result.message]),
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

function recentSyncErrorMap() {
  const errors = new Map<string, string>();
  for (const result of state.recentSync?.results ?? []) {
    if (result.status === "error") errors.set(result.repoId, result.message);
  }
  return errors;
}

export function resetWorkspaceStateForTests() {
  state.settings = null;
  state.bindingStatus = null;
  state.repos = [];
  state.repoDetails = {};
  state.launchConfigs = {};
  state.launchStatuses = {};
  state.launchLogs = {};
  state.loading = false;
  state.scanning = false;
  state.authLoading = false;
  state.authFlowStatus = "idle";
  state.authRemainingSeconds = null;
  state.launchLoading = false;
  state.error = null;
  state.bulkPreview = null;
  state.bulkResults = [];
  state.bulkRunning = false;
  state.recentSync = null;
  state.githubContributions = {
    days: [],
    meta: null,
    loading: false,
    error: null,
  };
  deviceFlow.value = null;
}
