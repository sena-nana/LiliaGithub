<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch, type Component } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock,
  FolderOpen,
  FolderGit2,
  GitBranchPlus,
  GitMerge,
  GitPullRequestArrow,
  Info,
  Plus,
  CloudDownload,
  CloudUpload,
  LoaderCircle,
  Radar,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  X,
} from "@lucide/vue";
import { useComponentEpoch } from "../composables/useComponentEpoch";
import { useCloneRepoDialog } from "../composables/useCloneRepoDialog";
import { openContextMenuAt, type ContextMenuItem } from "@lilia/ui";
import { buildContributionHeatmapModel } from "@lilia/ui";
import { createLatestAsyncLoader } from "../composables/useLatestAsyncLoader";
import { runBackgroundTask } from "../composables/useBackgroundTasks";
import { useWorkspace } from "../composables/useWorkspace";
import {
  repoSyncIssuesByRepoId,
  type GitHubContributionsState,
  type RepoSyncIssueDisplay,
} from "../composables/workspace/state";
import {
  isGitHubBindingExpiredError,
  listGitHubRepos,
  listGitHubAccountIssues,
  listGitHubActionNotifications,
  mergeGitHubPullRequest,
  preloadGitHubRepos,
  updateGitHubIssue,
  updateGitHubPullRequest,
  type GitHubAccountIssueItem,
  type GitHubActionNotification,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubRepoSummary,
  type ContributionIdentityRecommendation,
  type ContributionIdentityRecommendationResult,
  type BulkOperation,
  type RepoPullLocalChangesMode,
  type RepoSummary,
  type WorkspaceSettings,
} from "../services/workspace";
import {
  clearHomeGitHubOverviewSnapshot,
  homeGitHubOverviewSnapshotNeedsRefresh,
  readHomeGitHubOverviewSnapshot,
  writeHomeGitHubOverviewSnapshot,
} from "./homeOverviewCache";
import ContributionIdentityRecommendations from "../components/ContributionIdentityRecommendations.vue";
import HomeContributionCard from "../components/home/HomeContributionCard.vue";
import HomeCloneDialog from "../components/home/HomeCloneDialog.vue";
import RepoCreateCard from "../components/sidebar/RepoCreateCard.vue";
import { bulkResultTone, repoDisplayName } from "../utils/repoDisplay";
import {
  buildHomePendingItems,
  type HomePendingItem,
  type HomePendingRepoSource,
} from "../utils/homePendingItems";
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
import {
  DEFAULT_REPO_SORT,
  compareRepoSortItems,
  nextRepoSort,
  nextRepoSortDisplayLabel,
  repoSortDisplayLabel,
  readRepoSort,
  writeRepoSort,
  type RepoSortState,
  type SortDirection,
} from "../utils/repoSort";
import {
  contributionIdentityKey,
  mergeContributionIdentity,
} from "../utils/contributionIdentities";

const workspace = useWorkspace();
const router = useRouter();
const syncingRepoId = ref<string | null>(null);
const bulkLocalChangesMode = ref<RepoPullLocalChangesMode>("stash");
const createRepoCardOpen = ref(false);
const createRepoCardMode = ref<"local" | "remote">("local");
const searchOpen = ref(false);
const searchQuery = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
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
};

type LanguageChartMode = "language" | "project";
type RepoStatusSortKey = "updated" | "name" | "created";
type RepoStatusSortState = RepoSortState<RepoStatusSortKey>;

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

type HomeSearchResult = {
  key: string;
  label: string;
  detail: string;
} & (
  { kind: "local"; repo: RepoSummary } |
  { kind: "remote"; repo: GitHubRepoSummary }
);

type HomePendingLink = {
  kind: "route";
  to: string;
} | {
  kind: "none";
};

type HomePendingAction = "issue-complete" | "issue-close" | "pull-merge" | "pull-close";

type HomePendingRow = {
  item: HomePendingItem;
  icon: Component;
  repoFullName: string;
  link: HomePendingLink;
  actions: HomePendingAction[];
  runningAction: HomePendingAction | null;
  actionError: string | null;
};

type HomeOverviewSettingsSnapshot = Pick<WorkspaceSettings, "repoSyncPreferences"> | null;

type HomeOverviewSnapshot = {
  settings: HomeOverviewSettingsSnapshot;
  statusRepos: RepoSummary[];
  codeRepos: RepoSummary[];
  githubRepos: GitHubRepoSummary[];
  githubReposNextPage: number | null;
  issuesByRepo: Record<string, GitHubIssue[] | undefined>;
  pullRequestsByRepo: Record<string, GitHubPullRequest[] | undefined>;
  actionNotificationsByRepo: Record<string, GitHubActionNotification[] | undefined>;
  syncIssuesByRepoId: Map<string, RepoSyncIssueDisplay>;
};

type ProjectTabRef = "issues" | "pulls" | "actions";
const REPO_STATUS_RENDER_PAGE_SIZE = 60;
const HOME_PENDING_ITEM_LIMIT = 12;
const GITHUB_ACCOUNT_ISSUES_PER_PAGE = 100;
const GITHUB_ACTION_NOTIFICATIONS_PER_PAGE = 50;
const REPO_STATUS_SORT_STORAGE_KEY = "lilia-github.home.repoStatusSort.v1";
const CONTRIBUTION_SETTINGS_ROUTE = {
  path: "/settings",
  query: { tab: "repositories" },
  hash: "#contribution-identity-list-title",
} as const;
const repoStatusSortOptions: readonly {
  value: RepoStatusSortKey;
  label: string;
  defaultDirection: SortDirection;
  icon: NonNullable<ContextMenuItem["icon"]>;
}[] = [
  { value: "name", label: "首字母", defaultDirection: "asc", icon: ArrowDownAZ },
  { value: "created", label: "创建时间", defaultDirection: "desc", icon: CalendarDays },
  { value: "updated", label: "最近更新", defaultDirection: "desc", icon: Clock },
];
const homePendingTaskTitles: Record<HomePendingAction, string> = {
  "issue-complete": "完成 Issue",
  "issue-close": "关闭 Issue",
  "pull-merge": "合并 PR",
  "pull-close": "关闭 PR",
};
const defaultRepoStatusSortOption = repoStatusSortOptions[2]!;
type RepoStatusSortOption = (typeof repoStatusSortOptions)[number];

function cloneRepoWorktree(repo: RepoSummary) {
  return { ...repo.worktree };
}

function snapshotHomeStatusRepos(repos: readonly RepoSummary[]): RepoSummary[] {
  return repos.map((repo) => ({
    ...repo,
    languageStats: [],
    worktree: cloneRepoWorktree(repo),
  }));
}

function snapshotHomeCodeRepos(repos: readonly RepoSummary[]): RepoSummary[] {
  return repos.map((repo) => ({
    ...repo,
    languageStats: repo.languageStats.map((stat) => ({ ...stat })),
    worktree: cloneRepoWorktree(repo),
  }));
}

