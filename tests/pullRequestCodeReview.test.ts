import { describe, expect, it } from "vitest";
import { commentLocation, parseUnifiedPatch, toSplitDiffRows } from "../src/components/repo/review/pullRequestDiff";
import { evaluatePullRequestMergeGate } from "../src/components/repo/review/pullRequestMergeGate";
import { activeRequestedChanges, latestPullRequestReviews } from "../src/components/repo/review/pullRequestReviewState";
import { reviewAgentIdToken } from "../src/components/repo/review/reviewAgentId";
import { codeReviewErrorMessage } from "../src/components/repo/review/reviewError";
import {
  createPullRequestLineCommentFallback,
  getPullRequestCodeReviewFallback,
  replyPullRequestReviewThreadFallback,
  resetCodeReviewFallbackForTests,
  submitPullRequestCodeReviewFallback,
} from "../src/services/codeReview/fallback";
import type { PullRequestCodeReviewDetail } from "../src/services/codeReview";
import type { GitHubPullRequest, GitHubPullRequestCheck } from "../src/services/workspace/types";

const pull = {
  state: "open",
  merged: false,
  draft: false,
} satisfies Pick<GitHubPullRequest, "state" | "merged" | "draft">;

const protectedDetail: PullRequestCodeReviewDetail = {
  files: [],
  reviews: [],
  threads: [],
  reviewDecision: "APPROVED",
  mergeable: true,
  mergeStateStatus: "CLEAN",
  baseBranch: "main",
  baseSha: "base123",
  headSha: "abc123",
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

describe("Pull Request Code Review domain", () => {
  it("keeps line identity when converting a unified hunk to split rows", () => {
    const rows = parseUnifiedPatch({
      filename: "src/value.ts",
      patch: "@@ -7,3 +7,4 @@\n keep\n-old\n+new\n+extra",
    });

    expect(rows.map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([
      ["hunk", null, null],
      ["context", 7, 7],
      ["deletion", 8, null],
      ["addition", null, 8],
      ["addition", null, 9],
    ]);
    expect(commentLocation(rows[2]!)).toEqual({ line: 8, side: "LEFT" });
    expect(commentLocation(rows[3]!)).toEqual({ line: 8, side: "RIGHT" });
    expect(toSplitDiffRows(rows).slice(2)).toMatchObject([
      { left: { line: 8, content: "old" }, right: { line: 8, content: "new" } },
      { left: { kind: "empty" }, right: { line: 9, content: "extra" } },
    ]);
  });

  it("only allows merge after required checks, approvals, and conversations pass", () => {
    const pendingChecks: GitHubPullRequestCheck[] = [{
      id: 1,
      name: "build",
      status: "in_progress",
      conclusion: null,
      detailsUrl: null,
      startedAt: null,
      completedAt: null,
    }];
    const unresolved = {
      ...protectedDetail,
      threads: [{
        id: "thread-1",
        isResolved: false,
        isOutdated: false,
        path: "src/value.ts",
        line: 8,
        originalLine: null,
        side: "RIGHT",
        diffHunk: null,
        commentsTruncated: false,
        commentsUnavailableReason: null,
        comments: [],
      }],
    };
    const blocked = evaluatePullRequestMergeGate(pull, pendingChecks, unresolved);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons).toEqual(expect.arrayContaining([
      "必需检查 build 仍在运行。",
      "分支保护要求先解决 1 个 review thread。",
    ]));

    const successfulChecks = [{ ...pendingChecks[0]!, status: "completed", conclusion: "success" }];
    expect(evaluatePullRequestMergeGate(pull, successfulChecks, protectedDetail)).toEqual({
      allowed: true,
      reasons: [],
      warnings: [],
    });

    const protectionUnavailable = evaluatePullRequestMergeGate(pull, successfulChecks, {
      ...protectedDetail,
      branchProtection: { ...protectedDetail.branchProtection, available: false },
    });
    expect(protectionUnavailable.allowed).toBe(false);
    expect(protectionUnavailable.reasons).toContain("无法确认目标分支的保护规则，请刷新后重试。");

    const incompleteStatus = evaluatePullRequestMergeGate(pull, successfulChecks, {
      ...protectedDetail,
      reviewDecision: null,
      mergeStateStatus: null,
      branchProtection: {
        ...protectedDetail.branchProtection,
        requiredApprovals: 0,
        requireCodeOwnerReviews: true,
      },
    });
    expect(incompleteStatus.allowed).toBe(false);
    expect(incompleteStatus.reasons).toEqual(expect.arrayContaining([
      "GitHub 尚未返回完整的合并状态。",
      "分支保护要求 Code Owner 批准。",
    ]));
  });

  it("maps recoverable write failures and creates selector-safe replay ids", () => {
    expect(codeReviewErrorMessage(new Error("HTTP 403 Forbidden"), { draftPreserved: true }))
      .toBe("当前 GitHub 授权不允许此操作，草稿已保留；请重新绑定并授予仓库写入权限。");
    expect(codeReviewErrorMessage(new Error("network timeout"), { draftPreserved: true }))
      .toBe("暂时无法连接 GitHub，草稿已保留；请检查网络后重试。");
    expect(codeReviewErrorMessage(new Error("HTTP 422 Unprocessable"), { draftPreserved: true }))
      .toBe("Review 上下文已经变化或不存在，草稿已保留；请刷新后重试。");
    expect(reviewAgentIdToken("src/a file['x'].ts")).toBe("src_2Fa_20file_5B_27x_27_5D.ts");
  });

  it("keeps only each reviewer's latest effective review state", () => {
    const reviews = [
      { id: 1, author: "Mika", state: "CHANGES_REQUESTED", body: "old request", submittedAt: null, htmlUrl: null },
      { id: 2, author: "mika", state: "APPROVED", body: null, submittedAt: null, htmlUrl: null },
      { id: 3, author: "Lee", state: "CHANGES_REQUESTED", body: "still active", submittedAt: null, htmlUrl: null },
      { id: 6, author: "lee", state: "COMMENTED", body: "follow-up context", submittedAt: null, htmlUrl: null },
      { id: 4, author: "Ren", state: "CHANGES_REQUESTED", body: "dismissed request", submittedAt: null, htmlUrl: null },
      { id: 5, author: "ren", state: "DISMISSED", body: null, submittedAt: null, htmlUrl: null },
    ];

    expect(latestPullRequestReviews(reviews).map((review) => [review.author, review.state])).toEqual([
      ["mika", "APPROVED"],
      ["lee", "COMMENTED"],
      ["ren", "DISMISSED"],
    ]);
    expect(activeRequestedChanges(reviews).map((review) => review.body)).toEqual(["still active"]);
  });

  it("persists line comments, thread replies, and review decisions in mock runtime", async () => {
    resetCodeReviewFallbackForTests();
    const initial = await getPullRequestCodeReviewFallback("acme/widget", 26);
    const thread = initial.threads[0]!;

    await createPullRequestLineCommentFallback("acme/widget", 26, {
      body: "请处理这一行",
      commitId: initial.headSha,
      path: "src/example.ts",
      line: 2,
      side: "RIGHT",
    });
    await replyPullRequestReviewThreadFallback("acme/widget", 26, {
      threadId: thread.id,
      body: "已经处理",
    });
    await submitPullRequestCodeReviewFallback("acme/widget", 26, {
      event: "approve",
      body: null,
    });

    const updated = await getPullRequestCodeReviewFallback("acme/widget", 26);
    expect(updated.threads).toHaveLength(2);
    expect(updated.threads[0]?.comments.map((comment) => comment.body)).toContain("已经处理");
    expect(updated.reviewDecision).toBe("APPROVED");
    expect(updated.reviews[0]).toMatchObject({ author: "fallback-user", state: "APPROVED" });
  });
});
