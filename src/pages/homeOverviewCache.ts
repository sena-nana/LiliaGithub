import type { GitHubIssue, GitHubRepoSummary, GitHubWorkflowRun } from "../services/workspace";

export type HomeGitHubOverviewSnapshot = {
  repos: GitHubRepoSummary[];
  nextPage: number | null;
  issuesByRepo: Record<string, GitHubIssue[] | undefined>;
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

function cloneIssuesByRepo(issuesByRepo: Record<string, GitHubIssue[] | undefined>) {
  if (!issuesByRepo) return {};
  return Object.fromEntries(
    Object.entries(issuesByRepo).map(([repoFullName, issues]) => [
      repoFullName,
      issues?.map(cloneIssue),
    ]),
  );
}

function cloneWorkflowRun(run: GitHubWorkflowRun): GitHubWorkflowRun {
  return { ...run };
}

function cloneWorkflowRunsByRepo(workflowRunsByRepo: Record<string, GitHubWorkflowRun[] | undefined>) {
  if (!workflowRunsByRepo) return {};
  return Object.fromEntries(
    Object.entries(workflowRunsByRepo).map(([repoFullName, runs]) => [
      repoFullName,
      runs?.map(cloneWorkflowRun),
    ]),
  );
}

function cloneSnapshot(snapshot: HomeGitHubOverviewSnapshot): HomeGitHubOverviewSnapshot {
  return {
    repos: snapshot.repos.map((repo) => ({ ...repo })),
    nextPage: snapshot.nextPage,
    issuesByRepo: cloneIssuesByRepo(snapshot.issuesByRepo),
    workflowRunsByRepo: cloneWorkflowRunsByRepo(snapshot.workflowRunsByRepo),
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
