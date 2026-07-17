import { call } from "../workspace/client";
import {
  createPullRequestLineCommentFallback,
  getPullRequestCodeReviewFallback,
  replyPullRequestReviewThreadFallback,
  submitPullRequestCodeReviewFallback,
} from "./fallback";
import type {
  CreatePullRequestLineCommentRequest,
  ReplyPullRequestReviewThreadRequest,
  SubmitPullRequestCodeReviewRequest,
} from "./types";

export function getPullRequestCodeReview(repoFullName: string, pullNumber: number) {
  return call(
    "github_get_pull_request_code_review",
    { repoFullName, pullNumber },
    () => getPullRequestCodeReviewFallback(repoFullName, pullNumber),
  );
}

export function createPullRequestLineComment(
  repoFullName: string,
  pullNumber: number,
  request: CreatePullRequestLineCommentRequest,
) {
  return call(
    "github_create_pull_request_line_comment",
    { repoFullName, pullNumber, request },
    () => createPullRequestLineCommentFallback(repoFullName, pullNumber, request),
  );
}

export function replyPullRequestReviewThread(
  repoFullName: string,
  pullNumber: number,
  request: ReplyPullRequestReviewThreadRequest,
) {
  return call(
    "github_reply_pull_request_review_thread",
    { repoFullName, request },
    () => replyPullRequestReviewThreadFallback(repoFullName, pullNumber, request),
  );
}

export function submitPullRequestCodeReview(
  repoFullName: string,
  pullNumber: number,
  request: SubmitPullRequestCodeReviewRequest,
) {
  return call(
    "github_submit_pull_request_code_review",
    { repoFullName, pullNumber, request },
    () => submitPullRequestCodeReviewFallback(repoFullName, pullNumber, request),
  );
}
