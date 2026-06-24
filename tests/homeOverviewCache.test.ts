import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHomeGitHubOverviewSnapshot,
  homeGitHubOverviewSnapshotNeedsRefresh,
  readHomeGitHubOverviewSnapshot,
  writeHomeGitHubOverviewSnapshot,
  type HomeGitHubOverviewSnapshot,
} from "../src/pages/homeOverviewCache";

const STORAGE_KEY = "lilia-github.home.overviewSnapshot.v1";

function snapshot(overrides: Partial<HomeGitHubOverviewSnapshot> = {}): HomeGitHubOverviewSnapshot {
  return {
    schemaVersion: 2,
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
    releasesByRepo: {
      "sena-nana/LiliaGithub": [{
        id: 8001,
        tagName: "v1.2.0",
        targetCommitish: "main",
        name: "桌面端 v1.2.0",
        body: null,
        draft: false,
        prerelease: false,
        immutable: false,
        makeLatest: null,
        htmlUrl: "https://github.com/sena-nana/LiliaGithub/releases/tag/v1.2.0",
        uploadUrl: "https://uploads.github.com/repos/sena-nana/LiliaGithub/releases/8001/assets{?name,label}",
        tarballUrl: null,
        zipballUrl: null,
        createdAt: "2026-06-18T08:00:00Z",
        publishedAt: "2026-06-18T08:00:00Z",
        author: "lilia-user",
        assets: [{
          id: 9001,
          name: "LiliaGithub_1.2.0_x64-setup.exe",
          label: null,
          contentType: "application/octet-stream",
          size: 42_000_000,
          downloadCount: 8,
          state: "uploaded",
          browserDownloadUrl: "https://github.com/sena-nana/LiliaGithub/releases/download/v1.2.0/LiliaGithub_1.2.0_x64-setup.exe",
          createdAt: "2026-06-18T08:05:00Z",
          updatedAt: "2026-06-18T08:05:00Z",
          uploader: "lilia-user",
        }],
      }],
    },
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
    expect(restored?.releasesByRepo["sena-nana/LiliaGithub"]?.[0]?.tagName).toBe("v1.2.0");
    expect(restored?.releasesByRepo["sena-nana/LiliaGithub"]?.[0]?.assets[0]?.name).toBe("LiliaGithub_1.2.0_x64-setup.exe");
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

  it("rejects old schema snapshots without release data", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      accountLogin: "sena-nana",
      cachedAt: Date.now(),
      repos: [],
      nextPage: null,
      issuesByRepo: {},
      pullRequestsByRepo: {},
      pullRequestChecksByRepo: {},
      workflowRunsByRepo: {},
    }));

    expect(readHomeGitHubOverviewSnapshot()).toBeNull();
  });
});
