import { describe, expect, it } from "vitest";
import type {
  GitHubActionNotification,
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRepoSummary,
  RepoSummary,
} from "../src/services/workspace";
import { buildHomePendingItems, type HomePendingRepoSource } from "../src/utils/homePendingItems";

const repoFullName = "sena-nana/LiliaGithub";

function githubRepo(overrides: Partial<GitHubRepoSummary> = {}): GitHubRepoSummary {
  return {
    id: 1,
    name: "LiliaGithub",
    fullName: repoFullName,
    ownerLogin: "sena-nana",
    private: false,
    disabled: false,
    archived: false,
    description: null,
    defaultBranch: "main",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-25T08:00:00Z",
    cloneUrl: "https://github.com/sena-nana/LiliaGithub.git",
    htmlUrl: "https://github.com/sena-nana/LiliaGithub",
    ...overrides,
  };
}

function localRepo(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: "repo-1",
    name: "LiliaGithub",
    path: "C:/Files/workspace/LiliaGithub",
    relativePath: "LiliaGithub",
    currentBranch: "main",
    remoteUrl: "https://github.com/sena-nana/LiliaGithub.git",
    githubFullName: repoFullName,
    ahead: 0,
    behind: 0,
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

function issue(number: number, state: GitHubIssue["state"], updatedAt: string): GitHubIssue {
  return {
    number,
    title: `Issue ${number}`,
    state,
    body: null,
    labels: [],
    assignees: [],
    htmlUrl: `https://github.com/sena-nana/LiliaGithub/issues/${number}`,
    updatedAt,
    createdAt: "2026-06-01T00:00:00Z",
  };
}

function pullRequest(number: number, overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number,
    title: `PR ${number}`,
    state: "open",
    draft: false,
    body: null,
    labels: [],
    assignees: [],
    htmlUrl: `https://github.com/sena-nana/LiliaGithub/pull/${number}`,
    updatedAt: "2026-06-25T10:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
    author: "sena",
    baseBranch: "main",
    headBranch: `branch-${number}`,
    merged: false,
    mergeable: true,
    mergeableState: "clean",
    ...overrides,
  };
}

function check(
  id: number,
  status: string,
  conclusion: string | null,
  name = `check-${id}`,
): GitHubPullRequestCheck {
  return {
    id,
    name,
    status,
    conclusion,
    detailsUrl: null,
    htmlUrl: null,
    startedAt: null,
    completedAt: null,
  };
}

function actionNotification(
  id: string,
  title: string,
  updatedAt: string,
  overrides: Partial<GitHubActionNotification> = {},
): GitHubActionNotification {
  return {
    id,
    repoFullName,
    title,
    subjectType: "WorkflowRun",
    subjectUrl: `https://api.github.com/repos/sena-nana/LiliaGithub/actions/runs/${id}`,
    latestCommentUrl: null,
    reason: "ci_activity",
    updatedAt,
    unread: true,
    ...overrides,
  };
}

function source(overrides: Partial<HomePendingRepoSource> = {}): HomePendingRepoSource {
  return {
    githubRepo: githubRepo(),
    localRepo: localRepo(),
    syncIssue: null,
    issues: [],
    pullRequests: [],
    pullRequestChecksByPull: {},
    actionNotifications: [],
    ...overrides,
  };
}

describe("buildHomePendingItems", () => {
  it("prioritizes failing Actions before open pull requests and issues", () => {
    const items = buildHomePendingItems([
      source({
        issues: [issue(12, "open", "2026-06-25T12:00:00Z")],
        pullRequests: [pullRequest(7, { updatedAt: "2026-06-25T11:00:00Z" })],
        actionNotifications: [actionNotification("90", "CI failed", "2026-06-25T09:00:00Z")],
      }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["workflow", "pull", "issue"]);
    expect(items[0]).toMatchObject({
      title: "Actions 报错",
      tone: "error",
      target: { kind: "workflow", runId: 90 },
    });
  });

  it("excludes closed issues, merged pull requests, draft pull requests and non-notified Actions", () => {
    const items = buildHomePendingItems([
      source({
        issues: [
          issue(1, "closed", "2026-06-25T12:00:00Z"),
          issue(2, "open", "2026-06-25T11:00:00Z"),
        ],
        pullRequests: [
          pullRequest(3, { state: "closed" }),
          pullRequest(4, { merged: true }),
          pullRequest(5, { draft: true }),
          pullRequest(6),
        ],
        actionNotifications: [actionNotification("11", "CI failed", "2026-06-25T09:00:00Z")],
      }),
    ]);

    expect(items.map((item) => item.id)).toEqual([
      "workflow-notification:11",
      `pull-request:${repoFullName}:6`,
      `issue:${repoFullName}:2`,
    ]);
  });

  it("surfaces failed and running pull request checks in tone and summary", () => {
    const items = buildHomePendingItems([
      source({
        pullRequests: [
          pullRequest(1, { updatedAt: "2026-06-25T08:00:00Z" }),
          pullRequest(2, { updatedAt: "2026-06-25T09:00:00Z" }),
        ],
        pullRequestChecksByPull: {
          1: [check(1, "completed", "failure", "lint")],
          2: [check(2, "in_progress", null, "test")],
        },
      }),
    ]);

    expect(items.map((item) => item.id)).toEqual([
      `pull-request:${repoFullName}:1`,
      `pull-request:${repoFullName}:2`,
    ]);
    expect(items[0]).toMatchObject({ tone: "error", summary: `${repoFullName} · Checks 失败：lint` });
    expect(items[1]).toMatchObject({ tone: "warn", summary: `${repoFullName} · Checks 运行中：test` });
  });

  it("creates repo targets for local sync errors and sync state items", () => {
    const items = buildHomePendingItems([
      source({
        localRepo: localRepo({ ahead: 2, behind: 1 }),
        syncIssue: {
          label: "最近同步失败",
          message: "push failed",
          retryable: true,
          retrying: false,
          updatedAt: Date.parse("2026-06-25T13:00:00Z"),
        },
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "最近同步失败",
      detail: "push failed",
      target: { kind: "repo", repoId: "repo-1" },
      tone: "error",
    });
    expect(items[1]).toMatchObject({
      title: "仓库同步状态",
      detail: "待处理提交 ↑2 / ↓1",
      target: { kind: "repo", repoId: "repo-1" },
      tone: "warn",
    });
  });

  it("can build only the top pending items without changing ordering", () => {
    const sources = [
      source({
        issues: Array.from({ length: 18 }, (_, index) =>
          issue(index + 1, "open", `2026-06-${String(index + 1).padStart(2, "0")}T12:00:00Z`)
        ),
        pullRequests: [
          pullRequest(101, { updatedAt: "2026-06-25T09:00:00Z" }),
          pullRequest(102, { updatedAt: "2026-06-25T10:00:00Z" }),
        ],
        actionNotifications: [
          actionNotification("201", "CI failed", "2026-06-20T09:00:00Z"),
          actionNotification("202", "Release cancelled", "2026-06-21T09:00:00Z"),
        ],
      }),
    ];
    const fullTopIds = buildHomePendingItems(sources).slice(0, 5).map((item) => item.id);

    expect(buildHomePendingItems(sources, 5).map((item) => item.id)).toEqual(fullTopIds);
    expect(buildHomePendingItems(sources, 0)).toEqual([]);
  });
});
