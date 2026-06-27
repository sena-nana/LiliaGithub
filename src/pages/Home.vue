<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  FolderOpen,
  FolderGit2,
  FolderInput,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Info,
  CloudDownload,
  CloudUpload,
  LoaderCircle,
  Radar,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  Tag,
  X,
} from "@lucide/vue";
import { useComponentEpoch } from "../composables/useComponentEpoch";
import { createConcurrentTaskQueue } from "../composables/useConcurrentTaskQueue";
import { useCloneRepoDialog } from "../composables/useCloneRepoDialog";
import { openContextMenuAt, type ContextMenuItem } from "../composables/useContextMenu";
import { createLatestAsyncLoader } from "../composables/useLatestAsyncLoader";
import { repoLocalDirtyCount, useRepoLocalChangesPrompt } from "../composables/useRepoLocalChangesPrompt";
import { useShellRepoActions } from "../composables/useShellRepoActions";
import { useWorkspace } from "../composables/useWorkspace";
import {
  repoActionErrorDetailForRepo,
  repoSyncIssueForRepo,
  syncErrorDetailsByRepoId,
  type RepoSyncIssueDisplay,
} from "../composables/workspace/state";
import {
  isGitHubBindingExpiredError,
  listGitHubRepos,
  listGitHubIssues,
  listGitHubPullRequests,
  listGitHubPullRequestChecks,
  listGitHubReleases,
  listGitHubWorkflowRuns,
  preloadGitHubRepos,
  type GitHubContributionDay,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubPullRequestCheck,
  type GitHubRelease,
  type GitHubRepoSummary,
  type GitHubWorkflowRun,
  type BulkOperation,
  type RepoPullLocalChangesMode,
  type RepoSummary,
} from "../services/workspace";
import {
  clearHomeGitHubOverviewSnapshot,
  homeGitHubOverviewSnapshotNeedsRefresh,
  readHomeGitHubOverviewSnapshot,
  writeHomeGitHubOverviewSnapshot,
} from "./homeOverviewCache";
import GitHubTimelineList, { type TimelineDisplayNode, type TimelineNodeLink } from "../components/GitHubTimelineList.vue";
import HomeCloneDialog from "../components/home/HomeCloneDialog.vue";
import RepoCreateCard from "../components/sidebar/RepoCreateCard.vue";
import { createCachedAsyncComponent } from "../utils/asyncComponent";
import { bulkResultTone, workflowRunStatusText, workflowRunStatusTone, type WorkflowRunTone } from "../utils/repoDisplay";
import {
  repoCalculatesHomeTimeline,
  repoIncludedInHomeCodeStats,
} from "../config/repoSettingsManifest";
import { representativeReposByGitHubFullName, representativeReposBySharedGroup } from "../utils/repoWorktree";
import { remoteRepoRoute, shortcutFromGitHubRepo } from "../utils/remoteRepo";
import { repoProjectRoute, repoRoute } from "../utils/repoRoutes";
import {
  buildLanguageOverviewFromRepos,
  buildProjectCodeOverviewFromRepos,
  formatBytes,
  formatPercent,
} from "../utils/languageStats";
import "../styles/page.css";

const workspace = useWorkspace();
const router = useRouter();
const shellActions = useShellRepoActions();
const repoLocalChangesDialogModule = createCachedAsyncComponent(() => import("../components/repo/RepoLocalChangesDialog.vue"));
const RepoLocalChangesDialog = repoLocalChangesDialogModule.component;
const {
  dialog: pullLocalChangesDialog,
  request: requestPullLocalChangesMode,
  select: selectPullLocalChangesMode,
  cancel: cancelPullLocalChangesDialog,
} = useRepoLocalChangesPrompt();
const syncErrorDetails = computed(() => syncErrorDetailsByRepoId());
const syncingRepoId = ref<string | null>(null);
const bulkLocalChangesMode = ref<RepoPullLocalChangesMode>("reject");
const createRepoCardOpen = ref(false);
const createRepoCardMode = ref<"local" | "remote">("local");
const pendingCreatedRepoGroupId = ref<string | null>(null);
const cloneDialog = useCloneRepoDialog({
  onCloned: placeCreatedRepo,
});

type RepoAction = {
  label: string;
  title: string;
} & (
  {
    kind: "link";
    to: string;
  } | {
    kind: "sync";
  }
);

type RepoStatusRow = {
  githubRepo: GitHubRepoSummary;
  localRepo: RepoSummary | null;
  action: RepoAction | null;
  syncIssue: RepoSyncIssueDisplay | null;
  workflowRun: WorkflowRunOverview | null;
};

type GitHubTimelineRepoSource = Pick<RepoStatusRow, "githubRepo" | "localRepo">;

type GitHubTimelineEvent = {
  id: string;
  kind: "repo" | "operation" | "commit" | "issue" | "pull" | "workflow" | "release";
  title: string;
  detail: string;
  summary: string;
  timestamp: number;
  href?: string;
  tone?: WorkflowRunTone;
};

type WorkflowRunOverview = {
  run: GitHubWorkflowRun;
  status: string;
  detail: string;
  tone: WorkflowRunTone;
  priority: number;
};

type ContributionCell = GitHubContributionDay & {
  level: number;
  weekStart: string;
};

type ContributionMonthLabel = {
  key: string;
  label: string;
};

type LanguageChartMode = "language" | "project";

type HomeCodeSlice = {
  key: string;
  label: string;
  to: string | null;
  linkTitle: string;
  bytes: number;
  lines: number;
  percent: number;
  color: string;
  offset: number;
  title: string;
};

type HomeCodeOverview = {
  totalBytes: number;
  totalLines: number;
  slices: HomeCodeSlice[];
};

type ProjectTabRef = "issues" | "pulls" | "actions" | "release";
const REPO_STATUS_RENDER_PAGE_SIZE = 60;
const GITHUB_TIMELINE_EVENT_LIMIT = 12;
const GITHUB_TIMELINE_ISSUE_CACHE_KEY = "lilia-github.home.timelineIssues.v1";
const GITHUB_TIMELINE_ISSUE_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_TIMELINE_ISSUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GITHUB_TIMELINE_ISSUES_PER_REPO = 100;
const GITHUB_TIMELINE_PULL_REQUESTS_PER_REPO = 5;
const GITHUB_TIMELINE_WORKFLOW_RUNS_PER_REPO = 5;
const GITHUB_TIMELINE_FETCH_CONCURRENCY = 2;

type GitHubTimelineIssueCacheEntry = {
  repoFullName: string;
  since: string;
  fetchedAt: number;
  issues: GitHubIssue[];
};

type GitHubTimelineIssueCache = Record<string, GitHubTimelineIssueCacheEntry | undefined>;

type IdleRequestWindow = Window & {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type GitHubTimelineIssueTask = {
  repo: GitHubRepoSummary;
  generation: number;
  since: string;
  cache: GitHubTimelineIssueCache;
};

type GitHubTimelinePullRequestTask = {
  repo: GitHubRepoSummary;
  generation: number;
  since: string;
};

type GitHubTimelineWorkflowTask = {
  repo: GitHubRepoSummary;
  generation: number;
};

type GitHubTimelineReleaseTask = {
  repo: GitHubRepoSummary;
  generation: number;
};

const languageChartMode = ref<LanguageChartMode>("language");
const discovering = ref(false);
const githubRepos = ref<GitHubRepoSummary[]>([]);
const githubReposNextPage = ref<number | null>(null);
const githubReposLoading = ref(false);
const githubReposLoadingMore = ref(false);
const githubReposError = ref<string | null>(null);
const githubIssuesByRepo = ref<Record<string, GitHubIssue[] | undefined>>({});
const githubIssuesLoading = ref(false);
const githubPullRequestsByRepo = ref<Record<string, GitHubPullRequest[] | undefined>>({});
const githubPullRequestChecksByRepo = ref<Record<string, Record<number, GitHubPullRequestCheck[] | undefined> | undefined>>({});
const githubPullRequestsLoading = ref(false);
const githubWorkflowRunsByRepo = ref<Record<string, GitHubWorkflowRun[] | undefined>>({});
const githubWorkflowRunsLoading = ref(false);
const githubReleasesByRepo = ref<Record<string, GitHubRelease[] | undefined>>({});
const githubReleasesLoading = ref(false);
const githubTimelineCard = ref<HTMLElement | null>(null);
const githubTimelineActivated = ref(false);
const cloningFullName = ref<string | null>(null);
const repoStatusVisibleCount = ref(REPO_STATUS_RENDER_PAGE_SIZE);
const componentEpoch = useComponentEpoch();
const githubRepoStatusLoader = createLatestAsyncLoader({ componentEpoch });
const githubRepoMoreLoader = createLatestAsyncLoader({ componentEpoch });
let lastRepoStatusListRefreshToken = workspace.state.repoStatusListRefreshToken;
const searchOpen = computed(() => shellActions?.searchOpen.value ?? false);
const repoGroups = computed(() => workspace.state.settings?.repoGroups ?? []);
const contributionWeeks = computed(() => buildContributionWeeks(workspace.state.githubContributions.days));
const contributionMonthLabels = computed(() =>
  buildContributionMonthLabels(contributionWeeks.value, workspace.state.githubContributions.days),
);

const totalContributions = computed(() =>
  workspace.state.githubContributions.days.reduce((total, day) => total + day.count, 0),
);
const hasContributionDays = computed(() => workspace.state.githubContributions.days.length > 0);
const skippedContributionRepoCount = computed(() =>
  workspace.state.githubContributions.meta?.skippedRepoCount ?? 0,
);
const homeCodeStatsRepos = computed(() =>
  representativeReposBySharedGroup(workspace.state.repos)
    .filter((repo) => repoIncludedInHomeCodeStats(workspace.state.settings, repo.id)),
);

const languageOverview = computed<HomeCodeOverview>(() => {
  const overview = buildLanguageOverviewFromRepos(homeCodeStatsRepos.value);
  const slices = overview.slices.map((slice) => {
    const primaryRepoId = slice.repoIds[0] ?? null;
    const target = workspace.repoById(primaryRepoId ?? "")?.name ?? primaryRepoId;
    return {
      ...slice,
      key: `language:${slice.language}`,
      label: slice.language,
      to: primaryRepoId ? repoRoute(primaryRepoId) : null,
      linkTitle: target
        ? `${slice.title}，点击进入 ${target}${slice.repoIds.length > 1 ? ` 等 ${slice.repoIds.length} 个仓库` : ""}`
        : slice.title,
    };
  });
  return { ...overview, slices };
});

const projectCodeOverview = computed<HomeCodeOverview>(() => {
  const overview = buildProjectCodeOverviewFromRepos(homeCodeStatsRepos.value);
  return {
    ...overview,
    slices: overview.slices.map((slice) => ({
      ...slice,
      key: `project:${slice.repoId ?? "other"}`,
      label: slice.repoName,
      to: slice.repoId ? repoRoute(slice.repoId) : null,
      linkTitle: slice.repoId ? `${slice.title}，点击进入 ${slice.repoName}` : slice.title,
    })),
  };
});
const activeCodeOverview = computed(() =>
  languageChartMode.value === "project" ? projectCodeOverview.value : languageOverview.value,
);

const localRepoByGitHubFullName = computed(() => representativeReposByGitHubFullName(workspace.state.repos));

const repoStatusRows = computed<RepoStatusRow[]>(() =>
  githubRepos.value.filter((repo) => !repo.disabled).map((githubRepo) => {
    const localRepo = localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null;
    return {
      githubRepo,
      localRepo,
      action: localRepo ? repoAction(localRepo) : null,
      syncIssue: localRepo ? repoSyncIssueForRepo(localRepo.id) : null,
      workflowRun: focusedWorkflowRun(githubWorkflowRunsByRepo.value[githubRepo.fullName] ?? []),
    };
  }).sort((a, b) => Number(a.githubRepo.archived) - Number(b.githubRepo.archived)),
);

const visibleRepoStatusRows = computed(() =>
  repoStatusRows.value.slice(0, repoStatusVisibleCount.value),
);
const hiddenRepoStatusRowCount = computed(() =>
  Math.max(0, repoStatusRows.value.length - visibleRepoStatusRows.value.length),
);
const homeTimelineRepos = computed(() =>
  githubRepos.value.filter(repoIncludedInHomeTimeline),
);
const githubTimelineRepoSources = computed<GitHubTimelineRepoSource[]>(() =>
  homeTimelineRepos.value.map((githubRepo) => ({
    githubRepo,
    localRepo: localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null,
  })),
);
const githubTimelineNodes = computed<TimelineDisplayNode[]>(() =>
  githubTimelineRepoSources.value
    .flatMap((source) => buildGitHubTimelineEvents(source))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, GITHUB_TIMELINE_EVENT_LIMIT)
    .map(toGitHubTimelineDisplayNode),
);
const githubTimelineWaitingForActivation = computed(() =>
  !githubTimelineActivated.value && (
    githubIssuesPendingCount.value > 0 ||
    githubPullRequestsPendingCount.value > 0 ||
    githubWorkflowRunsPendingCount.value > 0 ||
    githubReleasesPendingCount.value > 0
  ),
);
const githubTimelineBusy = computed(() =>
  githubReposLoading.value ||
  githubIssuesLoading.value ||
  githubPullRequestsLoading.value ||
  githubWorkflowRunsLoading.value ||
  githubReleasesLoading.value ||
  githubTimelineWaitingForActivation.value,
);

