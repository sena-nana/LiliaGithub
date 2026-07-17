import { describe, expect, it } from "vitest";
import {
  applyWorkItemDispositions,
  buildProjectMomentum,
  buildWorkItems,
  readWorkItemDispositions,
  writeWorkItemDisposition,
  type KeyValueStorage,
} from "../src/services/controlCenter";
import type { DiscoveryRepositoryInput, DiscoveryScanResult } from "../src/services/discovery/types";
import type { GitHubIssue, GitHubPullRequest, GitHubWorkflowRun } from "../src/services/workspace/types";
import { repoSummary } from "./fixtures/workspace";

const NOW = Date.parse("2026-07-17T12:00:00Z");

describe("control center work items", () => {
  it("deduplicates the same PR across sources and collapses dirty/conflict signals into one root cause", () => {
    const local = repoSummary("repo", {
      githubFullName: "acme/repo",
      conflictCount: 2,
      stagedCount: 1,
      behind: 1,
      lastCommitAt: NOW - 10_000,
    });
    const scan = emptyScan();
    scan.pendingPullRequests.items = [{
      repoFullName: "acme/repo",
      pullRequest: pullRequest(7, "2026-07-17T11:00:00Z"),
      reasons: ["review_requested", "assigned"],
    }];

    const items = buildWorkItems({
      repositories: [repository(local)],
      localRepositories: [local],
      scan,
      accountItems: [{ repoFullName: "acme/repo", issue: issue(7), pullRequest: true }],
      now: NOW,
    });

    expect(items.filter((item) => item.id.endsWith(":pr:7"))).toHaveLength(1);
    expect(items.find((item) => item.id.endsWith(":pr:7"))).toMatchObject({
      kind: "review",
      bucket: "attention",
      prioritySource: "等待你的 Review",
    });
    expect(items.filter((item) => item.id === "local:repo:worktree")).toEqual([
      expect.objectContaining({ kind: "sync_conflict", priority: "critical" }),
    ]);
  });

  it("keeps deterministic ordering and reactivates a completed item when GitHub reports newer activity", () => {
    const storage = new MemoryStorage();
    const scan = emptyScan();
    scan.assignedIssues.items = [
      { repoFullName: "acme/repo", issue: issue(2, "2026-07-17T10:00:00Z") },
      { repoFullName: "acme/repo", issue: issue(1, "2026-07-17T10:00:00Z") },
    ];
    const input = { repositories: [] as DiscoveryRepositoryInput[], localRepositories: [], scan, now: NOW };
    const items = buildWorkItems(input);
    expect(items.map((item) => item.id)).toEqual([
      "github:acme/repo:issue:1",
      "github:acme/repo:issue:2",
    ]);

    writeWorkItemDisposition(items[0]!.id, { state: "completed" }, { storage, scope: "sena", now: NOW });
    expect(applyWorkItemDispositions(items, readWorkItemDispositions(storage, "sena"), NOW).hidden).toHaveLength(1);

    scan.assignedIssues.items[1] = { repoFullName: "acme/repo", issue: issue(1, "2026-07-17T13:00:00Z") };
    const refreshed = buildWorkItems({ ...input, now: NOW + 60 * 60 * 1000 });
    expect(applyWorkItemDispositions(refreshed, readWorkItemDispositions(storage, "sena"), NOW + 60 * 60 * 1000).visible)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: items[0]!.id })]));
  });

  it("applies pin and snooze without hiding a newly changed local signal", () => {
    const storage = new MemoryStorage();
    const local = repoSummary("repo", { unstagedCount: 1, lastCommitAt: NOW });
    const item = buildWorkItems({ repositories: [], localRepositories: [local], scan: emptyScan(), now: NOW })[0]!;
    writeWorkItemDisposition(item.id, { state: "active", pinned: true }, {
      storage, scope: "sena", now: NOW, sourceRevision: item.sourceRevision,
    });
    expect(applyWorkItemDispositions([item], readWorkItemDispositions(storage, "sena"), NOW).visible[0]?.pinned).toBe(true);

    writeWorkItemDisposition(item.id, { state: "snoozed", snoozedUntil: NOW + 1_000 }, {
      storage, scope: "sena", now: NOW, sourceRevision: item.sourceRevision,
    });
    expect(applyWorkItemDispositions([item], readWorkItemDispositions(storage, "sena"), NOW).hidden).toHaveLength(1);
    expect(applyWorkItemDispositions([item], readWorkItemDispositions(storage, "sena"), NOW + 1_001).visible).toHaveLength(1);

    const changed = buildWorkItems({
      repositories: [], localRepositories: [{ ...local, unstagedCount: 2 }], scan: emptyScan(), now: NOW,
    })[0]!;
    expect(applyWorkItemDispositions([changed], readWorkItemDispositions(storage, "sena"), NOW).visible).toHaveLength(1);
  });
});

describe("project momentum", () => {
  it("explains blocked, attention, healthy and inactive states without contribution data", () => {
    const blocked = repoSummary("blocked", { githubFullName: "acme/blocked", conflictCount: 1, lastCommitAt: NOW });
    const attention = repoSummary("attention", { githubFullName: "acme/attention", behind: 2, lastCommitAt: NOW });
    const healthy = repoSummary("healthy", { githubFullName: "acme/healthy", lastCommitAt: NOW });
    const inactive = repoSummary("inactive", { githubFullName: "acme/inactive", lastCommitAt: NOW - 120 * 24 * 60 * 60 * 1000 });
    const momentum = buildProjectMomentum({
      repositories: [blocked, attention, healthy, inactive].map(repository),
      localRepositories: [blocked, attention, healthy, inactive],
      scan: emptyScan(),
      now: NOW,
    });

    expect(Object.fromEntries(momentum.map((item) => [item.repository, item.state]))).toEqual({
      "acme/blocked": "blocked",
      "acme/attention": "attention",
      "acme/healthy": "healthy",
      "acme/inactive": "inactive",
    });
    expect(momentum.every((item) => item.reasons.length > 0 && item.nextAction.route.startsWith("/repos/"))).toBe(true);
    expect(momentum.find((item) => item.repository === "acme/blocked")?.reasons[0]?.label).toContain("冲突");
  });
});

function repository(localRepo: ReturnType<typeof repoSummary>): DiscoveryRepositoryInput {
  return { fullName: localRepo.githubFullName!, localRepo, remote: null };
}

function issue(number: number, updatedAt = "2026-07-17T11:00:00Z"): GitHubIssue {
  return {
    number, title: `Issue ${number}`, state: "open", body: null, labels: [], assignees: ["octocat"],
    htmlUrl: `https://github.com/acme/repo/issues/${number}`, updatedAt, createdAt: updatedAt,
  };
}

function pullRequest(number: number, updatedAt: string): GitHubPullRequest {
  return {
    number, title: `PR ${number}`, state: "open", draft: false, body: null, labels: [], assignees: ["octocat"],
    htmlUrl: `https://github.com/acme/repo/pull/${number}`, updatedAt, createdAt: updatedAt, author: "octocat",
    baseBranch: "main", headBranch: "feature", merged: false, mergeable: true, mergeableState: "clean",
  };
}

function emptyScan(): DiscoveryScanResult {
  const section = <T>() => ({
    items: [] as T[], failures: [], truncated: false, requestedRepositoryCount: 0, successfulRepositoryCount: 0,
  });
  return {
    pendingPullRequests: section(),
    assignedIssues: section(),
    failedWorkflows: section<{ repoFullName: string; run: GitHubWorkflowRun }>(),
    recentReleases: section(),
    repositoryStatuses: section(),
  };
}

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
