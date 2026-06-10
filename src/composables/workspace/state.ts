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
  if (index >= 0) state.repos[index] = summary;
}

export function repoById(repoId: string) {
  return state.repos.find((repo) => repo.id === repoId) ?? null;
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
  deviceFlow.value = null;
}