const githubIssuesPendingCount = ref(0);
const githubPullRequestsPendingCount = ref(0);
const githubWorkflowRunsPendingCount = ref(0);
const githubReleasesPendingCount = ref(0);
let githubTimelineGeneration = 0;
let githubTimelineActivationQueued = false;
let githubTimelineObserver: IntersectionObserver | null = null;
let githubTimelineIdleHandle: number | null = null;
let githubTimelineIdleFallbackTimer: number | null = null;
const githubTimelineIssueTasks = createConcurrentTaskQueue<GitHubTimelineIssueTask>({
  concurrency: GITHUB_TIMELINE_FETCH_CONCURRENCY,
  key: (task) => task.repo.fullName,
  loading: githubIssuesLoading,
  pendingCount: githubIssuesPendingCount,
  canRun: () => githubTimelineActivated.value,
  isCurrent: (task) => task.generation === githubTimelineGeneration,
  worker: processGitHubTimelineIssueTask,
});
const githubTimelinePullRequestTasks = createConcurrentTaskQueue<GitHubTimelinePullRequestTask>({
  concurrency: GITHUB_TIMELINE_FETCH_CONCURRENCY,
  key: (task) => task.repo.fullName,
  loading: githubPullRequestsLoading,
  pendingCount: githubPullRequestsPendingCount,
  canRun: () => githubTimelineActivated.value,
  isCurrent: (task) => task.generation === githubTimelineGeneration,
  worker: processGitHubTimelinePullRequestTask,
});
const githubTimelineWorkflowTasks = createConcurrentTaskQueue<GitHubTimelineWorkflowTask>({
  concurrency: GITHUB_TIMELINE_FETCH_CONCURRENCY,
  key: (task) => task.repo.fullName,
  loading: githubWorkflowRunsLoading,
  pendingCount: githubWorkflowRunsPendingCount,
  canRun: () => githubTimelineActivated.value,
  isCurrent: (task) => task.generation === githubTimelineGeneration,
  worker: processGitHubTimelineWorkflowTask,
});
const githubTimelineReleaseTasks = createConcurrentTaskQueue<GitHubTimelineReleaseTask>({
  concurrency: GITHUB_TIMELINE_FETCH_CONCURRENCY,
  key: (task) => task.repo.fullName,
  loading: githubReleasesLoading,
  pendingCount: githubReleasesPendingCount,
  canRun: () => githubTimelineActivated.value,
  isCurrent: (task) => task.generation === githubTimelineGeneration,
  worker: processGitHubTimelineReleaseTask,
});

watch(
  () => repoStatusRows.value.length,
  (length, previousLength) => {
    if (length < previousLength) {
      repoStatusVisibleCount.value = REPO_STATUS_RENDER_PAGE_SIZE;
    }
  },
);

onUnmounted(() => {
  githubTimelineGeneration += 1;
  githubRepoStatusLoader.invalidate();
  githubRepoMoreLoader.invalidate();
  clearGitHubTimelineActivationHooks();
  resetGitHubTimelineQueues();
});

watch(
  () => [workspace.isReady.value, workspace.state.repoStatusListRefreshToken] as const,
  ([ready, token]) => {
    if (!ready) return;
    const shouldForceRefresh = token !== lastRepoStatusListRefreshToken;
    lastRepoStatusListRefreshToken = token;
    if (shouldForceRefresh) {
      void loadGitHubRepoStatus({ force: true });
      return;
    }
    const restoredSnapshot = restoreGitHubOverviewSnapshot();
    if (restoredSnapshot) {
      if (homeGitHubOverviewSnapshotNeedsRefresh(restoredSnapshot)) {
        void loadGitHubRepoStatus({ force: true });
      }
      return;
    }
    void loadGitHubRepoStatus();
  },
  { immediate: true },
);

function repoDetailPath(repo: Pick<RepoSummary, "id">, tab?: "conflicts") {
  return tab === "conflicts" ? repoRoute(repo.id, "changes") : repoRoute(repo.id);
}

function repoProjectPath(
  repo: Pick<RepoSummary, "id">,
  tab: ProjectTabRef,
  focusId?: number | null,
  releaseTag?: string | null,
) {
  return repoProjectRoute(repo.id, tab, focusId, null, releaseTag);
}

function remoteRepoProjectPath(
  repo: Pick<GitHubRepoSummary, "fullName">,
  tab: ProjectTabRef,
  focusId?: number | null,
  releaseTag?: string | null,
) {
  return repoProjectRoute(`github:${repo.fullName}`, tab, focusId, null, releaseTag);
}

function dedupeGitHubRepos(items: GitHubRepoSummary[]) {
  const seen = new Set<string>();
  const next: GitHubRepoSummary[] = [];
  for (const item of items) {
    if (seen.has(item.fullName)) continue;
    seen.add(item.fullName);
    next.push(item);
  }
  return next;
}

function applyGitHubRepoPage(
  page: { items: GitHubRepoSummary[]; nextPage: number | null },
  append = false,
  refreshIssues = false,
) {
  if (!append || refreshIssues) {
    githubTimelineGeneration += 1;
    resetGitHubTimelineQueues();
  }
  githubRepos.value = append ? dedupeGitHubRepos([...githubRepos.value, ...page.items]) : page.items;
  githubReposNextPage.value = page.nextPage;
  githubReposError.value = null;
  writeGitHubOverviewSnapshot();
  prepareGitHubTimeline(page.items, refreshIssues);
}

function currentGitHubAccountLogin() {
  return workspace.githubBinding.value?.login ?? null;
}

function restoreGitHubOverviewSnapshot() {
  const snapshot = readHomeGitHubOverviewSnapshot();
  if (!snapshot) return null;
  if (snapshot.accountLogin !== currentGitHubAccountLogin()) {
    clearHomeGitHubOverviewSnapshot();
    return null;
  }
  githubRepos.value = snapshot.repos;
  githubReposNextPage.value = snapshot.nextPage;
  githubIssuesByRepo.value = snapshot.issuesByRepo;
  githubPullRequestsByRepo.value = snapshot.pullRequestsByRepo;
  githubPullRequestChecksByRepo.value = snapshot.pullRequestChecksByRepo;
  githubWorkflowRunsByRepo.value = snapshot.workflowRunsByRepo;
  githubReleasesByRepo.value = snapshot.releasesByRepo;
  githubReposError.value = null;
  prepareGitHubTimeline(snapshot.repos);
  return snapshot;
}

function writeGitHubOverviewSnapshot() {
  writeHomeGitHubOverviewSnapshot({
    schemaVersion: 2,
    accountLogin: currentGitHubAccountLogin(),
    cachedAt: Date.now(),
    repos: githubRepos.value,
    nextPage: githubReposNextPage.value,
    issuesByRepo: githubIssuesByRepo.value,
    pullRequestsByRepo: githubPullRequestsByRepo.value,
    pullRequestChecksByRepo: githubPullRequestChecksByRepo.value,
    workflowRunsByRepo: githubWorkflowRunsByRepo.value,
    releasesByRepo: githubReleasesByRepo.value,
  });
}

function githubRepoLoadErrorMessage(err: unknown) {
  if (isGitHubBindingExpiredError(err)) {
    clearGitHubTimelineIssueCache();
    clearGitHubTimelinePullRequests();
    clearGitHubTimelineWorkflowRuns();
    clearGitHubTimelineReleases();
    return "GitHub 绑定已失效，请重新绑定后再加载账号仓库。";
  }
  return `GitHub 仓库列表加载失败：${String(err)}`;
}

function loadGitHubTimelineReleases(
  repos: GitHubRepoSummary[],
  refresh = false,
) {
  let nextReleasesByRepo = { ...githubReleasesByRepo.value };
  if (refresh) {
    for (const repo of repos) {
      delete nextReleasesByRepo[repo.fullName];
    }
  }
  githubReleasesByRepo.value = nextReleasesByRepo;
  writeGitHubOverviewSnapshot();
  const missingRepos = repos.filter((repo) => nextReleasesByRepo[repo.fullName] == null);
  enqueueGitHubTimelineReleaseRepos(missingRepos);
}

async function fetchGitHubTimelineReleases(
  repo: GitHubRepoSummary,
): Promise<readonly [string, GitHubRelease[]]> {
  try {
    const releases = await listGitHubReleases(repo.fullName);
    return [repo.fullName, releases.map(cloneRelease)] as const;
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) clearGitHubTimelineReleases();
    return [repo.fullName, []] as const;
  }
}

function loadGitHubTimelineWorkflowRuns(
  repos: GitHubRepoSummary[],
  refresh = false,
) {
  let nextWorkflowRunsByRepo = { ...githubWorkflowRunsByRepo.value };
  if (refresh) {
    for (const repo of repos) {
      delete nextWorkflowRunsByRepo[repo.fullName];
    }
  }
  githubWorkflowRunsByRepo.value = nextWorkflowRunsByRepo;
  writeGitHubOverviewSnapshot();
  const missingRepos = repos.filter((repo) => nextWorkflowRunsByRepo[repo.fullName] == null);
  enqueueGitHubTimelineWorkflowRepos(missingRepos);
}

