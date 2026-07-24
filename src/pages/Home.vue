<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, shallowRef, watch, type Component } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
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
  Send,
  ShieldCheck,
  Pin,
  X,
} from "@lucide/vue";
import { useComponentEpoch } from "../composables/useComponentEpoch";
import { useCloneRepoDialog } from "../composables/useCloneRepoDialog";
import { cloneAccountPreferences, useAccountPreferences } from "../composables/useAccountPreferences";
import {
  buildCalendarHeatmapModel,
  Dropdown,
  UiDialog,
  openContextMenuAt,
  type ContextMenuItem,
} from "../ui";
import { createLatestAsyncLoader } from "../composables/useLatestAsyncLoader";
import {
  findWorkflowFailureWorktree,
  isWorkflowFailureHandoffRun,
  useHomeWorkflowFailureHandoff,
  type WorkflowFailureHandoffSession,
} from "../composables/useHomeWorkflowFailureHandoff";
import { useWorkspace } from "../composables/useWorkspace";
import {
  repoSyncIssuesByRepoId,
  type GitHubContributionsState,
  type RepoSyncIssueDisplay,
} from "../composables/workspace/state";
import {
  cancelGitHubWorkflowRun,
  listGitHubAccountIssues,
  listGitHubActionNotifications,
  mergeGitHubPullRequest,
  rerunFailedGitHubWorkflowRun,
  updateGitHubIssue,
  updateGitHubPullRequest,
  type GitHubActionNotification,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubRepoSummary,
  type GitHubRepoOwner,
  type GitHubRepositoryScope,
  type ContributionIdentityRecommendation,
  type ContributionIdentityRecommendationResult,
  type BulkOperation,
  type RepoPullLocalChangesMode,
  type RepoSummary,
  type WorkspaceRepoPlacement,
  type WorkspaceSettings,
} from "../services/workspace";
import { clearGitHubRepoCache } from "../services/workspace/cache";
import {
  listGitHubHomeAttention,
  mergeHomeAttentionResult,
  type HomeAttentionResult,
} from "../services/homeAttention";
import { isGitHubBindingExpiredError } from "../utils/githubErrors";
import {
  workflowCancelErrorMessage,
  workflowRerunErrorMessage,
  workflowRunWriteActionAvailability,
} from "../utils/workflowActions";
import {
  clearHomeGitHubOverviewSnapshot,
  homeGitHubOverviewSnapshotNeedsRefresh,
  readHomeGitHubOverviewSnapshot,
  writeHomeGitHubOverviewSnapshot,
} from "./homeOverviewCache";
import ContributionIdentityRecommendations from "../components/ContributionIdentityRecommendations.vue";
import HomeContributionCard from "../components/home/HomeContributionCard.vue";
import HomeCloneDialog from "../components/home/HomeCloneDialog.vue";
import GitHubRepositoryStateNotice from "../components/github/GitHubRepositoryStateNotice.vue";
import RepoCreateCard from "../components/sidebar/RepoCreateCard.vue";
import { bulkResultTone, repoDisplayName } from "../utils/repoDisplay";
import {
  favoriteRepositories,
  type FavoriteRepositoryEntry,
} from "../utils/repoFavorites";
import { buildHomeContinueItems, type HomeContinueItem } from "../utils/homeContinueItems";
import {
  buildHomePendingItems,
  cloneGitHubIssue,
  cloneGitHubPullRequest,
  groupAccountIssuesByRepo,
  groupActionNotificationsByRepo,
  groupHomePendingItemsByBucket,
  replaceReposByFullName,
  shouldLoadHomePendingAccountIssues,
  shouldLoadHomePendingActionNotifications,
  type HomePendingItem,
  type HomePendingRepoSource,
} from "../utils/homePendingItems";
import { buildProjectMomentum, type ProjectMomentum } from "../utils/projectMomentum";
import {
  repoCalculatesHomeTimeline,
  repoIncludedInHomeCodeStats,
} from "../config/repoSettingsManifest";
import { representativeReposByGitHubFullName, representativeReposBySharedGroup } from "../utils/repoWorktree";
import { githubRepositoryIdentityKey, remoteRepoRoute, shortcutFromGitHubRepo } from "../utils/remoteRepo";
import { repoConflictRoute, repoProjectRoute, repoRoute } from "../utils/repoRoutes";
import {
  buildLanguageOverviewFromRepos,
  buildProjectCodeOverviewFromRepos,
  formatBytes,
  formatPercent,
} from "../utils/languageStats";
import {
  compareRepoSortItems,
  nextRepoSort,
  nextRepoSortDisplayLabel,
  readRepoSort,
  repoSortDisplayLabel,
  writeRepoSort,
  type RepoSortState,
  type SortDirection,
} from "../utils/repoSort";
import {
  contributionIdentityKey,
  mergeContributionIdentity,
} from "../utils/contributionIdentities";
import {
  ALL_GITHUB_REPOSITORIES,
  githubOrganizationAccessLimited,
  githubOrganizationAccessMessage,
  githubOrganizationAccessRecovery,
  githubOrganizationOwners,
  githubRepositoryPermissionLabel,
  githubRepositoryScopeFromQuery,
  githubRepositoryScopeKey,
  githubUserFacingError,
  githubRepositoryScopeQuery,
} from "../utils/githubRepositoryScope";

const workspace = useWorkspace();
const workflowFailureHandoff = useHomeWorkflowFailureHandoff();
const activeNamedWorkspace = computed(() => workspace.activeWorkspace.value);
const hasAvailableWorkspaceRoot = computed(() => workspace.hasAvailableWorkspaceRoot.value);
const accountPreferences = useAccountPreferences();
const router = useRouter();
const route = useRoute();
const syncingRepoId = ref<string | null>(null);
const bulkLocalChangesMode = ref<RepoPullLocalChangesMode>("stash");
const createRepoCardOpen = ref(false);
const createRepoCardMode = ref<"local" | "remote">("local");
const searchOpen = ref(false);
const searchQuery = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const cloneDialog = useCloneRepoDialog({
  onCloned: placeClonedRepo,
});
const favoritePendingKeys = ref<Set<string>>(new Set());
const favoriteError = ref<string | null>(null);
const workspaceCreateOpen = ref(false);
const workspaceCreateName = ref("");
const workspaceCreateRoot = ref("");
const workspaceCreateBusy = ref(false);
const choosingInitialWorkspaceRoot = ref(false);

async function chooseWorkspaceRoot() {
  if (choosingInitialWorkspaceRoot.value) return;
  choosingInitialWorkspaceRoot.value = true;
  try {
    const root = await workspace.pickWorkspaceRoot();
    if (!root) return;
    const active = activeNamedWorkspace.value;
    if (active) {
      await workspace.addWorkspaceRoot(active.id, root);
      return;
    }
    workspaceCreateRoot.value = root;
    const rootSegments = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
    workspaceCreateName.value = rootSegments[rootSegments.length - 1] ?? "默认工作区";
    workspaceCreateOpen.value = true;
  } catch {
    // The workspace lifecycle exposes the failure through its shared error state.
  } finally {
    choosingInitialWorkspaceRoot.value = false;
  }
}

async function createInitialWorkspace() {
  const name = workspaceCreateName.value.trim();
  if (!name || workspaceCreateBusy.value) return;
  workspaceCreateBusy.value = true;
  try {
    await workspace.createWorkspace(name, workspaceCreateRoot.value);
    workspaceCreateOpen.value = false;
  } finally {
    workspaceCreateBusy.value = false;
  }
}

