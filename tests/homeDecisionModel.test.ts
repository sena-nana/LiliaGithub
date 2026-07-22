import { describe, expect, it } from "vitest";
import { buildHomeContinueItems } from "../src/utils/homeContinueItems";
import { buildProjectMomentum } from "../src/utils/projectMomentum";
import type { RepoSummary } from "../src/services/workspace";

function repo(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: "repo-1",
    name: "LiliaGithub",
    path: "/tmp/LiliaGithub",
    relativePath: "LiliaGithub",
    currentBranch: "main",
    remoteUrl: "https://github.com/sena-nana/LiliaGithub.git",
    githubFullName: "sena-nana/LiliaGithub",
    ahead: 0,
    behind: 0,
    remoteBranchStates: [],
    remotesNeedingPull: 0,
    remotesNeedingPush: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: 1_782_390_000,
    lastCommitMessage: "最近提交",
    languageStats: [],
    languageStatsUpdatedAt: 0,
    worktree: { role: "main", groupId: null },
    ...overrides,
  };
}

describe("homeContinueItems", () => {
  it("prefers recoverable recent context and then recent local visits", () => {
    const items = buildHomeContinueItems({
      recentContext: { version: 1, route: "/repos/repo-1/changes" },
      recentLocalRepos: [
        { repoId: "repo-1", openedAt: 200 },
        { repoId: "repo-2", openedAt: 300 },
      ],
      repos: [
        repo(),
        repo({ id: "repo-2", name: "Other", githubFullName: "sena-nana/Other", path: "/tmp/Other" }),
      ],
      currentRoute: "/overview",
    });

    expect(items.map((item) => item.id)).toEqual(["context:/repos/repo-1/changes", "recent:repo-2"]);
  });
});

describe("projectMomentum", () => {
  it("marks conflicts as blocked and dirty work as attention", () => {
    expect(buildProjectMomentum({
      githubRepo: { fullName: "sena-nana/LiliaGithub", updatedAt: "2026-07-01T00:00:00Z", archived: false },
      localRepo: repo({ conflictCount: 2 }),
      syncIssue: null,
    }).state).toBe("blocked");

    expect(buildProjectMomentum({
      githubRepo: { fullName: "sena-nana/LiliaGithub", updatedAt: "2026-07-01T00:00:00Z", archived: false },
      localRepo: repo({ unstagedCount: 3 }),
      syncIssue: null,
    })).toMatchObject({
      state: "attention",
      reason: "3 项本地改动尚未提交",
    });
  });
});