async function fetchGitHubTimelineWorkflowRuns(
  repo: GitHubRepoSummary,
): Promise<readonly [string, GitHubWorkflowRun[]]> {
  try {
    const runs = await listGitHubWorkflowRuns(repo.fullName, GITHUB_TIMELINE_WORKFLOW_RUNS_PER_REPO);
    return [repo.fullName, runs.map(cloneWorkflowRun)] as const;
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) clearGitHubTimelineWorkflowRuns();
    return [repo.fullName, []] as const;
  }
}

function loadGitHubTimelinePullRequests(
  repos: GitHubRepoSummary[],
  refresh = false,
) {
  const since = gitHubTimelineIssueSince();
  let nextPullRequestsByRepo = { ...githubPullRequestsByRepo.value };
  let nextPullRequestChecksByRepo = { ...githubPullRequestChecksByRepo.value };
  if (refresh) {
    for (const repo of repos) {
      delete nextPullRequestsByRepo[repo.fullName];
      delete nextPullRequestChecksByRepo[repo.fullName];
    }
  }
  githubPullRequestsByRepo.value = nextPullRequestsByRepo;
  githubPullRequestChecksByRepo.value = nextPullRequestChecksByRepo;
  writeGitHubOverviewSnapshot();
  const missingRepos = repos.filter((repo) => nextPullRequestsByRepo[repo.fullName] == null);
  enqueueGitHubTimelinePullRequestRepos(missingRepos, since);
}

async function fetchGitHubTimelinePullRequests(
  repo: GitHubRepoSummary,
  since: string,
): Promise<readonly [string, GitHubPullRequest[], Record<number, GitHubPullRequestCheck[]>]> {
  try {
    const pullRequests = filterRecentGitHubPullRequests(
      await listGitHubPullRequests(repo.fullName, "all"),
      since,
    ).slice(0, GITHUB_TIMELINE_PULL_REQUESTS_PER_REPO);
    const checkEntries = await Promise.all(
      pullRequests.map(async (pullRequest) => {
        try {
          const checks = await listGitHubPullRequestChecks(repo.fullName, pullRequest.number);
          return [pullRequest.number, checks.map((check) => ({ ...check }))] as const;
        } catch {
          return [pullRequest.number, []] as const;
        }
      }),
    );
    return [repo.fullName, pullRequests, Object.fromEntries(checkEntries)] as const;
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) clearGitHubTimelinePullRequests();
    return [repo.fullName, [], {}] as const;
  }
}

function loadGitHubTimelineIssues(
  repos: GitHubRepoSummary[],
  refresh = false,
) {
  const since = gitHubTimelineIssueSince();
  const now = Date.now();
  const cache = readGitHubTimelineIssueCache();
  let nextIssuesByRepo = { ...githubIssuesByRepo.value };
  if (refresh) {
    for (const repo of repos) {
      delete nextIssuesByRepo[repo.fullName];
      delete cache[repo.fullName];
    }
  }
  for (const repo of repos) {
    if (nextIssuesByRepo[repo.fullName] != null) continue;
    const cached = cache[repo.fullName];
    if (cached && isGitHubTimelineIssueCacheFresh(cached, now)) {
      nextIssuesByRepo[repo.fullName] = filterRecentGitHubIssues(cached.issues, since);
    }
  }
  githubIssuesByRepo.value = nextIssuesByRepo;
  writeGitHubOverviewSnapshot();
  const missingRepos = repos.filter((repo) => nextIssuesByRepo[repo.fullName] == null);
  enqueueGitHubTimelineIssueRepos(missingRepos, since, cache);
}

async function fetchGitHubTimelineIssues(
  repo: GitHubRepoSummary,
  since: string,
): Promise<readonly [string, GitHubIssue[]]> {
  try {
    const issues = await listGitHubIssues(repo.fullName, {
      state: "all",
      perPage: GITHUB_TIMELINE_ISSUES_PER_REPO,
      sort: "updated",
      direction: "desc",
      since,
    });
    return [repo.fullName, filterRecentGitHubIssues(issues, since)] as const;
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) clearGitHubTimelineIssueCache();
    return [repo.fullName, []] as const;
  }
}

function gitHubTimelineIssueSince() {
  return new Date(Date.now() - GITHUB_TIMELINE_ISSUE_WINDOW_MS).toISOString();
}

function filterRecentGitHubIssues(issues: readonly GitHubIssue[], since: string) {
  const sinceTimestamp = parseGitHubTime(since);
  return issues
    .filter((issue) => parseGitHubTime(issue.updatedAt) >= sinceTimestamp)
    .map(cloneGitHubIssue);
}

function filterRecentGitHubPullRequests(pullRequests: readonly GitHubPullRequest[], since: string) {
  const sinceTimestamp = parseGitHubTime(since);
  return pullRequests
    .filter((pullRequest) => parseGitHubTime(pullRequest.updatedAt) >= sinceTimestamp)
    .sort((a, b) => parseGitHubTime(b.updatedAt) - parseGitHubTime(a.updatedAt) || b.number - a.number)
    .map((pullRequest) => ({ ...pullRequest }));
}

function cloneGitHubIssue(issue: GitHubIssue): GitHubIssue {
  return {
    ...issue,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
  };
}

function cloneWorkflowRun(run: GitHubWorkflowRun): GitHubWorkflowRun {
  return { ...run };
}

function cloneRelease(release: GitHubRelease): GitHubRelease {
  return {
    ...release,
    assets: release.assets.map((asset) => ({ ...asset })),
  };
}

function isGitHubTimelineIssueCacheFresh(entry: GitHubTimelineIssueCacheEntry, now: number) {
  return Number.isFinite(entry.fetchedAt) &&
    now - entry.fetchedAt >= 0 &&
    now - entry.fetchedAt < GITHUB_TIMELINE_ISSUE_CACHE_TTL_MS;
}

function readGitHubTimelineIssueCache(): GitHubTimelineIssueCache {
  try {
    const raw = localStorage.getItem(GITHUB_TIMELINE_ISSUE_CACHE_KEY);
    if (!raw) return {};
    return parseGitHubTimelineIssueCache(JSON.parse(raw));
  } catch {
    return {};
  }
}

function parseGitHubTimelineIssueCache(value: unknown): GitHubTimelineIssueCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: GitHubTimelineIssueCache = {};
  for (const [repoFullName, rawEntry] of Object.entries(value)) {
    const entry = parseGitHubTimelineIssueCacheEntry(repoFullName, rawEntry);
    if (entry) entries[repoFullName] = entry;
  }
  return entries;
}

function parseGitHubTimelineIssueCacheEntry(
  repoFullName: string,
  value: unknown,
): GitHubTimelineIssueCacheEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Partial<GitHubTimelineIssueCacheEntry>;
  if (entry.repoFullName !== repoFullName) return null;
  if (typeof entry.since !== "string" || typeof entry.fetchedAt !== "number" || !Array.isArray(entry.issues)) {
    return null;
  }
  return {
    repoFullName,
    since: entry.since,
    fetchedAt: entry.fetchedAt,
    issues: entry.issues
      .map(parseCachedGitHubIssue)
      .filter((issue): issue is GitHubIssue => issue != null),
  };
}

function parseCachedGitHubIssue(value: unknown): GitHubIssue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const issue = value as Partial<GitHubIssue>;
  if (
    typeof issue.number !== "number" ||
    typeof issue.title !== "string" ||
    typeof issue.state !== "string" ||
    typeof issue.htmlUrl !== "string" ||
    typeof issue.updatedAt !== "string" ||
    typeof issue.createdAt !== "string"
  ) {
    return null;
  }
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: typeof issue.body === "string" || issue.body === null ? issue.body : null,
    labels: Array.isArray(issue.labels) ? issue.labels.filter((label): label is string => typeof label === "string") : [],
    assignees: Array.isArray(issue.assignees)
      ? issue.assignees.filter((assignee): assignee is string => typeof assignee === "string")
      : [],
    htmlUrl: issue.htmlUrl,
    updatedAt: issue.updatedAt,
    createdAt: issue.createdAt,
  };
}