const languageChartMode = ref<LanguageChartMode>("language");
const discovering = ref(false);
const githubRepos = ref<GitHubRepoSummary[]>([]);
const githubReposNextPage = ref<number | null>(null);
const githubReposLoading = ref(false);
const githubReposLoadingMore = ref(false);
const githubReposError = ref<string | null>(null);
const githubIssuesByRepo = ref<Record<string, GitHubIssue[] | undefined>>({});
const githubPullRequestsByRepo = ref<Record<string, GitHubPullRequest[] | undefined>>({});
const githubAccountIssuesLoading = ref(false);
const githubActionNotificationsByRepo = ref<Record<string, GitHubActionNotification[] | undefined>>({});
const githubActionNotificationsLoading = ref(false);
const githubTimelineError = ref<string | null>(null);
const homePendingRunningActions = ref<Record<string, HomePendingAction | undefined>>({});
const homePendingActionErrors = ref<Record<string, string | undefined>>({});
const cloningFullName = ref<string | null>(null);
const repoStatusVisibleCount = ref(REPO_STATUS_RENDER_PAGE_SIZE);
const repoStatusSort = ref<RepoStatusSortState>(
  readRepoSort(REPO_STATUS_SORT_STORAGE_KEY, repoStatusSortOptions, DEFAULT_REPO_SORT),
);
const homeOverviewSnapshot = shallowRef<HomeOverviewSnapshot | null>(null);
const homeContributionSnapshot = shallowRef<GitHubContributionsState | null>(null);
const homeContributionIdentityRecommendations = ref<ContributionIdentityRecommendationResult | null>(null);
const homeContributionIdentityScanning = ref(false);
const homeContributionIdentitySavingKey = ref<string | null>(null);
const homeContributionIdentityError = ref<string | null>(null);
const homeContributionIdentityPanelOpen = ref(false);
const componentEpoch = useComponentEpoch();
const githubRepoStatusLoader = createLatestAsyncLoader({ componentEpoch });
const githubRepoMoreLoader = createLatestAsyncLoader({ componentEpoch });
let searchRepoPagesLoading = false;
let homeOverviewInitialized = false;
let homeContributionRefreshGeneration = 0;
const repoGroups = computed(() => workspace.state.settings?.repoGroups ?? []);
const emptySyncIssuesByRepoId = new Map<string, RepoSyncIssueDisplay>();
const emptyContributions: GitHubContributionsState = {
  days: [],
  meta: null,
  loading: false,
  error: null,
};

function cloneOverviewSettings(settings: typeof workspace.state.settings): HomeOverviewSettingsSnapshot {
  if (!settings) return null;
  return {
    repoSyncPreferences: Object.fromEntries(
      Object.entries(settings.repoSyncPreferences).map(([repoId, preference]) => [repoId, { ...preference }]),
    ),
  };
}

function cloneContributions(contributions: typeof workspace.state.githubContributions): GitHubContributionsState {
  return {
    days: contributions.days.map((day) => ({
      ...day,
      repositories: day.repositories?.map((repo) => ({ ...repo })) ?? [],
    })),
    meta: contributions.meta ? { ...contributions.meta } : null,
    loading: contributions.loading,
    error: contributions.error,
  };
}

function cloneRecordArray<T>(source: Record<string, T[] | undefined>) {
  return Object.fromEntries(
    Object.entries(source).map(([key, values]) => [
      key,
      values?.map((value) => ({ ...value })) ?? [],
    ]),
  ) as Record<string, T[] | undefined>;
}

function buildCodeReposForOverview(settings: HomeOverviewSettingsSnapshot) {
  return representativeReposBySharedGroup(snapshotHomeCodeRepos(workspace.state.repos))
    .filter((repo) => repoIncludedInHomeCodeStats(settings, repo.id));
}

function buildHomeOverviewSnapshot(
  overrides: Partial<Pick<
    HomeOverviewSnapshot,
    "githubRepos" |
    "githubReposNextPage" |
    "issuesByRepo" |
    "pullRequestsByRepo" |
    "actionNotificationsByRepo"
  >> = {},
): HomeOverviewSnapshot {
  const settings = cloneOverviewSettings(workspace.state.settings);
  return {
    settings,
    statusRepos: snapshotHomeStatusRepos(workspace.state.repos),
    codeRepos: buildCodeReposForOverview(settings),
    githubRepos: overrides.githubRepos ?? homeOverviewSnapshot.value?.githubRepos ?? githubRepos.value,
    githubReposNextPage: overrides.githubReposNextPage ??
      homeOverviewSnapshot.value?.githubReposNextPage ??
      githubReposNextPage.value,
    issuesByRepo: cloneRecordArray(overrides.issuesByRepo ?? homeOverviewSnapshot.value?.issuesByRepo ?? githubIssuesByRepo.value),
    pullRequestsByRepo: cloneRecordArray(
      overrides.pullRequestsByRepo ?? homeOverviewSnapshot.value?.pullRequestsByRepo ?? githubPullRequestsByRepo.value,
    ),
    actionNotificationsByRepo: cloneRecordArray(
      overrides.actionNotificationsByRepo ??
        homeOverviewSnapshot.value?.actionNotificationsByRepo ??
        githubActionNotificationsByRepo.value,
    ),
    syncIssuesByRepoId: new Map(repoSyncIssuesByRepoId()),
  };
}

function commitHomeOverviewSnapshot(
  overrides: Partial<Pick<
    HomeOverviewSnapshot,
    "githubRepos" |
    "githubReposNextPage" |
    "issuesByRepo" |
    "pullRequestsByRepo" |
    "actionNotificationsByRepo"
  >> = {},
) {
  homeOverviewSnapshot.value = buildHomeOverviewSnapshot(overrides);
}

function commitHomeOverviewSnapshotFromGitHubState() {
  commitHomeOverviewSnapshot({
    githubRepos: githubRepos.value,
    githubReposNextPage: githubReposNextPage.value,
    issuesByRepo: githubIssuesByRepo.value,
    pullRequestsByRepo: githubPullRequestsByRepo.value,
    actionNotificationsByRepo: githubActionNotificationsByRepo.value,
  });
}

function commitHomeContributionSnapshot() {
  homeContributionSnapshot.value = cloneContributions(workspace.state.githubContributions);
}

async function refreshHomeContributionSnapshot(options: { requireReady?: boolean } = {}) {
  const generation = ++homeContributionRefreshGeneration;
  await workspace.refreshRepoContributions();
  await nextTick();
  await waitForOverviewContributionRefresh();
  if (generation !== homeContributionRefreshGeneration || (options.requireReady !== false && !workspace.isReady.value)) {
    return;
  }
  commitHomeContributionSnapshot();
}

function homeContributionRefreshSettled() {
  const contributions = workspace.state.githubContributions;
  return !contributions.loading && (
    contributions.days.length > 0 ||
    contributions.meta !== null ||
    contributions.error !== null
  );
}

function commitInitialHomeContributionSnapshot() {
  if (!workspace.isReady.value || homeContributionSnapshot.value || !homeContributionRefreshSettled()) {
    return;
  }
  commitHomeContributionSnapshot();
}

async function refreshHomeAfterRepoMutation() {
  commitHomeOverviewSnapshot();
  await refreshHomeContributionSnapshot();
}

const overviewStatusRepos = computed(() => homeOverviewSnapshot.value?.statusRepos ?? []);
const overviewCodeRepos = computed(() => homeOverviewSnapshot.value?.codeRepos ?? []);
const overviewGitHubRepos = computed(() => homeOverviewSnapshot.value?.githubRepos ?? []);
const overviewGitHubReposNextPage = computed(() => homeOverviewSnapshot.value?.githubReposNextPage ?? null);
const overviewIssuesByRepo = computed(() => homeOverviewSnapshot.value?.issuesByRepo ?? {});
const overviewPullRequestsByRepo = computed(() => homeOverviewSnapshot.value?.pullRequestsByRepo ?? {});
const overviewActionNotificationsByRepo = computed(() => homeOverviewSnapshot.value?.actionNotificationsByRepo ?? {});
const overviewSyncIssuesByRepoId = computed(() =>
  homeOverviewSnapshot.value?.syncIssuesByRepoId ?? emptySyncIssuesByRepoId,
);
const overviewContributions = computed(() => homeContributionSnapshot.value ?? emptyContributions);

const contributionHeatmapModel = computed(() =>
  buildContributionHeatmapModel(overviewContributions.value.days, {
    cellSize: 13,
    cellGap: 3,
    cellRadius: 3,
    formatTitle: (day) => `${day.date}：${day.count} 次提交`,
  })
);

