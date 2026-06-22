import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGitHubRepoCache,
  getRepoFilePreview,
  getGitHubRepoCommitDetail,
  listRepoFiles,
  listGitHubRepoCommits,
  listGitHubIssues,
  listGitHubPullRequests,
  updateGitHubIssue,
  workspaceFallbackForTests,
} from "../src/services/workspace/client";
import type { CommitDetail, CommitSummary, GitHubIssue, GitHubPullRequest } from "../src/services/workspace/types";

const repoFullName = "sena-nana/remote-repo";
type WorkspaceFallbackForTests = Awaited<ReturnType<typeof workspaceFallbackForTests>>;
let workspaceFallback: WorkspaceFallbackForTests;

function issue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 12,
    title: "缓存前 Issue",
    state: "open",
    body: null,
    labels: ["bug"],
    assignees: ["sena"],
    htmlUrl: "https://github.com/sena-nana/remote-repo/issues/12",
    updatedAt: "2026-06-18T08:00:00Z",
    createdAt: "2026-06-18T08:00:00Z",
    ...overrides,
  };
}

function pullRequest(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 52,
    title: "缓存前 PR",
    state: "open",
    draft: false,
    body: null,
    labels: ["bug"],
    assignees: ["sena"],
    milestone: { number: 1, title: "v1" },
    comments: 2,
    projectItems: [{ id: "PVT_roadmap", title: "Roadmap" }],
    htmlUrl: "https://github.com/sena-nana/remote-repo/pull/52",
    updatedAt: "2026-06-18T08:00:00Z",
    createdAt: "2026-06-18T08:00:00Z",
    author: "sena",
    baseBranch: "main",
    headBranch: "feature/cache",
    merged: false,
    mergeable: true,
    mergeableState: "clean",
    ...overrides,
  };
}

function commit(overrides: Partial<CommitSummary> = {}): CommitSummary {
  return {
    hash: "fedcba9876543210",
    shortHash: "fedcba9",
    author: "Sena",
    authorEmail: "sena@example.com",
    timestamp: 1_785_010_000,
    subject: "缓存前提交",
    parents: ["1234567890abcdef"],
    refs: ["main"],
    ...overrides,
  };
}

function commitDetail(commit: CommitSummary, overrides: Partial<CommitDetail> = {}): CommitDetail {
  return {
    ...commit,
    committer: commit.author,
    committerEmail: commit.authorEmail ?? null,
    body: "缓存前详情",
    files: [],
    ...overrides,
  };
}