function writeGitHubTimelineIssueCache(
  cache: GitHubTimelineIssueCache,
  entries: readonly (readonly [string, GitHubIssue[]])[],
  since: string,
) {
  const next: GitHubTimelineIssueCache = { ...cache };
  const fetchedAt = Date.now();
  for (const [repoFullName, issues] of entries) {
    const entry = {
      repoFullName,
      since,
      fetchedAt,
      issues: issues.map(cloneGitHubIssue),
    };
    next[repoFullName] = entry;
    cache[repoFullName] = entry;
  }
  try {
    localStorage.setItem(GITHUB_TIMELINE_ISSUE_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / privacy mode errors */
  }
}

function clearGitHubTimelineIssueCache() {
  githubIssuesByRepo.value = {};
  clearHomeGitHubOverviewSnapshot();
  try {
    localStorage.removeItem(GITHUB_TIMELINE_ISSUE_CACHE_KEY);
  } catch {
    /* ignore storage errors */
  }
}

function clearGitHubTimelinePullRequests() {
  githubPullRequestsByRepo.value = {};
  githubPullRequestChecksByRepo.value = {};
  clearHomeGitHubOverviewSnapshot();
}

function clearGitHubTimelineWorkflowRuns() {
  githubWorkflowRunsByRepo.value = {};
  clearHomeGitHubOverviewSnapshot();
}

function clearGitHubTimelineReleases() {
  githubReleasesByRepo.value = {};
  clearHomeGitHubOverviewSnapshot();
}

function prepareGitHubTimeline(repos: GitHubRepoSummary[], refresh = false) {
  const timelineRepos = repos.filter(repoIncludedInHomeTimeline);
  loadGitHubTimelineIssues(timelineRepos, refresh);
  loadGitHubTimelinePullRequests(timelineRepos, refresh);
  loadGitHubTimelineWorkflowRuns(timelineRepos, refresh);
  loadGitHubTimelineReleases(timelineRepos, refresh);
  if (githubTimelineActivated.value) {
    drainGitHubTimelineQueues();
    return;
  }
  scheduleGitHubTimelineActivation();
}

function repoIncludedInHomeTimeline(repo: GitHubRepoSummary) {
  if (repo.disabled) return false;
  const localRepo = localRepoByGitHubFullName.value.get(repo.fullName) ?? null;
  return !localRepo || repoCalculatesHomeTimeline(workspace.state.settings, localRepo.id);
}

function enqueueGitHubTimelineIssueRepos(
  repos: GitHubRepoSummary[],
  since: string,
  cache: GitHubTimelineIssueCache,
) {
  githubTimelineIssueTasks.enqueue(repos.map((repo) => ({
    repo,
    generation: githubTimelineGeneration,
    since,
    cache,
  })));
}

function enqueueGitHubTimelinePullRequestRepos(
  repos: GitHubRepoSummary[],
  since: string,
) {
  githubTimelinePullRequestTasks.enqueue(repos.map((repo) => ({
    repo,
    generation: githubTimelineGeneration,
    since,
  })));
}

function enqueueGitHubTimelineWorkflowRepos(repos: GitHubRepoSummary[]) {
  githubTimelineWorkflowTasks.enqueue(repos.map((repo) => ({
    repo,
    generation: githubTimelineGeneration,
  })));
}

function enqueueGitHubTimelineReleaseRepos(repos: GitHubRepoSummary[]) {
  githubTimelineReleaseTasks.enqueue(repos.map((repo) => ({
    repo,
    generation: githubTimelineGeneration,
  })));
}

async function processGitHubTimelinePullRequestTask(task: GitHubTimelinePullRequestTask) {
  const [repoFullName, pullRequests, checksByPull] = await fetchGitHubTimelinePullRequests(task.repo, task.since);
  if (task.generation !== githubTimelineGeneration) return;
  githubPullRequestsByRepo.value = {
    ...githubPullRequestsByRepo.value,
    [repoFullName]: pullRequests,
  };
  githubPullRequestChecksByRepo.value = {
    ...githubPullRequestChecksByRepo.value,
    [repoFullName]: checksByPull,
  };
  writeGitHubOverviewSnapshot();
}

async function processGitHubTimelineIssueTask(task: GitHubTimelineIssueTask) {
  const [repoFullName, issues] = await fetchGitHubTimelineIssues(task.repo, task.since);
  if (task.generation !== githubTimelineGeneration) return;
  githubIssuesByRepo.value = {
    ...githubIssuesByRepo.value,
    [repoFullName]: issues,
  };
  writeGitHubOverviewSnapshot();
  writeGitHubTimelineIssueCache(task.cache, [[repoFullName, issues]], task.since);
}

async function processGitHubTimelineWorkflowTask(task: GitHubTimelineWorkflowTask) {
  const [repoFullName, runs] = await fetchGitHubTimelineWorkflowRuns(task.repo);
  if (task.generation !== githubTimelineGeneration) return;
  githubWorkflowRunsByRepo.value = {
    ...githubWorkflowRunsByRepo.value,
    [repoFullName]: runs,
  };
  writeGitHubOverviewSnapshot();
}

async function processGitHubTimelineReleaseTask(task: GitHubTimelineReleaseTask) {
  const [repoFullName, releases] = await fetchGitHubTimelineReleases(task.repo);
  if (task.generation !== githubTimelineGeneration) return;
  githubReleasesByRepo.value = {
    ...githubReleasesByRepo.value,
    [repoFullName]: releases,
  };
  writeGitHubOverviewSnapshot();
}

function drainGitHubTimelineQueues() {
  githubTimelineIssueTasks.drain();
  githubTimelinePullRequestTasks.drain();
  githubTimelineWorkflowTasks.drain();
  githubTimelineReleaseTasks.drain();
}

function scheduleGitHubTimelineActivation() {
  if (githubTimelineActivated.value || githubTimelineActivationQueued) return;
  if (
    !githubIssuesPendingCount.value &&
    !githubPullRequestsPendingCount.value &&
    !githubWorkflowRunsPendingCount.value &&
    !githubReleasesPendingCount.value
  ) return;
  githubTimelineActivationQueued = true;
  void nextTick(() => {
    githubTimelineActivationQueued = false;
    if (githubTimelineActivated.value) return;
    if (
      !githubIssuesPendingCount.value &&
      !githubPullRequestsPendingCount.value &&
      !githubWorkflowRunsPendingCount.value &&
      !githubReleasesPendingCount.value
    ) return;
    if (typeof window === "undefined" || typeof document === "undefined") {
      activateGitHubTimeline();
      return;
    }
    clearGitHubTimelineActivationHooks();
    const card = githubTimelineCard.value;
    const scrollRoot = document.querySelector(".shell__main");
    const hasVisibilityObserver = typeof IntersectionObserver === "function" && card && scrollRoot instanceof Element;
    if (hasVisibilityObserver) {
      githubTimelineObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        activateGitHubTimeline();
      }, {
        root: scrollRoot,
      });
      githubTimelineObserver.observe(card);
    }
    const idleWindow = window as IdleRequestWindow;
    if (typeof idleWindow.requestIdleCallback === "function") {
      githubTimelineIdleHandle = idleWindow.requestIdleCallback(() => activateGitHubTimeline());
      return;
    }
    if (!hasVisibilityObserver) {
      queueMicrotask(() => activateGitHubTimeline());
      return;
    }
    githubTimelineIdleFallbackTimer = window.setTimeout(() => activateGitHubTimeline(), 0);
  });
}

function activateGitHubTimeline() {
  clearGitHubTimelineActivationHooks();
  githubTimelineActivated.value = true;
  drainGitHubTimelineQueues();
}

function clearGitHubTimelineActivationHooks() {
  githubTimelineObserver?.disconnect();
  githubTimelineObserver = null;
  const idleWindow = typeof window === "undefined" ? null : window as IdleRequestWindow;
  if (idleWindow && githubTimelineIdleHandle != null && typeof idleWindow.cancelIdleCallback === "function") {
    idleWindow.cancelIdleCallback(githubTimelineIdleHandle);
  }
  githubTimelineIdleHandle = null;
  if (typeof window !== "undefined" && githubTimelineIdleFallbackTimer != null) {
    window.clearTimeout(githubTimelineIdleFallbackTimer);
  }
  githubTimelineIdleFallbackTimer = null;
}

function resetGitHubTimelineQueues() {
  githubTimelineIssueTasks.reset();
  githubTimelinePullRequestTasks.reset();
  githubTimelineWorkflowTasks.reset();
  githubTimelineReleaseTasks.reset();
}

async function loadGitHubRepoStatus(options: { force?: boolean } = {}) {
  if (!workspace.isReady.value || githubReposLoading.value) return;
  githubRepoMoreLoader.invalidate();
  githubReposLoadingMore.value = false;
  await githubRepoStatusLoader.run(options.force ? "overview-repos:force" : "overview-repos", async (runId) => {
    githubReposLoading.value = true;
    githubReposError.value = null;
    try {
      const page = await preloadGitHubRepos({ force: options.force });
      if (!githubRepoStatusLoader.isCurrent(runId) || !workspace.isReady.value) return;
      applyGitHubRepoPage(page, false, options.force);
    } catch (err) {
      if (!githubRepoStatusLoader.isCurrent(runId) || !workspace.isReady.value) return;
      githubRepos.value = [];
      githubReposNextPage.value = null;
      githubReposError.value = githubRepoLoadErrorMessage(err);
    } finally {
      if (githubRepoStatusLoader.isCurrent(runId)) {
        githubReposLoading.value = false;
      }
    }
  });
}

async function loadMoreGitHubRepos() {
  const pageNumber = githubReposNextPage.value;
  if (!pageNumber || githubReposLoading.value || githubReposLoadingMore.value) return;
  await githubRepoMoreLoader.run(`overview-repos-more:${pageNumber}`, async (runId) => {
    githubReposLoadingMore.value = true;
    githubReposError.value = null;
    try {
      const page = await listGitHubRepos(pageNumber);
      if (!githubRepoMoreLoader.isCurrent(runId) || githubReposNextPage.value !== pageNumber) return;
      applyGitHubRepoPage(page, true);
    } catch (err) {
      if (!githubRepoMoreLoader.isCurrent(runId)) return;
      githubReposError.value = githubRepoLoadErrorMessage(err);
    } finally {
      if (githubRepoMoreLoader.isCurrent(runId)) {
        githubReposLoadingMore.value = false;
      }
    }
  });
}

function showMoreRepoStatusRows() {
  repoStatusVisibleCount.value += REPO_STATUS_RENDER_PAGE_SIZE;
}

function repoAction(repo: RepoSummary): RepoAction | null {
  if (repo.conflictCount > 0) {
    return {
      kind: "link",
      label: "查看变更",
      title: `${repo.conflictCount} 个冲突待处理，冲突解决功能将重新设计`,
      to: repoDetailPath(repo, "conflicts"),
    };
  }
  if (repo.behind > 0) {
    return {
      kind: "sync",
      label: "待同步",
      title: `远端领先 ${repo.behind} 个提交`,
    };
  }
  return null;
}

function focusedWorkflowRun(runs: readonly GitHubWorkflowRun[]): WorkflowRunOverview | null {
  return runs
    .map(workflowRunOverview)
    .sort((a, b) =>
      b.priority - a.priority ||
      parseGitHubTime(b.run.updatedAt) - parseGitHubTime(a.run.updatedAt) ||
      b.run.id - a.run.id,
    )[0] ?? null;
}

function workflowRunOverview(run: GitHubWorkflowRun): WorkflowRunOverview {
  const tone = workflowRunStatusTone(run);
  return {
    run,
    status: workflowRunStatusText(run),
    detail: `${run.name} · ${run.branch}`,
    tone,
    priority: tone === "error" ? 3 : tone === "warn" ? 2 : tone === "ok" ? 0 : 1,
  };
}

function pullRequestStatusText(pullRequest: GitHubPullRequest) {
  if (pullRequest.merged) return "已合并";
  if (pullRequest.draft) return "草稿";
  if (pullRequest.state === "closed") return "已关闭";
  return "打开";
}

function pullRequestChecksOverview(checks: readonly GitHubPullRequestCheck[]): { detail: string; tone?: WorkflowRunTone } {
  if (!checks.length) return { detail: "无 checks", tone: "muted" };
  const pending = checks.filter((check) => check.status !== "completed");
  if (pending.length) {
    return { detail: `Checks 运行中：${formatCheckNames(pending)}`, tone: "warn" };
  }
  const failed = checks.filter((check) => !isSuccessfulPullRequestCheck(check));
  if (failed.length) {
    return { detail: `Checks 失败：${formatCheckNames(failed)}`, tone: "error" };
  }
  return { detail: `Checks 通过：${checks.length} 项`, tone: "ok" };
}

function isSuccessfulPullRequestCheck(check: GitHubPullRequestCheck) {
  return check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped";
}

function formatCheckNames(checks: readonly GitHubPullRequestCheck[]) {
  const names = checks.map((check) => check.name).filter(Boolean).slice(0, 2);
  const suffix = checks.length > names.length ? ` 等 ${checks.length} 项` : "";
  return `${names.join("、") || `${checks.length} 项`}${suffix}`;
}

function releaseStatusText(release: GitHubRelease) {
  if (release.draft) return "草稿";
  if (release.prerelease) return "预发布";
  return "正式发布";
}

function releaseSummary(repoFullName: string, release: GitHubRelease) {
  const parts = [repoFullName, releaseStatusText(release)];
  if (release.assets.length > 0) parts.push(`${release.assets.length} 个附件`);
  return parts.join(" · ");
}

