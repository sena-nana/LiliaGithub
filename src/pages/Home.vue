<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  FolderOpen,
  FolderGit2,
  GitBranchPlus,
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
import { createLatestAsyncLoader } from "../composables/useLatestAsyncLoader";
import { useWorkspace } from "../composables/useWorkspace";
import {
  repoSyncIssuesByRepoId,
  type RepoSyncIssueDisplay,
} from "../composables/workspace/state";
import {
  isGitHubBindingExpiredError,
  listGitHubRepos,
  listGitHubAccountIssues,
  listGitHubActionNotifications,
  preloadGitHubRepos,
  type GitHubAccountIssueItem,
  type GitHubActionNotification,
  type GitHubContributionDay,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubRepoSummary,
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

type HomeSearchResult = {
  key: string;
  label: string;
  detail: string;
} & (
  { kind: "local"; repo: RepoSummary } |
  { kind: "remote"; repo: GitHubRepoSummary }
);

type HomePerfMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
};

type ProjectTabRef = "issues" | "pulls" | "actions";
const REPO_STATUS_RENDER_PAGE_SIZE = 60;
const HOME_PENDING_ITEM_LIMIT = 12;
const GITHUB_ACCOUNT_ISSUES_PER_PAGE = 100;
const GITHUB_ACTION_NOTIFICATIONS_PER_PAGE = 50;
const HOME_PERF_SLOW_MS = 8;
const HOME_PERF_LOG_INTERVAL = 120;
const HOME_FIELD_SEPARATOR = "\u001f";
const HOME_REPO_SEPARATOR = "\u001e";

const homePerfMetrics = import.meta.env.DEV && typeof performance !== "undefined"
  ? new Map<string, HomePerfMetric>()
  : null;

function measureHomeComputed<T>(label: string, compute: () => T): T {
  if (!homePerfMetrics) return compute();
  const start = performance.now();
  try {
    return compute();
  } finally {
    const duration = performance.now() - start;
    const current = homePerfMetrics.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
    const next = {
      count: current.count + 1,
      totalMs: current.totalMs + duration,
      maxMs: Math.max(current.maxMs, duration),
    };
    homePerfMetrics.set(label, next);
    if (duration >= HOME_PERF_SLOW_MS || next.count % HOME_PERF_LOG_INTERVAL === 0) {
      console.debug("[Home perf]", label, {
        count: next.count,
        lastMs: Number(duration.toFixed(2)),
        maxMs: Number(next.maxMs.toFixed(2)),
        avgMs: Number((next.totalMs / next.count).toFixed(2)),
      });
    }
  }
}

function languageStatsSignature(repo: RepoSummary) {
  return repo.languageStats
    .map((stat) => `${stat.language}:${stat.bytes}:${stat.lines}`)
    .join(",");
}

function homeRepoSignature(repo: RepoSummary) {
  return [
    repo.id,
    repo.name,
    repo.path,
    repo.relativePath,
    repo.githubFullName ?? "",
    repo.ahead,
    repo.behind,
    repo.stagedCount,
    repo.unstagedCount,
    repo.untrackedCount,
    repo.conflictCount,
    repo.languageStatsUpdatedAt,
    languageStatsSignature(repo),
    repo.worktree.role,
    repo.worktree.sharedRepoKey,
    repo.worktree.mainRepoId ?? "",
  ].join(HOME_FIELD_SEPARATOR);
}

function snapshotHomeRepos(repos: readonly RepoSummary[]): RepoSummary[] {
  return repos.map((repo) => ({
    ...repo,
    languageStats: repo.languageStats.map((stat) => ({ ...stat })),
    worktree: { ...repo.worktree },
  }));
}

function sameRepoAction(left: RepoAction | null, right: RepoAction | null) {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.label !== right.label || left.title !== right.title) return false;
  if (left.kind === "sync") return true;
  return right.kind === "link" && left.to === right.to;
}

function sameSyncIssue(left: RepoSyncIssueDisplay | null, right: RepoSyncIssueDisplay | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.label === right.label &&
    left.message === right.message &&
    left.retryable === right.retryable &&
    left.retrying === right.retrying &&
    left.updatedAt === right.updatedAt;
}

function sameRepoStatusRow(left: RepoStatusRow, right: RepoStatusRow) {
  return left.githubRepo === right.githubRepo &&
    left.localRepo === right.localRepo &&
    sameRepoAction(left.action, right.action) &&
    sameSyncIssue(left.syncIssue, right.syncIssue);
}

