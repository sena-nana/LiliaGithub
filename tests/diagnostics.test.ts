import { describe, expect, it } from "vitest";
import { launchDiagnostic, launchHistoryLabel } from "../src/utils/launchDiagnostics";
import { recoveryGuidanceForMessage } from "../src/utils/recoveryGuidance";
import { errorExcerptFromLog, workflowFailureSummary } from "../src/utils/workflowDiagnostics";
import type { GitHubWorkflowJob, ProjectLaunchHistoryEntry } from "../src/services/workspace/types";

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

function launchHistory(overrides: Partial<ProjectLaunchHistoryEntry> = {}): ProjectLaunchHistoryEntry {
  return {
    id: "run-1",
    repoId: "LiliaGithub",
    command: "yarn dev",
    cwd: "C:/Files/workspace/LiliaGithub",
    state: "error",
    startedAt: 1,
    finishedAt: 2,
    exitCode: 1,
    error: "Error: EADDRINUSE 1420",
    lastOutput: "port already used",
    ...overrides,
  };
}

describe("diagnostics helpers", () => {
  it("按错误文本给 Git 恢复指引分类", () => {
    expect(recoveryGuidanceForMessage("merge conflict in README").title).toBe("处理冲突后继续");
    expect(recoveryGuidanceForMessage("HTTP 403 permission denied").title).toBe("恢复 GitHub 权限");
    expect(recoveryGuidanceForMessage("unknown failure").title).toBe("查看错误并重试");
  });

  it("从启动历史识别失败类型和历史标签", () => {
    const diagnostic = launchDiagnostic(null, [], [launchHistory()]);

    expect(diagnostic?.title).toBe("端口被占用");
    expect(diagnostic?.steps).toContain("停止占用端口的进程");
    expect(launchHistoryLabel(launchHistory({ exitCode: 0, state: "exited", error: null }))).toBe("正常结束");
  });

  it("优先使用当前启动错误，不需要组件合成日志", () => {
    const diagnostic = launchDiagnostic(null, [], [], "command not found: yarn");

    expect(diagnostic?.title).toBe("启动命令不可用");
  });

  it("聚合失败 workflow step 并截取错误日志附近内容", () => {
    const summary = workflowFailureSummary([workflowJob()]);
    const excerpt = errorExcerptFromLog(["prepare", "compile", "::error file=src/main.ts::boom", "after"].join("\n"));

    expect(summary.failedJobs).toHaveLength(1);
    expect(summary.failedSteps[0].step.name).toBe("Test");
    expect(excerpt).toContain("::error file=src/main.ts::boom");
    expect(excerpt).toContain("compile");
  });
});
