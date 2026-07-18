import { describe, expect, it } from "vitest";
import { parseWorkflowJobLogSections } from "../src/components/repo/workflowLogs";
import type { GitHubWorkflowJob } from "../src/services/workspace/types";

function job(stepNames: string[]): GitHubWorkflowJob {
  return {
    id: 1,
    name: "CI",
    status: "completed",
    conclusion: "success",
    startedAt: "2026-06-21T10:00:00Z",
    completedAt: "2026-06-21T10:02:00Z",
    htmlUrl: null,
    runnerName: null,
    steps: stepNames.map((name, index) => ({
      name,
      status: "completed",
      conclusion: "success",
      number: index + 1,
      startedAt: null,
      completedAt: null,
    })),
  };
}

describe("parseWorkflowJobLogSections", () => {
  it("按 GitHub group 标记匹配 step 日志", () => {
    const sections = parseWorkflowJobLogSections(job(["Set up job", "Run tests"]), [
      "2026-06-21T10:00:00Z ##[group]Set up job",
      "prepare runner",
      "##[endgroup]",
      "##[group]Run tests",
      "pnpm test",
      "\u001b[32mpass\u001b[0m",
      "##[endgroup]",
    ].join("\n"));

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ matched: true, content: "prepare runner" });
    expect(sections[1].matched).toBe(true);
    expect(sections[1].content).toContain("pnpm test");
    expect(sections[1].content).toContain("\u001b[32mpass\u001b[0m");
  });

  it("无法匹配 step 时回退到完整 job 日志", () => {
    const content = "plain job log\nwithout groups";
    const sections = parseWorkflowJobLogSections(job(["Build"]), content);

    expect(sections[0]).toMatchObject({ matched: false, content });
  });

  it("空日志仍返回 step section", () => {
    const sections = parseWorkflowJobLogSections(job(["Build"]), "");

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ matched: false, content: "" });
    expect(sections[0].step.name).toBe("Build");
  });
});
