import { beforeEach, describe, expect, it } from "vitest";
import {
  attachGitHubWorkflowArtifactAsset,
  clearGitHubRepoCache,
  createGitHubRelease,
  deleteGitHubRelease,
  deleteGitHubReleaseAsset,
  getRepoFilePreview,
  getGitHubRepoCommitDetail,
  listRepoFiles,
  listGitHubRepoCommits,
  listGitHubIssues,
  listGitHubPullRequests,
  listGitHubReleases,
  updateGitHubIssue,
  updateGitHubRelease,
  uploadGitHubReleaseAsset,
  workspaceFallbackForTests,
} from "../src/services/workspace/client";
import type {
  CommitDetail,
  CommitSummary,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubWorkflowRunDetail,
} from "../src/services/workspace/types";

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

function releaseAsset(overrides: Partial<GitHubReleaseAsset> = {}): GitHubReleaseAsset {
  return {
    id: 9001,
    name: "lilia-windows.zip",
    label: null,
    contentType: "application/zip",
    size: 2048,
    downloadCount: 3,
    state: "uploaded",
    browserDownloadUrl: "https://github.com/sena-nana/remote-repo/releases/download/v1.0.0/lilia-windows.zip",
    createdAt: "2026-06-18T08:10:00Z",
    updatedAt: "2026-06-18T08:10:00Z",
    ...overrides,
  };
}

function release(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    id: 8001,
    tagName: "v1.0.0",
    targetCommitish: "main",
    name: "缓存前 Release",
    body: "缓存前说明",
    draft: false,
    prerelease: false,
    makeLatest: "true",
    author: "sena",
    htmlUrl: "https://github.com/sena-nana/remote-repo/releases/tag/v1.0.0",
    uploadUrl: "https://uploads.github.com/repos/sena-nana/remote-repo/releases/8001/assets{?name,label}",
    tarballUrl: null,
    zipballUrl: null,
    createdAt: "2026-06-18T08:00:00Z",
    publishedAt: "2026-06-18T08:05:00Z",
    assets: [releaseAsset()],
    ...overrides,
  };
}

function workflowRunDetail(): GitHubWorkflowRunDetail {
  return {
    run: {
      id: 1310,
      name: "Release",
      displayTitle: "v1.1.0",
      status: "completed",
      conclusion: "success",
      branch: "v1.1.0",
      event: "release",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310",
      createdAt: "2026-06-18T08:00:00Z",
      updatedAt: "2026-06-18T08:00:00Z",
      headSha: "abc123",
      workflowId: 99,
    },
    jobs: [],
    artifacts: [{
      id: 131001,
      name: "windows-installer",
      sizeInBytes: 4096,
      expired: false,
      createdAt: "2026-06-18T08:02:00Z",
      expiresAt: "2026-07-18T08:02:00Z",
    }],
    workflow: null,
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

  it("缓存 releases，forceRefresh 才重新读取，并返回隔离副本", async () => {
    workspaceFallback.setFallbackGitHubReleasesForTests({ [repoFullName]: [release()] });

    const first = await listGitHubReleases(repoFullName);
    expect(first[0]?.name).toBe("缓存前 Release");
    expect(workspaceFallback.getFallbackGitHubReleaseListCallsForTests()).toHaveLength(1);

    first[0].name = "外部污染";
    workspaceFallback.setFallbackGitHubReleasesForTests({ [repoFullName]: [release({ name: "远端新 Release" })] });
    const cached = await listGitHubReleases(repoFullName);
    expect(cached[0]?.name).toBe("缓存前 Release");
    expect(workspaceFallback.getFallbackGitHubReleaseListCallsForTests()).toHaveLength(1);

    const refreshed = await listGitHubReleases(repoFullName, { forceRefresh: true });
    expect(refreshed[0]?.name).toBe("远端新 Release");
    expect(workspaceFallback.getFallbackGitHubReleaseListCallsForTests()).toHaveLength(2);
  });

  it("Release mutation 后同步或清理项目页 releases 缓存", async () => {
    workspaceFallback.setFallbackGitHubReleasesForTests({ [repoFullName]: [release()] });
    await listGitHubReleases(repoFullName);

    await createGitHubRelease(repoFullName, {
      tagName: "v1.1.0",
      targetCommitish: "main",
      name: "新 Release",
      body: "新说明",
      draft: false,
      prerelease: false,
      generateReleaseNotes: false,
    });
    const afterCreate = await listGitHubReleases(repoFullName);
    expect(afterCreate.map((item) => item.tagName)).toEqual(["v1.1.0", "v1.0.0"]);
    expect(workspaceFallback.getFallbackGitHubReleaseListCallsForTests()).toHaveLength(1);

    await updateGitHubRelease(repoFullName, 8001, { name: "缓存内已编辑" });
    const afterUpdate = await listGitHubReleases(repoFullName);
    expect(afterUpdate.find((item) => item.id === 8001)?.name).toBe("缓存内已编辑");

    const asset = await uploadGitHubReleaseAsset(repoFullName, 8001, "C:\\Files\\release\\setup.exe");
    const afterUpload = await listGitHubReleases(repoFullName);
    expect(afterUpload.find((item) => item.id === 8001)?.assets[0]?.id).toBe(asset.id);

    await deleteGitHubReleaseAsset(repoFullName, 8001, asset.id);
    const afterDeleteAsset = await listGitHubReleases(repoFullName);
    expect(afterDeleteAsset.find((item) => item.id === 8001)?.assets.some((item) => item.id === asset.id)).toBe(false);

    await deleteGitHubRelease(repoFullName, 8001);
    const afterDeleteRelease = await listGitHubReleases(repoFullName);
    expect(afterDeleteRelease.some((item) => item.id === 8001)).toBe(false);
  });

  it("从 Actions artifact 附加 release asset 后同步 releases 缓存", async () => {
    const draftRelease = release({
      id: 8101,
      tagName: "v1.1.0",
      name: "Draft v1.1.0",
      draft: true,
      publishedAt: null,
      assets: [],
    });
    workspaceFallback.setFallbackGitHubReleasesForTests({ [repoFullName]: [draftRelease] });
    workspaceFallback.setFallbackGitHubWorkflowRunDetailsForTests({
      [repoFullName]: {
        1310: workflowRunDetail(),
      },
    });
    workspaceFallback.setFallbackGitHubWorkflowArtifactEntriesForTests({
      [repoFullName]: {
        131001: [
          { path: "packages/Lilia_1.1.0_x64.msi", name: "Lilia_1.1.0_x64.msi", kind: "file", size: 4096 },
        ],
      },
    });

    await listGitHubReleases(repoFullName);
    const asset = await attachGitHubWorkflowArtifactAsset(repoFullName, {
      runId: 1310,
      artifactId: 131001,
      artifactName: "windows-installer",
      artifactPath: "packages/Lilia_1.1.0_x64.msi",
      releaseId: 8101,
      expectedTagName: "v1.1.0",
      label: "Windows",
    });
    const cached = await listGitHubReleases(repoFullName);

    expect(asset.name).toBe("Lilia_1.1.0_x64.msi");
    expect(asset.label).toBe("Windows");
    expect(cached.find((item) => item.id === 8101)?.assets[0]).toMatchObject({
      id: asset.id,
      name: "Lilia_1.1.0_x64.msi",
      label: "Windows",
    });
    expect(workspaceFallback.getFallbackGitHubReleaseListCallsForTests()).toHaveLength(1);
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
