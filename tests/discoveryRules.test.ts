import { describe, expect, it } from "vitest";
import {
  isAssignedOpenIssue,
  isRecentActionableWorkflowRun,
  isRecentPublishedRelease,
  mergePendingPullRequestCandidates,
} from "../src/services/discovery/rules";
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubRelease,
  GitHubWorkflowRun,
} from "../src/services/workspace/types";

const NOW = new Date("2026-07-17T12:00:00Z");

describe("discovery domain rules", () => {
  it("merges pending pull request sources, records both reasons, and excludes drafts and closed items", () => {
    const shared = pullRequest(1, "2026-07-16T12:00:00Z");
    const result = mergePendingPullRequestCandidates(
      [shared, { ...pullRequest(2, "2026-07-17T10:00:00Z"), draft: true }],
      [shared, { ...pullRequest(3, "2026-07-17T11:00:00Z"), state: "closed" }, pullRequest(4, "2026-07-17T09:00:00Z")],
    );

    expect(result.map(({ pullRequest, reasons }) => ({ number: pullRequest.number, reasons }))).toEqual([
      { number: 4, reasons: ["assigned"] },
      { number: 1, reasons: ["review_requested", "assigned"] },
    ]);
  });

  it("keeps only open issues and defensively rejects pull request URLs", () => {
    expect(isAssignedOpenIssue(issue(1, "open", "https://github.com/acme/repo/issues/1"))).toBe(true);
    expect(isAssignedOpenIssue(issue(2, "closed", "https://github.com/acme/repo/issues/2"))).toBe(false);
    expect(isAssignedOpenIssue(issue(3, "open", "https://github.com/acme/repo/pull/3"))).toBe(false);
  });

  it.each(["failure", "timed_out", "action_required", "startup_failure"])(
    "accepts recent %s workflow conclusions",
    (conclusion) => {
      expect(isRecentActionableWorkflowRun(workflowRun(conclusion, "2026-06-17T12:00:00Z"), NOW)).toBe(true);
    },
  );

  it("rejects successful, expired, future, and invalid workflow timestamps", () => {
    expect(isRecentActionableWorkflowRun(workflowRun("success", "2026-07-17T10:00:00Z"), NOW)).toBe(false);
    expect(isRecentActionableWorkflowRun(workflowRun("failure", "2026-06-17T11:59:59Z"), NOW)).toBe(false);
    expect(isRecentActionableWorkflowRun(workflowRun("failure", "2026-07-17T12:00:01Z"), NOW)).toBe(false);
    expect(isRecentActionableWorkflowRun(workflowRun("failure", "not-a-date"), NOW)).toBe(false);
  });

  it("includes stable and prerelease publications within 30 days but excludes drafts and unpublished releases", () => {
    expect(isRecentPublishedRelease(release(1, "2026-07-16T12:00:00Z"), NOW)).toBe(true);
    expect(isRecentPublishedRelease({ ...release(2, "2026-07-16T12:00:00Z"), prerelease: true }, NOW)).toBe(true);
    expect(isRecentPublishedRelease({ ...release(3, "2026-07-16T12:00:00Z"), draft: true }, NOW)).toBe(false);
    expect(isRecentPublishedRelease(release(4, null), NOW)).toBe(false);
    expect(isRecentPublishedRelease(release(5, "2026-06-17T11:59:59Z"), NOW)).toBe(false);
  });
});

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

function issue(number: number, state: string, htmlUrl: string): GitHubIssue {
  return {
    number,
    title: `Issue ${number}`,
    state,
    body: null,
    labels: [],
    assignees: ["octocat"],
    htmlUrl,
    updatedAt: "2026-07-17T10:00:00Z",
    createdAt: "2026-07-17T10:00:00Z",
  };
}

function workflowRun(conclusion: string, updatedAt: string): GitHubWorkflowRun {
  return {
    id: 1,
    name: "CI",
    displayTitle: "CI",
    status: "completed",
    conclusion,
    branch: "main",
    event: "push",
    htmlUrl: "https://github.com/acme/repo/actions/runs/1",
    createdAt: updatedAt,
    updatedAt,
  };
}

function release(id: number, publishedAt: string | null): GitHubRelease {
  return {
    id,
    tagName: `v${id}`,
    targetCommitish: "main",
    name: null,
    body: null,
    draft: false,
    prerelease: false,
    immutable: false,
    makeLatest: null,
    htmlUrl: `https://github.com/acme/repo/releases/tag/v${id}`,
    uploadUrl: "",
    tarballUrl: null,
    zipballUrl: null,
    createdAt: publishedAt ?? "2026-07-16T12:00:00Z",
    publishedAt,
    author: "octocat",
    assets: [],
  };
}
