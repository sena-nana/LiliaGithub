import { computed, reactive, readonly, ref } from "vue";
import {
  bulkSyncExecute,
  bulkSyncPreview,
  checkoutBranch,
  commitRepo,
  getGitHubBindingStatus,
  getRepoDetail,
  getWorkspaceSettings,
  openPath,
  openUrl,
  pickWorkspaceRoot,
  pollGitHubDeviceFlow,
  pullRepo,
  pushRepo,
  scanRepos,
  setWorkspaceRoot,
  stageFiles,
  startGitHubDeviceFlow,
  unstageFiles,
  type BulkOperation,
  type BulkSyncPreview,
  type BulkSyncResult,
  type GitHubBindingStatus,
  type GitHubDeviceFlowStart,
  type RepoDetail,
  type RepoSummary,
  type WorkspaceSettings,
} from "../services/workspace";

interface WorkspaceState {
  settings: WorkspaceSettings | null;
  bindingStatus: GitHubBindingStatus | null;
  repos: RepoSummary[];
  repoDetails: Record<string, RepoDetail | undefined>;
  loading: boolean;
  scanning: boolean;
  authLoading: boolean;
  error: string | null;
  bulkPreview: BulkSyncPreview | null;
  bulkResults: BulkSyncResult[];
  bulkRunning: boolean;
}

const state = reactive<WorkspaceState>({
  settings: null,
  bindingStatus: null,
  repos: [],
  repoDetails: {},
  loading: false,
  scanning: false,
  authLoading: false,
  error: null,
  bulkPreview: null,
  bulkResults: [],
  bulkRunning: false,
});

const deviceFlow = ref<GitHubDeviceFlowStart | null>(null);

const workspaceRoot = computed(() => state.settings?.workspaceRoot ?? null);
const githubBinding = computed(() => state.bindingStatus?.binding ?? state.settings?.githubBinding ?? null);
const isAuthorized = computed(() => state.bindingStatus?.state === "bound" && Boolean(githubBinding.value));
const isReady = computed(() => Boolean(workspaceRoot.value) && isAuthorized.value);

const overviewStats = computed(() => {
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

async function initialize() {
  if (state.loading) return;
  state.loading = true;
  state.error = null;
  try {
    const [settings, bindingStatus] = await Promise.all([
      getWorkspaceSettings(),
      getGitHubBindingStatus(),
    ]);
    state.settings = settings;
    state.bindingStatus = bindingStatus;
    if (settings.workspaceRoot) {
      await refreshRepos();
    }
  } catch (err) {
    state.error = String(err);
  } finally {
    state.loading = false;
  }
}

async function chooseWorkspaceRoot() {
  state.error = null;
  const picked = await pickWorkspaceRoot();
  if (!picked) return null;
  state.settings = await setWorkspaceRoot(picked);
  await refreshRepos();
  return picked;
}

async function refreshRepos() {
  state.scanning = true;
  state.error = null;
  try {
    state.repos = await scanRepos();
  } catch (err) {
    state.error = String(err);
  } finally {
    state.scanning = false;
  }
}

function applyBindingStatus(bindingStatus: GitHubBindingStatus) {
  state.bindingStatus = bindingStatus;
  if (state.settings) {
    state.settings = {
      ...state.settings,
      githubBinding: bindingStatus.binding,
    };
  }
}

async function startAuthFlow() {
  state.authLoading = true;
  state.error = null;
  try {
    deviceFlow.value = await startGitHubDeviceFlow();
    await openUrl(deviceFlow.value.verificationUri);
  } catch (err) {
    state.error = String(err);
  } finally {
    state.authLoading = false;
  }
}

async function pollAuthFlow() {
  if (!deviceFlow.value) return null;
  state.authLoading = true;
  try {
    const result = await pollGitHubDeviceFlow(
      deviceFlow.value.deviceCode,
      deviceFlow.value.intervalSeconds,
    );
    if (result.status === "authorized" && result.bindingStatus) {
      applyBindingStatus(result.bindingStatus);
      deviceFlow.value = null;
    }
    return result;
  } finally {
    state.authLoading = false;
  }
}

async function loadRepoDetail(repoId: string) {
  state.error = null;
  const detail = await getRepoDetail(repoId);
  state.repoDetails[repoId] = detail;
  upsertRepo(detail.summary);
  return detail;
}

function upsertRepo(summary: RepoSummary) {
  const index = state.repos.findIndex((repo) => repo.id === summary.id);
  if (index >= 0) state.repos[index] = summary;
}

async function stage(repoId: string, files: string[]) {
  await stageFiles(repoId, files);
  await loadRepoDetail(repoId);
}

async function unstage(repoId: string, files: string[]) {
  await unstageFiles(repoId, files);
  await loadRepoDetail(repoId);
}

async function commit(repoId: string, files: string[], message: string, pushAfter: boolean) {
  const summary = await commitRepo(repoId, files, message, pushAfter);
  upsertRepo(summary);
  await loadRepoDetail(repoId);
}

async function pull(repoId: string) {
  const summary = await pullRepo(repoId);
  upsertRepo(summary);
  await loadRepoDetail(repoId);
}

async function push(repoId: string) {
  const summary = await pushRepo(repoId);
  upsertRepo(summary);
  await loadRepoDetail(repoId);
}

async function checkout(repoId: string, branch: string) {
  const summary = await checkoutBranch(repoId, branch);
  upsertRepo(summary);
  await loadRepoDetail(repoId);
}

async function previewBulk(operation: BulkOperation) {
  state.bulkPreview = await bulkSyncPreview(operation);
  state.bulkResults = [];
}

async function executeBulk() {
  if (!state.bulkPreview) return;
  state.bulkRunning = true;
  try {
    const ids = state.bulkPreview.eligible.map((item) => item.repo.id);
    state.bulkResults = await bulkSyncExecute(state.bulkPreview.operation, ids);
    await refreshRepos();
  } finally {
    state.bulkRunning = false;
  }
}

function closeBulkPreview() {
  state.bulkPreview = null;
  state.bulkResults = [];
}

function repoById(repoId: string) {
  return state.repos.find((repo) => repo.id === repoId) ?? null;
}

export function useWorkspace() {
  return {
    state: readonly(state),
    deviceFlow: readonly(deviceFlow),
    workspaceRoot,
    githubBinding,
    isAuthorized,
    isReady,
    overviewStats,
    initialize,
    chooseWorkspaceRoot,
    refreshRepos,
    startAuthFlow,
    pollAuthFlow,
    loadRepoDetail,
    stage,
    unstage,
    commit,
    pull,
    push,
    checkout,
    previewBulk,
    executeBulk,
    closeBulkPreview,
    repoById,
    openPath,
    openUrl,
  };
}
