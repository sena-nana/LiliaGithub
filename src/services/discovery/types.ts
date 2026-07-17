import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubRelease,
  GitHubRepositoryPermissions,
  GitHubWorkflowRun,
} from "../workspace/types";

export type DiscoveryPullRequestReason = "review_requested" | "assigned";

export interface DiscoveryPendingPullRequest {
  repoFullName: string;
  pullRequest: GitHubPullRequest;
  reasons: DiscoveryPullRequestReason[];
}

export interface DiscoveryAssignedIssue {
  repoFullName: string;
  issue: GitHubIssue;
}

export interface DiscoveryFailedWorkflowRun {
  repoFullName: string;
  run: GitHubWorkflowRun;
}

export interface DiscoveryRecentRelease {
  repoFullName: string;
  release: GitHubRelease;
}

export interface DiscoveryRepositoryFailure {
  repoFullName: string;
  message: string;
}

export interface DiscoveryAggregateResult<T> {
  items: T[];
  failures: DiscoveryRepositoryFailure[];
  truncated: boolean;
  requestedRepositoryCount: number;
  successfulRepositoryCount: number;
}

export interface DiscoveryLoadOptions {
  forceRefresh?: boolean;
  now?: Date;
}

export interface DiscoveryRepositoryStatus {
  fullName: string;
  updatedAt: string;
  private: boolean;
  archived: boolean;
  disabled: boolean;
  htmlUrl: string;
  permissions: GitHubRepositoryPermissions;
  allowMergeCommit: boolean;
  allowSquashMerge: boolean;
  allowRebaseMerge: boolean;
}

export interface DiscoveryRepositoryStatusItem {
  repoFullName: string;
  status: DiscoveryRepositoryStatus;
}

export type DiscoveryPullRequestReviewEvent = "approve" | "request_changes" | "comment";

export interface DiscoveryPullRequestReviewRequest {
  event: DiscoveryPullRequestReviewEvent;
  body?: string | null;
}

export interface DiscoveryCommandOptions {
  forceRefresh?: boolean;
}
