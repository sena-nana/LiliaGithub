import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGitHubDiscoveryRepositoryStatus,
  submitGitHubDiscoveryPullRequestReview,
} from "../src/services/discovery/client";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  runtime: vi.fn(() => "tauri"),
  listRepos: vi.fn(),
  getManagement: vi.fn(),
}));

vi.mock("../src/tauri/runtime", () => ({ invoke: mocks.invoke }));
vi.mock("../src/services/workspace/client", () => ({
  resolveWorkspaceRuntimeForTests: mocks.runtime,
  listGitHubRepos: mocks.listRepos,
  getGitHubRepoManagement: mocks.getManagement,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockReturnValue("tauri");
});

describe("discovery command client", () => {
  it("forwards repository status refresh options to the discovery command", async () => {
    const status = {
      fullName: "acme/repo",
      updatedAt: "2026-07-17T00:00:00Z",
      private: false,
      archived: false,
      disabled: false,
      htmlUrl: "https://github.com/acme/repo",
      permissions: { pull: true, push: true, admin: false },
      allowMergeCommit: true,
      allowSquashMerge: true,
      allowRebaseMerge: false,
    };
    mocks.invoke.mockResolvedValue(status);

    await expect(getGitHubDiscoveryRepositoryStatus(" acme/repo ", { forceRefresh: true })).resolves.toEqual(status);
    expect(mocks.invoke).toHaveBeenCalledWith("github_discovery_get_repository_status", {
      repoFullName: "acme/repo",
      forceRefresh: true,
    });
  });

  it("submits normalized reviews and rejects review types that require an empty body", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await submitGitHubDiscoveryPullRequestReview("acme/repo", 7, {
      event: "request_changes",
      body: "  Please add coverage.  ",
    });

    expect(mocks.invoke).toHaveBeenCalledWith("github_discovery_submit_pull_request_review", {
      repoFullName: "acme/repo",
      pullNumber: 7,
      request: { event: "request_changes", body: "Please add coverage." },
    });
    await expect(submitGitHubDiscoveryPullRequestReview("acme/repo", 7, {
      event: "comment",
      body: "  ",
    })).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("uses repository data in mock mode and does not pretend review writes succeeded", async () => {
    mocks.runtime.mockReturnValue("mock");
    mocks.listRepos.mockResolvedValue({
      items: [{
        fullName: "acme/repo",
        updatedAt: "2026-07-16T00:00:00Z",
        private: true,
        archived: false,
        disabled: false,
        htmlUrl: "https://github.com/acme/repo",
        permissions: { pull: true, push: true, admin: false },
      }],
      nextPage: null,
    });
    mocks.getManagement.mockResolvedValue({
      allowMergeCommit: false,
      allowSquashMerge: true,
      allowRebaseMerge: false,
    });

    await expect(getGitHubDiscoveryRepositoryStatus("acme/repo")).resolves.toMatchObject({
      private: true,
      allowMergeCommit: false,
      allowSquashMerge: true,
    });
    await expect(submitGitHubDiscoveryPullRequestReview("acme/repo", 7, {
      event: "approve",
    })).rejects.toThrow("桌面应用");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
