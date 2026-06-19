import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRepoSummary,
  GitHubWorkflowRun,
} from "../services/workspace";

export type HomeGitHubOverviewSnapshot = {
  repos: GitHubRepoSummary[];
  nextPage: number | null;
  issuesByRepo: Record<string, GitHubIssue[] | undefined>;
  pullRequestsByRepo: Record<string, GitHubPullRequest[] | undefined>;
  pullRequestChecksByRepo: Record<string, Record<number, GitHubPullRequestCheck[] | undefined> | undefined>;
  workflowRunsByRepo: Record<string, GitHubWorkflowRun[] | undefined>;
};

let githubOverviewSnapshot: HomeGitHubOverviewSnapshot | null = null;

function cloneIssue(issue: GitHubIssue): GitHubIssue {
  return {
    ...issue,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
  };
}

function cloneShallow<T extends object>(item: T): T {
  return { ...item };
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
    repos: snapshot.repos.map((repo) => ({ ...repo })),
    nextPage: snapshot.nextPage,
    issuesByRepo: cloneListByRepo(snapshot.issuesByRepo, cloneIssue),
    pullRequestsByRepo: cloneListByRepo(snapshot.pullRequestsByRepo, cloneShallow),
    pullRequestChecksByRepo: clonePullRequestChecksByRepo(snapshot.pullRequestChecksByRepo),
    workflowRunsByRepo: cloneListByRepo(snapshot.workflowRunsByRepo, cloneShallow),
  };
}

export function readHomeGitHubOverviewSnapshot() {
  return githubOverviewSnapshot ? cloneSnapshot(githubOverviewSnapshot) : null;
}

export function writeHomeGitHubOverviewSnapshot(snapshot: HomeGitHubOverviewSnapshot) {
  githubOverviewSnapshot = cloneSnapshot(snapshot);
}

export function clearHomeGitHubOverviewSnapshot() {
  githubOverviewSnapshot = null;
}
