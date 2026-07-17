import type {
  CreatePullRequestLineCommentRequest,
  PullRequestCodeReviewDetail,
  PullRequestReview,
  PullRequestReviewComment,
  ReplyPullRequestReviewThreadRequest,
  SubmitPullRequestCodeReviewRequest,
} from "./types";

const details = new Map<string, PullRequestCodeReviewDetail>();
let nextCommentId = 1;
let nextReviewId = 1;

function key(repoFullName: string, pullNumber: number) {
  return `${repoFullName.toLocaleLowerCase()}#${pullNumber}`;
}

function clone(detail: PullRequestCodeReviewDetail): PullRequestCodeReviewDetail {
  return {
    ...detail,
    files: detail.files.map((file) => ({ ...file })),
    reviews: detail.reviews.map((review) => ({ ...review })),
    threads: detail.threads.map((thread) => ({
      ...thread,
      comments: thread.comments.map((comment) => ({ ...comment })),
    })),
    branchProtection: {
      ...detail.branchProtection,
      requiredStatusChecks: [...detail.branchProtection.requiredStatusChecks],
    },
  };
}

function fallbackDetail(repoFullName: string, pullNumber: number): PullRequestCodeReviewDetail {
  const stored = details.get(key(repoFullName, pullNumber));
  if (stored) return stored;
  const created: PullRequestCodeReviewDetail = {
    files: [
      {
        sha: "fallback-file-sha",
        filename: "src/example.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        changes: 3,
        blobUrl: null,
        rawUrl: null,
        patch: "@@ -1,2 +1,3 @@\n-export const ready = false;\n+export const ready = true;\n+export const source = 'review';\n export const stable = true;",
        truncated: false,
      },
    ],
    reviews: [],
    threads: [{
      id: "fallback-thread-review",
      isResolved: false,
      isOutdated: false,
      path: "src/example.ts",
      line: 2,
      originalLine: null,
      side: "RIGHT",
      diffHunk: "@@ -1,2 +1,3 @@",
      commentsTruncated: false,
      commentsUnavailableReason: null,
      comments: [{
        id: "fallback-comment-review",
        databaseId: 1,
        author: "reviewer",
        body: "请确认状态切换后仍保留稳定行为。",
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:00:00Z",
        htmlUrl: "https://github.com",
        replyToId: null,
      }],
    }],
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: true,
    mergeStateStatus: "BLOCKED",
    baseBranch: "main",
    baseSha: "fallback-base-sha",
    headSha: "fallback-head-sha",
    branchProtection: {
      available: true,
      protected: true,
      requiredApprovals: 1,
      requireCodeOwnerReviews: false,
      requiredStatusChecks: ["build"],
      enforceAdmins: true,
      requireConversationResolution: true,
      unavailableReason: null,
    },
  };
  details.set(key(repoFullName, pullNumber), created);
  return created;
}

function comment(body: string, replyToId: string | null = null): PullRequestReviewComment {
  const id = `fallback-review-comment-${nextCommentId++}`;
  const now = new Date().toISOString();
  return {
    id,
    databaseId: nextCommentId,
    author: "fallback-user",
    body: body.trim(),
    createdAt: now,
    updatedAt: now,
    htmlUrl: "https://github.com",
    replyToId,
  };
}

export async function getPullRequestCodeReviewFallback(repoFullName: string, pullNumber: number) {
  return clone(fallbackDetail(repoFullName, pullNumber));
}

export async function createPullRequestLineCommentFallback(
  repoFullName: string,
  pullNumber: number,
  request: CreatePullRequestLineCommentRequest,
) {
  const detail = fallbackDetail(repoFullName, pullNumber);
  const next = comment(request.body);
  detail.threads.push({
    id: `fallback-thread-${next.id}`,
    isResolved: false,
    isOutdated: false,
    path: request.path,
    line: request.line,
    originalLine: null,
    side: request.side,
    diffHunk: null,
    commentsTruncated: false,
    commentsUnavailableReason: null,
    comments: [next],
  });
  return { ...next };
}

export async function replyPullRequestReviewThreadFallback(
  repoFullName: string,
  pullNumber: number,
  request: ReplyPullRequestReviewThreadRequest,
) {
  const detail = fallbackDetail(repoFullName, pullNumber);
  const thread = detail.threads.find((item) => item.id === request.threadId);
  if (!thread) throw new Error("Review Thread 不存在，请刷新后重试");
  const next = comment(
    request.body,
    thread.comments.length ? thread.comments[thread.comments.length - 1]?.id ?? null : null,
  );
  thread.comments.push(next);
  return { ...next };
}

export async function submitPullRequestCodeReviewFallback(
  repoFullName: string,
  pullNumber: number,
  request: SubmitPullRequestCodeReviewRequest,
) {
  const detail = fallbackDetail(repoFullName, pullNumber);
  const review: PullRequestReview = {
    id: nextReviewId++,
    author: "fallback-user",
    state: request.event === "approve"
      ? "APPROVED"
      : request.event === "request_changes"
        ? "CHANGES_REQUESTED"
        : "COMMENTED",
    body: request.body?.trim() || null,
    submittedAt: new Date().toISOString(),
    htmlUrl: "https://github.com",
  };
  detail.reviews.push(review);
  detail.reviewDecision = request.event === "approve"
    ? "APPROVED"
    : request.event === "request_changes"
      ? "CHANGES_REQUESTED"
      : detail.reviewDecision;
  return { ...review };
}

export function resetCodeReviewFallbackForTests() {
  details.clear();
  nextCommentId = 1;
  nextReviewId = 1;
}