function sameTimelineSource(left: HomePendingRepoSource, right: HomePendingRepoSource) {
  return left.githubRepo === right.githubRepo &&
    left.localRepo === right.localRepo &&
    sameSyncIssue(left.syncIssue, right.syncIssue) &&
    left.issues === right.issues &&
    left.pullRequests === right.pullRequests &&
    left.actionNotifications === right.actionNotifications;
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
const cloningFullName = ref<string | null>(null);
const repoStatusVisibleCount = ref(REPO_STATUS_RENDER_PAGE_SIZE);
const componentEpoch = useComponentEpoch();
const githubRepoStatusLoader = createLatestAsyncLoader({ componentEpoch });
const githubRepoMoreLoader = createLatestAsyncLoader({ componentEpoch });
let lastRepoStatusListRefreshToken = workspace.state.repoStatusListRefreshToken;
let searchRepoPagesLoading = false;
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
const homeReposSnapshot = shallowRef<RepoSummary[]>(
  measureHomeComputed("repos.snapshot.initial", () => snapshotHomeRepos(workspace.state.repos)),
);
const homeCodeStatsRepos = shallowRef<RepoSummary[]>([]);
const repoStatusRowCache = new Map<string, RepoStatusRow>();
const timelineSourceCache = new Map<string, HomePendingRepoSource>();
let homeCodeStatsUpdateCancel: (() => void) | null = null;

const homeReposSignature = computed(() =>
  measureHomeComputed("repos.signature", () => workspace.state.repos.map(homeRepoSignature).join(HOME_REPO_SEPARATOR)),
);
const homeRepoSettingsSignature = computed(() =>
  JSON.stringify(workspace.state.settings?.repoSyncPreferences ?? {}),
);
const homeRepoById = computed(() =>
  measureHomeComputed("repos.byId", () => new Map(homeReposSnapshot.value.map((repo) => [repo.id, repo]))),
);

function buildHomeCodeStatsRepos() {
  return measureHomeComputed("codeStats.repos", () =>
    representativeReposBySharedGroup(homeReposSnapshot.value)
      .filter((repo) => repoIncludedInHomeCodeStats(workspace.state.settings, repo.id)),
  );
}

function commitHomeCodeStatsRepos() {
  homeCodeStatsUpdateCancel = null;
  homeCodeStatsRepos.value = buildHomeCodeStatsRepos();
}

function scheduleHomeCodeStatsReposUpdate() {
  if (homeCodeStatsUpdateCancel) return;
  if (typeof requestAnimationFrame === "function") {
    const frame = requestAnimationFrame(commitHomeCodeStatsRepos);
    homeCodeStatsUpdateCancel = () => cancelAnimationFrame(frame);
  } else {
    const timer = window.setTimeout(commitHomeCodeStatsRepos, 0);
    homeCodeStatsUpdateCancel = () => window.clearTimeout(timer);
  }
}

homeCodeStatsRepos.value = buildHomeCodeStatsRepos();

watch(homeReposSignature, () => {
  homeReposSnapshot.value = measureHomeComputed("repos.snapshot", () => snapshotHomeRepos(workspace.state.repos));
});

watch(
  () => [homeReposSnapshot.value, homeRepoSettingsSignature.value] as const,
  scheduleHomeCodeStatsReposUpdate,
);

const languageOverview = computed<HomeCodeOverview>(() => {
  return measureHomeComputed("codeStats.languageOverview", () => {
    const overview = buildLanguageOverviewFromRepos(homeCodeStatsRepos.value);
    const slices = overview.slices.map((slice) => {
      const primaryRepoId = slice.repoIds[0] ?? null;
      const target = homeRepoById.value.get(primaryRepoId ?? "")?.name ?? primaryRepoId;
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
});

const projectCodeOverview = computed<HomeCodeOverview>(() => {
  return measureHomeComputed("codeStats.projectOverview", () => {
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
});
const activeCodeOverview = computed(() =>
  languageChartMode.value === "project" ? projectCodeOverview.value : languageOverview.value,
);

const localRepoByGitHubFullName = computed(() =>
  measureHomeComputed("repos.byGitHubFullName", () => representativeReposByGitHubFullName(homeReposSnapshot.value)),
);
const syncIssuesByRepoId = computed(() =>
  measureHomeComputed("repos.syncIssues", () => repoSyncIssuesByRepoId()),
);
const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLocaleLowerCase());
const homeSearchResults = computed<HomeSearchResult[]>(() => {
  const query = normalizedSearchQuery.value;
  if (!query) return [];

  return measureHomeComputed("search.results", () => {
    const localResults = homeReposSnapshot.value
      .filter((repo) => repoMatchesHomeSearch(repo, query))
      .map((repo): HomeSearchResult => ({
        key: `local:${repo.id}`,
        kind: "local",
        label: repoDisplayName(repo),
        detail: repo.githubFullName ?? repo.relativePath ?? repo.path,
        repo,
      }));

    const remoteResults = githubRepos.value
      .filter((repo) => !repo.disabled)
      .filter((repo) => !localRepoByGitHubFullName.value.has(repo.fullName))
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
});
const searchRemotePending = computed(() =>
  Boolean(normalizedSearchQuery.value && githubReposNextPage.value && !githubReposError.value) ||
  githubReposLoading.value ||
  githubReposLoadingMore.value,
);

const repoStatusRows = computed<RepoStatusRow[]>(() =>
  measureHomeComputed("repoStatus.rows", () => {
    const activeFullNames = new Set<string>();
    const rows = githubRepos.value.filter((repo) => !repo.disabled).map((githubRepo) => {
      activeFullNames.add(githubRepo.fullName);
      const localRepo = localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null;
      const nextRow: RepoStatusRow = {
        githubRepo,
        localRepo,
        action: localRepo ? repoAction(localRepo) : null,
        syncIssue: localRepo ? syncIssuesByRepoId.value.get(localRepo.id) ?? null : null,
      };
      const currentRow = repoStatusRowCache.get(githubRepo.fullName);
      if (currentRow && sameRepoStatusRow(currentRow, nextRow)) return currentRow;
      repoStatusRowCache.set(githubRepo.fullName, nextRow);
      return nextRow;
    }).sort((a, b) => Number(a.githubRepo.archived) - Number(b.githubRepo.archived));

    for (const fullName of repoStatusRowCache.keys()) {
      if (!activeFullNames.has(fullName)) repoStatusRowCache.delete(fullName);
    }
    return rows;
  }),
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
const githubTimelineRepoSources = computed<HomePendingRepoSource[]>(() =>
  measureHomeComputed("timeline.sources", () => {
    const activeFullNames = new Set<string>();
    const sources = homeTimelineRepos.value.map((githubRepo) => {
      activeFullNames.add(githubRepo.fullName);
      const nextSource: HomePendingRepoSource = {
        githubRepo,
        localRepo: localRepoByGitHubFullName.value.get(githubRepo.fullName) ?? null,
        syncIssue: repoSyncIssueForTimeline(githubRepo),
        issues: githubIssuesByRepo.value[githubRepo.fullName] ?? [],
        pullRequests: githubPullRequestsByRepo.value[githubRepo.fullName] ?? [],
        pullRequestChecksByPull: undefined,
        actionNotifications: githubActionNotificationsByRepo.value[githubRepo.fullName] ?? [],
      };
      const currentSource = timelineSourceCache.get(githubRepo.fullName);
      if (currentSource && sameTimelineSource(currentSource, nextSource)) return currentSource;
      timelineSourceCache.set(githubRepo.fullName, nextSource);
      return nextSource;
    });

    for (const fullName of timelineSourceCache.keys()) {
      if (!activeFullNames.has(fullName)) timelineSourceCache.delete(fullName);
    }
    return sources;
  }),
);
const homePendingNodes = computed<TimelineDisplayNode[]>(() =>
  measureHomeComputed("timeline.pendingNodes", () =>
    buildHomePendingItems(githubTimelineRepoSources.value)
      .slice(0, HOME_PENDING_ITEM_LIMIT)
      .map(toHomePendingDisplayNode),
  ),
);
const githubTimelineBusy = computed(() =>
  githubReposLoading.value ||
  githubAccountIssuesLoading.value ||
  githubActionNotificationsLoading.value,
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
  () => [searchOpen.value, normalizedSearchQuery.value, githubReposNextPage.value] as const,
  ([open, query, nextPage]) => {
    if (open && query && nextPage) {
      void loadRemainingSearchGitHubRepos();
    }
  },
);

onUnmounted(() => {
  githubPendingGeneration += 1;
  githubRepoStatusLoader.invalidate();
  githubRepoMoreLoader.invalidate();
  homeCodeStatsUpdateCancel?.();
  homeCodeStatsUpdateCancel = null;
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
    githubPendingGeneration += 1;
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
  githubActionNotificationsByRepo.value = snapshot.actionNotificationsByRepo;
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
    pullRequestChecksByRepo: {},
    actionNotificationsByRepo: githubActionNotificationsByRepo.value,
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
    writeGitHubOverviewSnapshot();
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) clearGitHubPendingItems();
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
    writeGitHubOverviewSnapshot();
  } catch (err) {
    if (isGitHubBindingExpiredError(err)) clearGitHubPendingItems();
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

function clearGitHubPendingItems() {
  githubIssuesByRepo.value = {};
  githubPullRequestsByRepo.value = {};
  githubActionNotificationsByRepo.value = {};
  clearHomeGitHubOverviewSnapshot();
}

function prepareGitHubTimeline(repos: GitHubRepoSummary[], refresh = false) {
  const timelineRepos = repos.filter(repoIncludedInHomeTimeline);
  void loadHomePendingAccountIssues(timelineRepos, refresh);
  void loadHomePendingActionNotifications(timelineRepos, refresh);
}

function repoIncludedInHomeTimeline(repo: GitHubRepoSummary) {
  if (repo.disabled) return false;
  const localRepo = localRepoByGitHubFullName.value.get(repo.fullName) ?? null;
  return !localRepo || repoCalculatesHomeTimeline(workspace.state.settings, localRepo.id);
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

async function loadRemainingSearchGitHubRepos() {
  if (searchRepoPagesLoading || githubReposLoading.value || githubReposLoadingMore.value) return;
  searchRepoPagesLoading = true;
  try {
    while (searchOpen.value && normalizedSearchQuery.value && githubReposNextPage.value) {
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
  return localRepo ? syncIssuesByRepoId.value.get(localRepo.id) ?? null : null;
}

function toHomePendingDisplayNode(item: HomePendingItem): TimelineDisplayNode {
  return {
    id: item.id,
    icon: homePendingItemIcon(item.kind),
    title: item.title,
    detail: item.detail,
    summary: item.summary,
    timestamp: item.timestamp,
    link: homePendingItemLink(item),
    tone: item.tone,
  };
}

function homePendingItemLink(item: HomePendingItem): TimelineNodeLink {
  const target = item.target;
  if (target.kind === "repo") return timelineNodeLink(repoDetailPath({ id: target.repoId }));
  if (target.kind === "issue") {
    const href = target.localRepoId
      ? repoProjectPath({ id: target.localRepoId }, "issues", target.number)
      : remoteRepoProjectPath({ fullName: target.repoFullName }, "issues", target.number);
    return timelineNodeLink(href);
  }
  if (target.kind === "pull") {
    const href = target.localRepoId
      ? repoProjectPath({ id: target.localRepoId }, "pulls", target.number)
      : remoteRepoProjectPath({ fullName: target.repoFullName }, "pulls", target.number);
    return timelineNodeLink(href);
  }
  const href = target.localRepoId
    ? repoProjectPath({ id: target.localRepoId }, "actions", target.runId)
    : remoteRepoProjectPath({ fullName: target.repoFullName }, "actions", target.runId);
  return timelineNodeLink(href);
}

function homePendingItemIcon(kind: HomePendingItem["kind"]) {
  if (kind === "issue") return CircleDot;
  if (kind === "pull") return GitPullRequestArrow;
  if (kind === "workflow") return RotateCw;
  return RefreshCw;
}

function timelineNodeLink(href: string | undefined, preload?: () => Promise<unknown>): TimelineNodeLink {
  if (!href) return { kind: "none" };
  if (href.startsWith("http")) return { kind: "external", href };
  return { kind: "route", to: href, preload };
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

function formatTimelineTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
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
  if (workspace.isReady.value && !githubRepos.value.length && !githubReposLoading.value) {
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

function openCloneRepoDialog() {
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
      onSelect: openCloneRepoDialog,
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

async function syncRepo(repo: RepoSummary) {
  if (syncingRepoId.value) return;
  syncingRepoId.value = repo.id;
  try {
    await workspace.mergePull(repo.id, "stash");
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
  void workspace.syncAll("stash");
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
              v-if="githubTimelineBusy && !homePendingNodes.length"
              class="repo-status-empty"
            >
              正在加载待处理事项...
            </p>
            <p v-else-if="!homePendingNodes.length" class="repo-status-empty">暂无待处理事项</p>
            <GitHubTimelineList
              v-else
              :nodes="homePendingNodes"
              :format-time="formatTimelineTime"
              aria-label="待处理事项列表"
            />
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
