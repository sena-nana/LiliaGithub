import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRelease,
  GitHubRepoSummary,
  GitHubActionNotification,
} from "../services/workspace";
import { scheduleLowPriorityTask, type CancelLowPriorityTask } from "../utils/lowPriorityScheduler";

export type HomeGitHubOverviewSnapshot = {
  schemaVersion: 3;
  accountLogin: string | null;
  cachedAt: number;
  repos: GitHubRepoSummary[];
  nextPage: number | null;
  issuesByRepo: Record<string, GitHubIssue[] | undefined>;
  pullRequestsByRepo: Record<string, GitHubPullRequest[] | undefined>;
  pullRequestChecksByRepo: Record<string, Record<number, GitHubPullRequestCheck[] | undefined> | undefined>;
  actionNotificationsByRepo: Record<string, GitHubActionNotification[] | undefined>;
  releasesByRepo: Record<string, GitHubRelease[] | undefined>;
};

let githubOverviewSnapshot: HomeGitHubOverviewSnapshot | null = null;
let persistedOverviewSnapshot: PersistedHomeGitHubOverviewSnapshot | null = null;
let persistedOverviewSnapshotWriteCancel: CancelLowPriorityTask | null = null;
const STORAGE_KEY = "lilia-github.home.overviewSnapshot.v1";
export const HOME_GITHUB_OVERVIEW_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const HOME_GITHUB_OVERVIEW_SNAPSHOT_REFRESH_MS = 5 * 60 * 1000;

type PersistedHomeGitHubOverviewSnapshot = Pick<
  HomeGitHubOverviewSnapshot,
  "schemaVersion" | "accountLogin" | "cachedAt" | "repos" | "nextPage"
>;

type RawStoredHomeGitHubOverviewSnapshot = {
  schemaVersion?: unknown;
  accountLogin?: unknown;
  cachedAt?: unknown;
  repos?: unknown;
  nextPage?: unknown;
};

function emptyRepoLists() {
  return {
    issuesByRepo: {},
    pullRequestsByRepo: {},
    pullRequestChecksByRepo: {},
    actionNotificationsByRepo: {},
    releasesByRepo: {},
  };
}

function cloneIssue(issue: GitHubIssue): GitHubIssue {
  return {
    ...issue,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
    milestone: issue.milestone ? { ...issue.milestone } : null,
    projectItems: issue.projectItems?.map((project) => ({ ...project })) ?? [],
    developmentItems: issue.developmentItems?.map((item) => ({ ...item })) ?? [],
  };
}

