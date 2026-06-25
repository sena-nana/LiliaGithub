import type { GitHubWorkflowRun, RepoChange, RepoSummary } from "../services/workspace";

type RepoIdentity = Pick<RepoSummary, "name" | "path" | "githubFullName" | "worktree">;
export type WorkflowRunTone = "error" | "warn" | "ok" | "muted";

export function repoDisplayName(repo: RepoIdentity | null | undefined) {
  if (repo?.worktree?.role === "linked") {
    return repo.name;
  }
  const githubFullName = repo?.githubFullName?.trim();
  if (githubFullName) {
    const parts = githubFullName.split("/").filter(Boolean);
    const repoName = parts[parts.length - 1];
    if (repoName) return repoName;
  }
  return repo?.name ?? "仓库";
}

export function repoDisplayTitle(repo: RepoIdentity) {
  return [repo.githubFullName, repo.path].filter(Boolean).join(" · ") || repo.name;
}

export function changeStatusText(change: RepoChange) {
  if (change.conflicted) return "冲突";
  if (change.untracked) return "未跟踪";
  if (change.staged && change.unstaged) return "已暂存/有修改";
  if (change.staged) return "已暂存";
  return "未暂存";
}

export function changeStatusTone(change: RepoChange) {
  if (change.conflicted) return "change-badge--err";
  if (change.untracked) return "change-badge--warn";
  if (change.staged && change.unstaged) return "change-badge--accent";
  if (change.staged) return "change-badge--ok";
  return "change-badge--muted";
}

export function changeStatusLetter(change: RepoChange) {
  if (change.conflicted) return "!";
  if (change.untracked) return "U";
  if (change.staged && change.unstaged) return "M";
  if (change.staged) return "S";
  return "W";
}

export function formatRepoTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

export function formatCompactRepoTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeRepoTime(timestamp: number | null | undefined, now = Date.now()) {
  if (!timestamp) return "无提交";
  const deltaMs = Math.max(0, now - timestamp * 1000);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;
  if (deltaMs < minute) return "刚刚";
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)} 分钟前`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)} 小时前`;
  if (deltaMs < month) return `${Math.floor(deltaMs / day)} 天前`;
  if (deltaMs < year) return `${Math.floor(deltaMs / month)} 个月前`;
  return `${Math.floor(deltaMs / year)} 年前`;
}

export function bulkResultTone(result: { status: string }) {
  return result.status === "success" ? "sync-results__item--success" : "sync-results__item--error";
}

export function workflowRunStatusText(run: Pick<GitHubWorkflowRun, "status" | "conclusion">) {
  const status = run.status.toLowerCase();
  const conclusion = run.conclusion?.toLowerCase() ?? null;
  if (status === "completed") return workflowConclusionText(conclusion);
  if (status === "in_progress") return "Actions 运行中";
  if (status === "queued") return "Actions 排队中";
  if (status === "requested") return "Actions 待执行";
  if (status === "waiting" || status === "pending") return "Actions 等待中";
  return `Actions ${status}`;
}

export function workflowRunStatusTone(run: Pick<GitHubWorkflowRun, "status" | "conclusion">): WorkflowRunTone {
  const status = run.status.toLowerCase();
  const conclusion = run.conclusion?.toLowerCase() ?? null;
  if (status === "completed") {
    if (conclusion != null && !["success", "neutral", "skipped"].includes(conclusion)) return "error";
    return conclusion === "success" ? "ok" : "muted";
  }
  return ["in_progress", "queued", "requested", "waiting", "pending"].includes(status) ? "warn" : "muted";
}

export function isWorkflowRunFailure(run: Pick<GitHubWorkflowRun, "status" | "conclusion">) {
  return workflowRunStatusTone(run) === "error";
}

function workflowConclusionText(conclusion: string | null) {
  if (conclusion === "success") return "Actions 通过";
  if (conclusion === "failure") return "Actions 失败";
  if (conclusion === "cancelled") return "Actions 取消";
  if (conclusion === "timed_out") return "Actions 超时";
  if (conclusion === "skipped") return "Actions 跳过";
  if (conclusion === "neutral") return "Actions 完成";
  return conclusion ? `Actions ${conclusion}` : "Actions 完成";
}

export function commitFileStatusText(status: string) {
  if (status === "renamed") return "重命名";
  if (status === "added") return "新增";
  if (status === "deleted") return "删除";
  if (status === "copied") return "复制";
  return "修改";
}
