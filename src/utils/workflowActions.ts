import type {
  GitHubRepositoryPermissions,
  GitHubWorkflowJob,
  GitHubWorkflowRun,
} from "../services/workspace/types";
import { githubErrorCode, isGitHubBindingExpiredError } from "./githubErrors";

export interface WorkflowActionAvailability {
  available: boolean;
  reason: string | null;
}

type WorkflowRunWriteAction = "rerun" | "cancel";

const RERUN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RUN_ATTEMPTS = 50;
const RERUNNABLE_FAILURES = new Set(["failure", "timed_out", "action_required", "startup_failure"]);
const CANCELLABLE_STATUSES = new Set(["queued", "in_progress"]);

export function workflowRunRerunAvailability(
  run: Pick<GitHubWorkflowRun, "status" | "conclusion" | "createdAt" | "runAttempt">,
  now = Date.now(),
): WorkflowActionAvailability {
  if (run.status !== "completed") return unavailable("运行尚未结束");
  if (!RERUNNABLE_FAILURES.has(run.conclusion ?? "")) return unavailable("只有失败运行可以重跑失败任务");
  if ((run.runAttempt ?? 1) >= MAX_RUN_ATTEMPTS) return unavailable("已达到 50 次重跑上限");
  const createdAt = Date.parse(run.createdAt);
  if (!Number.isFinite(createdAt) || now - createdAt > RERUN_WINDOW_MS) {
    return unavailable("运行已超过 30 天重跑期限");
  }
  return available();
}

export function workflowJobRerunAvailability(
  run: Pick<GitHubWorkflowRun, "status" | "conclusion" | "createdAt" | "runAttempt">,
  job: Pick<GitHubWorkflowJob, "status" | "conclusion">,
  now = Date.now(),
): WorkflowActionAvailability {
  const runAvailability = workflowRunRerunAvailability(run, now);
  if (!runAvailability.available) return runAvailability;
  if (job.status !== "completed") return unavailable("Job 尚未结束");
  if (!RERUNNABLE_FAILURES.has(job.conclusion ?? "")) return unavailable("只有失败 job 可以重跑");
  return available();
}

export function workflowRunCancelAvailability(
  run: Pick<GitHubWorkflowRun, "status">,
): WorkflowActionAvailability {
  return CANCELLABLE_STATUSES.has(run.status)
    ? available()
    : unavailable("只有排队中或运行中的 Actions 可以取消");
}

export function workflowRunWriteActionAvailability(
  action: WorkflowRunWriteAction,
  run: Pick<GitHubWorkflowRun, "status" | "conclusion" | "createdAt" | "runAttempt">,
  permissions: Pick<GitHubRepositoryPermissions, "push" | "admin"> | null | undefined,
  now = Date.now(),
): WorkflowActionAvailability {
  if (permissions && !permissions.push && !permissions.admin) {
    return unavailable("当前仓库为只读权限");
  }
  return action === "rerun"
    ? workflowRunRerunAvailability(run, now)
    : workflowRunCancelAvailability(run);
}

function workflowActionErrorMessage(error: unknown, action: WorkflowRunWriteAction) {
  const code = githubErrorCode(error);
  const message = String(error).replace(/^Error:\s*/, "").trim();
  const actionLabel = action === "rerun" ? "重跑" : "取消";

  if (code === "github_rate_limited" || /rate limit|请求频率|限流/i.test(message)) {
    return "GitHub 请求暂时受限，请稍后重试。";
  }
  if (code === "github_authentication_required" || isGitHubBindingExpiredError(error)) {
    return "GitHub 账户授权已失效，请重新绑定后再试。";
  }
  if (code === "github_org_sso_required") {
    return "组织要求额外的 SSO 授权，请在 GitHub 完成授权后重试。";
  }
  if (code === "github_forbidden" || /HTTP 403|forbidden|permission|权限/i.test(message)) {
    return `没有${actionLabel}权限。需要仓库写入权限和 GitHub Actions 写入权限。`;
  }
  if (code === "github_repository_not_accessible" || /HTTP 404|not found|不存在/i.test(message)) {
    return "该运行已失效，刷新 Actions 后重试。";
  }
  if (action === "cancel" && /HTTP 409|conflict|无法取消|cannot be cancelled/i.test(message)) {
    return "GitHub 拒绝取消。该运行的状态可能已经改变，请刷新后重试。";
  }
  if (action === "rerun" && /HTTP 409|HTTP 422|cannot be re-run|无法重跑/i.test(message)) {
    return "GitHub 拒绝重跑。该运行可能仍在执行、已过期或达到重跑上限。";
  }
  return message;
}

export function workflowRerunErrorMessage(error: unknown) {
  return workflowActionErrorMessage(error, "rerun");
}

export function workflowCancelErrorMessage(error: unknown) {
  return workflowActionErrorMessage(error, "cancel");
}

function available(): WorkflowActionAvailability {
  return { available: true, reason: null };
}

function unavailable(reason: string): WorkflowActionAvailability {
  return { available: false, reason };
}
