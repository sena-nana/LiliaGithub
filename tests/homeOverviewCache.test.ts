import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHomeGitHubOverviewSnapshot,
  homeGitHubOverviewSnapshotNeedsRefresh,
  readHomeGitHubOverviewSnapshot,
  writeHomeGitHubOverviewSnapshot,
  type HomeGitHubOverviewSnapshot,
} from "../src/pages/homeOverviewCache";

function snapshot(overrides: Partial<HomeGitHubOverviewSnapshot> = {}): HomeGitHubOverviewSnapshot {
  return {
    schemaVersion: 1,
    accountLogin: "sena-nana",
    cachedAt: Date.now(),
    repos: [{
      id: 1,
      name: "LiliaGithub",
      fullName: "sena-nana/LiliaGithub",
      ownerLogin: "sena-nana",
      private: false,
      disabled: false,
      archived: false,
      description: null,
      defaultBranch: "main",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:00:00Z",
      cloneUrl: "https://github.com/sena-nana/LiliaGithub.git",
      htmlUrl: "https://github.com/sena-nana/LiliaGithub",
    }],
    nextPage: null,
    issuesByRepo: {},
    pullRequestsByRepo: {},
    pullRequestChecksByRepo: {},
    workflowRunsByRepo: {},
    ...overrides,
  };
}

describe("home overview cache", () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearHomeGitHubOverviewSnapshot();
    localStorage.clear();
  });

  it("persists and restores the GitHub overview snapshot", () => {
    writeHomeGitHubOverviewSnapshot(snapshot());

    const restored = readHomeGitHubOverviewSnapshot();

    expect(restored?.repos[0]?.fullName).toBe("sena-nana/LiliaGithub");
    expect(restored?.accountLogin).toBe("sena-nana");
  });

  it("marks snapshots older than five minutes for background refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T00:10:00Z"));
    writeHomeGitHubOverviewSnapshot(snapshot({
      cachedAt: new Date("2026-06-21T00:04:00Z").getTime(),
    }));

    const restored = readHomeGitHubOverviewSnapshot();

    expect(restored).not.toBeNull();
    expect(homeGitHubOverviewSnapshotNeedsRefresh(restored!)).toBe(true);
  });
});
