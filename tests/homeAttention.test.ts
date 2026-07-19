import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listGitHubHomeAttention,
  mergeHomeAttentionResult,
  type HomeAttentionResult,
} from "../src/services/homeAttention";
import {
  isHomeAttentionWorkflowRun,
  listHomeAttentionFallback,
  mergeHomeAttentionPullRequestCandidates,
} from "../src/services/homeAttention/fallback";
import type { GitHubPullRequest, GitHubWorkflowRun } from "../src/services/workspace/types";

const workspace = vi.hoisted(() => ({
  call: vi.fn(),
  listGitHubPullRequests: vi.fn(),
  listGitHubWorkflowRuns: vi.fn(),
}));

vi.mock("../src/services/workspace/client", () => workspace);

beforeEach(() => {
  vi.clearAllMocks();
  workspace.call.mockImplementation((_command, _args, fallback) => fallback());
});

describe("home attention", () => {
  it("normalizes the repository batch and forwards force refresh to the home command", async () => {
    workspace.call.mockResolvedValue(emptyResult());

    await listGitHubHomeAttention([" acme/one ", "ACME/ONE", "acme/two"], { forceRefresh: true });

    expect(workspace.call).toHaveBeenCalledWith(
      "github_list_home_attention",
      { repoFullNames: ["acme/one", "acme/two"], forceRefresh: true },
      expect.any(Function),
    );
  });

  it("deduplicates review and assigned PRs while preserving the stronger review reason", () => {
    const shared = pullRequest(1, "2026-07-18T12:00:00Z");
    const result = mergeHomeAttentionPullRequestCandidates(
      [shared, { ...pullRequest(2, "2026-07-18T13:00:00Z"), draft: true }],
      [shared, pullRequest(3, "2026-07-18T14:00:00Z")],
    );

    expect(result.map(({ pullRequest, reasons }) => ({ number: pullRequest.number, reasons }))).toEqual([
      { number: 3, reasons: ["assigned"] },
      { number: 1, reasons: ["review_requested", "assigned"] },
    ]);
  });

  it("loads review PRs and actionable workflow runs while retaining partial successes", async () => {
    workspace.listGitHubPullRequests.mockImplementation(async (repo, options) => {
      if (repo === "acme/failing") throw new Error("forbidden");
      return options.query ? [pullRequest(7, "2026-07-18T12:00:00Z")] : [pullRequest(7, "2026-07-18T12:00:00Z")];
    });
    workspace.listGitHubWorkflowRuns.mockImplementation(async (repo) => {
      if (repo === "acme/failing") throw new Error("forbidden");
      return [
        workflowRun(91, "completed", "failure", "2026-07-18T12:00:00Z"),
        workflowRun(92, "completed", "success", "2026-07-18T13:00:00Z"),
        workflowRun(93, "queued", null, "2026-05-18T13:00:00Z"),
        workflowRun(94, "in_progress", null, "2026-07-18T14:00:00Z"),
      ];
    });

    const result = await listHomeAttentionFallback(
      ["acme/repo", "acme/failing"],
      { forceRefresh: true, now: new Date("2026-07-19T00:00:00Z") },
    );

    expect(result.pendingPullRequests.items[0]).toMatchObject({
      repoFullName: "acme/repo",
      pullRequest: { number: 7 },
      reasons: ["review_requested", "assigned"],
    });
    expect(result.workflowRuns.items.map(({ run }) => run.id)).toEqual([91, 94, 93]);
    expect(result.pendingPullRequests.failures).toEqual([{ repoFullName: "acme/failing", message: "forbidden" }]);
    expect(workspace.listGitHubPullRequests.mock.calls.every((call) => call[2]?.forceRefresh === true)).toBe(true);
  });

  it("preserves the previous successful rows for repositories that fail during refresh", () => {
    const previous = emptyResult();
    previous.pendingPullRequests.items = [{
      repoFullName: "acme/repo",
      pullRequest: pullRequest(7, "2026-07-18T12:00:00Z"),
      reasons: ["review_requested"],
    }];
    const next = emptyResult();
    next.pendingPullRequests.failures = [{ repoFullName: "acme/repo", message: "rate limited" }];

    expect(mergeHomeAttentionResult(previous, next).pendingPullRequests.items).toHaveLength(1);
  });

  it("accepts active runs and only recent completed actionable failures", () => {
    const now = new Date("2026-07-19T00:00:00Z");
    expect(isHomeAttentionWorkflowRun(workflowRun(1, "completed", "timed_out", "2026-07-18T00:00:00Z"), now)).toBe(true);
    expect(isHomeAttentionWorkflowRun(workflowRun(2, "completed", "success", "2026-07-18T00:00:00Z"), now)).toBe(false);
    expect(isHomeAttentionWorkflowRun(workflowRun(3, "completed", "failure", "2026-06-01T00:00:00Z"), now)).toBe(false);
    expect(isHomeAttentionWorkflowRun(workflowRun(4, "queued", null, "2026-06-01T00:00:00Z"), now)).toBe(true);
    expect(isHomeAttentionWorkflowRun(workflowRun(5, "in_progress", null, "2026-07-18T00:00:00Z"), now)).toBe(true);
    expect(isHomeAttentionWorkflowRun(workflowRun(6, "waiting", null, "2026-07-18T00:00:00Z"), now)).toBe(false);
    expect(isHomeAttentionWorkflowRun(workflowRun(7, "pending", null, "2026-07-18T00:00:00Z"), now)).toBe(false);
    expect(isHomeAttentionWorkflowRun(workflowRun(8, "completed", "cancelled", "2026-07-18T00:00:00Z"), now)).toBe(false);
  });
});

function emptyResult(): HomeAttentionResult {
  const section = () => ({
    items: [],
    failures: [],
    truncated: false,
    requestedRepositoryCount: 0,
    successfulRepositoryCount: 0,
  });
  return { pendingPullRequests: section(), workflowRuns: section() };
}

function pullRequest(number: number, updatedAt: string): GitHubPullRequest {
  return {
    number,
    title: `PR ${number}`,
    state: "open",
    draft: false,
    body: null,
    labels: [],
    assignees: [],
    htmlUrl: `https://github.com/acme/repo/pull/${number}`,
    updatedAt,
    createdAt: updatedAt,
    author: "octocat",
    baseBranch: "main",
    headBranch: `feature-${number}`,
    merged: false,
    mergeable: true,
    mergeableState: "clean",
  };
}

function workflowRun(
  id: number,
  status: string,
  conclusion: string | null,
  updatedAt: string,
): GitHubWorkflowRun {
  return {
    id,
    name: "CI",
    displayTitle: "CI",
    status,
    conclusion,
    branch: "main",
    event: "push",
    htmlUrl: `https://github.com/acme/repo/actions/runs/${id}`,
    createdAt: updatedAt,
    updatedAt,
  };
}
