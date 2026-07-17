import { describe, expect, it } from "vitest";
import {
  buildPullRequestReviewHandoff,
  buildWorkflowFailureHandoff,
  LILIA_CODE_TASK_HANDOFF_PROTOCOL,
  LILIA_CODE_TASK_HANDOFF_VERSION,
} from "../src/services/liliaCodeHandoff";
import type { GitHubPullRequest, GitHubWorkflowRun } from "../src/services/workspace/types";

const repository = {
  fullName: "acme/widget",
  worktreePath: "/work/widget",
  branch: "fix/review",
  remoteUrl: "https://github.com/acme/widget.git",
};

const pull: GitHubPullRequest = {
  number: 42,
  title: "Fix renderer",
  state: "open",
  draft: false,
  body: null,
  labels: [],
  assignees: [],
  htmlUrl: "https://github.com/acme/widget/pull/42",
  updatedAt: "2026-07-17T00:00:00Z",
  createdAt: "2026-07-16T00:00:00Z",
  author: "mika",
  baseBranch: "main",
  headBranch: "fix/review",
  merged: false,
  mergeable: true,
  mergeableState: "clean",
};

const run: GitHubWorkflowRun = {
  id: 77,
  name: "verify",
  displayTitle: "verify",
  status: "completed",
  conclusion: "failure",
  branch: "fix/review",
  event: "pull_request",
  htmlUrl: "https://github.com/acme/widget/actions/runs/77",
  createdAt: "2026-07-17T00:00:00Z",
  updatedAt: "2026-07-17T00:01:00Z",
};

describe("LiliaCode task handoff builders", () => {
  it("preserves complete pull request review context", () => {
    const handoff = buildPullRequestReviewHandoff({
      repository,
      pull,
      sourceRoute: "/repos/widget?section=pulls&pull=42",
      reviewRequirements: ["修复 src/render.ts:18 的空值分支"],
      relatedFiles: ["src/render.ts"],
      baseSha: "base-sha",
      headSha: "head-sha",
    });

    expect(handoff).toMatchObject({
      protocol: LILIA_CODE_TASK_HANDOFF_PROTOCOL,
      version: LILIA_CODE_TASK_HANDOFF_VERSION,
      kind: "pullRequestReview",
      repository,
      source: { application: "LiliaGithub" },
      pullRequest: {
        number: 42,
        baseBranch: "main",
        headBranch: "fix/review",
        baseSha: "base-sha",
        headSha: "head-sha",
        reviewRequirements: ["修复 src/render.ts:18 的空值分支"],
      },
      relatedFiles: ["src/render.ts"],
    });
    expect(handoff.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("includes workflow identity and diagnostic evidence", () => {
    const handoff = buildWorkflowFailureHandoff({
      repository,
      run,
      sourceRoute: "/discovery?workflow=77",
      logSummary: "typecheck failed in src/render.ts",
      relatedFiles: ["src/render.ts", "src/render.ts"],
    });

    expect(handoff.workflow).toEqual({
      runId: 77,
      runUrl: run.htmlUrl,
      workflowName: "verify",
    });
    expect(handoff.logSummary).toBe("typecheck failed in src/render.ts");
    expect(handoff.relatedFiles).toEqual(["src/render.ts"]);
  });
});