const totalContributions = computed(() =>
  overviewContributions.value.days.reduce((total, day) => total + day.count, 0),
);
const hasContributionDays = computed(() => overviewContributions.value.days.length > 0);
const skippedContributionRepoCount = computed(() =>
  overviewContributions.value.meta?.skippedRepoCount ?? 0,
);
const homeContributionIdentityPanelVisible = computed(() =>
  homeContributionIdentityPanelOpen.value
  && (
    homeContributionIdentityScanning.value
    || homeContributionIdentityError.value !== null
    || homeContributionIdentityRecommendations.value !== null
  ),
);
const languageOverview = computed<HomeCodeOverview>(() => {
  const overview = buildLanguageOverviewFromRepos(overviewCodeRepos.value);
  const slices = overview.slices.map((slice) => ({
    ...slice,
    key: `language:${slice.language}`,
    label: slice.language,
    to: null,
    linkTitle: slice.title,
  }));
  return { ...overview, slices };
});

const projectCodeOverview = computed<HomeCodeOverview>(() => {
  const overview = buildProjectCodeOverviewFromRepos(overviewCodeRepos.value);
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

const localRepoByGitHubFullName = computed(() =>
  representativeReposByGitHubFullName(overviewStatusRepos.value),
);
const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLocaleLowerCase());
const homeSearchResults = computed<HomeSearchResult[]>(() => {
  const query = normalizedSearchQuery.value;
  if (!query) return [];

  const searchStatusRepos = snapshotHomeStatusRepos(workspace.state.repos);
  const searchLocalRepoByGitHubFullName = representativeReposByGitHubFullName(searchStatusRepos);
  const localResults = searchStatusRepos
    .filter((repo) => repoMatchesHomeSearch(repo, query))
    .map((repo): HomeSearchResult => ({
      key: `local:${repo.id}`,
      kind: "local",
      label: repoDisplayName(repo),
      detail: repo.githubFullName ?? repo.relativePath ?? repo.path,
      repo,
    }));

  const remoteResults = overviewGitHubRepos.value
    .filter((repo) => !repo.disabled)
    .filter((repo) => !searchLocalRepoByGitHubFullName.has(repo.fullName))
    .filter((repo) => githubRepoMatchesHomeSearch(repo, query))
    .map((repo): HomeSearchResult => ({
      key: `remote:${repo.fullName}`,
      kind: "remote",
      label: repo.name,
      detail: repo.fullName,
      repo,
    }));

  return [...localResults, ...remoteResults].slice(0, 12);
});
const searchRemotePending = computed(() =>
  Boolean(normalizedSearchQuery.value && overviewGitHubReposNextPage.value && !githubReposError.value) ||
  githubReposLoading.value ||
  githubReposLoadingMore.value,
);

const activeRepoStatusSortOption = computed(() =>
  repoStatusSortOption(repoStatusSort.value.sort) ?? defaultRepoStatusSortOption,
);
const repoStatusSortLabel = computed(() =>
  repoSortDisplayLabel(activeRepoStatusSortOption.value, repoStatusSort.value.direction),
);

const repoStatusRows = computed<RepoStatusRow[]>(() =>
  overviewGitHubRepos.value.filter((repo) => !repo.disabled).map((githubRepo) => {
    const localRepo = localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null;
    return {
      githubRepo,
      localRepo,
      action: localRepo ? repoAction(localRepo) : null,
      syncIssue: localRepo ? overviewSyncIssuesByRepoId.value.get(localRepo.id) ?? null : null,
    };
  }).sort(compareRepoStatusRows),
);

const visibleRepoStatusRows = computed(() =>
  repoStatusRows.value.slice(0, repoStatusVisibleCount.value),
);
const hiddenRepoStatusRowCount = computed(() =>
  Math.max(0, repoStatusRows.value.length - visibleRepoStatusRows.value.length),
);
const homeTimelineRepos = computed(() => overviewGitHubRepos.value.filter((repo) => repoIncludedInHomeTimeline(repo)));
const homeTimelineAccountIssuesPending = computed(() =>
  homeTimelineRepos.value.some((repo) =>
    overviewIssuesByRepo.value[repo.fullName] == null ||
    overviewPullRequestsByRepo.value[repo.fullName] == null
  ),
);
const homeTimelineActionNotificationsPending = computed(() =>
  homeTimelineRepos.value.some((repo) => overviewActionNotificationsByRepo.value[repo.fullName] == null),
);
function hasHomeTimelineRepoData(repo: GitHubRepoSummary, localRepo: RepoSummary | null) {
  const syncIssue = localRepo ? overviewSyncIssuesByRepoId.value.get(localRepo.id) ?? null : null;
  return Boolean(
    syncIssue ||
    (localRepo && (localRepo.ahead > 0 || localRepo.behind > 0 || localRepo.conflictCount > 0)) ||
    overviewIssuesByRepo.value[repo.fullName]?.length ||
    overviewPullRequestsByRepo.value[repo.fullName]?.length ||
    overviewActionNotificationsByRepo.value[repo.fullName]?.length
  );
}

function buildGitHubTimelineRepoSourcesSnapshot(): HomePendingRepoSource[] {
  return homeTimelineRepos.value
    .filter((githubRepo) => {
      const localRepo = localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null;
      return hasHomeTimelineRepoData(githubRepo, localRepo);
    })
    .map((githubRepo) => {
      return {
        githubRepo,
        localRepo: localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null,
        syncIssue: repoSyncIssueForTimeline(githubRepo),
        issues: overviewIssuesByRepo.value[githubRepo.fullName] ?? [],
        pullRequests: overviewPullRequestsByRepo.value[githubRepo.fullName] ?? [],
        pullRequestChecksByPull: undefined,
        actionNotifications: overviewActionNotificationsByRepo.value[githubRepo.fullName] ?? [],
      };
    });
}

const homePendingRows = computed<HomePendingRow[]>(() =>
  buildHomePendingItems(buildGitHubTimelineRepoSourcesSnapshot(), HOME_PENDING_ITEM_LIMIT)
    .map(toHomePendingRow),
);
const githubTimelineBusy = computed(() =>
  githubReposLoading.value ||
  githubAccountIssuesLoading.value ||
  githubActionNotificationsLoading.value ||
  homeTimelineAccountIssuesPending.value ||
  homeTimelineActionNotificationsPending.value,
);

let githubPendingGeneration = 0;
watch(
  () => repoStatusRows.value.length,
  (length, previousLength) => {
    if (length < previousLength) {
      repoStatusVisibleCount.value = REPO_STATUS_RENDER_PAGE_SIZE;
    }
  },
);

watch(
  () => [searchOpen.value, normalizedSearchQuery.value, overviewGitHubReposNextPage.value] as const,
  ([open, query, nextPage]) => {
    if (open && query && nextPage) {
      void loadRemainingSearchGitHubRepos();
    }
  },
);

onUnmounted(() => {
  githubPendingGeneration += 1;
  homeContributionRefreshGeneration += 1;
  githubRepoStatusLoader.invalidate();
  githubRepoMoreLoader.invalidate();
});

watch(
  () => workspace.isReady.value,
  (ready) => {
    if (!ready) {
      homeOverviewInitialized = false;
      homeContributionRefreshGeneration += 1;
      homeContributionSnapshot.value = null;
      return;
    }
    if (homeOverviewInitialized) return;
    homeOverviewInitialized = true;
    commitHomeOverviewSnapshot();
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

watch(
  () => [
    workspace.isReady.value,
    workspace.state.githubContributions.days,
    workspace.state.githubContributions.loading,
    workspace.state.githubContributions.meta,
    workspace.state.githubContributions.error,
  ] as const,
  commitInitialHomeContributionSnapshot,
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
    githubPendingGeneration += 1;
  }
  githubRepos.value = append ? dedupeGitHubRepos([...githubRepos.value, ...page.items]) : page.items;
  githubReposNextPage.value = page.nextPage;
  githubReposError.value = null;
  commitHomeOverviewSnapshotFromGitHubState();
  writeGitHubRepoOverviewSnapshot();
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
  githubActionNotificationsByRepo.value = snapshot.actionNotificationsByRepo;
  githubReposError.value = null;
  commitHomeOverviewSnapshotFromGitHubState();
  prepareGitHubTimeline(snapshot.repos);
  return snapshot;
}

function writeGitHubRepoOverviewSnapshot() {
  writeHomeGitHubOverviewSnapshot({
    schemaVersion: 3,
    accountLogin: currentGitHubAccountLogin(),
    cachedAt: Date.now(),
    repos: githubRepos.value,
    nextPage: githubReposNextPage.value,
    issuesByRepo: {},
    pullRequestsByRepo: {},
    pullRequestChecksByRepo: {},
    actionNotificationsByRepo: {},
    releasesByRepo: {},
  });
}

function githubRepoLoadErrorMessage(err: unknown) {
  if (isGitHubBindingExpiredError(err)) {
    clearGitHubPendingItems();
    return "GitHub 绑定已失效，请重新绑定后再加载账号仓库。";
  }
  return `GitHub 仓库列表加载失败：${String(err)}`;
}

async function loadHomePendingAccountIssues(repos: GitHubRepoSummary[], refresh = false) {
  if (!repos.length) return;
  const alreadyLoaded = repos.every((repo) =>
    githubIssuesByRepo.value[repo.fullName] != null &&
    githubPullRequestsByRepo.value[repo.fullName] != null
  );
  if (!refresh && alreadyLoaded) return;

  const generation = githubPendingGeneration;
  githubAccountIssuesLoading.value = true;
  githubTimelineError.value = null;
  try {
    const items = await listGitHubAccountIssues({
      state: "open",
      perPage: GITHUB_ACCOUNT_ISSUES_PER_PAGE,
      sort: "updated",
      direction: "desc",
    }, { forceRefresh: refresh });
    if (generation !== githubPendingGeneration) return;
    const grouped = groupAccountIssuesByRepo(items, repos);
    githubIssuesByRepo.value = replaceReposByFullName(githubIssuesByRepo.value, repos, grouped.issues);
    githubPullRequestsByRepo.value = replaceReposByFullName(
      githubPullRequestsByRepo.value,
      repos,
      grouped.pullRequests,
    );
    commitHomeOverviewSnapshotFromGitHubState();
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) {
      clearGitHubPendingItems();
      return;
    }
    if (generation === githubPendingGeneration) {
      githubTimelineError.value = `Issue / PR 加载失败：${String(err)}`;
    }
  } finally {
    if (generation === githubPendingGeneration) {
      githubAccountIssuesLoading.value = false;
    }
  }
}

async function loadHomePendingActionNotifications(repos: GitHubRepoSummary[], refresh = false) {
  if (!repos.length) return;
  const alreadyLoaded = repos.every((repo) => githubActionNotificationsByRepo.value[repo.fullName] != null);
  if (!refresh && alreadyLoaded) return;

  const generation = githubPendingGeneration;
  githubActionNotificationsLoading.value = true;
  githubTimelineError.value = null;
  try {
    const notifications = await listGitHubActionNotifications(
      GITHUB_ACTION_NOTIFICATIONS_PER_PAGE,
      { forceRefresh: refresh },
    );
    if (generation !== githubPendingGeneration) return;
    githubActionNotificationsByRepo.value = replaceReposByFullName(
      githubActionNotificationsByRepo.value,
      repos,
      groupActionNotificationsByRepo(notifications, repos),
    );
    commitHomeOverviewSnapshotFromGitHubState();
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) {
      clearGitHubPendingItems();
      return;
    }
    if (generation === githubPendingGeneration) {
      githubTimelineError.value = `Actions 通知加载失败：${String(err)}`;
    }
  } finally {
    if (generation === githubPendingGeneration) {
      githubActionNotificationsLoading.value = false;
    }
  }
}

