import { describe, expect, it } from "vitest";
import type { GitHubWorkflowJob, GitHubWorkflowRun } from "../src/services/workspace/types";
import {
  workflowJobRerunAvailability,
  workflowRerunErrorMessage,
  workflowRunRerunAvailability,
} from "../src/components/repo/workflowRerun";

const now = Date.parse("2026-07-11T00:00:00Z");

function failedRun(overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun {
  return {
    id: 42,
    name: "CI",
    displayTitle: "CI",
    status: "completed",
    conclusion: "failure",
    branch: "main",
    event: "push",
    htmlUrl: "https://github.com/a/repo/actions/runs/42",
    createdAt: "2026-07-10T00:00:00Z",
    updatedAt: "2026-07-10T00:05:00Z",
    runAttempt: 1,
    ...overrides,
  };
}

function failedJob(overrides: Partial<GitHubWorkflowJob> = {}): GitHubWorkflowJob {
  return {
    id: 77,
    name: "test",
    status: "completed",
    conclusion: "failure",
    startedAt: null,
    completedAt: null,
    htmlUrl: null,
    runnerName: null,
    steps: [],
    ...overrides,
  };
}

describe("workflow rerun availability", () => {
  it("只允许在期限和次数限制内重跑失败 run 与 job", () => {
    expect(workflowRunRerunAvailability(failedRun(), now)).toEqual({ available: true, reason: null });
    expect(workflowJobRerunAvailability(failedRun(), failedJob(), now)).toEqual({ available: true, reason: null });
    expect(workflowRunRerunAvailability(failedRun({ status: "in_progress", conclusion: null }), now).reason).toContain("尚未结束");
    expect(workflowRunRerunAvailability(failedRun({ conclusion: "success" }), now).reason).toContain("只有失败运行");
    expect(workflowRunRerunAvailability(failedRun({ runAttempt: 50 }), now).reason).toContain("50 次");
    expect(workflowRunRerunAvailability(failedRun({ createdAt: "2026-05-01T00:00:00Z" }), now).reason).toContain("30 天");
    expect(workflowJobRerunAvailability(failedRun(), failedJob({ conclusion: "cancelled" }), now).reason).toContain("只有失败 job");
  });

  it("把权限、失效和 GitHub 拒绝响应转成可操作错误", () => {
    expect(workflowRerunErrorMessage(new Error("HTTP 403 Forbidden"))).toContain("没有重跑权限");
    expect(workflowRerunErrorMessage(new Error("HTTP 404 Not Found"))).toContain("已失效");
    expect(workflowRerunErrorMessage(new Error("HTTP 422 cannot be re-run"))).toContain("GitHub 拒绝重跑");
    expect(workflowRerunErrorMessage(new Error("network offline"))).toBe("network offline");
  });
});