function buildGitHubTimelineEvents(row: GitHubTimelineRepoSource): GitHubTimelineEvent[] {
  const { githubRepo, localRepo } = row;
  const events: GitHubTimelineEvent[] = [];
  addTimelineEvent(events, {
    id: `repo-created:${githubRepo.fullName}`,
    kind: "repo",
    title: "创建仓库",
    detail: githubRepo.fullName,
    summary: githubRepo.private ? "私有 GitHub 仓库" : "公开 GitHub 仓库",
    timestamp: parseGitHubTime(githubRepo.createdAt),
    href: githubRepo.htmlUrl,
  });

  if (localRepo?.lastCommitAt) {
    addTimelineEvent(events, {
      id: `commit:${localRepo.id}:${localRepo.lastCommitAt}`,
      kind: "commit",
      title: "提交",
      detail: localRepo.lastCommitMessage ?? "最近一次本地提交",
      summary: githubRepo.fullName,
      timestamp: localRepo.lastCommitAt * 1000,
      href: repoDetailPath(localRepo),
    });
  }

  const syncError = localRepo ? syncErrorDetails.value.get(localRepo.id) : null;
  if (localRepo && syncError) {
    addTimelineEvent(events, {
      id: `operation-sync-error:${localRepo.id}`,
      kind: "operation",
      title: "仓库操作失败",
      detail: syncError.message,
      summary: githubRepo.fullName,
      timestamp: syncError.updatedAt,
      href: repoDetailPath(localRepo),
    });
  }

  const repoActionError = localRepo ? repoActionErrorDetailForRepo(localRepo.id) : null;
  if (localRepo && repoActionError) {
    addTimelineEvent(events, {
      id: `operation-error:${localRepo.id}`,
      kind: "operation",
      title: "仓库操作失败",
      detail: repoActionError.message,
      summary: githubRepo.fullName,
      timestamp: repoActionError.updatedAt,
      href: repoDetailPath(localRepo),
    });
  }

  if (localRepo && (localRepo.ahead > 0 || localRepo.behind > 0)) {
    addTimelineEvent(events, {
      id: `operation-sync-state:${localRepo.id}:${localRepo.ahead}:${localRepo.behind}`,
      kind: "operation",
      title: "仓库同步状态",
      detail: `待处理提交 ↑${localRepo.ahead} / ↓${localRepo.behind}`,
      summary: githubRepo.fullName,
      timestamp: parseGitHubTime(githubRepo.updatedAt),
      href: repoDetailPath(localRepo),
    });
  }

  for (const issue of githubIssuesByRepo.value[githubRepo.fullName] ?? []) {
    const href = localRepo
      ? repoProjectPath(localRepo, "issues", issue.number)
      : remoteRepoProjectPath(githubRepo, "issues", issue.number);
    addTimelineEvent(events, {
      id: `issue-created:${githubRepo.fullName}:${issue.number}`,
      kind: "issue",
      title: `Issue #${issue.number}`,
      detail: issue.title,
      summary: githubRepo.fullName,
      timestamp: parseGitHubTime(issue.updatedAt),
      href,
    });
  }

  for (const pullRequest of githubPullRequestsByRepo.value[githubRepo.fullName] ?? []) {
    const href = localRepo
      ? repoProjectPath(localRepo, "pulls", pullRequest.number)
      : remoteRepoProjectPath(githubRepo, "pulls", pullRequest.number);
    const checksOverview = pullRequestChecksOverview(
      githubPullRequestChecksByRepo.value[githubRepo.fullName]?.[pullRequest.number] ?? [],
    );
    addTimelineEvent(events, {
      id: `pull-request:${githubRepo.fullName}:${pullRequest.number}`,
      kind: "pull",
      title: `PR #${pullRequest.number}`,
      detail: pullRequest.title,
      summary: `${githubRepo.fullName} · ${pullRequestStatusText(pullRequest)} · ${checksOverview.detail}`,
      timestamp: parseGitHubTime(pullRequest.updatedAt),
      href,
      tone: checksOverview.tone,
    });
  }

  for (const run of githubWorkflowRunsByRepo.value[githubRepo.fullName] ?? []) {
    const overview = workflowRunOverview(run);
    const href = localRepo
      ? repoProjectPath(localRepo, "actions", run.id)
      : remoteRepoProjectPath(githubRepo, "actions", run.id);
    addTimelineEvent(events, {
      id: `workflow:${githubRepo.fullName}:${run.id}`,
      kind: "workflow",
      title: overview.status,
      detail: run.displayTitle,
      summary: `${githubRepo.fullName} · ${overview.detail} · ${run.event}`,
      timestamp: parseGitHubTime(run.updatedAt),
      href,
      tone: overview.tone,
    });
  }

  for (const release of githubReleasesByRepo.value[githubRepo.fullName] ?? []) {
    const href = localRepo
      ? repoProjectPath(localRepo, "release", null, release.tagName)
      : remoteRepoProjectPath(githubRepo, "release", null, release.tagName);
    addTimelineEvent(events, {
      id: `release:${githubRepo.fullName}:${release.id}`,
      kind: "release",
      title: `Release ${release.tagName}`,
      detail: release.name?.trim() || release.tagName,
      summary: releaseSummary(githubRepo.fullName, release),
      timestamp: parseGitHubTime(release.publishedAt ?? release.createdAt),
      href,
    });
  }

  return events;
}

function addTimelineEvent(events: GitHubTimelineEvent[], event: GitHubTimelineEvent) {
  if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) return;
  events.push(event);
}

function toGitHubTimelineDisplayNode(event: GitHubTimelineEvent): TimelineDisplayNode {
  return {
    id: event.id,
    icon: gitHubTimelineEventIcon(event.kind),
    title: event.title,
    detail: event.detail,
    summary: event.summary,
    timestamp: event.timestamp,
    link: timelineNodeLink(event.href),
    tone: event.tone,
  };
}

function gitHubTimelineEventIcon(kind: GitHubTimelineEvent["kind"]) {
  if (kind === "repo") return FolderGit2;
  if (kind === "commit") return GitCommitHorizontal;
  if (kind === "issue") return CircleDot;
  if (kind === "pull") return GitPullRequestArrow;
  if (kind === "workflow") return RotateCw;
  if (kind === "release") return Tag;
  return RefreshCw;
}

function timelineNodeLink(href: string | undefined): TimelineNodeLink {
  if (!href) return { kind: "none" };
  if (href.startsWith("http")) return { kind: "external", href };
  return { kind: "route", to: href };
}

function buildContributionWeeks(days: readonly GitHubContributionDay[]) {
  if (!days.length) return [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const maxCount = Math.max(1, ...sorted.map((day) => day.count));
  const start = parseDateOnly(sorted[0].date);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = parseDateOnly(sorted[sorted.length - 1].date);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
  const byDate = new Map(sorted.map((day) => [day.date, day]));
  const weeks: ContributionCell[][] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const week: ContributionCell[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(cursor);
      date.setUTCDate(cursor.getUTCDate() + offset);
      const key = date.toISOString().slice(0, 10);
      const day = byDate.get(key) ?? { date: key, count: 0 };
      week.push({
        ...day,
        level: contributionLevel(day.count, maxCount),
        weekStart: cursor.toISOString().slice(0, 10),
      });
    }
    weeks.push(week);
  }
  return weeks;
}

function buildContributionMonthLabels(
  weeks: readonly ContributionCell[][],
  days: readonly GitHubContributionDay[],
): ContributionMonthLabel[] {
  let lastMonth = "";
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const start = sortedDays[0]?.date ?? "";
  const end = sortedDays[sortedDays.length - 1]?.date ?? "";
  const isInRange = (date: string) => start !== "" && date >= start && date <= end;
  return weeks.map((week, index) => {
    const weekStart = week[0]?.weekStart ?? String(index);
    const month = week
      .filter((day) => isInRange(day.date))
      .map((day) => day.date.slice(0, 7))
      .find((value) => value && value !== lastMonth) ?? "";
    const label = month && month !== lastMonth ? formatContributionMonth(month) : "";
    if (month) lastMonth = month;
    return {
      key: weekStart,
      label,
    };
  });
}

function formatContributionMonth(month: string) {
  const [, rawMonth] = month.split("-");
  return `${Number(rawMonth)}月`;
}

