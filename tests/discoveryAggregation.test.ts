import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDiscoveryAssignedIssues,
  loadDiscoveryFailedWorkflowRuns,
  loadDiscoveryPendingPullRequests,
  loadDiscoveryRecentReleases,
  loadDiscoveryRepositoryStatuses,
} from "../src/services/discovery";
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubRelease,
  GitHubWorkflowRun,
} from "../src/services/workspace/types";

const workspace = vi.hoisted(() => ({
  getGitHubPullRequest: vi.fn(),
  getGitHubDiscoveryRepositoryStatus: vi.fn(),
  listGitHubIssues: vi.fn(),
  listGitHubPullRequests: vi.fn(),
  listGitHubReleases: vi.fn(),
  listGitHubWorkflowRuns: vi.fn(),
}));

vi.mock("../src/services/workspace/client", () => workspace);
vi.mock("../src/services/discovery/client", () => ({
  getGitHubDiscoveryRepositoryStatus: workspace.getGitHubDiscoveryRepositoryStatus,
}));

beforeEach(() => vi.clearAllMocks());

describe("discovery aggregation", () => {
  it("deduplicates PR sources, fetches complete details, preserves reasons, and forwards force refresh", async () => {
    workspace.listGitHubPullRequests.mockImplementation(async (_repo, options) => (
      options.query ? [pullRequest(2, "2026-07-15T00:00:00Z"), pullRequest(1, "2026-07-16T00:00:00Z")]
        : [pullRequest(2, "2026-07-15T00:00:00Z")]
    ));
    workspace.getGitHubPullRequest.mockImplementation(async (_repo, number) => (
      pullRequest(number, number === 2 ? "2026-07-17T00:00:00Z" : "2026-07-16T00:00:00Z")
    ));

    const result = await loadDiscoveryPendingPullRequests(["acme/repo"], { forceRefresh: true });

    expect(result.items.map((item) => ({ number: item.pullRequest.number, reasons: item.reasons }))).toEqual([
      { number: 2, reasons: ["review_requested", "assigned"] },
      { number: 1, reasons: ["review_requested"] },
    ]);
    expect(workspace.getGitHubPullRequest).toHaveBeenCalledTimes(2);
    expect(workspace.listGitHubPullRequests.mock.calls.every((call) => call[2]?.forceRefresh === true)).toBe(true);
    expect(result).toMatchObject({ failures: [], truncated: false, successfulRepositoryCount: 1 });
  });

  it("keeps successful repositories, reports failures, and marks source truncation", async () => {
    workspace.listGitHubIssues.mockImplementation(async (repoFullName) => {
      if (repoFullName === "acme/failing") throw new Error("forbidden");
      if (repoFullName === "acme/full") return Array.from({ length: 100 }, (_, index) => issue(index + 1));
      return [issue(1)];
    });
    const repositories = ["acme/full", "acme/failing", ...Array.from({ length: 7 }, (_, index) => `acme/repo-${index}`)];

    const result = await loadDiscoveryAssignedIssues(repositories, { forceRefresh: true });

    expect(result.truncated).toBe(true);
    expect(result.failures).toEqual([{ repoFullName: "acme/failing", message: "forbidden" }]);
    expect(result).toMatchObject({ requestedRepositoryCount: 9, successfulRepositoryCount: 8 });
    expect(result.items).toHaveLength(107);
  });

  it("filters and globally sorts workflow failures and releases using the supplied clock", async () => {
    const now = new Date("2026-07-17T12:00:00Z");
    workspace.listGitHubWorkflowRuns.mockImplementation(async (repo) => repo.endsWith("one")
      ? [workflowRun(1, "failure", "2026-07-15T00:00:00Z"), workflowRun(2, "success", "2026-07-17T00:00:00Z")]
      : [workflowRun(3, "timed_out", "2026-07-16T00:00:00Z"), workflowRun(4, "failure", "2026-06-01T00:00:00Z")]);
    workspace.listGitHubReleases.mockImplementation(async (repo) => repo.endsWith("one")
      ? [release(1, "2026-07-14T00:00:00Z"), { ...release(2, "2026-07-17T00:00:00Z"), draft: true }]
      : [{ ...release(3, "2026-07-16T00:00:00Z"), prerelease: true }, release(4, null)]);

    const workflows = await loadDiscoveryFailedWorkflowRuns(["acme/one", "acme/two"], { now, forceRefresh: true });
    const releases = await loadDiscoveryRecentReleases(["acme/one", "acme/two"], { now, forceRefresh: true });

    expect(workflows.items.map((item) => item.run.id)).toEqual([3, 1]);
    expect(releases.items.map((item) => item.release.id)).toEqual([3, 1]);
    expect(workspace.listGitHubWorkflowRuns).toHaveBeenCalledWith("acme/one", 100, { forceRefresh: true });
    expect(workspace.listGitHubReleases).toHaveBeenCalledWith("acme/two", { forceRefresh: true });
  });

});

function pullRequest(number: number, updatedAt: string): GitHubPullRequest {
  return {
    number, title: `PR ${number}`, state: "open", draft: false, body: null, labels: [], assignees: [],
    htmlUrl: `https://github.com/acme/repo/pull/${number}`, updatedAt, createdAt: updatedAt, author: "octocat",
    baseBranch: "main", headBranch: `feature-${number}`, merged: false, mergeable: true, mergeableState: "clean",
  };
}

function issue(number: number): GitHubIssue {
  return {
    number, title: `Issue ${number}`, state: "open", body: null, labels: [], assignees: ["octocat"],
    htmlUrl: `https://github.com/acme/repo/issues/${number}`, updatedAt: "2026-07-17T00:00:00Z",
    createdAt: "2026-07-17T00:00:00Z",
  };
}

function workflowRun(id: number, conclusion: string, updatedAt: string): GitHubWorkflowRun {
  return {
    id, name: "CI", displayTitle: "CI", status: "completed", conclusion, branch: "main", event: "push",
    htmlUrl: `https://github.com/acme/repo/actions/runs/${id}`, createdAt: updatedAt, updatedAt,
  };
}

function release(id: number, publishedAt: string | null): GitHubRelease {
  return {
    id, tagName: `v${id}`, targetCommitish: "main", name: null, body: null, draft: false, prerelease: false,
    immutable: false, makeLatest: null, htmlUrl: `https://github.com/acme/repo/releases/tag/v${id}`, uploadUrl: "",
    tarballUrl: null, zipballUrl: null, createdAt: publishedAt ?? "2026-07-16T00:00:00Z", publishedAt,
    author: "octocat", assets: [],
  };
}
