export type PullRequestDiffSide = "LEFT" | "RIGHT";
export type PullRequestCodeReviewEvent = "approve" | "request_changes" | "comment";

export interface PullRequestChangedFile {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  blobUrl: string | null;
  rawUrl: string | null;
  patch: string | null;
  truncated: boolean;
}

export interface PullRequestReview {
  id: number;
  author: string;
  state: string;
  body: string | null;
  submittedAt: string | null;
  htmlUrl: string | null;
}

export interface PullRequestReviewComment {
  id: string;
  databaseId: number | null;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  replyToId: string | null;
}

export interface PullRequestReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  side: PullRequestDiffSide | string | null;
  diffHunk: string | null;
  comments: PullRequestReviewComment[];
  commentsTruncated: boolean;
  commentsUnavailableReason: string | null;
}

export interface PullRequestBranchProtectionSummary {
  available: boolean;
  protected: boolean;
  requiredApprovals: number;
  requireCodeOwnerReviews: boolean;
  requiredStatusChecks: string[];
  enforceAdmins: boolean;
  requireConversationResolution: boolean;
  unavailableReason: string | null;
}

export interface PullRequestCodeReviewDetail {
  files: PullRequestChangedFile[];
  reviews: PullRequestReview[];
  threads: PullRequestReviewThread[];
  reviewDecision: string | null;
  mergeable: boolean | null;
  mergeStateStatus: string | null;
  baseBranch: string;
  baseSha: string;
  headSha: string;
  branchProtection: PullRequestBranchProtectionSummary;
}

export interface CreatePullRequestLineCommentRequest {
  body: string;
  commitId: string;
  path: string;
  line: number;
  side: PullRequestDiffSide;
  startLine?: number | null;
  startSide?: PullRequestDiffSide | null;
}

export interface ReplyPullRequestReviewThreadRequest {
  threadId: string;
  body: string;
}

export interface SubmitPullRequestCodeReviewRequest {
  event: PullRequestCodeReviewEvent;
  body?: string | null;
}