describe("workspace GitHub project cache", () => {
  beforeEach(async () => {
    workspaceFallback = await workspaceFallbackForTests();
    workspaceFallback.resetWorkspaceFallbacksForTests();
    clearGitHubRepoCache();
  });

  it("默认复用项目页远端缓存，forceRefresh 才重新读取", async () => {
    workspaceFallback.setFallbackGitHubIssuesForTests({ [repoFullName]: [issue()] });

    const first = await listGitHubIssues(repoFullName, "open");
    expect(first[0]?.title).toBe("缓存前 Issue");
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);

    workspaceFallback.setFallbackGitHubIssuesForTests({ [repoFullName]: [issue({ title: "远端新 Issue" })] });
    const cached = await listGitHubIssues(repoFullName, "open");
    expect(cached[0]?.title).toBe("缓存前 Issue");
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);

    const refreshed = await listGitHubIssues(repoFullName, "open", { forceRefresh: true });
    expect(refreshed[0]?.title).toBe("远端新 Issue");
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toHaveLength(2);
  });

  it("同 key GitHub 读取 pending 时只发起一笔请求并返回隔离副本", async () => {
    workspaceFallback.setFallbackGitHubIssuesForTests({ [repoFullName]: [issue()] });

    const firstLoad = listGitHubIssues(repoFullName, "open");
    const secondLoad = listGitHubIssues(repoFullName, "open");

    const [first, second] = await Promise.all([firstLoad, secondLoad]);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first[0].title = "外部污染";
    const cached = await listGitHubIssues(repoFullName, "open");
    expect(cached[0]?.title).toBe("缓存前 Issue");
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);
  });

  it("Issue 缓存按筛选和排序参数分桶", async () => {
    workspaceFallback.setFallbackGitHubIssuesForTests({
      [repoFullName]: [
        issue({
          title: "Bug issue",
          labels: ["bug"],
          author: "sena",
          milestone: { number: 1, title: "v1" },
          projectItems: [{ id: "PVT_roadmap", title: "Roadmap" }],
        }),
        issue({
          number: 22,
          title: "Docs issue",
          labels: ["documentation"],
          author: "mika",
          milestone: { number: 2, title: "v2" },
          projectItems: [{ id: "PVT_docs", title: "Docs" }],
        }),
      ],
    });

    const bugIssues = await listGitHubIssues(repoFullName, {
      state: "open",
      labels: ["bug"],
      creator: "sena",
      milestone: "1",
      project: "PVT_roadmap",
      sort: "comments",
      direction: "desc",
      query: "Bug",
    });
    const docsIssues = await listGitHubIssues(repoFullName, {
      state: "open",
      labels: ["documentation"],
      creator: "mika",
      milestone: "2",
      project: "PVT_docs",
      sort: "updated",
      direction: "asc",
      query: "Docs",
    });
    const cachedBugIssues = await listGitHubIssues(repoFullName, {
      state: "open",
      labels: ["bug"],
      creator: "sena",
      milestone: "1",
      project: "PVT_roadmap",
      sort: "comments",
      direction: "desc",
      query: "Bug",
    });

    expect(bugIssues.map((item) => item.title)).toEqual(["Bug issue"]);
    expect(docsIssues.map((item) => item.title)).toEqual(["Docs issue"]);
    expect(cachedBugIssues.map((item) => item.title)).toEqual(["Bug issue"]);
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toHaveLength(2);
  });

  it("Pull Request 缓存按筛选、Review 和排序参数分桶", async () => {
    workspaceFallback.setFallbackGitHubPullRequestsForTests({
      [repoFullName]: [
        pullRequest({
          title: "Bug PR",
          labels: ["bug"],
          author: "sena",
          assignees: ["sena"],
          milestone: { number: 1, title: "v1" },
          projectItems: [{ id: "PVT_roadmap", title: "Roadmap" }],
          mergeableState: "clean",
        }),
        pullRequest({
          number: 54,
          title: "Docs PR",
          labels: ["documentation"],
          author: "mika",
          assignees: [],
          milestone: { number: 2, title: "v2" },
          projectItems: [{ id: "PVT_docs", title: "Docs" }],
          mergeableState: "blocked",
        }),
      ],
    });

    const bugPulls = await listGitHubPullRequests(repoFullName, {
      state: "open",
      labels: ["bug"],
      creator: "sena",
      assignee: "sena",
      milestone: "1",
      project: "PVT_roadmap",
      review: "approved",
      sort: "comments",
      direction: "desc",
      query: "Bug",
    });
    const docsPulls = await listGitHubPullRequests(repoFullName, {
      state: "open",
      labels: ["documentation"],
      creator: "mika",
      assignee: "none",
      milestone: "2",
      project: "PVT_docs",
      review: "changes_requested",
      sort: "updated",
      direction: "asc",
      query: "Docs",
    });
    const cachedBugPulls = await listGitHubPullRequests(repoFullName, {
      state: "open",
      labels: ["bug"],
      creator: "sena",
      assignee: "sena",
      milestone: "1",
      project: "PVT_roadmap",
      review: "approved",
      sort: "comments",
      direction: "desc",
      query: "Bug",
    });

    expect(bugPulls.map((item) => item.title)).toEqual(["Bug PR"]);
    expect(docsPulls.map((item) => item.title)).toEqual(["Docs PR"]);
    expect(cachedBugPulls.map((item) => item.title)).toEqual(["Bug PR"]);
    expect(workspaceFallback.getFallbackGitHubPullRequestListCallsForTests()).toHaveLength(2);
  });

  it("更新 Issue 后同步已缓存列表", async () => {
    workspaceFallback.setFallbackGitHubIssuesForTests({ [repoFullName]: [issue()] });

    await listGitHubIssues(repoFullName, "open");
    await updateGitHubIssue(repoFullName, 12, { title: "缓存内已更新" });
    const cached = await listGitHubIssues(repoFullName, "open");

    expect(cached[0]?.title).toBe("缓存内已更新");
    expect(workspaceFallback.getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);
  });

  it("缓存远程提交列表，forceRefresh 才重新读取", async () => {
    workspaceFallback.setFallbackGitHubCommitsForTests({ [repoFullName]: [commit()] });

    const first = await listGitHubRepoCommits(repoFullName);
    expect(first[0]?.subject).toBe("缓存前提交");
    expect(workspaceFallback.getFallbackGitHubCommitListCallsForTests()).toHaveLength(1);

    first[0].subject = "外部污染";
    workspaceFallback.setFallbackGitHubCommitsForTests({ [repoFullName]: [commit({ subject: "远端新提交" })] });
    const cached = await listGitHubRepoCommits(repoFullName);
    expect(cached[0]?.subject).toBe("缓存前提交");
    expect(workspaceFallback.getFallbackGitHubCommitListCallsForTests()).toHaveLength(1);

    const refreshed = await listGitHubRepoCommits(repoFullName, {}, { forceRefresh: true });
    expect(refreshed[0]?.subject).toBe("远端新提交");
    expect(workspaceFallback.getFallbackGitHubCommitListCallsForTests()).toHaveLength(2);
  });

  it("缓存远程提交详情并返回克隆数据", async () => {
    const firstCommit = commit();
    workspaceFallback.setFallbackGitHubCommitDetailsForTests({
      [repoFullName]: {
        [firstCommit.hash]: commitDetail(firstCommit),
      },
    });

    const first = await getGitHubRepoCommitDetail(repoFullName, firstCommit.hash);
    expect(first.body).toBe("缓存前详情");
    expect(workspaceFallback.getFallbackGitHubCommitDetailCallsForTests()).toHaveLength(1);

    first.body = "外部污染";
    workspaceFallback.setFallbackGitHubCommitDetailsForTests({
      [repoFullName]: {
        [firstCommit.hash]: commitDetail(firstCommit, { body: "远端新详情" }),
      },
    });
    const cached = await getGitHubRepoCommitDetail(repoFullName, firstCommit.hash);
    expect(cached.body).toBe("缓存前详情");
    expect(workspaceFallback.getFallbackGitHubCommitDetailCallsForTests()).toHaveLength(1);

    const refreshed = await getGitHubRepoCommitDetail(repoFullName, firstCommit.hash, { forceRefresh: true });
    expect(refreshed.body).toBe("远端新详情");
    expect(workspaceFallback.getFallbackGitHubCommitDetailCallsForTests()).toHaveLength(2);
  });

  it("github repoId 文件树和预览按远程仓库与 ref 分派", async () => {
    workspaceFallback.setFallbackGitHubRepoFilesForTests({
      [repoFullName]: {
        "": [{ path: "README.md", name: "README.md", kind: "file", hasChildren: false }],
      },
    });
    workspaceFallback.setFallbackGitHubRepoFilePreviewsForTests({
      [repoFullName]: {
        "README.md": {
          path: "README.md",
          name: "README.md",
          previewKind: "markdown",
          content: "# Remote\n",
          dataUrl: null,
          images: {},
          size: 9,
          mimeType: "text/markdown",
          truncated: false,
        },
      },
    });

    const entries = await listRepoFiles(`github:${repoFullName}`, null, "feature/tree");
    const preview = await getRepoFilePreview(`github:${repoFullName}`, "README.md", "feature/tree");

    expect(entries).toEqual([{ path: "README.md", name: "README.md", kind: "file", hasChildren: false }]);
    expect(preview.content).toBe("# Remote\n");
    expect(workspaceFallback.getFallbackGitHubRepoFileListCallsForTests()).toEqual([
      { repoFullName, parentPath: null, refName: "feature/tree" },
    ]);
    expect(workspaceFallback.getFallbackGitHubRepoFilePreviewCallsForTests()).toEqual([
      { repoFullName, path: "README.md", refName: "feature/tree" },
    ]);
  });
});
