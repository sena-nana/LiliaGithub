import type { GitHubWorkflowJob, GitHubWorkflowJobStep } from "../services/workspace/types";

export interface WorkflowFailureSummary {
  failedJobs: GitHubWorkflowJob[];
  failedSteps: Array<{ job: GitHubWorkflowJob; step: GitHubWorkflowJobStep }>;
}

export function workflowFailureSummary(jobs: readonly GitHubWorkflowJob[]): WorkflowFailureSummary {
  const failedJobs = jobs.filter((job) => isFailure(job.conclusion));
  const failedSteps = jobs.flatMap((job) =>
    job.steps
      .filter((step) => isFailure(step.conclusion))
      .map((step) => ({ job, step })),
  );
  return { failedJobs, failedSteps };
}

export function errorExcerptFromLog(log: string, maxLines = 8) {
  const lines = log.split(/\r?\n/);
  const errorIndex = lines.findIndex((line) => /(::error|error:|failed|失败|panic|exception|exit code)/i.test(line));
  if (errorIndex < 0) return "";
  const start = Math.max(0, errorIndex - 2);
  return lines.slice(start, start + maxLines).join("\n").trim();
}

function isFailure(value: string | null | undefined) {
  return value === "failure" || value === "timed_out" || value === "action_required" || value === "cancelled";
}
