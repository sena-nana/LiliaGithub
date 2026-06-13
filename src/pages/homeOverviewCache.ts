import type { GitHubIssue, GitHubRepoSummary } from "../services/workspace";

export type HomeGitHubOverviewSnapshot = {
  repos: GitHubRepoSummary[];
  nextPage: number | null;
  issuesByRepo: Record<string, GitHubIssue[] | undefined>;
};

let githubOverviewSnapshot: HomeGitHubOverviewSnapshot | null = null;

function cloneIssue(issue: GitHubIssue): GitHubIssue {
  return {
    ...issue,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
  };
}

function cloneIssuesByRepo(issuesByRepo: Record<string, GitHubIssue[] | undefined>) {
  return Object.fromEntries(
    Object.entries(issuesByRepo).map(([repoFullName, issues]) => [
      repoFullName,
      issues?.map(cloneIssue),
    ]),
  );
}

function cloneSnapshot(snapshot: HomeGitHubOverviewSnapshot): HomeGitHubOverviewSnapshot {
  return {
    repos: snapshot.repos.map((repo) => ({ ...repo })),
    nextPage: snapshot.nextPage,
    issuesByRepo: cloneIssuesByRepo(snapshot.issuesByRepo),
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
