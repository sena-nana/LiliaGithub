import type { GitHubPullRequest, GitHubWorkflowRun } from "../workspace/types";

export type HomeAttentionPullRequestReason = "review_requested" | "assigned";

export interface HomeAttentionPendingPullRequest {
  repoFullName: string;
  pullRequest: GitHubPullRequest;
  reasons: HomeAttentionPullRequestReason[];
}

export interface HomeAttentionFailedWorkflowRun {
  repoFullName: string;
  run: GitHubWorkflowRun;
}

export interface HomeAttentionRepositoryFailure {
  repoFullName: string;
  message: string;
}

export interface HomeAttentionSection<T> {
  items: T[];
  failures: HomeAttentionRepositoryFailure[];
  truncated: boolean;
  requestedRepositoryCount: number;
  successfulRepositoryCount: number;
}

export interface HomeAttentionResult {
  pendingPullRequests: HomeAttentionSection<HomeAttentionPendingPullRequest>;
  failedWorkflows: HomeAttentionSection<HomeAttentionFailedWorkflowRun>;
}

export interface HomeAttentionLoadOptions {
  forceRefresh?: boolean;
}