function groupAccountIssuesByRepo(items: readonly GitHubAccountIssueItem[], repos: readonly GitHubRepoSummary[]) {
  const repoNames = new Set(repos.map((repo) => repo.fullName));
  const issues: Record<string, GitHubIssue[]> = {};
  const pullRequests: Record<string, GitHubPullRequest[]> = {};
  for (const item of items) {
    if (!repoNames.has(item.repoFullName)) continue;
    if (item.pullRequest) {
      (pullRequests[item.repoFullName] ??= []).push(accountIssueItemToPullRequest(item));
    } else {
      (issues[item.repoFullName] ??= []).push(cloneGitHubIssue(item.issue));
    }
  }
  return { issues, pullRequests };
}

function groupActionNotificationsByRepo(
  notifications: readonly GitHubActionNotification[],
  repos: readonly GitHubRepoSummary[],
) {
  const repoNames = new Set(repos.map((repo) => repo.fullName));
  const byRepo: Record<string, GitHubActionNotification[]> = {};
  for (const notification of notifications) {
    if (!repoNames.has(notification.repoFullName)) continue;
    (byRepo[notification.repoFullName] ??= []).push({ ...notification });
  }
  return byRepo;
}

function replaceReposByFullName<T>(
  current: Record<string, T[] | undefined>,
  repos: readonly GitHubRepoSummary[],
  values: Record<string, T[] | undefined>,
) {
  const next = { ...current };
  for (const repo of repos) {
    next[repo.fullName] = values[repo.fullName] ?? [];
  }
  return next;
}

function accountIssueItemToPullRequest(item: GitHubAccountIssueItem): GitHubPullRequest {
  const issue = cloneGitHubIssue(item.issue);
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    draft: false,
    body: issue.body,
    labels: issue.labels,
    assignees: issue.assignees,
    author: issue.author ?? "",
    milestone: issue.milestone ?? null,
    comments: issue.comments ?? 0,
    projectItems: issue.projectItems ?? [],
    developmentItems: issue.developmentItems ?? [],
    htmlUrl: issue.htmlUrl,
    updatedAt: issue.updatedAt,
    createdAt: issue.createdAt,
    baseBranch: "",
    headBranch: "",
    merged: false,
    mergeable: null,
    mergeableState: null,
  };
}

function cloneGitHubIssue(issue: GitHubIssue): GitHubIssue {
  return {
    ...issue,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
    milestone: issue.milestone ? { ...issue.milestone } : null,
    projectItems: issue.projectItems?.map((project) => ({ ...project })) ?? [],
    developmentItems: issue.developmentItems?.map((item) => ({ ...item })) ?? [],
  };
}

function cloneGitHubPullRequest(pullRequest: GitHubPullRequest): GitHubPullRequest {
  return {
    ...pullRequest,
    labels: [...pullRequest.labels],
    assignees: [...pullRequest.assignees],
    milestone: pullRequest.milestone ? { ...pullRequest.milestone } : null,
    projectItems: pullRequest.projectItems?.map((project) => ({ ...project })) ?? [],
    reviewers: pullRequest.reviewers?.map((reviewer) => ({ ...reviewer })) ?? [],
    developmentItems: pullRequest.developmentItems?.map((item) => ({ ...item })) ?? [],
  };
}

function clearGitHubPendingItems() {
  githubAccountIssuesLoading.value = false;
  githubActionNotificationsLoading.value = false;
  githubTimelineError.value = null;
  githubIssuesByRepo.value = {};
  githubPullRequestsByRepo.value = {};
  githubActionNotificationsByRepo.value = {};
  commitHomeOverviewSnapshotFromGitHubState();
  clearHomeGitHubOverviewSnapshot();
}

