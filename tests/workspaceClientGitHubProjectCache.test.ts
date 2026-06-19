import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGitHubRepoCache,
  getGitHubRepoCommitDetail,
  listGitHubRepoCommits,
  listGitHubIssues,
  updateGitHubIssue,
} from "../src/services/workspace/client";
import type { CommitDetail, CommitSummary, GitHubIssue } from "../src/services/workspace/types";
import {
  getFallbackGitHubCommitDetailCallsForTests,
  getFallbackGitHubCommitListCallsForTests,
  getFallbackGitHubIssueListCallsForTests,
  resetWorkspaceFallbacksForTests,
  setFallbackGitHubCommitDetailsForTests,
  setFallbackGitHubCommitsForTests,
  setFallbackGitHubIssuesForTests,
} from "../src/services/workspace/fallback";

const repoFullName = "sena-nana/remote-repo";

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
  beforeEach(() => {
    resetWorkspaceFallbacksForTests();
    clearGitHubRepoCache();
  });

  it("默认复用项目页远端缓存，forceRefresh 才重新读取", async () => {
    setFallbackGitHubIssuesForTests({ [repoFullName]: [issue()] });

    const first = await listGitHubIssues(repoFullName, "open");
    expect(first[0]?.title).toBe("缓存前 Issue");
    expect(getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);

    setFallbackGitHubIssuesForTests({ [repoFullName]: [issue({ title: "远端新 Issue" })] });
    const cached = await listGitHubIssues(repoFullName, "open");
    expect(cached[0]?.title).toBe("缓存前 Issue");
    expect(getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);

    const refreshed = await listGitHubIssues(repoFullName, "open", { forceRefresh: true });
    expect(refreshed[0]?.title).toBe("远端新 Issue");
    expect(getFallbackGitHubIssueListCallsForTests()).toHaveLength(2);
  });

  it("更新 Issue 后同步已缓存列表", async () => {
    setFallbackGitHubIssuesForTests({ [repoFullName]: [issue()] });

    await listGitHubIssues(repoFullName, "open");
    await updateGitHubIssue(repoFullName, 12, { title: "缓存内已更新" });
    const cached = await listGitHubIssues(repoFullName, "open");

    expect(cached[0]?.title).toBe("缓存内已更新");
    expect(getFallbackGitHubIssueListCallsForTests()).toHaveLength(1);
  });

  it("缓存远程提交列表，forceRefresh 才重新读取", async () => {
    setFallbackGitHubCommitsForTests({ [repoFullName]: [commit()] });

    const first = await listGitHubRepoCommits(repoFullName);
    expect(first[0]?.subject).toBe("缓存前提交");
    expect(getFallbackGitHubCommitListCallsForTests()).toHaveLength(1);

    first[0].subject = "外部污染";
    setFallbackGitHubCommitsForTests({ [repoFullName]: [commit({ subject: "远端新提交" })] });
    const cached = await listGitHubRepoCommits(repoFullName);
    expect(cached[0]?.subject).toBe("缓存前提交");
    expect(getFallbackGitHubCommitListCallsForTests()).toHaveLength(1);

    const refreshed = await listGitHubRepoCommits(repoFullName, {}, { forceRefresh: true });
    expect(refreshed[0]?.subject).toBe("远端新提交");
    expect(getFallbackGitHubCommitListCallsForTests()).toHaveLength(2);
  });

  it("缓存远程提交详情并返回克隆数据", async () => {
    const firstCommit = commit();
    setFallbackGitHubCommitDetailsForTests({
      [repoFullName]: {
        [firstCommit.hash]: commitDetail(firstCommit),
      },
    });

    const first = await getGitHubRepoCommitDetail(repoFullName, firstCommit.hash);
    expect(first.body).toBe("缓存前详情");
    expect(getFallbackGitHubCommitDetailCallsForTests()).toHaveLength(1);

    first.body = "外部污染";
    setFallbackGitHubCommitDetailsForTests({
      [repoFullName]: {
        [firstCommit.hash]: commitDetail(firstCommit, { body: "远端新详情" }),
      },
    });
    const cached = await getGitHubRepoCommitDetail(repoFullName, firstCommit.hash);
    expect(cached.body).toBe("缓存前详情");
    expect(getFallbackGitHubCommitDetailCallsForTests()).toHaveLength(1);

    const refreshed = await getGitHubRepoCommitDetail(repoFullName, firstCommit.hash, { forceRefresh: true });
    expect(refreshed.body).toBe("远端新详情");
    expect(getFallbackGitHubCommitDetailCallsForTests()).toHaveLength(2);
  });
});