function parseDateOnly(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function contributionLevel(count: number, maxCount: number) {
  if (count <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
}

function contributionTitle(day: GitHubContributionDay) {
  const lines = [`${day.date}：${day.count} 次提交`];
  for (const repo of day.repositories ?? []) {
    const label = repo.repoFullName || repo.repoName || repo.repoId;
    lines.push(`${label}：${repo.count} 次`);
  }
  return lines.join("\n");
}

function parseGitHubTime(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatTimelineTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function toggleSearch() {
  void shellActions?.toggleSearch();
}

function repoGroupMenuItems(idPrefix: string, onSelect: (groupId: string | null) => void): ContextMenuItem[] {
  return [
    {
      id: `${idPrefix}-ungrouped`,
      label: "未分组仓库",
      icon: FolderGit2,
      onSelect: () => onSelect(null),
    },
    ...repoGroups.value.map((group) => ({
      id: `${idPrefix}-${group.id}`,
      label: group.name,
      icon: FolderInput,
      onSelect: () => onSelect(group.id),
    })),
  ];
}

function openCreateRepoCard(mode: "local" | "remote", groupId: string | null) {
  createRepoCardMode.value = mode;
  pendingCreatedRepoGroupId.value = groupId;
  createRepoCardOpen.value = true;
}

function openCloneRepoDialog(groupId: string | null) {
  pendingCreatedRepoGroupId.value = groupId;
  void cloneDialog.openDialog();
}

function closeCreateRepoCard() {
  createRepoCardOpen.value = false;
}

function createRepoMenuItems(): ContextMenuItem[] {
  return [
    {
      id: "home-clone-repo",
      label: "克隆仓库",
      icon: CloudDownload,
      disabled: !workspace.workspaceRoot.value,
      children: repoGroupMenuItems("home-clone-repo", openCloneRepoDialog),
    },
    {
      id: "home-create-local-repo",
      label: "创建本地仓库",
      icon: FolderGit2,
      disabled: !workspace.workspaceRoot.value,
      children: repoGroupMenuItems("home-create-local-repo", (groupId) => openCreateRepoCard("local", groupId)),
    },
    {
      id: "home-create-remote-repo",
      label: "创建远程仓库",
      icon: GitBranchPlus,
      disabled: !workspace.workspaceRoot.value || !workspace.isAuthorized.value,
      children: repoGroupMenuItems("home-create-remote-repo", (groupId) => openCreateRepoCard("remote", groupId)),
    },
  ];
}

function openCreateRepoMenu(event: MouseEvent) {
  const button = event.currentTarget as HTMLElement | null;
  const rect = button?.getBoundingClientRect();
  openContextMenuAt(
    rect?.left ?? event.clientX,
    (rect?.bottom ?? event.clientY) + 4,
    createRepoMenuItems(),
  );
}

async function placeCreatedRepo(repo: RepoSummary) {
  const groupId = pendingCreatedRepoGroupId.value;
  if (groupId) {
    await workspace.moveRepoToGroup(repo.id, groupId);
  }
  await router.push(repoRoute(repo.id));
}

async function discoverRepos() {
  if (discovering.value) return;
  discovering.value = true;
  try {
    await workspace.discoverRepos();
  } finally {
    discovering.value = false;
  }
}

async function refreshOverviewRepos() {
  void workspace.refreshRepos();
  await loadGitHubRepoStatus({ force: true });
}

async function cloneGitHubRepo(repo: GitHubRepoSummary) {
  if (cloningFullName.value) return;
  cloningFullName.value = repo.fullName;
  githubReposError.value = null;
  try {
    await workspace.cloneRepo(repo.cloneUrl, repo.name);
  } catch (err) {
    githubReposError.value = isGitHubBindingExpiredError(err)
      ? "GitHub 绑定已失效，请重新绑定后再克隆仓库。"
      : `克隆 ${repo.fullName} 失败：${String(err)}`;
  } finally {
    cloningFullName.value = null;
  }
}

async function openGitHubRepo(githubRepo: GitHubRepoSummary, localRepo: RepoSummary | null) {
  if (localRepo) {
    await router.push(repoDetailPath(localRepo));
    return;
  }
  await workspace.rememberRemoteRepo(shortcutFromGitHubRepo(githubRepo));
  await router.push(remoteRepoRoute(githubRepo.fullName));
}

function reposNeedingPullLocalChanges(repos = workspace.state.repos) {
  return repos.filter((repo) => repo.behind > 0 && repoLocalDirtyCount(repo) > 0);
}

async function syncRepo(repo: RepoSummary) {
  if (syncingRepoId.value) return;
  const localChangesMode = await requestPullLocalChangesMode("同步前处理本地修改", [repo]);
  if (!localChangesMode) return;
  syncingRepoId.value = repo.id;
  try {
    await workspace.mergePull(repo.id, localChangesMode);
  } catch {
    /* action error is surfaced by workspace state */
  } finally {
    syncingRepoId.value = null;
  }
}

async function retryRepoPush(repo: RepoSummary) {
  if (syncingRepoId.value) return;
  syncingRepoId.value = repo.id;
  try {
    await workspace.push(repo.id);
  } catch {
    /* retry state is surfaced by recent sync status */
  } finally {
    syncingRepoId.value = null;
  }
}

async function previewBulkOperation(operation: BulkOperation) {
  const localChangesMode = operation === "push"
    ? "reject"
    : await requestPullLocalChangesMode(
        `${bulkOperationLabel(operation)}前处理本地修改`,
        reposNeedingPullLocalChanges(),
      );
  if (!localChangesMode) return;
  bulkLocalChangesMode.value = localChangesMode;
  void workspace.previewBulk(operation, localChangesMode);
}

async function runSyncAll() {
  const localChangesMode = await requestPullLocalChangesMode(
    "同步前处理本地修改",
    reposNeedingPullLocalChanges(),
  );
  if (!localChangesMode) return;
  bulkLocalChangesMode.value = localChangesMode;
  void workspace.syncAll(localChangesMode);
}

function executeBulkOperation() {
  void workspace.executeBulk(undefined, bulkLocalChangesMode.value);
}

function bulkOperationLabel(operation: BulkOperation) {
  if (operation === "pull") return "拉取";
  if (operation === "push") return "推送";
  return "同步";
}

function bulkOperationDescription(operation: BulkOperation) {
  if (operation === "pull") return "确认后逐仓库执行 pull 预检通过的项。";
  if (operation === "push") return "确认后逐仓库执行 push，错误不会中断后续仓库。";
  return "确认后逐仓库执行同步链路，错误不会中断后续仓库。";
}

</script>

<template>
  <section class="home-page" data-agent-id="home.page" :class="{ 'setup-page': !workspace.isReady.value }">
    <div v-if="!workspace.isReady.value" class="setup-screen" data-agent-id="setup.screen">
      <div class="page-header">
        <div>
          <h1>LiliaGithub 初始化</h1>
          <p>选择本地工作区并完成 GitHub 授权后进入仓库工作台。</p>
        </div>
      </div>

      <div class="setup-list">
        <div class="setup-step" :class="{ 'is-done': workspace.workspaceRoot.value }">
          <div class="setup-step__icon">
            <FolderOpen :size="18" aria-hidden="true" />
          </div>
          <div class="setup-step__content">
            <h2>工作区文件夹</h2>
            <p class="muted">
              {{ workspace.workspaceRoot.value ?? "尚未选择。本应用会扫描该文件夹下的 Git 仓库。" }}
            </p>
          </div>
          <div class="setup-step__action">
            <button
              type="button"
              class="primary"
              data-agent-id="setup.workspace.choose"
              @click="workspace.chooseWorkspaceRoot"
            >
              <FolderOpen :size="14" aria-hidden="true" />
              选择工作区
            </button>
          </div>
        </div>

        <div class="setup-step" :class="{ 'is-done': workspace.isAuthorized.value }">
          <div class="setup-step__icon">
            <ShieldCheck :size="18" aria-hidden="true" />
          </div>
          <div class="setup-step__content">
            <h2>GitHub 授权</h2>
            <p class="muted">
              <template v-if="workspace.githubBinding.value">
                已识别共享凭证：{{ workspace.githubBinding.value.login }}
              </template>
              <template v-else>
                复用 LiliaCode 的 GitHub 设备码授权和系统钥匙串凭证。
              </template>
            </p>
            <div v-if="workspace.deviceFlow.value" class="auth-flow">
              <p class="setup-code">
                设备码 <code>{{ workspace.deviceFlow.value.userCode }}</code>
              </p>
              <p v-if="workspace.state.authNotice" class="auth-flow__notice">
                {{ workspace.state.authNotice }}
              </p>
              <p
                class="auth-flow__status"
                :class="{
                  'is-error': workspace.state.authFlowStatus === 'error',
                  'is-expired': workspace.state.authFlowStatus === 'expired',
                }"
              >
                {{ workspace.authPendingStatusText.value }}
                <template v-if="workspace.authRemainingText.value">，剩余 {{ workspace.authRemainingText.value }}</template>
              </p>
            </div>
          </div>
          <div class="setup-step__action">
            <div class="setup-actions">
              <button
                type="button"
                class="primary"
                data-agent-id="setup.github.bind"
                :disabled="workspace.state.authLoading"
                @click="workspace.startAuthFlow"
              >
                <ShieldCheck :size="14" aria-hidden="true" />
                {{ workspace.deviceFlow.value ? "重新绑定 GitHub" : "绑定 GitHub" }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p v-if="workspace.state.error" class="error-line">{{ workspace.state.error }}</p>
    </div>

    <template v-else>
      <div class="page-header" data-agent-id="home.overview.header">
        <div>
          <div class="overview-title">
            <h1>项目总览</h1>
            <span v-if="workspace.workspaceRoot.value" :title="workspace.workspaceRoot.value">
              {{ workspace.workspaceRoot.value }}
            </span>
          </div>
        </div>
        <div class="overview-actions" aria-label="项目总览操作">
          <button
            type="button"
            class="overview-actions__btn"
            data-agent-id="home.overview.create-repo"
            title="创建仓库"
            aria-label="创建仓库"
            @click="openCreateRepoMenu"
          >
            <GitBranchPlus :size="17" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="overview-actions__btn"
            data-agent-id="home.overview.search"
            :class="{ 'is-active': searchOpen }"
            title="搜索"
            aria-label="搜索"
            :disabled="!workspace.state.repos.length"
            @click="toggleSearch"
          >
            <Search :size="17" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="overview-actions__btn"
            data-agent-id="home.overview.discover"
            title="发现仓库"
            aria-label="发现仓库"
            :disabled="!workspace.workspaceRoot.value || discovering"
            @click="discoverRepos"
          >
            <LoaderCircle v-if="discovering" :size="17" aria-hidden="true" class="sb-spin" />
            <Radar v-else :size="17" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="overview-actions__btn"
            data-agent-id="home.overview.refresh"
            title="刷新并抓取"
            aria-label="刷新并抓取"
            :disabled="!workspace.isReady.value || workspace.state.scanning || workspace.state.bulkRunning || githubReposLoading"
            @click="refreshOverviewRepos"
          >
            <RefreshCw :size="17" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="overview-actions__btn"
            data-agent-id="home.overview.bulk.pull"
            :class="{ 'is-running': workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'pull' }"
            title="批量拉取"
            aria-label="批量拉取"
            :disabled="!workspace.isReady.value || workspace.state.bulkRunning"
            @click="previewBulkOperation('pull')"
          >
            <LoaderCircle
              v-if="workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'pull'"
              :size="17"
              aria-hidden="true"
              class="sb-spin"
            />
            <CloudDownload v-else :size="17" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="overview-actions__btn"
            data-agent-id="home.overview.bulk.push"
            :class="{ 'is-running': workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'push' }"
            title="批量推送"
            aria-label="批量推送"
            :disabled="!workspace.isReady.value || workspace.state.bulkRunning"
            @click="previewBulkOperation('push')"
          >
            <LoaderCircle
              v-if="workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'push'"
              :size="17"
              aria-hidden="true"
              class="sb-spin"
            />
            <CloudUpload v-else :size="17" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="overview-actions__btn overview-actions__btn--primary"
            data-agent-id="home.overview.bulk.sync"
            :class="{ 'is-running': workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'sync' }"
            title="一键同步"
            aria-label="一键同步"
            :disabled="!workspace.isReady.value || workspace.state.bulkRunning"
            @click="runSyncAll"
          >
            <LoaderCircle
              v-if="workspace.state.bulkRunning && workspace.state.bulkPreview?.operation === 'sync'"
              :size="17"
              aria-hidden="true"
              class="sb-spin"
            />
            <GitPullRequestArrow v-else :size="17" aria-hidden="true" />
            <span>同步</span>
          </button>
        </div>
      </div>

      <div class="overview-grid">
        <div class="card contribution-card">
          <div class="card-heading">
            <div>
              <h2>
                最近工作结果
                <LoaderCircle
                  v-if="workspace.state.githubContributions.loading"
                  :size="13"
                  aria-hidden="true"
                  class="card-title-loader"
                />
              </h2>
              <p class="contribution-total">{{ totalContributions }} 次提交，最近一年</p>
              <p v-if="skippedContributionRepoCount > 0" class="contribution-notice">
                已跳过 {{ skippedContributionRepoCount }} 个不可读取仓库
              </p>
            </div>
            <button
              v-if="workspace.state.githubContributions.error"
              type="button"
              class="ghost contribution-retry"
              :disabled="workspace.state.githubContributions.loading"
              @click="workspace.refreshRepoContributions"
            >
              <RefreshCw :size="13" aria-hidden="true" />
              重试
            </button>
          </div>
          <p v-if="workspace.state.githubContributions.error" class="contribution-error">
            {{ workspace.state.githubContributions.error }}
          </p>
          <div
            v-if="workspace.state.githubContributions.loading && !hasContributionDays"
            class="contribution-loading"
            aria-label="本地提交加载中"
          >
            <span v-for="index in 84" :key="index" />
          </div>
          <p
            v-else-if="!workspace.state.githubContributions.loading && totalContributions <= 0 && !workspace.state.githubContributions.error"
            class="contribution-empty"
          >
            暂无本地提交
          </p>
          <div v-else class="contribution-chart" aria-label="本地提交贡献图">
            <div class="contribution-week-labels" aria-hidden="true">
              <span class="contribution-month-spacer" />
              <span />
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
              <span />
            </div>
            <div class="contribution-window">
              <div class="contribution-grid">
                <div class="contribution-months" aria-hidden="true">
                  <span
                    v-for="month in contributionMonthLabels"
                    :key="month.key"
                    class="contribution-month"
                  >
                    {{ month.label }}
                  </span>
                </div>
                <div class="contribution-weeks">
                  <div
                    v-for="(week, weekIndex) in contributionWeeks"
                    :key="weekIndex"
                    class="contribution-week"
                  >
                    <span
                      v-for="day in week"
                      :key="day.date"
                      class="contribution-day"
                      :class="`contribution-day--${day.level}`"
                      :title="contributionTitle(day)"
                      :aria-label="contributionTitle(day)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card language-card">
          <div class="card-heading">
            <div>
              <h2>编程语言占比</h2>
              <p class="language-total">{{ formatBytes(activeCodeOverview.totalBytes) }} 代码量</p>
            </div>
            <div class="language-actions">
              <div class="language-tabs" aria-label="代码占比模式">
                <button
                  type="button"
                  data-agent-id="home.language.mode.language"
                  :class="{ 'is-active': languageChartMode === 'language' }"
                  @click="languageChartMode = 'language'"
                >
                  按编程语言
                </button>
                <button
                  type="button"
                  data-agent-id="home.language.mode.project"
                  :class="{ 'is-active': languageChartMode === 'project' }"
                  @click="languageChartMode = 'project'"
                >
                  按项目
                </button>
              </div>
            </div>
          </div>
          <p v-if="!activeCodeOverview.slices.length" class="language-empty">暂无语言数据</p>
          <div v-else class="language-chart" aria-label="编程语言占比图">
            <svg
              class="language-pie"
              viewBox="0 0 42 42"
              role="img"
              aria-label="编程语言占比饼图"
            >
              <circle class="language-pie__track" cx="21" cy="21" r="15.9155" />
              <circle
                v-for="slice in activeCodeOverview.slices"
                :key="slice.key"
                class="language-pie__slice"
                cx="21"
                cy="21"
                r="15.9155"
                :stroke="slice.color"
                :stroke-dasharray="`${slice.percent} ${100 - slice.percent}`"
                :stroke-dashoffset="-slice.offset"
              >
                <title>{{ slice.title }}</title>
              </circle>
            </svg>
            <ul class="language-list">
              <li v-for="slice in activeCodeOverview.slices" :key="slice.key">
                <RouterLink
                  v-if="slice.to"
                  class="language-list__link"
                  :data-agent-id="`home.language.slice.${slice.key}`"
                  :to="slice.to"
                  :title="slice.linkTitle"
                >
                  <span class="language-dot" :style="{ background: slice.color }" aria-hidden="true" />
                  <span class="language-name">{{ slice.label }}</span>
                  <strong>{{ formatPercent(slice.percent) }}</strong>
                </RouterLink>
                <span v-else class="language-list__link language-list__link--static" :title="slice.linkTitle">
                  <span class="language-dot" :style="{ background: slice.color }" aria-hidden="true" />
                  <span class="language-name">{{ slice.label }}</span>
                  <strong>{{ formatPercent(slice.percent) }}</strong>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div class="repo-overview-grid">
        <div ref="githubTimelineCard" class="card github-timeline-card">
          <div class="repo-status-heading">
            <h2>
              GitHub 时间线
              <LoaderCircle
                v-if="githubTimelineBusy"
                :size="13"
                aria-hidden="true"
                class="card-title-loader"
              />
            </h2>
          </div>
          <div class="home-scroll-card__body">
            <p
              v-if="githubTimelineBusy && !githubTimelineNodes.length"
              class="repo-status-empty"
            >
              {{ githubTimelineWaitingForActivation ? "正在准备 GitHub 时间线..." : "正在加载 GitHub 时间线..." }}
            </p>
            <p v-else-if="!githubTimelineNodes.length" class="repo-status-empty">暂无 GitHub 事件</p>
            <GitHubTimelineList v-else :nodes="githubTimelineNodes" :format-time="formatTimelineTime" />
          </div>
        </div>

        <div class="card repo-status-card">
          <div class="repo-status-heading">
            <h2>
              仓库状态
              <LoaderCircle v-if="githubReposLoading" :size="13" aria-hidden="true" class="card-title-loader" />
            </h2>
            <span>{{ repoStatusRows.length }} 个 GitHub 项目</span>
          </div>
          <p v-if="githubReposError" class="repo-status-error">
            {{ githubReposError }}
            <button type="button" class="ghost" :disabled="githubReposLoading" @click="loadGitHubRepoStatus({ force: true })">
              重试
            </button>
          </p>
          <div class="home-scroll-card__body">
            <div class="repo-status-list" aria-label="仓库状态列表">
              <p v-if="githubReposLoading && !repoStatusRows.length" class="repo-status-empty">正在加载 GitHub 项目...</p>
              <div
                v-for="{ githubRepo, localRepo, action, syncIssue, workflowRun } in visibleRepoStatusRows"
                :key="githubRepo.fullName"
                class="repo-status-row"
                :class="{ 'is-cloned': localRepo }"
                role="link"
                tabindex="0"
                :data-agent-id="`home.repo-status.${githubRepo.fullName}`"
                :aria-label="`打开 ${githubRepo.fullName}`"
                :title="localRepo ? localRepo.path : githubRepo.htmlUrl"
                @click="openGitHubRepo(githubRepo, localRepo)"
                @keydown.enter.prevent="openGitHubRepo(githubRepo, localRepo)"
                @keydown.space.prevent="openGitHubRepo(githubRepo, localRepo)"
              >
                <span class="repo-status-row__identity">
                  <strong class="repo-status-row__name">
                    {{ githubRepo.fullName }}
                  </strong>
                  <span
                    v-if="workflowRun"
                    class="repo-action-icon"
                    :class="`repo-action-icon--${workflowRun.tone}`"
                    :title="`${workflowRun.status} · ${workflowRun.run.displayTitle} · ${workflowRun.detail}`"
                    :aria-label="workflowRun.status"
                  >
                    <X v-if="workflowRun.tone === 'error'" :size="14" aria-hidden="true" />
                    <CircleDot v-else :size="14" aria-hidden="true" />
                  </span>
                  <span v-if="githubRepo.archived" class="repo-status-row__badge repo-status-row__badge--archived">Archive</span>
                  <span v-if="githubRepo.private" class="repo-status-row__badge">私有</span>
                  <span
                    v-if="syncIssue"
                    class="repo-status-row__issue"
                    :class="`repo-status-row__issue--${syncIssue.retryable ? 'error' : 'warn'}`"
                    :title="syncIssue.message"
                    :aria-label="syncIssue.label"
                  >
                    <AlertCircle :size="13" aria-hidden="true" />
                    <span>{{ syncIssue.label }}：{{ syncIssue.message }}</span>
                  </span>
                </span>
                <span class="repo-status-row__action">
                  <template v-if="localRepo">
                    <button
                      v-if="syncIssue?.retryable"
                      type="button"
                      class="repo-action-link repo-action-link--warn"
                      :data-agent-id="`home.repo-status.${githubRepo.fullName}.retry`"
                      :disabled="workspace.state.bulkRunning || syncingRepoId === localRepo.id || syncIssue.retrying"
                      :title="syncIssue.message"
                      @click.stop="retryRepoPush(localRepo)"
                    >
                      <LoaderCircle
                        v-if="syncingRepoId === localRepo.id || syncIssue.retrying"
                        :size="11"
                        aria-hidden="true"
                        class="sb-spin"
                      />
                      重试
                    </button>
                    <template v-else-if="!syncIssue && action">
                      <RouterLink
                        v-if="action.kind !== 'sync'"
                        class="repo-action-link repo-action-link--warn"
                        :data-agent-id="`home.repo-status.${githubRepo.fullName}.action.${action.kind}`"
                        :to="action.to"
                        :title="action.title"
                        @click.stop
                      >
                        {{ action.label }}
                      </RouterLink>
                      <button
                        v-else
                        type="button"
                        class="repo-action-link repo-action-link--warn"
                        :data-agent-id="`home.repo-status.${githubRepo.fullName}.action.sync`"
                        :disabled="workspace.state.bulkRunning || syncingRepoId === localRepo.id"
                        :title="action.title"
                        @click.stop="syncRepo(localRepo)"
                      >
                        <LoaderCircle
                          v-if="syncingRepoId === localRepo.id"
                          :size="11"
                          aria-hidden="true"
                          class="sb-spin"
                        />
                        {{ action.label }}
                      </button>
                    </template>
                    <span v-else-if="!syncIssue" class="repo-action-status repo-action-status--muted">已 clone</span>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="repo-action-link"
                    :data-agent-id="`home.repo-status.${githubRepo.fullName}.clone`"
                    :disabled="Boolean(cloningFullName)"
                    @click.stop="cloneGitHubRepo(githubRepo)"
                  >
                    <LoaderCircle
                      v-if="cloningFullName === githubRepo.fullName"
                      :size="13"
                      aria-hidden="true"
                      class="sb-spin"
                    />
                    clone
                  </button>
                </span>
              </div>
              <button
                v-if="hiddenRepoStatusRowCount > 0"
                type="button"
                class="repo-status-more"
                data-agent-id="home.repo-status.show-more"
                @click="showMoreRepoStatusRows"
              >
                显示更多 {{ hiddenRepoStatusRowCount }} 个
              </button>
              <button
                v-else-if="githubReposNextPage"
                type="button"
                class="repo-status-more"
                data-agent-id="home.repo-status.load-more"
                :disabled="githubReposLoadingMore"
                @click="loadMoreGitHubRepos"
              >
                <LoaderCircle v-if="githubReposLoadingMore" :size="13" aria-hidden="true" class="sb-spin" />
                加载更多
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div
      v-if="workspace.state.bulkPreview && workspace.state.bulkPreview.operation !== 'sync'"
      class="modal-backdrop"
      role="presentation"
    >
      <div class="modal" role="dialog" aria-modal="true" aria-label="批量同步预检">
        <div class="modal__header">
          <div>
            <h2>{{ bulkOperationLabel(workspace.state.bulkPreview.operation) }}预检</h2>
            <p class="muted">{{ bulkOperationDescription(workspace.state.bulkPreview.operation) }}</p>
          </div>
          <button type="button" class="ghost" aria-label="关闭" @click="workspace.closeBulkPreview">
            <X :size="14" aria-hidden="true" />
          </button>
        </div>

        <div class="sync-columns">
          <div>
            <h3>可执行</h3>
            <p v-if="!workspace.state.bulkPreview.eligible.length" class="muted">没有可执行仓库。</p>
            <ul>
              <li v-for="item in workspace.state.bulkPreview.eligible" :key="item.repo.id">
                <CheckCircle2 :size="13" aria-hidden="true" />
                <span>{{ item.repo.name }}</span>
                <em>{{ item.reason }}</em>
              </li>
            </ul>
          </div>
          <div>
            <h3>阻止</h3>
            <p v-if="!workspace.state.bulkPreview.blocked.length" class="muted">没有阻止项。</p>
            <ul>
              <li v-for="item in workspace.state.bulkPreview.blocked" :key="item.repo.id">
                <X :size="13" aria-hidden="true" />
                <span>{{ item.repo.name }}</span>
                <em>{{ item.reason }}</em>
              </li>
            </ul>
          </div>
          <div>
            <h3>提示</h3>
            <p v-if="!workspace.state.bulkPreview.warnings.length" class="muted">没有提示项。</p>
            <ul>
              <li v-for="item in workspace.state.bulkPreview.warnings" :key="item.repo.id">
                <Info :size="13" aria-hidden="true" />
                <span>{{ item.repo.name }}</span>
                <em>{{ item.reason }}</em>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="workspace.state.bulkResults.length" class="sync-results">
          <h3>执行结果</h3>
          <ul>
            <li
              v-for="result in workspace.state.bulkResults"
              :key="result.repoId"
              :class="bulkResultTone(result)"
              class="sync-results__item"
            >
              <CheckCircle2 v-if="result.status === 'success'" :size="13" aria-hidden="true" />
              <AlertCircle v-else :size="13" aria-hidden="true" />
              <span>{{ result.repoId }}</span>
              <em>{{ result.message }}</em>
            </li>
          </ul>
        </div>

        <div class="modal__footer">
          <button type="button" class="ghost" @click="workspace.closeBulkPreview">取消</button>
          <button
            type="button"
            class="primary"
            :disabled="workspace.state.bulkRunning || !workspace.state.bulkPreview.eligible.length"
            @click="executeBulkOperation"
          >
            确认执行
          </button>
        </div>
      </div>
    </div>

    <RepoLocalChangesDialog
      :open="Boolean(pullLocalChangesDialog)"
      :title="pullLocalChangesDialog?.title ?? ''"
      :repo-name="pullLocalChangesDialog?.repoName ?? ''"
      :dirty-count="pullLocalChangesDialog?.dirtyCount ?? 0"
      @select="selectPullLocalChangesMode"
      @cancel="cancelPullLocalChangesDialog"
    />
    <RepoCreateCard
      :open="createRepoCardOpen"
      :mode="createRepoCardMode"
      :workspace-ready="Boolean(workspace.workspaceRoot.value)"
      :github-ready="workspace.isAuthorized.value"
      @close="closeCreateRepoCard"
      @local-created="placeCreatedRepo"
      @remote-cloned="placeCreatedRepo"
    />
    <HomeCloneDialog
      v-if="cloneDialog.open"
      v-bind="cloneDialog.props"
      v-on="cloneDialog.events"
    />
  </section>
</template>

<style scoped>
.home-page {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.home-page > .page-header {
  margin-bottom: 0;
}

.overview-grid {
  display: grid;
  gap: 12px;
  min-height: 0;
}

.setup-screen {
  width: min(920px, 100%);
  min-height: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.setup-page {
  display: flex;
  min-height: 0;
}

.setup-screen .page-header {
  margin-bottom: 24px;
}

.setup-list {
  border-top: 1px solid var(--border-soft);
  border-bottom: 1px solid var(--border-soft);
}

.overview-grid {
  grid-template-columns: 1.3fr 1fr;
}

.overview-grid > .card {
  margin-bottom: 0;
}

.setup-step {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 96px;
  padding: 18px 0;
  border-bottom: 1px solid var(--border-soft);
}

.setup-step:last-child {
  border-bottom: 0;
}

.setup-step__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.setup-step.is-done .setup-step__icon {
  background: var(--ok-soft);
  color: var(--ok);
}

.setup-step__content {
  min-width: 0;
}

.setup-step__content h2 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}

.setup-step__content p {
  margin: 0;
  overflow-wrap: anywhere;
}

.setup-step__action {
  display: flex;
  justify-content: flex-end;
}

.setup-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.overview-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.overview-title span {
  min-width: 0;
  max-width: min(52vw, 720px);
  overflow: hidden;
  color: var(--text-muted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setup-code,
.error-line {
  margin: 10px 0 0;
}

.auth-flow {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.auth-flow .setup-code {
  margin: 0;
}

.auth-flow__status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.auth-flow__notice {
  margin: 0;
  color: var(--accent);
  font-size: 12px;
}

.auth-flow__status.is-expired,
.auth-flow__status.is-error {
  color: var(--err);
}

.error-line {
  color: var(--err);
}

.contribution-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 760px;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.card-heading h2 {
  margin: 0;
}

.contribution-total {
  margin: 3px 0 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.contribution-notice {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.contribution-retry {
  height: 26px;
  padding: 0 7px;
  color: var(--ok);
}

.contribution-error,
.contribution-empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.contribution-error {
  color: var(--err);
  margin-bottom: 8px;
}

.contribution-chart {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  padding-bottom: 2px;
  min-width: 0;
}

.contribution-week-labels {
  display: grid;
  grid-template-rows: 14px repeat(7, 11px);
  gap: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 11px;
}

.contribution-month-spacer {
  height: 14px;
}

.contribution-window {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  overflow: hidden;
}

.contribution-grid {
  min-width: max-content;
}

.contribution-months,
.contribution-weeks {
  display: flex;
  gap: 3px;
  min-width: max-content;
}

.contribution-months {
  margin-bottom: 3px;
}

.contribution-month {
  width: 11px;
  height: 14px;
  overflow: visible;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
}

.contribution-week {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  gap: 3px;
}

.contribution-day {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, var(--bg) 20%, transparent);
  background: var(--bg-subtle);
}

.contribution-day--1 {
  background: color-mix(in srgb, var(--ok) 30%, var(--bg-subtle));
}

.contribution-day--2 {
  background: color-mix(in srgb, var(--ok) 55%, var(--bg-subtle));
}

.contribution-day--3 {
  background: color-mix(in srgb, var(--ok) 78%, var(--bg-subtle));
}

.contribution-day--4 {
  background: #3fb950;
}

.contribution-loading {
  display: grid;
  grid-template-columns: repeat(21, 11px);
  gap: 3px;
  min-height: 98px;
}

.contribution-loading span {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ok) 14%, var(--bg-subtle));
}

.language-card {
  min-width: 0;
}

.language-total {
  margin: 3px 0 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.language-tabs {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  background: var(--bg-subtle);
}

.language-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.language-tabs button {
  height: 24px;
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 24px;
  cursor: pointer;
}

.language-tabs button.is-active {
  background: var(--bg);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--border-soft);
}

.language-error,
.language-empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.language-error {
  color: var(--err);
}

.language-chart {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}

.language-pie {
  width: 132px;
  height: 132px;
  transform: rotate(-90deg);
}

.language-pie__track,
.language-pie__slice {
  fill: none;
  stroke-width: 10;
}

.language-pie__track {
  stroke: var(--bg-subtle);
}

.language-pie__slice {
  transition: stroke-dasharray 0.2s ease;
}

.language-list {
  list-style: none;
  padding: 0;
  margin: 0;
  min-width: 0;
  height: 132px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.language-list li {
  height: 18px;
  border-bottom: 1px solid var(--border-soft);
}

.language-list li:last-child {
  border-bottom: 0;
}

.language-list__link {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  color: var(--text);
  text-decoration: none;
  font-size: 12px;
  line-height: 16px;
}

.language-list__link:hover,
.language-list__link:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.language-list__link--static {
  cursor: default;
}

.language-list__link--static:hover,
.language-list__link--static:focus-visible {
  background: transparent;
}

.language-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.language-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.github-timeline-card,
.repo-status-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  margin-bottom: 0;
  padding-bottom: 10px;
}

.home-scroll-card__body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.repo-status-heading {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.repo-status-heading h2 {
  margin: 0;
}

.repo-status-heading span {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.repo-status-list {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.repo-status-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 10px;
}

.repo-status-row {
  min-height: 34px;
  min-height: 28px;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
}

.repo-status-row:hover {
  background: var(--bg-hover);
}

.repo-status-row:focus-visible {
  outline: 0;
  border-color: var(--border-strong);
  background: var(--bg-active);
}

.repo-status-row__identity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.repo-status-row__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.repo-status-row__badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.repo-status-row__badge--archived {
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.repo-status-row__issue {
  flex: 1 1 130px;
  min-width: 80px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
}

.repo-status-row__issue > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-status-row__issue--error {
  color: var(--err);
}

.repo-status-row__issue--warn {
  color: var(--warn);
}

.repo-status-row__action {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.repo-action-status {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.repo-action-status--muted {
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.repo-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  color: var(--text-muted);
}

.repo-action-icon--error {
  color: var(--err);
}

.repo-action-icon--warn {
  color: var(--warn);
}

.repo-action-icon--ok {
  color: var(--ok);
}

.repo-action-icon--muted {
  color: var(--text-muted);
}

.repo-action-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 6px;
  color: var(--text);
  background: var(--bg-subtle);
  text-decoration: none;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  white-space: nowrap;
}

.repo-status-row .repo-action-link .sb-spin {
  width: 11px;
  height: 11px;
}

.repo-action-link:hover,
.repo-action-link:focus-visible {
  background: var(--bg-hover);
}

.repo-action-link--warn {
  color: var(--warn);
  background: var(--warn-soft);
}

.repo-action-link--warn:hover,
.repo-action-link--warn:focus-visible {
  background: color-mix(in srgb, var(--warn-soft) 72%, var(--bg-hover));
}

.repo-action-link:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.repo-status-error,
.repo-status-empty {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.repo-status-error {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--err);
}

.repo-status-more {
  justify-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  margin-top: 6px;
  padding: 0 10px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-subtle);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.modal-backdrop {
  position: fixed;
  inset: 36px 0 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.modal-backdrop--top {
  z-index: 30;
  align-items: flex-start;
  padding-top: 72px;
}

.modal {
  width: min(760px, calc(100vw - 48px));
  max-height: calc(100vh - 88px);
  overflow: auto;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}

.modal__header,
.modal__footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.modal__header {
  align-items: flex-start;
  margin-bottom: 14px;
}

.modal__header h2,
.sync-columns h3,
.sync-results h3 {
  margin: 0 0 4px;
  font-size: 13px;
}

.modal__footer {
  justify-content: flex-end;
  margin-top: 16px;
}

.sync-columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.sync-columns ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sync-columns li {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 4px 6px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
}

.sync-columns em {
  grid-column: 2;
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.sync-results {
  margin-top: 14px;
}

.sync-results ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sync-results__item {
  display: grid;
  grid-template-columns: 16px minmax(0, auto) 1fr;
  gap: 4px 6px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
}

.sync-results__item:last-child {
  border-bottom: 0;
}

.sync-results__item em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
}

.sync-results__item--success {
  color: var(--ok);
}

.sync-results__item--error {
  color: var(--err);
}

@media (max-width: 900px) {
  .overview-grid,
  .repo-overview-grid,
  .sync-columns {
    grid-template-columns: 1fr;
  }

.repo-status-row {
  grid-template-columns: minmax(0, 1fr) max-content;
  gap: 4px 8px;
  align-items: center;
  padding: 6px;
}

  .repo-status-row__name {
    grid-column: 1;
  }

  .repo-status-row__action {
    grid-column: 2;
    justify-content: flex-end;
    flex-wrap: wrap;
    max-width: 168px;
  }

  .setup-step {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .setup-step__action {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>