function prepareGitHubTimeline(repos: GitHubRepoSummary[], refresh = false) {
  const timelineRepos = repos.filter((repo) => repoIncludedInHomeTimeline(repo));
  const shouldLoadIssues = shouldLoadHomePendingAccountIssues(timelineRepos, refresh);
  const shouldLoadNotifications = shouldLoadHomePendingActionNotifications(timelineRepos, refresh);
  if (!shouldLoadIssues && !shouldLoadNotifications) {
    githubAccountIssuesLoading.value = false;
    githubActionNotificationsLoading.value = false;
    return;
  }

  const generation = githubPendingGeneration;
  githubTimelineError.value = null;
  if (shouldLoadIssues) {
    githubAccountIssuesLoading.value = true;
  } else {
    githubAccountIssuesLoading.value = false;
  }
  if (shouldLoadNotifications) {
    githubActionNotificationsLoading.value = true;
  } else {
    githubActionNotificationsLoading.value = false;
  }
  if (generation !== githubPendingGeneration) return;
  if (shouldLoadIssues) void loadHomePendingAccountIssues(timelineRepos, refresh);
  if (shouldLoadNotifications) void loadHomePendingActionNotifications(timelineRepos, refresh);
}

function retryHomePendingItems() {
  prepareGitHubTimeline(homeTimelineRepos.value, true);
}

function shouldLoadHomePendingAccountIssues(repos: readonly GitHubRepoSummary[], refresh = false) {
  if (!repos.length) return false;
  if (refresh) return true;
  return repos.some((repo) =>
    githubIssuesByRepo.value[repo.fullName] == null ||
    githubPullRequestsByRepo.value[repo.fullName] == null
  );
}

function shouldLoadHomePendingActionNotifications(repos: readonly GitHubRepoSummary[], refresh = false) {
  if (!repos.length) return false;
  if (refresh) return true;
  return repos.some((repo) => githubActionNotificationsByRepo.value[repo.fullName] == null);
}

