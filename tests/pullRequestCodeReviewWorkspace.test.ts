import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import PullRequestCodeReviewWorkspace from "../src/components/repo/review/PullRequestCodeReviewWorkspace.vue";
import PullRequestReviewThreads from "../src/components/repo/review/PullRequestReviewThreads.vue";
import type {
  GitHubBindingMetadata,
  GitHubPullRequest,
} from "../src/services/workspace/types";
import {
  createWorkspaceStoreFixture,
  provideWorkspaceStoreFixture,
} from "./fixtures/createWorkspaceStoreFixture";
import { workspaceBootstrap, workspaceSettings } from "./fixtures/workspace";

const mocks = vi.hoisted(() => ({
  createHandoff: vi.fn(),
  openHandoffResult: vi.fn(),
}));

const codeReviewDetail = {
    files: [{
      sha: "file-sha",
      filename: "src/review.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      changes: 2,
      blobUrl: "https://github.com/acme/widget/blob/head/src/review.ts",
      rawUrl: null,
      patch: "@@ -1 +1 @@\n-old\n+new",
      truncated: false,
    }],
    reviews: [],
    threads: [],
    reviewDecision: "APPROVED",
    mergeable: true,
    mergeStateStatus: "CLEAN",
    baseBranch: "main",
    baseSha: "base-sha",
    headSha: "head-sha",
    branchProtection: {
      available: true,
      protected: false,
      requiredApprovals: 0,
      requireCodeOwnerReviews: false,
      requiredStatusChecks: [],
      enforceAdmins: false,
      requireConversationResolution: false,
      unavailableReason: null,
    },
  } as const;

const pull: GitHubPullRequest = {
  number: 26,
  title: "Complete code review",
  state: "open",
  draft: false,
  body: null,
  labels: [],
  assignees: [],
  htmlUrl: "https://github.com/acme/widget/pull/26",
  updatedAt: "2026-07-17T00:00:00Z",
  createdAt: "2026-07-16T00:00:00Z",
  author: "author",
  baseBranch: "main",
  headBranch: "feature/review",
  merged: false,
  mergeable: true,
  mergeableState: "clean",
};

