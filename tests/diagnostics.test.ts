import { describe, expect, it } from "vitest";
import { recoveryGuidanceForMessage } from "../src/utils/recoveryGuidance";
import { errorExcerptFromLog, workflowFailureSummary } from "../src/utils/workflowDiagnostics";
import type { GitHubWorkflowJob } from "../src/services/workspace/types";

function workflowJob(overrides: Partial<GitHubWorkflowJob> = {}): GitHubWorkflowJob {
  return {
    id: 1,
    name: "build",
    status: "completed",
    conclusion: "failure",
    startedAt: null,
    completedAt: null,
    htmlUrl: null,
    runnerName: null,
    steps: [
      {
        name: "Install",
        status: "completed",
        conclusion: "success",
        number: 1,
        startedAt: null,
        completedAt: null,
      },
      {
        name: "Test",
        status: "completed",
        conclusion: "failure",
        number: 2,
        startedAt: null,
        completedAt: null,
      },
    ],
    ...overrides,
  };
}

describe("diagnostics helpers", () => {
  it("按同步失败文本给出状态、原因和下一步", () => {
    const cases = [
      ["merge conflict in README", "同步冲突待处理"],
      ["存在未提交变更，已阻止 pull", "未提交变更阻塞同步"],
      ["HTTP 403 permission denied", "认证或权限失效"],
      ["remote: Repository not found", "认证或权限失效"],
      ["Not possible to fast-forward, aborting.", "需要合并上游"],
      ["failed to push some refs: non-fast-forward", "远端拒绝同步"],
    ] as const;

    for (const [message, title] of cases) {
      const guidance = recoveryGuidanceForMessage(message);
      expect(guidance.title).toBe(title);
      expect(guidance.summary).not.toBe("");
      expect(guidance.steps.length).toBeGreaterThan(1);
    }

    expect(recoveryGuidanceForMessage("unknown failure").title).toBe("查看错误并重试");
  });

  it("聚合失败 workflow step 并截取错误日志附近内容", () => {
    const summary = workflowFailureSummary([
      workflowJob(),
      workflowJob({ id: 2, conclusion: "cancelled", steps: [] }),
    ]);
    const excerpt = errorExcerptFromLog(["prepare", "compile", "::error file=src/main.ts::boom", "after"].join("\n"));

    expect(summary.failedJobs).toHaveLength(1);
    expect(summary.failedSteps[0].step.name).toBe("Test");
    expect(excerpt).toContain("::error file=src/main.ts::boom");
    expect(excerpt).toContain("compile");
  });
});
