import type { GitHubWorkflowJob, GitHubWorkflowRun } from "../../services/workspace/types";

export interface WorkflowRerunAvailability {
  available: boolean;
  reason: string | null;
}

const RERUN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RUN_ATTEMPTS = 50;
const RERUNNABLE_FAILURES = new Set(["failure", "timed_out", "action_required", "startup_failure"]);

export function workflowRunRerunAvailability(
  run: Pick<GitHubWorkflowRun, "status" | "conclusion" | "createdAt" | "runAttempt">,
  now = Date.now(),
): WorkflowRerunAvailability {
  if (run.status !== "completed") return unavailable("运行尚未结束");
  if (!RERUNNABLE_FAILURES.has(run.conclusion ?? "")) return unavailable("只有失败运行可以重跑失败任务");
  if ((run.runAttempt ?? 1) >= MAX_RUN_ATTEMPTS) return unavailable("已达到 50 次重跑上限");
  const createdAt = Date.parse(run.createdAt);
  if (!Number.isFinite(createdAt) || now - createdAt > RERUN_WINDOW_MS) {
    return unavailable("运行已超过 30 天重跑期限");
  }
  return { available: true, reason: null };
}

export function workflowJobRerunAvailability(
  run: Pick<GitHubWorkflowRun, "status" | "conclusion" | "createdAt" | "runAttempt">,
  job: Pick<GitHubWorkflowJob, "status" | "conclusion">,
  now = Date.now(),
): WorkflowRerunAvailability {
  const runAvailability = workflowRunRerunAvailability(run, now);
  if (!runAvailability.available) return runAvailability;
  if (job.status !== "completed") return unavailable("Job 尚未结束");
  if (!RERUNNABLE_FAILURES.has(job.conclusion ?? "")) return unavailable("只有失败 job 可以重跑");
  return { available: true, reason: null };
}

export function workflowRerunErrorMessage(error: unknown) {
  const message = String(error);
  if (/HTTP 403|forbidden|permission|权限/i.test(message)) {
    return "没有重跑权限。需要仓库写入权限和 GitHub Actions 写入权限。";
  }
  if (/HTTP 404|not found|不存在/i.test(message)) {
    return "该运行或 job 已失效，刷新 Actions 后重试。";
  }
  if (/HTTP 409|HTTP 422|cannot be re-run|无法重跑/i.test(message)) {
    return "GitHub 拒绝重跑。该运行可能仍在执行、已过期或达到重跑上限。";
  }
  return message.replace(/^Error:\s*/, "");
}

function unavailable(reason: string): WorkflowRerunAvailability {
  return { available: false, reason };
}
