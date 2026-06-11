import { computed, reactive, ref } from "vue";
import type {
  BulkSyncPreview,
  BulkSyncResult,
  GitHubBindingStatus,
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
  recentPush: RecentBulkPushState | null;
}

export interface RecentBulkPushState {
  preview: BulkSyncPreview;
  results: BulkSyncResult[];
  retryingRepoIds: string[];
  updatedAt: number;
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
  recentPush: null,
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
  const commitsByDay = new Map<string, number>();
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    commitsByDay.set(d.toISOString().slice(5, 10), 0);
  }
  for (const repo of state.repos) {
    if (!repo.lastCommitAt) continue;
    const key = new Date(repo.lastCommitAt * 1000).toISOString().slice(5, 10);
    if (commitsByDay.has(key)) commitsByDay.set(key, (commitsByDay.get(key) ?? 0) + 1);
  }
  return {
    totalRepos: state.repos.length,
    dirtyRepos,
    pullable,
    pushable,
    commitsByDay: Array.from(commitsByDay, ([day, count]) => ({ day, count })),
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

export function bulkPushRepoIds(preview: BulkSyncPreview | null = state.bulkPreview) {
  if (!preview || preview.operation !== "push") return new Set<string>();
  const ids = new Set<string>();
  for (const item of [...preview.eligible, ...preview.blocked]) {
    if (item.repo.ahead > 0) ids.add(item.repo.id);
  }
  return ids;
}

export function bulkPushRunningRepoIds() {
  if (!state.bulkRunning) return new Set<string>();
  return bulkPushRepoIds();
}

export function pushErrorByRepoId() {
  const recentErrors = recentPushErrorMap();
  if (recentErrors.size) return recentErrors;
  if (state.bulkPreview?.operation !== "push") return new Map<string, string>();
  return new Map(
    state.bulkResults
      .filter((result) => result.status === "error")
      .map((result) => [result.repoId, result.message]),
  );
}

export function recentPushErrorForRepo(repoId: string) {
  const result = state.recentPush?.results.find((item) => item.repoId === repoId && item.status === "error");
  if (!result) return null;
  return {
    message: result.message,
    retrying: state.recentPush?.retryingRepoIds.includes(repoId) ?? false,
  };
}

export function rememberRecentPush(preview: BulkSyncPreview, results: BulkSyncResult[]) {
  if (preview.operation !== "push") return;
  state.recentPush = {
    preview,
    results,
    retryingRepoIds: state.recentPush?.retryingRepoIds.filter((id) =>
      results.some((result) => result.repoId === id && result.status === "error"),
    ) ?? [],
    updatedAt: Date.now(),
  };
}

export function beginRecentPushRetry(repoId: string) {
  if (!state.recentPush) return false;
  if (!isRecentPushIssue(repoId)) return false;
  if (!state.recentPush.retryingRepoIds.includes(repoId)) {
    state.recentPush.retryingRepoIds = [...state.recentPush.retryingRepoIds, repoId];
  }
  return true;
}

export function finishRecentPushRetry(result: BulkSyncResult) {
  if (!state.recentPush) return;
  const existingResult = state.recentPush.results.some((item) => item.repoId === result.repoId);
  const nextResults = existingResult
    ? state.recentPush.results.map((item) => (item.repoId === result.repoId ? result : item))
    : [...state.recentPush.results, result];
  state.recentPush = {
    ...state.recentPush,
    preview: {
      ...state.recentPush.preview,
      blocked: state.recentPush.preview.blocked.filter((item) => item.repo.id !== result.repoId),
    },
    results: nextResults,
    retryingRepoIds: state.recentPush.retryingRepoIds.filter((id) => id !== result.repoId),
    updatedAt: Date.now(),
  };
}

function isRecentPushIssue(repoId: string) {
  return Boolean(recentPushErrorForRepo(repoId));
}

function recentPushErrorMap() {
  const errors = new Map<string, string>();
  for (const result of state.recentPush?.results ?? []) {
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
  state.recentPush = null;
  deviceFlow.value = null;
}