describe("PullRequestCodeReviewWorkspace", () => {
  it("rejects account A review data after account B becomes current", async () => {
    const accountARequest = Promise.withResolvers<typeof codeReviewDetail>();
    const accountBDetail = {
      ...codeReviewDetail,
      files: [{ ...codeReviewDetail.files[0], filename: "src/account-b.ts" }],
    };
    const getPullRequestCodeReview = vi.fn()
      .mockImplementationOnce(() => accountARequest.promise)
      .mockResolvedValueOnce(accountBDetail);
    const accountA: GitHubBindingMetadata = {
      login: "account-a",
      avatarUrl: null,
      boundAt: 1,
      scopes: ["repo"],
      clientIdSource: "bundled",
    };
    const settings = workspaceSettings();
    settings.githubBinding = accountA;
    const store = createWorkspaceStoreFixture({ getPullRequestCodeReview });
    store.stateFeature.applyWorkspaceBootstrap(workspaceBootstrap(settings));

    render(PullRequestCodeReviewWorkspace, {
      props: {
        repoFullName: "acme/widget",
        pull,
        checks: [],
        updating: false,
        mergeMethod: "merge",
        sourceRoute: "/repos/acme-widget?projectTab=pulls&pr=26",
      },
      global: { provide: provideWorkspaceStoreFixture(store) },
    });
    await waitFor(() => expect(getPullRequestCodeReview).toHaveBeenCalledTimes(1));

    store.stateFeature.applyBindingStatus({
      state: "bound",
      clientIdConfigured: true,
      clientIdSource: "bundled",
      binding: { ...accountA, login: "account-b", boundAt: 2 },
    });

    expect(await screen.findByText("src/account-b.ts")).toBeVisible();
    expect(store.sessionContext.revision).toBe(1);

    accountARequest.resolve({
      ...codeReviewDetail,
      files: [{ ...codeReviewDetail.files[0], filename: "src/account-a.ts" }],
    });
    await accountARequest.promise;
    await Promise.resolve();

    expect(screen.queryByText("src/account-a.ts")).toBeNull();
    expect(screen.getByText("src/account-b.ts")).toBeVisible();
  });

  it("hands off real worktree context and opens accepted results through the native command", async () => {
    let resolveOpen!: () => void;
    const openPending = new Promise<void>((resolve) => { resolveOpen = resolve; });
    mocks.openHandoffResult.mockReturnValue(openPending);
    mocks.createHandoff.mockImplementation(async (handoff) => ({
      protocol: handoff.protocol,
      version: handoff.version,
      handoffId: handoff.id,
      status: "accepted",
      resultRoute: "liliacode://tasks/task-26",
      taskId: "task-26",
      updatedAt: "2026-07-17T01:00:00Z",
    }));

    const store = createWorkspaceStoreFixture({
      getPullRequestCodeReview: vi.fn(async () => codeReviewDetail),
      createLiliaCodeTaskHandoff: mocks.createHandoff,
      openLiliaCodeTaskHandoffResult: mocks.openHandoffResult,
    });
    render(PullRequestCodeReviewWorkspace, {
      props: {
        repoFullName: "acme/widget",
        pull,
        checks: [],
        updating: false,
        mergeMethod: "merge",
        worktreePath: "/work/acme-widget",
        currentBranch: "feature/review",
        remoteUrl: "https://github.com/acme/widget.git",
        sourceRoute: "/repos/acme-widget?projectTab=pulls&pr=26",
      },
      global: { provide: provideWorkspaceStoreFixture(store) },
    });

    await screen.findByText("src/review.ts");
    await fireEvent.click(screen.getByRole("button", { name: "创建修复任务" }));
    await waitFor(() => expect(mocks.createHandoff).toHaveBeenCalledTimes(1));
    expect(mocks.createHandoff.mock.calls[0]?.[0]).toMatchObject({
      repository: {
        fullName: "acme/widget",
        worktreePath: "/work/acme-widget",
        branch: "feature/review",
        remoteUrl: "https://github.com/acme/widget.git",
      },
      source: { route: "/repos/acme-widget?projectTab=pulls&pr=26" },
      relatedFiles: ["src/review.ts"],
      pullRequest: { baseSha: "base-sha", headSha: "head-sha" },
    });

    const openButton = await screen.findByRole("button", { name: "查看任务结果" });
    expect(screen.queryByRole("button", { name: "创建修复任务" })).toBeNull();
    await fireEvent.click(openButton);
    await fireEvent.click(openButton);
    expect(mocks.openHandoffResult).toHaveBeenCalledTimes(1);
    expect(mocks.openHandoffResult).toHaveBeenCalledWith(mocks.createHandoff.mock.calls[0]?.[0].id);
    expect(screen.getByRole("button", { name: "正在打开..." })).toBeDisabled();
    resolveOpen();
    await waitFor(() => expect(screen.getByRole("button", { name: "查看任务结果" })).toBeEnabled());
  });

  it("keeps a partially loaded thread usable and exposes the local recovery state", async () => {
    const reply = vi.fn(async () => undefined);
    render(PullRequestReviewThreads, {
      props: {
        busy: false,
        reply,
        threads: [{
          id: "thread-partial",
          isResolved: false,
          isOutdated: false,
          path: "src/review.ts",
          line: 18,
          originalLine: null,
          side: "RIGHT",
          diffHunk: null,
          comments: [],
          commentsTruncated: true,
          commentsUnavailableReason: "部分 thread 回复暂未加载，请刷新后重试。",
        }],
      },
    });

    expect(screen.getByText("部分 thread 回复暂未加载，请刷新后重试。")).toBeVisible();
    await fireEvent.update(screen.getByRole("textbox", { name: "回复 thread" }), "保留局部操作");
    await fireEvent.click(screen.getByRole("button", { name: "回复" }));
    await waitFor(() => expect(reply).toHaveBeenCalledWith("thread-partial", "保留局部操作"));
  });
});