function repoIncludedInHomeTimeline(repo: GitHubRepoSummary) {
  if (repo.disabled) return false;
  const localRepo = localRepoByGitHubFullName.value.get(repo.fullName) ?? null;
  return !localRepo || repoCalculatesHomeTimeline(homeOverviewSnapshot.value?.settings ?? null, localRepo.id);
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
      githubReposError.value = githubRepoLoadErrorMessage(err);
      if (isGitHubBindingExpiredError(err)) {
        githubRepos.value = [];
        githubReposNextPage.value = null;
        commitHomeOverviewSnapshotFromGitHubState();
      }
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

async function loadRemainingSearchGitHubRepos() {
  if (searchRepoPagesLoading || githubReposLoading.value || githubReposLoadingMore.value) return;
  searchRepoPagesLoading = true;
  try {
    while (searchOpen.value && normalizedSearchQuery.value && overviewGitHubReposNextPage.value) {
      const pageNumber = githubReposNextPage.value;
      await loadMoreGitHubRepos();
      if (githubReposNextPage.value === pageNumber) break;
    }
  } finally {
    searchRepoPagesLoading = false;
  }
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

function repoSyncIssueForTimeline(githubRepo: GitHubRepoSummary) {
  const localRepo = localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null;
  return localRepo ? overviewSyncIssuesByRepoId.value.get(localRepo.id) ?? null : null;
}

function toHomePendingRow(item: HomePendingItem): HomePendingRow {
  return {
    item,
    icon: homePendingItemIcon(item.kind),
    repoFullName: homePendingItemRepoFullName(item),
    link: homePendingItemLink(item),
    actions: homePendingActions(item),
    runningAction: homePendingRunningActions.value[item.id] ?? null,
    actionError: homePendingActionErrors.value[item.id] ?? null,
  };
}

function homePendingItemRepoFullName(item: HomePendingItem) {
  const target = item.target;
  if (target.kind === "repo") return item.summary;
  return target.repoFullName;
}

function homePendingItemLink(item: HomePendingItem): HomePendingLink {
  const target = item.target;
  if (target.kind === "repo") return homePendingRouteLink(repoDetailPath({ id: target.repoId }));
  if (target.kind === "issue") {
    const href = target.localRepoId
      ? repoProjectPath({ id: target.localRepoId }, "issues", target.number)
      : remoteRepoProjectPath({ fullName: target.repoFullName }, "issues", target.number);
    return homePendingRouteLink(href);
  }
  if (target.kind === "pull") {
    const href = target.localRepoId
      ? repoProjectPath({ id: target.localRepoId }, "pulls", target.number)
      : remoteRepoProjectPath({ fullName: target.repoFullName }, "pulls", target.number);
    return homePendingRouteLink(href);
  }
  const href = target.localRepoId
    ? repoProjectPath({ id: target.localRepoId }, "actions", target.runId)
    : remoteRepoProjectPath({ fullName: target.repoFullName }, "actions", target.runId);
  return homePendingRouteLink(href);
}

function homePendingItemIcon(kind: HomePendingItem["kind"]) {
  if (kind === "issue") return CircleDot;
  if (kind === "pull") return GitPullRequestArrow;
  if (kind === "workflow") return RotateCw;
  return RefreshCw;
}

function homePendingRouteLink(href: string | undefined): HomePendingLink {
  if (!href) return { kind: "none" };
  return { kind: "route", to: href };
}

function homePendingItemHref(link: HomePendingLink) {
  if (link.kind === "route") return router.resolve(link.to).href;
  return undefined;
}

async function openHomePendingLink(event: MouseEvent, link: HomePendingLink) {
  if (link.kind !== "route" || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  await router.push(link.to);
}

function homePendingActionLabel(action: HomePendingAction) {
  if (action === "issue-complete") return "完成";
  if (action === "issue-close") return "关闭";
  if (action === "pull-merge") return "合并";
  return "关闭";
}

function homePendingActionIcon(action: HomePendingAction) {
  if (action === "issue-complete") return CheckCircle2;
  if (action === "pull-merge") return GitMerge;
  return X;
}

function homePendingActions(item: HomePendingItem): HomePendingAction[] {
  if (item.target.kind === "issue") return ["issue-complete", "issue-close"];
  if (item.target.kind === "pull") return ["pull-merge", "pull-close"];
  return [];
}

function homePendingActionAgentId(item: HomePendingItem, action: HomePendingAction) {
  return `home.pending.${item.id}.${action}`;
}

function clearHomePendingActionError(item: HomePendingItem) {
  if (!homePendingActionErrors.value[item.id]) return;
  const { [item.id]: _removed, ...next } = homePendingActionErrors.value;
  homePendingActionErrors.value = next;
}

function setHomePendingActionError(item: HomePendingItem, error: unknown) {
  homePendingActionErrors.value = {
    ...homePendingActionErrors.value,
    [item.id]: String(error),
  };
}

async function runHomePendingAction(item: HomePendingItem, action: HomePendingAction) {
  if (homePendingRunningActions.value[item.id]) return;
  homePendingRunningActions.value = {
    ...homePendingRunningActions.value,
    [item.id]: action,
  };
  clearHomePendingActionError(item);
  try {
    await runBackgroundTask(homePendingBackgroundTask(item, action), async () => {
      if (action === "issue-complete" || action === "issue-close") {
        await updateHomePendingIssue(item, action);
      } else {
        await updateHomePendingPullRequest(item, action);
      }
    });
  } catch (err) {
    setHomePendingActionError(item, err);
  } finally {
    if (homePendingRunningActions.value[item.id] === action) {
      const { [item.id]: _removed, ...next } = homePendingRunningActions.value;
      homePendingRunningActions.value = next;
    }
  }
}

function homePendingBackgroundTask(item: HomePendingItem, action: HomePendingAction) {
  const target = item.target;
  return {
    kind: "github" as const,
    title: homePendingTaskTitles[action],
    repoId: target.kind === "repo" ? target.repoId : target.localRepoId,
    repoName: homePendingItemRepoFullName(item),
    detail: item.title,
    priority: "normal" as const,
  };
}

async function updateHomePendingIssue(item: HomePendingItem, action: Extract<HomePendingAction, "issue-complete" | "issue-close">) {
  const target = item.target;
  if (target.kind !== "issue") return;
  const updated = await updateGitHubIssue(target.repoFullName, target.number, {
    state: "closed",
    stateReason: action === "issue-complete" ? "completed" : "not_planned",
  });
  replaceHomePendingIssue(target.repoFullName, updated);
}

async function updateHomePendingPullRequest(item: HomePendingItem, action: Extract<HomePendingAction, "pull-merge" | "pull-close">) {
  const target = item.target;
  if (target.kind !== "pull") return;
  const updated = action === "pull-merge"
    ? await mergeGitHubPullRequest(target.repoFullName, target.number, { method: "merge" })
    : await updateGitHubPullRequest(target.repoFullName, target.number, { state: "closed" });
  replaceHomePendingPullRequest(target.repoFullName, updated);
}

function replaceHomePendingIssue(repoFullName: string, updated: GitHubIssue) {
  const current = githubIssuesByRepo.value[repoFullName] ?? overviewIssuesByRepo.value[repoFullName] ?? [];
  const nextItems = updated.state === "open"
    ? upsertByNumber(current, cloneGitHubIssue(updated))
    : current.filter((item) => item.number !== updated.number);
  githubIssuesByRepo.value = {
    ...githubIssuesByRepo.value,
    [repoFullName]: nextItems,
  };
  commitHomeOverviewSnapshotFromGitHubState();
}

function replaceHomePendingPullRequest(repoFullName: string, updated: GitHubPullRequest) {
  const current = githubPullRequestsByRepo.value[repoFullName] ?? overviewPullRequestsByRepo.value[repoFullName] ?? [];
  const visible = updated.state === "open" && !updated.merged && !updated.draft;
  const nextItems = visible
    ? upsertByNumber(current, cloneGitHubPullRequest(updated))
    : current.filter((item) => item.number !== updated.number);
  githubPullRequestsByRepo.value = {
    ...githubPullRequestsByRepo.value,
    [repoFullName]: nextItems,
  };
  commitHomeOverviewSnapshotFromGitHubState();
}

function upsertByNumber<T extends { number: number }>(items: readonly T[], updated: T): T[] {
  const existing = items.some((item) => item.number === updated.number);
  if (existing) return items.map((item) => item.number === updated.number ? updated : item);
  return [updated, ...items];
}

function valueMatchesHomeSearch(value: string | null | undefined, query: string) {
  return Boolean(value?.toLocaleLowerCase().includes(query));
}

function repoMatchesHomeSearch(repo: RepoSummary, query: string) {
  return [
    repoDisplayName(repo),
    repo.name,
    repo.githubFullName,
    repo.relativePath,
    repo.path,
  ].some((value) => valueMatchesHomeSearch(value, query));
}

function githubRepoMatchesHomeSearch(repo: GitHubRepoSummary, query: string) {
  return [
    repo.name,
    repo.fullName,
    repo.description,
    repo.defaultBranch,
  ].some((value) => valueMatchesHomeSearch(value, query));
}

async function openSearch() {
  searchOpen.value = true;
  if (workspace.isReady.value && !overviewGitHubRepos.value.length && !githubReposLoading.value) {
    void loadGitHubRepoStatus();
  }
  await nextTick();
  searchInput.value?.focus();
}

function closeSearch() {
  searchOpen.value = false;
  searchQuery.value = "";
}

function toggleSearch() {
  if (searchOpen.value) {
    closeSearch();
    return;
  }
  void openSearch();
}

function searchResultAriaLabel(result: HomeSearchResult) {
  return result.kind === "local"
    ? `打开本地仓库 ${result.label}`
    : `打开远程仓库 ${result.detail}`;
}

function repoStatusSortOption(value: unknown) {
  return repoStatusSortOptions.find((option) => option.value === value);
}

function compareRepoStatusRows(left: RepoStatusRow, right: RepoStatusRow) {
  const archivedCompare = Number(left.githubRepo.archived) - Number(right.githubRepo.archived);
  if (archivedCompare) return archivedCompare;

  return compareRepoSortItems(left, right, repoStatusSort.value, {
    name: (row) => row.githubRepo.fullName,
    updatedAt: (row) => row.githubRepo.updatedAt,
    createdAt: (row) => row.githubRepo.createdAt,
  });
}

function selectRepoStatusSort(option: RepoStatusSortOption) {
  repoStatusSort.value = nextRepoSort(repoStatusSort.value, option);
  writeRepoSort(REPO_STATUS_SORT_STORAGE_KEY, repoStatusSort.value);
}

function openRepoStatusSortMenu(event: MouseEvent) {
  const button = event.currentTarget as HTMLElement | null;
  const rect = button?.getBoundingClientRect();
  openContextMenuAt(
    rect?.left ?? event.clientX,
    (rect?.bottom ?? event.clientY) + 4,
    repoStatusSortOptions.map((option) => ({
      id: `home.repo-status.sort.${option.value}`,
      label: nextRepoSortDisplayLabel(repoStatusSort.value, option),
      icon: option.icon,
      onSelect: () => selectRepoStatusSort(option),
    })),
  );
}

async function openHomeSearchResult(result: HomeSearchResult | null = homeSearchResults.value[0] ?? null) {
  if (!result) return;
  if (result.kind === "local") {
    await router.push(repoRoute(result.repo.id));
  } else {
    await workspace.rememberRemoteRepo(shortcutFromGitHubRepo(result.repo));
    await router.push(remoteRepoRoute(result.repo.fullName));
  }
  closeSearch();
}

function openCreateRepoCard(mode: "local" | "remote") {
  createRepoCardMode.value = mode;
  createRepoCardOpen.value = true;
}

function openCloneRepoDialog(groupId: string | null = null) {
  void cloneDialog.openDialog(groupId);
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
      onSelect: () => openCloneRepoDialog(),
      children: cloneRepoGroupMenuItems(),
    },
    {
      id: "home-create-local-repo",
      label: "创建本地仓库",
      icon: FolderGit2,
      disabled: !workspace.workspaceRoot.value,
      onSelect: () => openCreateRepoCard("local"),
    },
    {
      id: "home-create-remote-repo",
      label: "创建远程仓库",
      icon: GitBranchPlus,
      disabled: !workspace.workspaceRoot.value || !workspace.isAuthorized.value,
      onSelect: () => openCreateRepoCard("remote"),
    },
  ];
}

function cloneRepoGroupMenuItems(): ContextMenuItem[] {
  return [
    {
      id: "home-clone-repo-ungrouped",
      label: "未分组仓库",
      icon: FolderOpen,
      onSelect: () => openCloneRepoDialog(null),
    },
    ...repoGroups.value.map((group) => ({
      id: `home-clone-repo-${group.id}`,
      label: group.name,
      icon: FolderOpen,
      onSelect: () => openCloneRepoDialog(group.id),
    })),
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

async function placeCreatedRepo(repo: RepoSummary, groupId: string | null = null) {
  if (groupId) {
    await workspace.moveRepoToGroup(repo.id, groupId);
  }
  commitHomeOverviewSnapshot();
  await router.push(repoRoute(repo.id));
}

async function placeClonedCreatedRepo(repo: RepoSummary, _remote: GitHubRepoSummary, groupId: string | null) {
  await placeCreatedRepo(repo, groupId);
}

async function discoverRepos() {
  if (discovering.value) return;
  discovering.value = true;
  try {
    await workspace.discoverRepos();
    await refreshHomeAfterRepoMutation();
  } finally {
    discovering.value = false;
  }
}

async function refreshOverviewRepos() {
  await workspace.refreshRepos();
  await refreshHomeContributionSnapshot();
  await loadGitHubRepoStatus({ force: true });
}

async function refreshOverviewContributions() {
  await refreshHomeContributionSnapshot();
}

async function scanHomeContributionIdentities() {
  if (homeContributionIdentityScanning.value || homeContributionIdentitySavingKey.value) return;
  homeContributionIdentityPanelOpen.value = true;
  homeContributionIdentityScanning.value = true;
  homeContributionIdentityError.value = null;
  try {
    const result = await workspace.scanContributionIdentities();
    if (!componentEpoch.assertAlive()) return;
    homeContributionIdentityRecommendations.value = result;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    homeContributionIdentityError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) homeContributionIdentityScanning.value = false;
  }
}

async function adoptHomeContributionIdentity(recommendation: ContributionIdentityRecommendation) {
  const key = contributionIdentityKey(recommendation.identity);
  if (homeContributionIdentityScanning.value || homeContributionIdentitySavingKey.value) return;
  homeContributionIdentitySavingKey.value = key;
  homeContributionIdentityError.value = null;
  try {
    const current = workspace.state.settings?.contributionIdentities ?? [];
    await workspace.setContributionIdentities(mergeContributionIdentity(current, recommendation.identity));
    if (!componentEpoch.assertAlive()) return;
    if (homeContributionIdentityRecommendations.value) {
      homeContributionIdentityRecommendations.value = {
        ...homeContributionIdentityRecommendations.value,
        recommendations: homeContributionIdentityRecommendations.value.recommendations.filter(
          (item) => contributionIdentityKey(item.identity) !== key,
        ),
      };
    }
    if (!workspace.state.repos.length) {
      await workspace.refreshRepos();
    }
    await refreshHomeContributionSnapshot({ requireReady: false });
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    homeContributionIdentityError.value = String(err);
  } finally {
    if (componentEpoch.assertAlive()) homeContributionIdentitySavingKey.value = null;
  }
}

function waitForOverviewContributionRefresh() {
  if (!workspace.state.githubContributions.loading) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = watch(
      () => workspace.state.githubContributions.loading,
      (loading) => {
        if (loading) return;
        stop();
        resolve();
      },
    );
  });
}