type RepoAction = {
  label: string;
  title: string;
} & (
  {
    kind: "conflict";
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
  momentum: ProjectMomentum;
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

type HomePendingAction =
  | "issue-complete"
  | "issue-close"
  | "pull-merge"
  | "pull-close"
  | "workflow-rerun"
  | "workflow-cancel";

type HomePendingRow = {
  item: HomePendingItem;
  icon: Component;
  repoFullName: string;
  link: HomePendingLink;
  actions: HomePendingAction[];
  handoff: HomePendingWorkflowHandoff | null;
  confirmingAction: HomePendingAction | null;
  runningAction: HomePendingAction | null;
};

type HomePendingSection = {
  id: "attention" | "today" | "continue";
  title: string;
  rows?: HomePendingRow[];
  continueItems?: HomeContinueItem[];
};

type HomePendingWorkflowHandoff = {
  worktree: RepoSummary | null;
  sourceRoute: string;
  unavailableReason: string | null;
  accepted: boolean;
  expanded: boolean;
  busy: boolean;
  error: string | null;
  buttonLabel: string;
  statusText: string | null;
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
const HOME_PENDING_ITEM_LIMIT = 20;
const GITHUB_ACCOUNT_ISSUES_PER_PAGE = 100;
const GITHUB_ACTION_NOTIFICATIONS_PER_PAGE = 50;
const LEGACY_REPO_STATUS_SORT_STORAGE_KEY = "lilia-github.home.repoStatusSort.v1";
const REPO_STATUS_SORT_STORAGE_PREFIX = "lilia-github.home.repoStatusSort.v2";
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
const hoveredCodeSlice = ref<HomeCodeSlice | null>(null);
const discovering = ref(false);
const githubRepos = ref<GitHubRepoSummary[]>([]);
const githubReposNextPage = ref<number | null>(null);
const githubReposLoading = ref(false);
const githubReposLoadingMore = ref(false);
const githubReposError = ref<string | null>(null);
const githubReposLoaded = ref(false);
const githubRepoOwners = ref<GitHubRepoOwner[]>([]);
const githubRepoOwnersLoading = ref(false);
const githubRepoOwnersError = ref<string | null>(null);
const githubRepositoryScope = ref<GitHubRepositoryScope>(repositoryScopeFromRouteOrPreferences([]));
const githubIssuesByRepo = ref<Record<string, GitHubIssue[] | undefined>>({});
const githubPullRequestsByRepo = ref<Record<string, GitHubPullRequest[] | undefined>>({});
const githubAccountIssuesLoading = ref(false);
const githubActionNotificationsByRepo = ref<Record<string, GitHubActionNotification[] | undefined>>({});
const githubActionNotificationsLoading = ref(false);
const githubTimelineError = ref<string | null>(null);
const homeAttentionResult = shallowRef<HomeAttentionResult | null>(null);
const homeAttentionLoadedKey = ref("");
const homeAttentionLoading = ref(false);
const homeAttentionError = ref<string | null>(null);
const homePendingRunningActions = ref<Record<string, HomePendingAction | undefined>>({});
const homePendingArmedAction = ref<{ itemId: string; action: HomePendingAction } | null>(null);
const homePendingMutationError = ref<string | null>(null);
const cloningFullNames = reactive(new Set<string>());
const repoStatusVisibleCount = ref(REPO_STATUS_RENDER_PAGE_SIZE);
const repoStatusSort = ref<RepoStatusSortState>(
  {
    sort: accountPreferences.value.repositorySort.key,
    direction: accountPreferences.value.repositorySort.direction,
  },
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
const githubRepoOwnersLoader = createLatestAsyncLoader({ componentEpoch, trackSessionContext: false });
const githubScopePages = new Map<string, {
  items: GitHubRepoSummary[];
  nextPage: number | null;
  error: string | null;
  loaded: boolean;
}>();
let searchRepoPagesLoading = false;
let homeOverviewInitialized = false;
let activeHomeBindingIdentity: string | null | undefined;
let repoStatusSortBindingIdentity: string | null | undefined;
let repoStatusSortSelectedOnPage = false;
let homeContributionRefreshGeneration = 0;
const repoGroups = computed(() => workspace.state.settings?.repoGroups ?? []);
const homeFavoritesByKey = computed(() => new Map(
  favoriteRepositories(workspace.state.settings, workspace.state.repos)
    .map((favorite) => [favorite.key, favorite]),
));

function favoritePending(key: string) {
  return favoritePendingKeys.value.has(key);
}

async function runFavoriteMutation(key: string, mutation: () => Promise<unknown>) {
  if (favoritePending(key)) return;
  favoriteError.value = null;
  favoritePendingKeys.value = new Set(favoritePendingKeys.value).add(key);
  try {
    await mutation();
  } catch (err) {
    favoriteError.value = `置顶更新失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    const next = new Set(favoritePendingKeys.value);
    next.delete(key);
    favoritePendingKeys.value = next;
  }
}

function githubRepoFavorite(repo: GitHubRepoSummary) {
  return homeFavoritesByKey.value.has(`github:${githubRepositoryIdentityKey(repo.fullName)}`);
}

async function toggleGitHubRepoFavorite(repo: GitHubRepoSummary) {
  const key = `github:${githubRepositoryIdentityKey(repo.fullName)}`;
  const current = homeFavoritesByKey.value.get(key);
  if (current) {
    await removeHomeFavorite(current);
    return;
  }
  const localRepo = localRepoByGitHubFullName.value.get(githubRepositoryIdentityKey(repo.fullName));
  await runFavoriteMutation(key, () => localRepo
    ? workspace.setLocalRepoFavorite(localRepo.id, true)
    : workspace.setRemoteRepoFavorite(shortcutFromGitHubRepo(repo), true));
}

async function removeHomeFavorite(favorite: FavoriteRepositoryEntry) {
  await runFavoriteMutation(favorite.key, async () => {
    if (favorite.localFavorite && favorite.localRepo) {
      await workspace.setLocalRepoFavorite(favorite.localRepo.id, false);
    }
    if (favorite.remoteFavorite && favorite.remoteShortcut) {
      await workspace.setRemoteRepoFavorite({ ...favorite.remoteShortcut }, false);
    }
  });
}

const githubOrganizationOwnerOptions = computed(() => githubOrganizationOwners(githubRepoOwners.value));
const githubOrganizationVisibilityLimited = computed(() =>
  githubOrganizationAccessLimited(workspace.githubBinding.value?.scopes, githubRepoOwners.value),
);
const githubOrganizationRecovery = computed(() => githubOrganizationAccessRecovery(githubRepoOwners.value));
const githubOrganizationVisibilityMessage = computed(() => githubOrganizationAccessMessage(githubRepoOwners.value));
const homeRepositoryScopeOptions = computed(() => {
  const personalLogin = workspace.githubBinding.value?.login ?? "";
  return [
    { value: "all", label: "全部", agentId: "home.repo-status.scope.all" },
    {
      value: "personal",
      label: personalLogin || "个人",
      disabled: !personalLogin,
      agentId: "home.repo-status.scope.personal",
    },
    ...githubOrganizationOwnerOptions.value.map((owner) => ({
      value: `organization:${owner.login}`,
      label: owner.login,
      agentId: `home.repo-status.scope.organization.${owner.login}`,
    })),
  ];
});
const homeRepositoryScopeValue = computed({
  get: () => {
    const scope = githubRepositoryScope.value;
    return scope.kind === "organization" ? `organization:${scope.login}` : scope.kind;
  },
  set: (value: string) => {
    const login = workspace.githubBinding.value?.login ?? "";
    if (value === "personal") {
      if (login) void selectHomeRepositoryScope({ kind: "personal", login });
      return;
    }
    if (value.startsWith("organization:")) {
      void selectHomeRepositoryScope({ kind: "organization", login: value.slice(13) });
      return;
    }
    void selectHomeRepositoryScope(ALL_GITHUB_REPOSITORIES);
  },
});
const emptySyncIssuesByRepoId = new Map<string, RepoSyncIssueDisplay>();
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
const overviewContributions = computed(() =>
  homeContributionSnapshot.value ?? {
    ...workspace.state.githubContributions,
    loading: workspace.state.loading || workspace.state.githubContributions.loading,
  },
);

const contributionHeatmapModel = computed(() =>
  buildCalendarHeatmapModel(overviewContributions.value.days.map((day) => ({
    date: day.date,
    value: day.count,
  })), {
    cellSize: 13,
    cellGap: 3,
    cellRadius: 3,
    titleFormatter: (day) => `${day.date}：${day.value} 次提交`,
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

function selectLanguageChartMode(mode: LanguageChartMode) {
  hoveredCodeSlice.value = null;
  languageChartMode.value = mode;
}

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
    .filter((repo) => !searchLocalRepoByGitHubFullName.has(githubRepositoryIdentityKey(repo.fullName)))
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

const homePendingItems = computed(() =>
  buildHomePendingItems(buildGitHubTimelineRepoSourcesSnapshot(), HOME_PENDING_ITEM_LIMIT),
);

const pendingItemsByRepo = computed(() => {
  const grouped = new Map<string, HomePendingItem[]>();
  for (const item of homePendingItems.value) {
    const key = githubRepositoryIdentityKey(homePendingItemRepoFullName(item));
    const list = grouped.get(key);
    if (list) list.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
});

const repoStatusRows = computed<RepoStatusRow[]>(() =>
  overviewGitHubRepos.value.filter((repo) => !repo.disabled).map((githubRepo) => {
    const localRepo = localRepoByGitHubFullName.value.get(githubRepositoryIdentityKey(githubRepo.fullName)) ?? null;
    const syncIssue = localRepo ? overviewSyncIssuesByRepoId.value.get(localRepo.id) ?? null : null;
    return {
      githubRepo,
      localRepo,
      action: localRepo ? repoAction(localRepo) : null,
      syncIssue,
      momentum: buildProjectMomentum({
        githubRepo,
        localRepo,
        syncIssue,
        pendingItems: pendingItemsByRepo.value.get(githubRepositoryIdentityKey(githubRepo.fullName)) ?? [],
      }),
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
const homeAttentionPullRequestsByRepo = computed(() => groupHomeAttentionItemsByRepo(
  homeAttentionResult.value?.pendingPullRequests.items ?? [],
));
const homeAttentionWorkflowRunsByRepo = computed(() => groupHomeAttentionItemsByRepo(
  homeAttentionResult.value?.workflowRuns.items ?? [],
));
function groupHomeAttentionItemsByRepo<T extends { repoFullName: string }>(items: readonly T[]) {
  return items.reduce<Record<string, T[]>>((grouped, item) => {
    (grouped[item.repoFullName] ??= []).push(item);
    return grouped;
  }, {});
}

function buildGitHubTimelineRepoSourcesSnapshot(): HomePendingRepoSource[] {
  const remoteSources = homeTimelineRepos.value
    .map((githubRepo) => ({
      githubRepo,
      localRepo: localRepoByGitHubFullName.value.get(githubRepositoryIdentityKey(githubRepo.fullName)) ?? null,
      syncIssue: repoSyncIssueForTimeline(githubRepo),
      issues: overviewIssuesByRepo.value[githubRepo.fullName] ?? [],
      pullRequests: overviewPullRequestsByRepo.value[githubRepo.fullName] ?? [],
      pullRequestChecksByPull: undefined,
      actionNotifications: overviewActionNotificationsByRepo.value[githubRepo.fullName] ?? [],
      attentionPullRequests: homeAttentionPullRequestsByRepo.value[githubRepo.fullName] ?? [],
      workflowRuns: homeAttentionWorkflowRunsByRepo.value[githubRepo.fullName] ?? [],
    }));
  const remoteNames = new Set(remoteSources.map(({ githubRepo }) => githubRepositoryIdentityKey(githubRepo.fullName)));
  const localSources = overviewStatusRepos.value.flatMap((localRepo): HomePendingRepoSource[] => {
    const fullName = localRepo.githubFullName || localRepo.name;
    if (remoteNames.has(githubRepositoryIdentityKey(fullName))) return [];
    if (!repoCalculatesHomeTimeline(homeOverviewSnapshot.value?.settings ?? null, localRepo.id)) return [];
    return [{
      githubRepo: {
        fullName,
        updatedAt: new Date(Math.max(0, localRepo.lastCommitAt ?? 0) * 1000).toISOString(),
      },
      localRepo,
      syncIssue: overviewSyncIssuesByRepoId.value.get(localRepo.id) ?? null,
      issues: [],
      pullRequests: [],
      pullRequestChecksByPull: undefined,
      actionNotifications: [],
      attentionPullRequests: [],
      workflowRuns: [],
    }];
  });
  return [...remoteSources, ...localSources];
}

const homeContinueItems = computed(() =>
  buildHomeContinueItems({
    recentContext: activeNamedWorkspace.value?.recentContext ?? null,
    recentLocalRepos: activeNamedWorkspace.value?.recentLocalRepos ?? [],
    repos: overviewStatusRepos.value,
    currentRoute: route.fullPath,
  }),
);
const homePendingSections = computed<HomePendingSection[]>(() => {
  const { attention, today } = groupHomePendingItemsByBucket(homePendingItems.value);
  const sections: HomePendingSection[] = [];
  if (attention.length) {
    sections.push({ id: "attention", title: "Attention", rows: attention.map(toHomePendingRow) });
  }
  if (today.length) {
    sections.push({ id: "today", title: "Today", rows: today.map(toHomePendingRow) });
  }
  if (homeContinueItems.value.length) {
    sections.push({ id: "continue", title: "Continue", continueItems: homeContinueItems.value });
  }
  return sections;
});
const homeDecisionEmpty = computed(() => homePendingSections.value.length === 0);
const githubTimelineBusy = computed(() =>
  githubReposLoading.value ||
  githubAccountIssuesLoading.value ||
  githubActionNotificationsLoading.value ||
  homeAttentionLoading.value ||
  homeTimelineAccountIssuesPending.value ||
  homeTimelineActionNotificationsPending.value,
);
const homePendingError = computed(() => githubTimelineError.value || homeAttentionError.value);

let githubPendingGeneration = 0;
let githubAccountIssuesGeneration = 0;
let homeAttentionGeneration = 0;
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

watch(
  () => [route.query.githubScope, route.query.githubOwner, githubRepoOwners.value] as const,
  () => {
    if (githubRepoOwnersLoading.value) return;
    const scope = repositoryScopeFromRouteOrPreferences(githubRepoOwners.value);
    if (githubRepositoryScopeKey(scope) !== githubRepositoryScopeKey(githubRepositoryScope.value)) {
      void selectHomeRepositoryScope(scope, false);
    }
  },
);

onUnmounted(() => {
  githubPendingGeneration += 1;
  homeContributionRefreshGeneration += 1;
  githubRepoStatusLoader.invalidate();
  githubRepoMoreLoader.invalidate();
  githubRepoOwnersLoader.invalidate();
});

watch(
  () => [workspace.isReady.value, currentGitHubBindingIdentity()] as const,
  ([ready, bindingIdentity]) => {
    const bindingChanged = activeHomeBindingIdentity !== undefined
      && activeHomeBindingIdentity !== bindingIdentity;
    activeHomeBindingIdentity = bindingIdentity;
    if (!ready) {
      resetHomeGitHubBindingState({ clearAccountCaches: bindingChanged });
      return;
    }
    if (bindingChanged) resetHomeGitHubBindingState({ clearAccountCaches: true });
    void loadGitHubRepoOwners();
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
    void loadGitHubRepoStatus({ force: bindingChanged });
  },
  { immediate: true },
);

watch(
  () => [
    workspace.isReady.value,
    activeNamedWorkspace.value?.id,
    activeNamedWorkspace.value?.viewPreferences.homeRepositoryStatusSort,
    currentGitHubBindingIdentity(),
    accountPreferences.value.repositorySort.key,
    accountPreferences.value.repositorySort.direction,
  ] as const,
  ([ready, , , bindingIdentity]) => {
    if (!ready) return;
    if (repoStatusSortBindingIdentity === bindingIdentity && repoStatusSortSelectedOnPage) return;
    const stored = readStoredRepoStatusSort();
    repoStatusSort.value = stored.value;
    repoStatusSortBindingIdentity = bindingIdentity;
    repoStatusSortSelectedOnPage = stored.exists;
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
    const key = githubRepositoryIdentityKey(item.fullName);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

function rememberGitHubScopePage(loaded = true) {
  githubScopePages.set(githubRepositoryScopeKey(githubRepositoryScope.value), {
    items: githubRepos.value.map((repo) => ({ ...repo })),
    nextPage: githubReposNextPage.value,
    error: githubReposError.value,
    loaded,
  });
}

function restoreGitHubScopePage(scope: GitHubRepositoryScope) {
  const page = githubScopePages.get(githubRepositoryScopeKey(scope));
  githubRepos.value = page?.items.map((repo) => ({ ...repo })) ?? [];
  githubReposNextPage.value = page?.nextPage ?? null;
  githubReposError.value = page?.error ?? null;
  githubReposLoaded.value = page?.loaded ?? false;
  commitHomeOverviewSnapshotFromGitHubState();
  return page?.loaded ?? false;
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
  githubReposLoaded.value = true;
  rememberGitHubScopePage();
  commitHomeOverviewSnapshotFromGitHubState();
  writeGitHubRepoOverviewSnapshot();
  prepareGitHubTimeline(githubRepos.value, refreshIssues);
}

async function loadGitHubRepoOwners() {
  await githubRepoOwnersLoader.run("home-github-owners", async (runId) => {
    githubRepoOwnersLoading.value = true;
    githubRepoOwnersError.value = null;
    try {
      const owners = await workspace.getAccountRepositoryOwners();
      if (!githubRepoOwnersLoader.isCurrent(runId)) return;
      githubRepoOwners.value = owners;
      const routeScope = repositoryScopeFromRouteOrPreferences(owners);
      if (githubRepositoryScopeKey(routeScope) !== githubRepositoryScopeKey(githubRepositoryScope.value)) {
        await selectHomeRepositoryScope(routeScope, false);
      }
    } catch (err) {
      if (!githubRepoOwnersLoader.isCurrent(runId)) return;
      githubRepoOwnersError.value = `账号与组织加载失败：${githubUserFacingError(err)}`;
    } finally {
      if (githubRepoOwnersLoader.isCurrent(runId)) githubRepoOwnersLoading.value = false;
    }
  });
}

async function selectHomeRepositoryScope(scope: GitHubRepositoryScope, updateRoute = true) {
  if (githubRepositoryScopeKey(scope) === githubRepositoryScopeKey(githubRepositoryScope.value)) return;
  rememberGitHubScopePage(githubReposLoaded.value);
  githubPendingGeneration += 1;
  githubRepositoryScope.value = scope;
  const restored = restoreGitHubScopePage(scope);
  repoStatusVisibleCount.value = REPO_STATUS_RENDER_PAGE_SIZE;
  if (updateRoute) {
    await router.replace({ query: { ...route.query, ...githubRepositoryScopeQuery(scope) } });
    try {
      const next = cloneAccountPreferences(accountPreferences.value);
      next.repositoryScope = scope.kind === "all" ? { kind: "all" } : { kind: scope.kind, login: scope.login };
      await workspace.updateAccountPreferences(next);
    } catch {
      // Keep scope switch even if preference persistence fails.
    }
  }
  if (restored) {
    prepareGitHubTimeline(githubRepos.value);
  } else {
    await loadGitHubRepoStatus();
  }
}

async function openOrganizationAuthorization() {
  if (githubOrganizationRecovery.value.url) {
    await workspace.openUrl(githubOrganizationRecovery.value.url);
    return;
  }
  await router.push({ path: "/settings", query: { tab: "account" } });
}

function preferredRepositoryScope(owners: readonly GitHubRepoOwner[]): GitHubRepositoryScope {
  const preferred = accountPreferences.value.repositoryScope;
  const login = workspace.githubBinding.value?.login ?? "";
  if (preferred.kind === "personal") {
    return login ? { kind: "personal", login } : ALL_GITHUB_REPOSITORIES;
  }
  if (preferred.kind === "organization") {
    const organization = owners.find((owner) =>
      owner.kind === "organization" && owner.login.toLocaleLowerCase() === preferred.login.toLocaleLowerCase()
    );
    return organization ? { kind: "organization", login: organization.login } : ALL_GITHUB_REPOSITORIES;
  }
  return ALL_GITHUB_REPOSITORIES;
}

function repositoryScopeFromRouteOrPreferences(owners: readonly GitHubRepoOwner[]) {
  if (route.query.githubScope == null) return preferredRepositoryScope(owners);
  return githubRepositoryScopeFromQuery(
    route.query.githubScope,
    route.query.githubOwner,
    workspace.githubBinding.value?.login ?? "",
    owners,
  );
}

function currentGitHubAccountLogin() {
  return workspace.githubBinding.value?.login ?? null;
}

function currentGitHubBindingIdentity() {
  const binding = workspace.githubBinding.value;
  if (!binding) return null;
  return JSON.stringify([
    binding.login.toLocaleLowerCase(),
    binding.boundAt,
    [...binding.scopes].sort(),
  ]);
}

function resetHomeGitHubBindingState(options: { clearAccountCaches?: boolean } = {}) {
  homeOverviewInitialized = false;
  homeContributionRefreshGeneration += 1;
  githubPendingGeneration += 1;
  githubAccountIssuesGeneration += 1;
  githubRepoStatusLoader.invalidate();
  githubRepoMoreLoader.invalidate();
  githubRepoOwnersLoader.invalidate();
  searchRepoPagesLoading = false;
  githubRepos.value = [];
  githubReposNextPage.value = null;
  githubReposLoading.value = false;
  githubReposLoadingMore.value = false;
  githubReposError.value = null;
  githubReposLoaded.value = false;
  githubRepoOwners.value = [];
  githubRepoOwnersLoading.value = false;
  githubRepoOwnersError.value = null;
  githubScopePages.clear();
  githubRepositoryScope.value = preferredRepositoryScope([]);
  githubIssuesByRepo.value = {};
  githubPullRequestsByRepo.value = {};
  githubActionNotificationsByRepo.value = {};
  githubAccountIssuesLoading.value = false;
  githubActionNotificationsLoading.value = false;
  githubTimelineError.value = null;
  homeAttentionGeneration += 1;
  homeAttentionResult.value = null;
  homeAttentionLoadedKey.value = "";
  homeAttentionLoading.value = false;
  homeAttentionError.value = null;
  homePendingMutationError.value = null;
  homeOverviewSnapshot.value = null;
  homeContributionSnapshot.value = null;
  repoStatusVisibleCount.value = REPO_STATUS_RENDER_PAGE_SIZE;
  if (options.clearAccountCaches) {
    clearGitHubRepoCache();
    clearHomeGitHubOverviewSnapshot();
  }
}

function restoreGitHubOverviewSnapshot() {
  if (githubRepositoryScope.value.kind !== "all") return null;
  const snapshot = readHomeGitHubOverviewSnapshot();
  if (!snapshot) return null;
  if (snapshot.accountLogin !== currentGitHubAccountLogin()) {
    clearHomeGitHubOverviewSnapshot();
    return null;
  }
  githubRepos.value = snapshot.repos;
  githubReposNextPage.value = snapshot.nextPage;
  githubReposLoaded.value = true;
  githubIssuesByRepo.value = snapshot.issuesByRepo;
  githubPullRequestsByRepo.value = snapshot.pullRequestsByRepo;
  githubActionNotificationsByRepo.value = snapshot.actionNotificationsByRepo;
  githubReposError.value = null;
  commitHomeOverviewSnapshotFromGitHubState();
  rememberGitHubScopePage();
  prepareGitHubTimeline(snapshot.repos);
  return snapshot;
}

function writeGitHubRepoOverviewSnapshot() {
  if (githubRepositoryScope.value.kind !== "all") return;
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
  return `GitHub 仓库列表加载失败：${githubUserFacingError(err)}`;
}

async function loadHomePendingAccountIssues(repos: GitHubRepoSummary[], refresh = false) {
  if (!repos.length) return;
  const alreadyLoaded = repos.every((repo) =>
    githubIssuesByRepo.value[repo.fullName] != null &&
    githubPullRequestsByRepo.value[repo.fullName] != null
  );
  if (!refresh && alreadyLoaded) return;

  const generation = githubPendingGeneration;
  const accountIssuesGeneration = githubAccountIssuesGeneration;
  const isCurrent = () =>
    generation === githubPendingGeneration && accountIssuesGeneration === githubAccountIssuesGeneration;
  githubAccountIssuesLoading.value = true;
  githubTimelineError.value = null;
  try {
    const items = await listGitHubAccountIssues({
      state: "open",
      perPage: GITHUB_ACCOUNT_ISSUES_PER_PAGE,
      sort: "updated",
      direction: "desc",
    }, { forceRefresh: refresh });
    if (!isCurrent()) return;
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
    if (isCurrent()) {
      githubTimelineError.value = `Issue / PR 加载失败：${githubUserFacingError(err)}`;
    }
  } finally {
    if (isCurrent()) {
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
      githubTimelineError.value = `Actions 通知加载失败：${githubUserFacingError(err)}`;
    }
  } finally {
    if (generation === githubPendingGeneration) {
      githubActionNotificationsLoading.value = false;
    }
  }
}

async function loadHomeAttention(repos: GitHubRepoSummary[], refresh = false) {
  const repoFullNames = repos.map((repo) => repo.fullName);
  const key = homeAttentionRepositoryKey(repoFullNames);
  if (!key) {
    homeAttentionGeneration += 1;
    homeAttentionResult.value = null;
    homeAttentionLoadedKey.value = "";
    homeAttentionLoading.value = false;
    homeAttentionError.value = null;
    return;
  }
  if (!refresh && homeAttentionLoadedKey.value === key) return;

  const generation = ++homeAttentionGeneration;
  const pendingGeneration = githubPendingGeneration;
  const previous = homeAttentionLoadedKey.value === key ? homeAttentionResult.value : null;
  if (homeAttentionLoadedKey.value !== key) {
    homeAttentionResult.value = null;
    homeAttentionLoadedKey.value = key;
  }
  homeAttentionLoading.value = true;
  homeAttentionError.value = null;
  try {
    const result = await listGitHubHomeAttention(repoFullNames, { forceRefresh: refresh });
    if (generation !== homeAttentionGeneration || pendingGeneration !== githubPendingGeneration) return;
    homeAttentionResult.value = mergeHomeAttentionResult(previous, result);
    const failures = new Set([
      ...result.pendingPullRequests.failures.map((failure) => failure.repoFullName),
      ...result.workflowRuns.failures.map((failure) => failure.repoFullName),
    ]);
    if (failures.size) {
      homeAttentionError.value = `${failures.size} 个仓库的关注事项暂时无法读取。`;
    }
  } catch (err) {
    if (generation !== homeAttentionGeneration || pendingGeneration !== githubPendingGeneration) return;
    homeAttentionError.value = `关注事项加载失败：${githubUserFacingError(err)}`;
  } finally {
    if (generation === homeAttentionGeneration && pendingGeneration === githubPendingGeneration) {
      homeAttentionLoading.value = false;
    }
  }
}

function homeAttentionRepositoryKey(repoFullNames: readonly string[]) {
  return [...new Set(repoFullNames.map((name) => githubRepositoryIdentityKey(name)))]
    .sort()
    .join("\n");
}

function clearGitHubPendingItems() {
  githubAccountIssuesGeneration += 1;
  homeAttentionGeneration += 1;
  githubAccountIssuesLoading.value = false;
  githubActionNotificationsLoading.value = false;
  githubTimelineError.value = null;
  homeAttentionResult.value = null;
  homeAttentionLoadedKey.value = "";
  homeAttentionLoading.value = false;
  homeAttentionError.value = null;
  homePendingMutationError.value = null;
  githubIssuesByRepo.value = {};
  githubPullRequestsByRepo.value = {};
  githubActionNotificationsByRepo.value = {};
  commitHomeOverviewSnapshotFromGitHubState();
  clearHomeGitHubOverviewSnapshot();
}

function prepareGitHubTimeline(repos: GitHubRepoSummary[], refresh = false) {
  const timelineRepos = repos.filter((repo) => repoIncludedInHomeTimeline(repo));
  const shouldLoadIssues = shouldLoadHomePendingAccountIssues(
    timelineRepos,
    githubIssuesByRepo.value,
    githubPullRequestsByRepo.value,
    refresh,
  );
  const shouldLoadNotifications = shouldLoadHomePendingActionNotifications(
    timelineRepos,
    githubActionNotificationsByRepo.value,
    refresh,
  );
  const attentionKey = homeAttentionRepositoryKey(timelineRepos.map((repo) => repo.fullName));
  const shouldLoadAttention = Boolean(attentionKey) && (
    refresh || homeAttentionLoadedKey.value !== attentionKey
  );
  if (!shouldLoadIssues && !shouldLoadNotifications && !shouldLoadAttention) {
    githubAccountIssuesLoading.value = false;
    githubActionNotificationsLoading.value = false;
    homeAttentionLoading.value = false;
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
  homeAttentionLoading.value = shouldLoadAttention;
  if (generation !== githubPendingGeneration) return;
  if (shouldLoadIssues) void loadHomePendingAccountIssues(timelineRepos, refresh);
  if (shouldLoadNotifications) void loadHomePendingActionNotifications(timelineRepos, refresh);
  if (shouldLoadAttention) void loadHomeAttention(timelineRepos, refresh);
}

function retryHomePendingItems() {
  homePendingMutationError.value = null;
  prepareGitHubTimeline(homeTimelineRepos.value, true);
}

function repoIncludedInHomeTimeline(repo: GitHubRepoSummary) {
  if (repo.disabled) return false;
  const localRepo = localRepoByGitHubFullName.value.get(repo.fullName) ?? null;
  return !localRepo || repoCalculatesHomeTimeline(homeOverviewSnapshot.value?.settings ?? null, localRepo.id);
}

async function loadGitHubRepoStatus(options: { force?: boolean } = {}) {
  if (!workspace.isReady.value || githubReposLoading.value) return;
  const scope = githubRepositoryScope.value;
  const scopeKey = githubRepositoryScopeKey(scope);
  githubRepoMoreLoader.invalidate();
  githubReposLoadingMore.value = false;
  await githubRepoStatusLoader.run(options.force ? "overview-repos:force" : "overview-repos", async (runId) => {
    githubReposLoading.value = true;
    githubReposError.value = null;
    try {
      const page = await workspace.preloadGitHubRepos({ force: options.force, scope });
      if (!githubRepoStatusLoader.isCurrent(runId) || !workspace.isReady.value) return;
      if (githubRepositoryScopeKey(githubRepositoryScope.value) !== scopeKey) return;
      applyGitHubRepoPage(page, false, options.force);
    } catch (err) {
      if (!githubRepoStatusLoader.isCurrent(runId) || !workspace.isReady.value) return;
      githubReposError.value = githubRepoLoadErrorMessage(err);
      if (isGitHubBindingExpiredError(err)) {
        githubRepos.value = [];
        githubReposNextPage.value = null;
        githubReposLoaded.value = false;
        commitHomeOverviewSnapshotFromGitHubState();
      }
      rememberGitHubScopePage(githubReposLoaded.value);
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
  const scope = githubRepositoryScope.value;
  const scopeKey = githubRepositoryScopeKey(scope);
  await githubRepoMoreLoader.run(`overview-repos-more:${pageNumber}`, async (runId) => {
    githubReposLoadingMore.value = true;
    githubReposError.value = null;
    try {
      const page = await workspace.listGitHubRepos(scope, pageNumber);
      if (!githubRepoMoreLoader.isCurrent(runId) || githubReposNextPage.value !== pageNumber) return;
      if (githubRepositoryScopeKey(githubRepositoryScope.value) !== scopeKey) return;
      applyGitHubRepoPage(page, true);
    } catch (err) {
      if (!githubRepoMoreLoader.isCurrent(runId)) return;
      githubReposError.value = githubRepoLoadErrorMessage(err);
      rememberGitHubScopePage(githubReposLoaded.value);
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
      kind: "conflict",
      label: "处理冲突",
      title: `${repo.conflictCount} 个冲突文件待处理`,
      to: repoConflictRoute(repo.id),
    };
  }
  if (repo.behind > 0) {
    return {
      kind: "sync",
      label: "待同步",
      title: repo.ahead > 0
        ? "本地与远端已分叉，需要合并"
        : `远端领先 ${repo.behind} 个提交`,
    };
  }
  return null;
}

function repoSyncIssueForTimeline(githubRepo: GitHubRepoSummary) {
  const localRepo = localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null;
  return localRepo ? overviewSyncIssuesByRepoId.value.get(localRepo.id) ?? null : null;
}

function toHomePendingRow(item: HomePendingItem): HomePendingRow {
  const armedAction = homePendingArmedAction.value;
  const workflowWorktree = homePendingWorkflowWorktree(item);
  const link = homePendingItemLink(item, workflowWorktree);
  return {
    item,
    icon: homePendingItemIcon(item.kind),
    repoFullName: homePendingItemRepoFullName(item),
    link,
    actions: homePendingActions(item),
    handoff: homePendingWorkflowHandoff(item, link, workflowWorktree),
    confirmingAction: armedAction?.itemId === item.id ? armedAction.action : null,
    runningAction: homePendingRunningActions.value[item.id] ?? null,
  };
}

function homePendingWorkflowWorktree(item: HomePendingItem) {
  const target = item.target;
  if (target.kind !== "workflow" || !target.run || !isWorkflowFailureHandoffRun(target.run)) return null;
  const branch = target.run.branch.trim();
  return branch
    ? findWorkflowFailureWorktree(workspace.state.repos, target.repoFullName, branch)
    : null;
}

function homePendingWorkflowHandoff(
  item: HomePendingItem,
  link: HomePendingLink,
  worktree: RepoSummary | null,
): HomePendingWorkflowHandoff | null {
  const target = item.target;
  if (
    target.kind !== "workflow" ||
    !target.run ||
    !isWorkflowFailureHandoffRun(target.run)
  ) return null;

  const branch = target.run.branch?.trim() ?? "";
  const unavailableReason = !branch
    ? "该运行没有可用分支，无法交接"
    : !worktree
      ? `请先在本地检出 ${branch} 分支`
      : null;
  const session = worktree ? workflowFailureHandoff.getSession(item.id) : null;
  return {
    worktree,
    sourceRoute: link.kind === "route"
      ? link.to
      : remoteRepoProjectPath({ fullName: target.repoFullName }, "actions", target.run.id),
    unavailableReason,
    ...homePendingHandoffPresentation(session, unavailableReason),
  };
}

function homePendingHandoffPresentation(
  session: WorkflowFailureHandoffSession | null,
  unavailableReason: string | null,
) {
  const status = session?.status?.status;
  const accepted = status === "accepted" && Boolean(session?.status?.resultRoute);
  const busy = Boolean(session?.busy);
  const expanded = Boolean(session && (session.busy || session.draft || session.status || session.error));
  let buttonLabel = "交给 LiliaCode";
  if (session?.busy === "diagnostics") buttonLabel = "正在准备";
  else if (session?.busy === "handoff") buttonLabel = "正在交接";
  else if (session?.busy === "open") buttonLabel = "正在打开";
  else if (accepted) buttonLabel = "查看任务";
  else if (status === "pending") buttonLabel = "继续等待";
  else if (session?.draft || session?.error) buttonLabel = "重试交接";

  let statusText = unavailableReason;
  if (!statusText && session?.busy === "diagnostics") statusText = "正在读取失败日志";
  else if (!statusText && session?.busy === "handoff") statusText = "正在等待 LiliaCode";
  else if (!statusText && session?.busy === "open") statusText = "正在打开任务";
  else if (!statusText && status === "pending") statusText = "任务已保存";
  else if (!statusText && status === "incompatible") statusText = "任务草稿已保留，可更新后重试";
  else if (!statusText && status === "failed") statusText = "任务草稿已保留，可重试";
  else if (!statusText && session?.error) {
    statusText = status === "accepted" ? "打开任务失败，可重试" : "交接未完成，可重试";
  } else if (!statusText && status === "accepted") statusText = "LiliaCode 已接收";
  return { accepted, expanded, busy, error: session?.error ?? null, buttonLabel, statusText };
}

function homePendingItemRepoFullName(item: HomePendingItem) {
  const target = item.target;
  if (target.kind === "repo") return item.summary;
  return target.repoFullName;
}

function homePendingItemLink(
  item: HomePendingItem,
  workflowWorktree: RepoSummary | null,
): HomePendingLink {
  const target = item.target;
  if (target.kind === "repo") {
    const href = target.view === "conflicts"
      ? repoConflictRoute(target.repoId)
      : repoRoute(target.repoId, target.view === "changes" ? "changes" : "repo");
    return homePendingRouteLink(href);
  }
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
  const localRepoId = workflowWorktree?.id ?? target.localRepoId;
  const href = localRepoId
    ? repoProjectPath({ id: localRepoId }, "actions", target.runId)
    : remoteRepoProjectPath({ fullName: target.repoFullName }, "actions", target.runId);
  return homePendingRouteLink(href);
}

function homePendingItemIcon(kind: HomePendingItem["kind"]) {
  if (kind === "issue") return CircleDot;
  if (kind === "pull" || kind === "review") return GitPullRequestArrow;
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

async function openHomePendingLink(event: MouseEvent | KeyboardEvent, link: HomePendingLink) {
  if (link.kind !== "route" || event.defaultPrevented) return;
  if ("button" in event && event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  await router.push(link.to);
}

async function openHomeContinueItem(event: MouseEvent | KeyboardEvent, item: HomeContinueItem) {
  await openHomePendingLink(event, { kind: "route", to: item.route });
}

async function openHomePendingLinkFromKeyboard(event: KeyboardEvent, link: HomePendingLink) {
  if (event.key !== "Enter" && event.key !== " ") return;
  await openHomePendingLink(event, link);
}

function homePendingActionLabel(action: HomePendingAction) {
  if (action === "issue-complete") return "完成";
  if (action === "issue-close") return "关闭";
  if (action === "pull-merge") return "合并";
  if (action === "workflow-rerun") return "重跑";
  if (action === "workflow-cancel") return "取消";
  return "关闭";
}

function homePendingButtonLabel(row: HomePendingRow, action: HomePendingAction) {
  const prefix = row.runningAction === action ? "正在" : row.confirmingAction === action ? "确认" : "";
  return `${prefix}${homePendingActionLabel(action)}`;
}

function homePendingActionIcon(action: HomePendingAction) {
  if (action === "issue-complete") return CheckCircle2;
  if (action === "pull-merge") return GitMerge;
  if (action === "workflow-rerun") return RotateCw;
  return X;
}

function homePendingActions(item: HomePendingItem): HomePendingAction[] {
  if (item.target.kind === "issue") return ["issue-complete", "issue-close"];
  if (item.kind === "pull" && item.target.kind === "pull") return ["pull-merge", "pull-close"];
  if (item.target.kind === "workflow" && item.target.run) {
    const action = item.target.run.status === "completed" ? "rerun" : "cancel";
    if (workflowRunWriteActionAvailability(
      action,
      item.target.run,
      item.target.permissions,
    ).available) {
      return [action === "rerun" ? "workflow-rerun" : "workflow-cancel"];
    }
  }
  return [];
}

function homePendingActionAgentId(item: HomePendingItem, action: HomePendingAction) {
  return `home.pending.${item.id}.${action}`;
}

function homePendingItemAgentId(item: HomePendingItem) {
  return item.target.kind === "repo" && item.target.view === "conflicts"
    ? `home.pending.conflict.${item.target.repoId}`
    : `home.pending.${item.id}`;
}

function homePendingHandoffAgentId(item: HomePendingItem, target: "create" | "status" | "error" | "open-result") {
  return `${homePendingItemAgentId(item)}.handoff.${target}`;
}

async function runHomeWorkflowHandoff(row: HomePendingRow) {
  const handoff = row.handoff;
  const target = row.item.target;
  if (
    !handoff ||
    handoff.unavailableReason ||
    !handoff.worktree ||
    target.kind !== "workflow" ||
    !target.run ||
    row.runningAction
  ) return;
  await workflowFailureHandoff.handoff({
    itemId: row.item.id,
    repoFullName: target.repoFullName,
    run: target.run,
    worktree: handoff.worktree,
    sourceRoute: handoff.sourceRoute,
  });
}

async function openHomeWorkflowHandoffResult(row: HomePendingRow) {
  if (!row.handoff?.accepted || row.runningAction) return;
  await workflowFailureHandoff.openResult(row.item.id);
}

async function requestHomePendingAction(item: HomePendingItem, action: HomePendingAction) {
  if (homePendingRunningActions.value[item.id]) return;
  const armedAction = homePendingArmedAction.value;
  if (armedAction?.itemId === item.id && armedAction.action === action) {
    homePendingArmedAction.value = null;
    await runHomePendingAction(item, action);
    return;
  }
  homePendingArmedAction.value = { itemId: item.id, action };
}

function closeHomePendingConfirm() {
  homePendingArmedAction.value = null;
}

function onHomePendingConfirmPointer(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest(".home-pending-action.is-confirming")) return;
  closeHomePendingConfirm();
}

function onHomePendingConfirmKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !homePendingArmedAction.value) return;
  closeHomePendingConfirm();
  event.stopPropagation();
}

watch(homePendingArmedAction, (value, _, onCleanup) => {
  if (!value) return;
  document.addEventListener("pointerdown", onHomePendingConfirmPointer, true);
  document.addEventListener("keydown", onHomePendingConfirmKeydown);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onHomePendingConfirmPointer, true);
    document.removeEventListener("keydown", onHomePendingConfirmKeydown);
  });
});

async function runHomePendingAction(item: HomePendingItem, action: HomePendingAction) {
  if (homePendingRunningActions.value[item.id]) return;
  homePendingMutationError.value = null;
  homePendingRunningActions.value = {
    ...homePendingRunningActions.value,
    [item.id]: action,
  };
  try {
    if (action === "issue-complete" || action === "issue-close") {
      await updateHomePendingIssue(item, action);
    } else if (action === "pull-merge" || action === "pull-close") {
      await updateHomePendingPullRequest(item, action);
    } else {
      await updateHomePendingWorkflow(item, action);
    }
  } catch (err) {
    homePendingMutationError.value = action === "workflow-rerun"
      ? workflowRerunErrorMessage(err)
      : action === "workflow-cancel"
        ? workflowCancelErrorMessage(err)
        : `${homePendingActionLabel(action)}失败：${githubUserFacingError(err)}`;
  } finally {
    if (homePendingRunningActions.value[item.id] === action) {
      const { [item.id]: _removed, ...next } = homePendingRunningActions.value;
      homePendingRunningActions.value = next;
    }
  }
}

async function updateHomePendingWorkflow(
  item: HomePendingItem,
  action: Extract<HomePendingAction, "workflow-rerun" | "workflow-cancel">,
) {
  const target = item.target;
  if (target.kind !== "workflow" || !target.run || target.runId == null) return;
  try {
    if (action === "workflow-rerun") {
      await rerunFailedGitHubWorkflowRun(target.repoFullName, target.runId);
    } else {
      await cancelGitHubWorkflowRun(target.repoFullName, target.runId);
    }
  } finally {
    await loadHomeAttention(homeTimelineRepos.value, true);
  }
}

async function updateHomePendingIssue(item: HomePendingItem, action: Extract<HomePendingAction, "issue-complete" | "issue-close">) {
  const target = item.target;
  if (target.kind !== "issue") return;
  const updated = await updateGitHubIssue(target.repoFullName, target.number, {
    state: "closed",
    stateReason: action === "issue-complete" ? "completed" : "not_planned",
  });
  githubAccountIssuesGeneration += 1;
  replaceHomePendingIssue(target.repoFullName, updated);
  await loadHomePendingAccountIssues(homeTimelineRepos.value, true);
}

async function updateHomePendingPullRequest(item: HomePendingItem, action: Extract<HomePendingAction, "pull-merge" | "pull-close">) {
  const target = item.target;
  if (target.kind !== "pull") return;
  const updated = action === "pull-merge"
    ? await mergeGitHubPullRequest(target.repoFullName, target.number, { method: "merge" })
    : await updateGitHubPullRequest(target.repoFullName, target.number, { state: "closed" });
  githubAccountIssuesGeneration += 1;
  replaceHomePendingPullRequest(target.repoFullName, updated);
  await loadHomePendingAccountIssues(homeTimelineRepos.value, true);
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

function repoStatusSortStorageKey() {
  const account = currentGitHubAccountLogin()?.trim().toLocaleLowerCase() || "anonymous";
  return `${REPO_STATUS_SORT_STORAGE_PREFIX}:${account}`;
}

function readStoredRepoStatusSort() {
  const defaultValue: RepoStatusSortState = {
    sort: accountPreferences.value.repositorySort.key,
    direction: accountPreferences.value.repositorySort.direction,
  };
  const workspaceValue = parseWorkspaceRepoStatusSort(
    activeNamedWorkspace.value?.viewPreferences.homeRepositoryStatusSort,
  );
  if (workspaceValue) return { value: workspaceValue, exists: true };
  const storageKey = repoStatusSortStorageKey();
  try {
    if (localStorage.getItem(storageKey) != null) {
      return { value: readRepoSort(storageKey, repoStatusSortOptions, defaultValue), exists: true };
    }
    if (localStorage.getItem(LEGACY_REPO_STATUS_SORT_STORAGE_KEY) != null) {
      const value = readRepoSort(LEGACY_REPO_STATUS_SORT_STORAGE_KEY, repoStatusSortOptions, defaultValue);
      writeRepoSort(storageKey, value);
      localStorage.removeItem(LEGACY_REPO_STATUS_SORT_STORAGE_KEY);
      return { value, exists: true };
    }
  } catch {
  }
  return { value: defaultValue, exists: false };
}

function parseWorkspaceRepoStatusSort(value: string | undefined): RepoStatusSortState | null {
  const [sort, direction] = value?.split(":") ?? [];
  if (!repoStatusSortOptions.some((option) => option.value === sort)) return null;
  if (direction !== "asc" && direction !== "desc") return null;
  return { sort: sort as RepoStatusSortKey, direction };
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
  repoStatusSortBindingIdentity = currentGitHubBindingIdentity();
  repoStatusSortSelectedOnPage = true;
  writeRepoSort(repoStatusSortStorageKey(), repoStatusSort.value);
  const preferences = activeNamedWorkspace.value?.viewPreferences;
  if (preferences) {
    void workspace.updateWorkspaceViewPreferences({
      ...preferences,
      homeRepositoryStatusSort: `${repoStatusSort.value.sort}:${repoStatusSort.value.direction}`,
    }).catch(() => undefined);
  }
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

function openCloneRepoDialog(placement: WorkspaceRepoPlacement = { kind: "automatic" }) {
  void cloneDialog.openDialog(placement);
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
      disabled: !hasAvailableWorkspaceRoot.value,
      onSelect: () => openCloneRepoDialog(),
    },
    {
      id: "home-create-local-repo",
      label: "创建本地仓库",
      icon: FolderGit2,
      disabled: !hasAvailableWorkspaceRoot.value,
      onSelect: () => openCreateRepoCard("local"),
    },
    {
      id: "home-create-remote-repo",
      label: "创建远程仓库",
      icon: GitBranchPlus,
      disabled: !hasAvailableWorkspaceRoot.value || !workspace.isAuthorized.value,
      onSelect: () => openCreateRepoCard("remote"),
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

async function placeCreatedRepo(repo: RepoSummary, groupId: string | null = null) {
  if (groupId) {
    await workspace.moveRepoToGroup(repo.id, groupId);
  }
  commitHomeOverviewSnapshot();
  await router.push(repoRoute(repo.id));
}

async function placeClonedRepo(repo: RepoSummary) {
  commitHomeOverviewSnapshot();
  await router.push(repoRoute(repo.id));
}

async function placeClonedCreatedRepo(repo: RepoSummary) {
  await placeClonedRepo(repo);
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
  if (cloningFullNames.has(repo.fullName)) return;
  cloningFullNames.add(repo.fullName);
  githubReposError.value = null;
  try {
    await workspace.cloneRepo({
      remoteUrl: repo.cloneUrl,
      repository: {
        id: repo.id,
        fullName: repo.fullName,
        cloneUrl: repo.cloneUrl,
        defaultBranch: repo.defaultBranch,
        owner: repo.owner ?? null,
      },
      placement: { kind: "automatic" },
      target: { kind: "default" },
    });
    await refreshHomeAfterRepoMutation();
  } catch (err) {
    githubReposError.value = isGitHubBindingExpiredError(err)
      ? "GitHub 绑定已失效，请重新绑定后再克隆仓库。"
      : `克隆 ${repo.fullName} 失败：${githubUserFacingError(err)}`;
  } finally {
    cloningFullNames.delete(repo.fullName);
  }
}

async function openGitHubRepo(githubRepo: GitHubRepoSummary, localRepo: RepoSummary | null) {
  if (localRepo) {
    await router.push(repoRoute(localRepo.id));
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

function failedRemoteSteps(repoId: string) {
  const recent = workspace.state.recentSync?.results.find((result) => result.repoId === repoId);
  const bulk = workspace.state.bulkResults.find((result) => result.repoId === repoId);
  return (recent ?? bulk)?.steps?.filter((step) => step.status === "error") ?? [];
}

function remoteStepOperationLabel(operation: "fetch" | "merge" | "push" | "restore") {
  if (operation === "fetch") return "抓取";
  if (operation === "merge") return "合并";
  if (operation === "restore") return "还原";
  return "推送";
}

async function retryRepoSync(repo: RepoSummary) {
  if (syncingRepoId.value) return;
  syncingRepoId.value = repo.id;
  try {
    const failedSteps = failedRemoteSteps(repo.id);
    const failedPushRemotes = [...new Set(
      failedSteps
        .filter((step) => step.operation === "push")
        .map((step) => step.remote),
    )];
    if (failedPushRemotes.length && failedSteps.every((step) => step.operation === "push")) {
      await workspace.push(repo.id, failedPushRemotes);
    } else {
      const pullResult = await workspace.mergePull(repo.id, "stash");
      if (pullResult.status === "success") await workspace.push(repo.id);
    }
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
        <div class="setup-step" :class="{ 'is-done': hasAvailableWorkspaceRoot }">
          <div class="setup-step__icon">
            <FolderOpen :size="18" aria-hidden="true" />
          </div>
          <div class="setup-step__content">
            <h2>{{ activeNamedWorkspace ? activeNamedWorkspace.name : "命名工作区" }}</h2>
            <p class="muted">
              {{ hasAvailableWorkspaceRoot ? workspace.workspaceRoot.value : (activeNamedWorkspace ? "当前工作区没有可用根目录。" : "选择首个根目录并创建工作区。") }}
            </p>
          </div>
          <div class="setup-step__action">
            <button
              type="button"
              class="primary"
              data-agent-id="setup.workspace.choose"
              :disabled="choosingInitialWorkspaceRoot"
              @click="chooseWorkspaceRoot"
            >
              <LoaderCircle
                v-if="choosingInitialWorkspaceRoot"
                :size="14"
                aria-hidden="true"
                class="sb-spin"
              />
              <FolderOpen v-else :size="14" aria-hidden="true" />
              {{ activeNamedWorkspace ? "添加根目录" : "创建工作区" }}
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
                @click="workspace.startAuthFlow()"
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
            <span v-if="activeNamedWorkspace" :title="activeNamedWorkspace.roots.map((root) => root.path).join('\n')">
              {{ activeNamedWorkspace.name }} · {{ activeNamedWorkspace.roots.length }} 个 root
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
            :disabled="!hasAvailableWorkspaceRoot || discovering"
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
              <p class="language-total">
                {{ formatBytes(activeCodeOverview.totalBytes) }} 代码量
              </p>
            </div>
            <div class="language-actions">
              <div class="language-tabs" aria-label="代码占比模式">
                <button
                  type="button"
                  data-agent-id="home.language.mode.language"
                  :class="{ 'is-active': languageChartMode === 'language' }"
                  @click="selectLanguageChartMode('language')"
                >
                  按编程语言
                </button>
                <button
                  type="button"
                  data-agent-id="home.language.mode.project"
                  :class="{ 'is-active': languageChartMode === 'project' }"
                  @click="selectLanguageChartMode('project')"
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
              viewBox="0 0 132 132"
              shape-rendering="geometricPrecision"
              role="img"
              aria-label="编程语言占比饼图"
            >
              <g transform="rotate(-90 66 66)">
                <circle class="language-pie__track" cx="66" cy="66" r="50" pathLength="100" />
                <circle
                  v-for="slice in activeCodeOverview.slices"
                  :key="slice.key"
                  class="language-pie__slice"
                  cx="66"
                  cy="66"
                  r="50"
                  pathLength="100"
                  :title="slice.title"
                  :aria-label="slice.title"
                  :stroke="slice.color"
                  :stroke-dasharray="`${slice.percent} ${100 - slice.percent}`"
                  :stroke-dashoffset="-slice.offset"
                  @pointerenter="hoveredCodeSlice = slice"
                  @pointerleave="hoveredCodeSlice = null"
                />
              </g>
            </svg>
            <ul class="language-list">
              <li v-for="slice in activeCodeOverview.slices" :key="slice.key">
                <RouterLink
                  v-if="slice.to"
                  class="language-list__link"
                  :class="{ 'is-hovered': hoveredCodeSlice?.key === slice.key }"
                  :data-agent-id="`home.language.slice.${slice.key}`"
                  :to="slice.to"
                  :title="slice.linkTitle"
                >
                  <span class="language-dot" :style="{ background: slice.color }" aria-hidden="true" />
                  <span class="language-name">{{ slice.label }}</span>
                  <strong>{{ formatPercent(slice.percent) }}</strong>
                </RouterLink>
                <span
                  v-else
                  class="language-list__link language-list__link--static"
                  :class="{ 'is-hovered': hoveredCodeSlice?.key === slice.key }"
                  :title="slice.linkTitle"
                >
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
              现在处理
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
              v-if="homePendingMutationError"
              class="repo-status-error"
              role="alert"
              data-agent-id="home.pending.mutation-error"
            >
              {{ homePendingMutationError }}
            </p>
            <p
              v-if="homePendingError"
              class="repo-status-error"
            >
              {{ homePendingError }}
              <button type="button" class="ghost" :disabled="githubAccountIssuesLoading || githubActionNotificationsLoading || homeAttentionLoading" @click="retryHomePendingItems">
                重试
              </button>
            </p>
            <p
              v-if="githubTimelineBusy && homeDecisionEmpty && !homePendingError"
              class="repo-status-empty"
            >
              正在加载待处理事项...
            </p>
            <p v-else-if="homeDecisionEmpty && !homePendingError" class="repo-status-empty">暂无需要处理的事项</p>
            <div
              v-for="section in homePendingSections"
              :key="section.id"
              class="home-pending-section"
              :data-agent-id="`home.pending.section.${section.id}`"
            >
              <h3 class="home-pending-section__title">
                {{ section.title }}
                <span class="home-pending-section__count">{{ section.rows?.length || section.continueItems?.length }}</span>
              </h3>
              <ol
                v-if="section.rows?.length"
                class="home-pending-list"
                :aria-label="`${section.title} 列表`"
              >
                <li
                  v-for="row in section.rows"
                  :key="row.item.id"
                  class="home-pending-row"
                  :class="{
                    'has-hover-controls': row.actions.length || row.handoff || row.link.kind !== 'none',
                    'is-clickable': row.link.kind !== 'none',
                  }"
                  :role="row.link.kind === 'route' ? 'link' : undefined"
                  :data-agent-id="row.link.kind === 'route' ? homePendingItemAgentId(row.item) : undefined"
                  :aria-label="`${row.item.title} ${row.item.detail}，${row.repoFullName}`"
                  :tabindex="row.link.kind === 'route' ? 0 : undefined"
                  @click="openHomePendingLink($event, row.link)"
                  @keydown.self="openHomePendingLinkFromKeyboard($event, row.link)"
                >
                  <span class="home-pending-row__icon" :class="row.item.tone ? `is-${row.item.tone}` : null" aria-hidden="true">
                    <component :is="row.icon" :size="14" aria-hidden="true" />
                  </span>
                  <span class="home-pending-row__main">
                    <strong>{{ row.item.title }}</strong>
                    <span>{{ row.item.detail }}</span>
                    <small v-if="row.item.reason && row.item.reason !== row.item.detail">{{ row.item.reason }}</small>
                  </span>
                  <span class="home-pending-row__side">
                    <span
                      v-if="row.handoff?.statusText"
                      class="home-pending-row__repo home-pending-row__handoff-status"
                      :class="{ 'is-error': Boolean(row.handoff.error) }"
                      :title="row.handoff.error || row.handoff.statusText"
                      :role="row.handoff.error ? 'alert' : 'status'"
                      :data-agent-id="homePendingHandoffAgentId(row.item, row.handoff.error ? 'error' : 'status')"
                    >
                      {{ row.handoff.statusText }}
                    </span>
                    <span v-else class="home-pending-row__repo" :title="row.repoFullName">{{ row.repoFullName }}</span>
                    <span
                      v-if="row.actions.length || row.handoff || row.link.kind !== 'none'"
                      class="home-pending-row__actions"
                      :class="{
                        'is-expanded': Boolean(row.confirmingAction || row.runningAction || row.handoff?.expanded),
                      }"
                      aria-label="快捷操作"
                    >
                      <button
                        v-if="row.handoff"
                        type="button"
                        class="home-pending-action"
                        :class="{
                          'is-expanded': row.handoff.expanded,
                        }"
                        :aria-label="row.handoff.unavailableReason || row.handoff.buttonLabel"
                        :title="row.handoff.unavailableReason || row.handoff.error || row.handoff.buttonLabel"
                        :data-agent-id="homePendingHandoffAgentId(row.item, row.handoff.accepted ? 'open-result' : 'create')"
                        :disabled="Boolean(row.runningAction || row.handoff.unavailableReason || row.handoff.busy)"
                        @click.stop="row.handoff.accepted ? openHomeWorkflowHandoffResult(row) : runHomeWorkflowHandoff(row)"
                      >
                        <LoaderCircle
                          v-if="row.handoff.busy"
                          :size="11"
                          aria-hidden="true"
                          class="sb-spin"
                        />
                        <Send v-else :size="13" aria-hidden="true" />
                        <span v-if="row.handoff.expanded">{{ row.handoff.buttonLabel }}</span>
                      </button>
                      <button
                        v-for="action in row.actions"
                        v-show="!row.runningAction || row.runningAction === action"
                        :key="action"
                        type="button"
                        class="home-pending-action"
                        :class="{
                          'home-pending-action--ok': action === 'issue-complete' || action === 'pull-merge',
                          'home-pending-action--danger': action === 'issue-close' || action === 'pull-close' || action === 'workflow-cancel',
                          'is-confirming': row.confirmingAction === action,
                          'is-expanded': row.confirmingAction === action || row.runningAction === action,
                        }"
                        :aria-label="homePendingButtonLabel(row, action)"
                        :title="homePendingButtonLabel(row, action)"
                        :data-agent-id="`${homePendingActionAgentId(row.item, action)}${row.confirmingAction === action ? '.confirm' : ''}`"
                        :disabled="Boolean(row.runningAction || row.handoff?.busy)"
                        @click.stop="requestHomePendingAction(row.item, action)"
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
                          :size="row.confirmingAction === action ? 12 : 13"
                          aria-hidden="true"
                        />
                        <span v-if="row.runningAction === action || row.confirmingAction === action">
                          {{ homePendingButtonLabel(row, action) }}
                        </span>
                      </button>
                      <a
                        v-if="row.link.kind !== 'none'"
                        class="home-pending-row__jump"
                        :href="homePendingItemHref(row.link)"
                        :aria-label="`打开 ${row.item.title}`"
                        title="打开"
                        :data-agent-id="`${homePendingItemAgentId(row.item)}.open`"
                        @click.stop="openHomePendingLink($event, row.link)"
                      >
                        <ArrowRight :size="13" aria-hidden="true" />
                      </a>
                    </span>
                  </span>
                </li>
              </ol>
              <ol
                v-else-if="section.continueItems?.length"
                class="home-pending-list home-continue-list"
                :aria-label="`${section.title} 列表`"
              >
                <li
                  v-for="item in section.continueItems"
                  :key="item.id"
                  class="home-pending-row is-clickable"
                  role="link"
                  tabindex="0"
                  :data-agent-id="`home.continue.${item.id}`"
                  :aria-label="`${item.title}，${item.detail}`"
                  @click="openHomeContinueItem($event, item)"
                  @keydown.enter.self.prevent="openHomeContinueItem($event, item)"
                  @keydown.space.self.prevent="openHomeContinueItem($event, item)"
                >
                  <span class="home-pending-row__icon is-muted" aria-hidden="true">
                    <Clock :size="14" aria-hidden="true" />
                  </span>
                  <span class="home-pending-row__main">
                    <strong>{{ item.title }}</strong>
                    <span>{{ item.detail }}</span>
                  </span>
                  <span class="home-pending-row__side">
                    <a
                      class="home-pending-row__jump"
                      :href="item.route"
                      :aria-label="`继续 ${item.title}`"
                      title="继续"
                      :data-agent-id="`home.continue.${item.id}.open`"
                      @click.stop="openHomeContinueItem($event, item)"
                    >
                      <ArrowRight :size="13" aria-hidden="true" />
                    </a>
                  </span>
                </li>
              </ol>
            </div>
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
              <Dropdown
                v-model="homeRepositoryScopeValue"
                :options="homeRepositoryScopeOptions"
                :disabled="githubReposLoading || githubRepoOwnersLoading"
                placement="bottom"
                button-class="overview-actions__btn repo-status-sort-button"
                agent-id="home.repo-status.scope"
              />
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
          <div
            v-if="githubRepoOwnersError || githubOrganizationVisibilityLimited"
            class="repo-status-scope"
          >
            <GitHubRepositoryStateNotice
              v-if="githubRepoOwnersError"
              state="error"
              compact
              retryable
              :message="githubRepoOwnersError"
              @retry="loadGitHubRepoOwners"
            />
            <GitHubRepositoryStateNotice
              v-if="githubOrganizationVisibilityLimited"
              state="limited"
              compact
              :message="githubOrganizationVisibilityMessage"
              :action-label="githubOrganizationRecovery.url ? '在 GitHub 授权' : '补充组织权限'"
              @authorize="openOrganizationAuthorization"
            />
          </div>
          <p v-if="githubReposError" class="repo-status-error">
            {{ githubReposError }}
            <button type="button" class="ghost" :disabled="githubReposLoading" @click="loadGitHubRepoStatus({ force: true })">
              重试
            </button>
          </p>
          <p v-if="favoriteError" class="repo-status-error">{{ favoriteError }}</p>
          <div class="home-scroll-card__body">
            <div
              class="repo-status-list"
              aria-label="仓库状态列表"
            >
              <p v-if="githubReposLoading && !repoStatusRows.length" class="repo-status-empty">正在加载 GitHub 项目...</p>
              <GitHubRepositoryStateNotice
                v-else-if="githubReposLoaded && !repoStatusRows.length && !githubReposError"
                state="empty"
                :message="githubRepositoryScope.kind === 'all' ? '没有可见仓库。' : '当前范围没有可见仓库。'"
              />
              <div
                v-for="{ githubRepo, localRepo, action, syncIssue, momentum } in visibleRepoStatusRows"
                :key="githubRepo.fullName"
                class="repo-status-row"
                :class="{ 'is-cloned': localRepo }"
                role="link"
                tabindex="0"
                :data-agent-id="`home.repo-status.${githubRepo.fullName}`"
                :aria-label="`打开 ${githubRepo.fullName}`"
                :title="localRepo ? localRepo.path : githubRepo.htmlUrl"
                @click="openGitHubRepo(githubRepo, localRepo)"
                @keydown.enter.self.prevent="openGitHubRepo(githubRepo, localRepo)"
                @keydown.space.self.prevent="openGitHubRepo(githubRepo, localRepo)"
              >
                <span class="repo-status-row__identity">
                  <strong class="repo-status-row__name">
                    {{ githubRepo.fullName }}
                  </strong>
                  <span
                    class="repo-status-row__badge"
                    :class="`repo-status-row__badge--momentum-${momentum.state}`"
                    :title="momentum.reason"
                    :data-agent-id="`home.repo-status.${githubRepo.fullName}.momentum`"
                  >
                    {{ momentum.label }}
                  </span>
                  <span v-if="githubRepo.archived" class="repo-status-row__badge repo-status-row__badge--archived">Archive</span>
                  <span v-if="githubRepo.private" class="repo-status-row__badge">私有</span>
                  <span
                    v-if="!githubRepo.permissions?.admin && githubRepositoryPermissionLabel(githubRepo.permissions)"
                    class="repo-status-row__badge"
                    :title="`当前账号权限：${githubRepositoryPermissionLabel(githubRepo.permissions)}`"
                  >
                    {{ githubRepositoryPermissionLabel(githubRepo.permissions) }}
                  </span>
                  <span
                    v-if="syncIssue"
                    class="repo-status-row__issue"
                    :class="`repo-status-row__issue--${syncIssue.retryable ? 'error' : 'warn'}`"
                    :title="syncIssue.message"
                    :aria-label="syncIssue.label"
                  >
                    <AlertCircle :size="13" aria-hidden="true" />
                    <span class="repo-status-row__issue-copy">
                      <span>{{ syncIssue.label }}：{{ syncIssue.message }}</span>
                      <small
                        v-for="(step, index) in failedRemoteSteps(localRepo?.id ?? '')"
                        :key="`${step.operation}:${step.remote}:${index}`"
                      >
                        {{ step.remote || "本地修改" }} · {{ remoteStepOperationLabel(step.operation) }} · {{ step.message }}
                      </small>
                    </span>
                  </span>
                </span>
                <span class="repo-status-row__action">
                  <button
                    type="button"
                    class="repo-favorite-button"
                    :class="{ 'is-favorite': githubRepoFavorite(githubRepo) }"
                    :data-agent-id="`home.repo-status.${githubRepo.fullName}.favorite`"
                    :aria-label="`${githubRepoFavorite(githubRepo) ? '取消置顶' : '置顶'} ${githubRepo.fullName}`"
                    :title="githubRepoFavorite(githubRepo) ? '取消置顶' : '置顶仓库'"
                    :disabled="favoritePending(`github:${githubRepositoryIdentityKey(githubRepo.fullName)}`)"
                    @click.stop="toggleGitHubRepoFavorite(githubRepo)"
                  >
                    <LoaderCircle
                      v-if="favoritePending(`github:${githubRepositoryIdentityKey(githubRepo.fullName)}`)"
                      :size="13"
                      aria-hidden="true"
                      class="sb-spin"
                    />
                    <Pin v-else :size="13" aria-hidden="true" />
                  </button>
                  <template v-if="localRepo">
                    <button
                      v-if="syncIssue?.retryable"
                      type="button"
                      class="repo-action-link repo-action-link--warn"
                      :data-agent-id="`home.repo-status.${githubRepo.fullName}.retry`"
                      :disabled="workspace.state.bulkRunning || syncingRepoId === localRepo.id || syncIssue.retrying"
                      :title="syncIssue.message"
                      @click.stop="retryRepoSync(localRepo)"
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
                    :disabled="cloningFullNames.has(githubRepo.fullName)"
                    @click.stop="cloneGitHubRepo(githubRepo)"
                  >
                    <LoaderCircle
                      v-if="cloningFullNames.has(githubRepo.fullName)"
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
              <span v-if="result.steps.some((step) => step.status === 'error')" class="sync-results__steps">
                <small
                  v-for="(step, index) in result.steps.filter((item) => item.status === 'error')"
                  :key="`${step.operation}:${step.remote}:${index}`"
                >
                  {{ step.remote || "本地修改" }} · {{ remoteStepOperationLabel(step.operation) }} · {{ step.message }}
                </small>
              </span>
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
      :workspace-ready="hasAvailableWorkspaceRoot"
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
    <UiDialog
      :open="workspaceCreateOpen"
      title="新建工作区"
      :close-disabled="workspaceCreateBusy"
      @close="workspaceCreateOpen = false"
    >
      <form class="workspace-create-dialog" @submit.prevent="createInitialWorkspace">
        <label>
          <span>名称</span>
          <input
            v-model="workspaceCreateName"
            maxlength="64"
            autofocus
            data-agent-id="setup.workspace.name"
          />
        </label>
        <label>
          <span>首个根目录</span>
          <input :value="workspaceCreateRoot" readonly />
        </label>
        <div class="workspace-create-dialog__actions">
          <button type="button" class="ghost" :disabled="workspaceCreateBusy" @click="workspaceCreateOpen = false">取消</button>
          <button
            type="submit"
            class="primary"
            data-agent-id="setup.workspace.create"
            :disabled="workspaceCreateBusy || !workspaceCreateName.trim()"
          >创建</button>
        </div>
      </form>
    </UiDialog>
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

.workspace-create-dialog {
  display: grid;
  gap: 14px;
}

.workspace-create-dialog label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 13px;
}

.workspace-create-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
}

.language-pie__track,
.language-pie__slice {
  fill: none;
  stroke-width: 28;
}

.language-pie__track {
  stroke: var(--bg-subtle);
}

.language-pie__slice {
  transition:
    stroke-width 0.12s ease,
    stroke-dasharray 0.2s ease;
}

.language-pie__slice:hover {
  stroke-width: 30;
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
  transition: background-color 0.12s ease;
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

.language-list__link.is-hovered {
  background: var(--bg-hover);
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

.home-pending-section + .home-pending-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
}

.home-pending-section__title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
}

.home-pending-section__count {
  color: var(--text-faint);
  font-weight: 500;
}

.home-pending-row__main small {
  display: block;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.35;
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

.home-pending-row.is-clickable {
  cursor: pointer;
}

.home-pending-row:hover {
  background: var(--bg-hover);
}

.home-pending-row:focus-visible,
.home-pending-row:focus-within {
  outline: 0;
  border-color: var(--border-strong);
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

.home-pending-row__repo {
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
.home-pending-row.has-hover-controls:focus-within .home-pending-row__repo {
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
  --home-pending-action-state-bg: var(--ok-soft);
  color: var(--ok);
}

.home-pending-action--danger {
  --home-pending-action-state-bg: var(--err-soft);
  color: var(--err);
}

.home-pending-row__handoff-status.is-error {
  color: var(--err);
}

.home-pending-row__actions.is-expanded .home-pending-row__jump {
  display: none;
}

.home-pending-action:hover,
.home-pending-action:focus-visible,
.home-pending-row__jump:hover,
.home-pending-row__jump:focus-visible {
  background: var(--bg-hover);
  outline: 0;
}

.home-pending-action.is-expanded {
  width: auto;
  min-width: 68px;
  gap: 4px;
  padding: 0 7px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  background: var(--home-pending-action-state-bg);
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
  height: 22px;
  margin-bottom: 8px;
}

.repo-status-heading h2 {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  height: 22px;
  margin: 0;
  line-height: 22px;
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
  height: 22px;
}

.repo-status-scope {
  display: grid;
  gap: 6px;
  margin-bottom: 8px;
}

.repo-status-sort-button {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 0;
  height: 22px;
  min-height: 22px;
  padding: 0 5px;
  font-size: 12px;
  line-height: 22px;
  font-weight: 700;
  white-space: nowrap;
}

.repo-status-heading__tools :deep(.dd__button) {
  max-width: min(160px, 34vw);
  border: 0;
  background: transparent;
  color: var(--text-muted);
  gap: 3px;
}

.repo-status-heading__tools :deep(.dd__button:hover:not(:disabled)),
.repo-status-heading__tools :deep(.dd__button.is-open) {
  color: var(--text);
  background: var(--bg-hover);
}

.repo-status-heading__tools :deep(.dd__button-label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
  font-size: 12px;
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

.repo-status-row__badge--momentum-healthy {
  background: var(--ok-soft);
  color: var(--ok);
}

.repo-status-row__badge--momentum-attention {
  background: var(--warn-soft);
  color: var(--warn);
}

.repo-status-row__badge--momentum-blocked {
  background: var(--err-soft);
  color: var(--err);
}

.repo-status-row__badge--momentum-inactive {
  background: var(--bg-subtle);
  color: var(--text-faint);
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

.repo-status-row__issue > .repo-status-row__issue-copy {
  display: grid;
  gap: 1px;
  overflow: visible;
  white-space: normal;
}

.repo-status-row__issue-copy > span,
.repo-status-row__issue-copy > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-status-row__issue-copy > small {
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 500;
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

.repo-favorite-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.repo-status-row:hover .repo-favorite-button,
.repo-status-row:focus-within .repo-favorite-button {
  opacity: 1;
  pointer-events: auto;
}

.repo-favorite-button:hover,
.repo-favorite-button:focus-visible {
  background: var(--bg-hover);
  color: var(--text);
}

.repo-favorite-button.is-favorite {
  color: var(--warn);
}

.repo-favorite-button.is-favorite :deep(svg) {
  fill: currentColor;
}

.repo-favorite-button:disabled {
  cursor: wait;
}

.repo-status-row:hover .repo-favorite-button:disabled,
.repo-status-row:focus-within .repo-favorite-button:disabled {
  opacity: 0.65;
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

.sync-results__steps {
  grid-column: 2 / -1;
  display: grid;
  gap: 2px;
  color: var(--text-muted);
  font-size: 11px;
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
    grid-template-columns: 18px minmax(0, 1fr) minmax(100px, 30%);
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

@media (prefers-reduced-motion: reduce) {
  .language-pie__slice,
  .language-list__link,
  .repo-favorite-button {
    transition: none;
  }
}
</style>