function clonePullRequest(pullRequest: GitHubPullRequest): GitHubPullRequest {
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

function cloneShallow<T extends object>(item: T): T {
  return { ...item };
}

function cloneRelease(release: GitHubRelease): GitHubRelease {
  return {
    ...release,
    assets: release.assets.map(cloneShallow),
  };
}

function cloneListByRepo<T>(
  itemsByRepo: Record<string, T[] | undefined>,
  cloneItem: (item: T) => T,
) {
  if (!itemsByRepo) return {};
  return Object.fromEntries(
    Object.entries(itemsByRepo).map(([repoFullName, items]) => [
      repoFullName,
      items?.map(cloneItem),
    ]),
  );
}

function clonePullRequestChecksByRepo(
  pullRequestChecksByRepo: Record<string, Record<number, GitHubPullRequestCheck[] | undefined> | undefined>,
) {
  if (!pullRequestChecksByRepo) return {};
  return Object.fromEntries(
    Object.entries(pullRequestChecksByRepo).map(([repoFullName, checksByPull]) => [
      repoFullName,
      checksByPull
        ? Object.fromEntries(
            Object.entries(checksByPull).map(([pullNumber, checks]) => [
              pullNumber,
              checks?.map(cloneShallow),
            ]),
          )
        : undefined,
    ]),
  );
}

function cloneSnapshot(snapshot: HomeGitHubOverviewSnapshot): HomeGitHubOverviewSnapshot {
  return {
    schemaVersion: 3,
    accountLogin: snapshot.accountLogin,
    cachedAt: snapshot.cachedAt,
    repos: snapshot.repos.map((repo) => ({ ...repo })),
    nextPage: snapshot.nextPage,
    issuesByRepo: cloneListByRepo(snapshot.issuesByRepo, cloneIssue),
    pullRequestsByRepo: cloneListByRepo(snapshot.pullRequestsByRepo, clonePullRequest),
    pullRequestChecksByRepo: clonePullRequestChecksByRepo(snapshot.pullRequestChecksByRepo),
    actionNotificationsByRepo: cloneListByRepo(snapshot.actionNotificationsByRepo ?? {}, cloneShallow),
    releasesByRepo: cloneListByRepo(snapshot.releasesByRepo, cloneRelease),
  };
}

function cloneSnapshotForMemory(snapshot: HomeGitHubOverviewSnapshot): HomeGitHubOverviewSnapshot {
  return {
    schemaVersion: 3,
    accountLogin: snapshot.accountLogin,
    cachedAt: snapshot.cachedAt,
    repos: snapshot.repos.map((repo) => ({ ...repo })),
    nextPage: snapshot.nextPage,
    issuesByRepo: snapshot.issuesByRepo,
    pullRequestsByRepo: snapshot.pullRequestsByRepo,
    pullRequestChecksByRepo: snapshot.pullRequestChecksByRepo,
    actionNotificationsByRepo: snapshot.actionNotificationsByRepo,
    releasesByRepo: snapshot.releasesByRepo,
  };
}

function persistedSnapshot(snapshot: HomeGitHubOverviewSnapshot): PersistedHomeGitHubOverviewSnapshot {
  return {
    schemaVersion: 3,
    accountLogin: snapshot.accountLogin,
    cachedAt: snapshot.cachedAt,
    repos: snapshot.repos.map((repo) => ({ ...repo })),
    nextPage: snapshot.nextPage,
  };
}

export function readHomeGitHubOverviewSnapshot() {
  const snapshot = githubOverviewSnapshot ?? readStoredSnapshot();
  if (!snapshot) return null;
  if (!isSnapshotUsable(snapshot)) {
    clearHomeGitHubOverviewSnapshot();
    return null;
  }
  githubOverviewSnapshot = cloneSnapshot(snapshot);
  return cloneSnapshot(snapshot);
}

export function writeHomeGitHubOverviewSnapshot(snapshot: HomeGitHubOverviewSnapshot) {
  githubOverviewSnapshot = cloneSnapshotForMemory(snapshot);
  persistedOverviewSnapshot = persistedSnapshot(snapshot);
  if (persistedOverviewSnapshotWriteCancel) return;
  persistedOverviewSnapshotWriteCancel = scheduleLowPriorityTask(() => {
    persistedOverviewSnapshotWriteCancel = null;
    const next = persistedOverviewSnapshot;
    if (!next) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / privacy mode errors */
    }
  });
}

export function clearHomeGitHubOverviewSnapshot() {
  persistedOverviewSnapshotWriteCancel?.();
  persistedOverviewSnapshotWriteCancel = null;
  persistedOverviewSnapshot = null;
  githubOverviewSnapshot = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore storage errors */
  }
}

function isSnapshotUsable(snapshot: HomeGitHubOverviewSnapshot) {
  const age = Date.now() - snapshot.cachedAt;
  return snapshot.schemaVersion === 3 &&
    Number.isFinite(snapshot.cachedAt) &&
    age >= 0 &&
    age < HOME_GITHUB_OVERVIEW_SNAPSHOT_MAX_AGE_MS;
}

export function homeGitHubOverviewSnapshotNeedsRefresh(snapshot: HomeGitHubOverviewSnapshot) {
  return Date.now() - snapshot.cachedAt >= HOME_GITHUB_OVERVIEW_SNAPSHOT_REFRESH_MS;
}

function readStoredSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseSnapshot(value: unknown): HomeGitHubOverviewSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as RawStoredHomeGitHubOverviewSnapshot;
  if (
    typeof snapshot.cachedAt !== "number" ||
    !Array.isArray(snapshot.repos)
  ) {
    return null;
  }
  if (snapshot.schemaVersion !== 2 && snapshot.schemaVersion !== 3) return null;
  return {
    schemaVersion: 3,
    accountLogin: typeof snapshot.accountLogin === "string" ? snapshot.accountLogin : null,
    cachedAt: snapshot.cachedAt,
    repos: snapshot.repos.map((repo) => ({ ...repo })),
    nextPage: typeof snapshot.nextPage === "number" ? snapshot.nextPage : null,
    ...emptyRepoLists(),
  };
}