async function cloneGitHubRepo(repo: GitHubRepoSummary) {
  if (cloningFullName.value) return;
  cloningFullName.value = repo.fullName;
  githubReposError.value = null;
  try {
    await workspace.cloneRepo(repo.cloneUrl, repo.name);
    await refreshHomeAfterRepoMutation();
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

async function syncRepo(repo: RepoSummary) {
  if (syncingRepoId.value) return;
  syncingRepoId.value = repo.id;
  try {
    await workspace.mergePull(repo.id, "stash");
    await refreshHomeAfterRepoMutation();
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
    await refreshHomeAfterRepoMutation();
  } catch {
    /* retry state is surfaced by recent sync status */
  } finally {
    syncingRepoId.value = null;
  }
}

async function previewBulkOperation(operation: BulkOperation) {
  if (operation === "push") {
    bulkLocalChangesMode.value = "reject";
    void workspace.previewBulk(operation, "reject");
    return;
  }
  bulkLocalChangesMode.value = "stash";
  void workspace.previewBulk(operation, "stash");
}

function runSyncAll() {
  bulkLocalChangesMode.value = "stash";
  void workspace.syncAll("stash").then(refreshHomeAfterRepoMutation);
}

async function executeBulkOperation() {
  await workspace.executeBulk(undefined, bulkLocalChangesMode.value);
  await refreshHomeAfterRepoMutation();
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
          <div class="overview-search" :class="{ 'is-open': searchOpen }">
            <button
              v-if="!searchOpen"
              type="button"
              class="overview-actions__btn"
              data-agent-id="home.overview.search"
              title="搜索"
              aria-label="搜索"
              :disabled="!workspace.isReady.value"
              @click="toggleSearch"
            >
              <Search :size="17" aria-hidden="true" />
            </button>
            <div v-else class="overview-search__box">
              <Search :size="15" aria-hidden="true" class="overview-search__icon" />
              <input
                ref="searchInput"
                v-model="searchQuery"
                type="search"
                data-agent-id="home.overview.search.input"
                aria-label="搜索仓库"
                placeholder="搜索仓库"
                autocomplete="off"
                @keydown.enter.prevent="openHomeSearchResult()"
                @keydown.esc.prevent="closeSearch"
              />
              <button
                type="button"
                class="overview-search__close"
                data-agent-id="home.overview.search.close"
                title="关闭搜索"
                aria-label="关闭搜索"
                @click="closeSearch"
              >
                <X :size="14" aria-hidden="true" />
              </button>
              <div
                v-if="normalizedSearchQuery"
                class="overview-search__results"
                role="listbox"
                aria-label="仓库搜索结果"
              >
                <button
                  v-for="(result, index) in homeSearchResults"
                  :key="result.key"
                  type="button"
                  class="overview-search__result"
                  role="option"
                  :aria-label="searchResultAriaLabel(result)"
                  :title="result.detail"
                  :data-agent-id="`home.overview.search.result.${result.kind}.${index}`"
                  @mousedown.prevent
                  @click="openHomeSearchResult(result)"
                >
                  <span class="overview-search__result-main">
                    <span class="overview-search__result-name">{{ result.label }}</span>
                    <span class="overview-search__result-detail">{{ result.detail }}</span>
                  </span>
                  <span class="overview-search__result-kind">{{ result.kind === "local" ? "本地" : "远程" }}</span>
                </button>
                <p v-if="!homeSearchResults.length && !searchRemotePending" class="overview-search__empty">
                  没有匹配的仓库
                </p>
                <p v-if="searchRemotePending" class="overview-search__empty">
                  正在加载远程仓库...
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            class="overview-actions__btn"
            data-agent-id="home.overview.create-repo"
            title="创建仓库"
            aria-label="创建仓库"
            @click="openCreateRepoMenu"
          >
            <Plus :size="17" aria-hidden="true" />
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
        <div class="contribution-stack">
          <HomeContributionCard
            :loading="overviewContributions.loading"
            :error="overviewContributions.error"
            :total-contributions="totalContributions"
            :skipped-repo-count="skippedContributionRepoCount"
            skipped-repo-action-button
            :skipped-repo-action-disabled="homeContributionIdentityScanning || Boolean(homeContributionIdentitySavingKey)"
            :has-contribution-days="hasContributionDays"
            :chart-model="contributionHeatmapModel"
            @retry="refreshOverviewContributions"
            @resolve-skipped="scanHomeContributionIdentities"
          />
          <ContributionIdentityRecommendations
            v-if="homeContributionIdentityPanelVisible"
            :result="homeContributionIdentityRecommendations"
            :loading="homeContributionIdentityScanning"
            :saving-key="homeContributionIdentitySavingKey"
            :error="homeContributionIdentityError"
            :settings-to="CONTRIBUTION_SETTINGS_ROUTE"
            @adopt="adoptHomeContributionIdentity"
          />
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
          <div v-else class="language-chart" aria-label="编程语言占比图" v-memo="[activeCodeOverview]">
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
        <div class="card github-timeline-card">
          <div class="repo-status-heading">
            <h2>
              待处理事项
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
              v-if="githubTimelineError"
              class="repo-status-error"
            >
              {{ githubTimelineError }}
              <button type="button" class="ghost" :disabled="githubAccountIssuesLoading || githubActionNotificationsLoading" @click="retryHomePendingItems">
                重试
              </button>
            </p>
            <p
              v-if="githubTimelineBusy && !homePendingRows.length && !githubTimelineError"
              class="repo-status-empty"
            >
              正在加载待处理事项...
            </p>
            <p v-else-if="!homePendingRows.length && !githubTimelineError" class="repo-status-empty">暂无待处理事项</p>
            <ol
              v-if="homePendingRows.length"
              class="home-pending-list"
              aria-label="待处理事项列表"
              v-memo="[homePendingRows]"
            >
              <li
                v-for="row in homePendingRows"
                :key="row.item.id"
                class="home-pending-row"
                :class="{ 'has-hover-controls': row.actions.length || row.link.kind !== 'none' }"
                :aria-label="`${row.item.title} ${row.item.detail}，${row.repoFullName}`"
                tabindex="0"
              >
                <span class="home-pending-row__icon" :class="row.item.tone ? `is-${row.item.tone}` : null" aria-hidden="true">
                  <component :is="row.icon" :size="14" aria-hidden="true" />
                </span>
                <span class="home-pending-row__main">
                  <strong>{{ row.item.title }}</strong>
                  <span>{{ row.item.detail }}</span>
                </span>
                <span class="home-pending-row__side">
                  <span
                    v-if="row.actionError"
                    class="home-pending-row__error"
                    :title="row.actionError"
                  >
                    {{ row.actionError }}
                  </span>
                  <span
                    v-else
                    class="home-pending-row__repo"
                    :title="row.repoFullName"
                  >
                    {{ row.repoFullName }}
                  </span>
                  <span
                    v-if="row.actions.length || row.link.kind !== 'none'"
                    class="home-pending-row__actions"
                    aria-label="快捷操作"
                  >
                    <button
                      v-for="action in row.actions"
                      :key="action"
                      type="button"
                      class="home-pending-action"
                      :class="{
                        'home-pending-action--ok': action === 'issue-complete' || action === 'pull-merge',
                        'home-pending-action--danger': action === 'issue-close' || action === 'pull-close',
                      }"
                      :aria-label="homePendingActionLabel(action)"
                      :title="homePendingActionLabel(action)"
                      :data-agent-id="homePendingActionAgentId(row.item, action)"
                      :disabled="Boolean(row.runningAction)"
                      @click.stop="runHomePendingAction(row.item, action)"
                    >
                      <LoaderCircle
                        v-if="row.runningAction === action"
                        :size="11"
                        aria-hidden="true"
                        class="sb-spin"
                      />
                      <component
                        v-else
                        :is="homePendingActionIcon(action)"
                        :size="13"
                        aria-hidden="true"
                      />
                    </button>
                    <a
                      v-if="row.link.kind !== 'none'"
                      class="home-pending-row__jump"
                      :href="homePendingItemHref(row.link)"
                      :aria-label="`打开 ${row.item.title}`"
                      title="打开"
                      :data-agent-id="`home.pending.${row.item.id}.open`"
                      @click="openHomePendingLink($event, row.link)"
                    >
                      <ArrowRight :size="13" aria-hidden="true" />
                    </a>
                  </span>
                </span>
              </li>
            </ol>
          </div>
        </div>

        <div class="card repo-status-card">
          <div class="repo-status-heading">
            <h2>
              仓库状态
              <span class="repo-status-heading__count">{{ repoStatusRows.length }}</span>
              <LoaderCircle v-if="githubReposLoading" :size="13" aria-hidden="true" class="card-title-loader" />
            </h2>
            <div class="repo-status-heading__tools">
              <button
                type="button"
                class="overview-actions__btn repo-status-sort-button"
                data-agent-id="home.repo-status.sort"
                :title="`排序：${repoStatusSortLabel}`"
                :aria-label="`仓库排序：${repoStatusSortLabel}`"
                @click="openRepoStatusSortMenu"
              >
                <span>{{ activeRepoStatusSortOption.label }} {{ repoStatusSort.direction === "asc" ? "↑" : "↓" }}</span>
              </button>
            </div>
          </div>
          <p v-if="githubReposError" class="repo-status-error">
            {{ githubReposError }}
            <button type="button" class="ghost" :disabled="githubReposLoading" @click="loadGitHubRepoStatus({ force: true })">
              重试
            </button>
          </p>
          <div class="home-scroll-card__body">
            <div
              class="repo-status-list"
              aria-label="仓库状态列表"
            >
              <p v-if="githubReposLoading && !repoStatusRows.length" class="repo-status-empty">正在加载 GitHub 项目...</p>
              <div
                v-for="{ githubRepo, localRepo, action, syncIssue } in visibleRepoStatusRows"
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

    <RepoCreateCard
      :open="createRepoCardOpen"
      :mode="createRepoCardMode"
      :workspace-ready="Boolean(workspace.workspaceRoot.value)"
      :github-ready="workspace.isAuthorized.value"
      :repo-groups="repoGroups"
      @close="closeCreateRepoCard"
      @local-created="placeCreatedRepo"
      @remote-cloned="placeClonedCreatedRepo"
    />
    <HomeCloneDialog
      v-if="cloneDialog.open"
      v-bind="cloneDialog.props"
      :repo-groups="repoGroups"
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

.contribution-stack {
  display: grid;
  align-content: stretch;
  gap: 8px;
  width: 100%;
  max-width: 760px;
  min-width: 0;
}

.contribution-stack > :first-child {
  height: 100%;
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

.language-card {
  min-width: 0;
  contain: layout paint style;
  content-visibility: auto;
  contain-intrinsic-size: 220px;
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
  contain: layout paint;
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
  contain: layout paint style;
  content-visibility: auto;
  contain-intrinsic-size: 420px;
}

.home-scroll-card__body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
  contain: layout paint style;
}

.home-pending-list {
  display: grid;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.home-pending-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) minmax(104px, 32%);
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 30px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 12px;
}

.home-pending-row:hover {
  background: var(--bg-hover);
}

.home-pending-row:focus-visible,
.home-pending-row:focus-within {
  outline: 0;
  border-color: var(--border-strong);
  background: var(--bg-active);
}

.home-pending-row__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--accent);
}

