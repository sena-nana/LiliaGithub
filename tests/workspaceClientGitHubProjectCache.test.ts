import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGitHubRepoCache,
  listGitHubIssues,
  updateGitHubIssue,
} from "../src/services/workspace/client";
import type { GitHubIssue } from "../src/services/workspace/types";
import {
  getFallbackGitHubIssueListCallsForTests,
  resetWorkspaceFallbacksForTests,
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
});
