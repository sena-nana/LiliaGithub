import type { WorkspaceClient } from "../workspace/client";
import type {
  CreatePullRequestLineCommentRequest,
  ReplyPullRequestReviewThreadRequest,
  SubmitPullRequestCodeReviewRequest,
} from "./types";

export function getPullRequestCodeReview(client: WorkspaceClient, repoFullName: string, pullNumber: number) {
  return client.call(
    "github_get_pull_request_code_review",
    { repoFullName, pullNumber },
  );
}

export function createPullRequestLineComment(
  client: WorkspaceClient,
  repoFullName: string,
  pullNumber: number,
  request: CreatePullRequestLineCommentRequest,
) {
  return client.call(
    "github_create_pull_request_line_comment",
    { repoFullName, pullNumber, request },
  );
}

export function replyPullRequestReviewThread(
  client: WorkspaceClient,
  repoFullName: string,
  _pullNumber: number,
  request: ReplyPullRequestReviewThreadRequest,
) {
  return client.call(
    "github_reply_pull_request_review_thread",
    { repoFullName, request },
  );
}

export function submitPullRequestCodeReview(
  client: WorkspaceClient,
  repoFullName: string,
  pullNumber: number,
  request: SubmitPullRequestCodeReviewRequest,
) {
  return client.call(
    "github_submit_pull_request_code_review",
    { repoFullName, pullNumber, request },
  );
}