.home-pending-row__icon.is-error {
  color: var(--err);
}

.home-pending-row__icon.is-warn {
  color: var(--warn);
}

.home-pending-row__icon.is-ok {
  color: var(--ok);
}

.home-pending-row__icon.is-muted {
  color: var(--text-muted);
}

.home-pending-row__main {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.home-pending-row__main strong {
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: 700;
  white-space: nowrap;
}

.home-pending-row__main span {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-pending-row__side {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  height: 24px;
}

.home-pending-row__repo,
.home-pending-row__error {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.12s ease;
}

.home-pending-row__repo {
  color: var(--text-faint);
  font-weight: 600;
}

.home-pending-row__error {
  color: var(--err);
  font-weight: 700;
}

.home-pending-row__actions {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, visibility 0.12s ease;
}

.home-pending-row.has-hover-controls:hover .home-pending-row__repo,
.home-pending-row.has-hover-controls:focus-within .home-pending-row__repo,
.home-pending-row.has-hover-controls:hover .home-pending-row__error,
.home-pending-row.has-hover-controls:focus-within .home-pending-row__error {
  opacity: 0;
}

.home-pending-row.has-hover-controls:hover .home-pending-row__actions,
.home-pending-row.has-hover-controls:focus-within .home-pending-row__actions {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
}

.home-pending-action,
.home-pending-row__jump {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  line-height: 1;
  text-decoration: none;
  background: transparent;
}

.home-pending-action {
  padding: 0;
  color: var(--text);
}

.home-pending-action--ok {
  color: var(--ok);
}

.home-pending-action--danger {
  color: var(--err);
}

.home-pending-action:hover,
.home-pending-action:focus-visible,
.home-pending-row__jump:hover,
.home-pending-row__jump:focus-visible {
  background: var(--bg-hover);
  outline: 0;
}

.home-pending-action:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.home-pending-row__jump {
  color: var(--text-muted);
}

.repo-status-heading {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.repo-status-heading h2 {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin: 0;
}

.repo-status-heading__count {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.repo-status-heading__tools {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}

.repo-status-sort-button {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.repo-status-list {
  display: grid;
  gap: 2px;
  min-width: 0;
  contain: layout paint;
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

  .home-pending-row {
    grid-template-columns: 18px minmax(0, 1fr) minmax(82px, 30%);
    gap: 5px;
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
