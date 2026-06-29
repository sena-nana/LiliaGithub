import type { GitHubWorkflowRun } from "../../services/workspace/types";
import { isWorkflowRunFailure, workflowRunStatusTone } from "../../utils/repoDisplay";

export function actionStatusIconKind(item: { status: string; conclusion: string | null }) {
  if (isWorkflowRunFailure(item)) return "error";
  if (workflowRunStatusTone(item) === "ok") return "ok";
  return "pending";
}

export function parseActionTime(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function actionDurationText(start: string | null | undefined, end: string | null | undefined) {
  const startMs = parseActionTime(start);
  const endMs = parseActionTime(end);
  if (!startMs || !endMs || endMs < startMs) return "-";
  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

export function actionRelativeTime(value: string | null | undefined) {
  const timestamp = parseActionTime(value);
  if (!timestamp) return "-";
  const delta = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  return `${Math.floor(delta / day)} 天前`;
}

export function formatActionTime(value: string | null | undefined) {
  const timestamp = parseActionTime(value);
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString();
}

export function actionRunMetaText(run: GitHubWorkflowRun) {
  return [run.name !== run.displayTitle ? run.name : "", run.branch, actionRelativeTime(run.updatedAt)]
    .filter(Boolean)
    .join(" · ");
}

export function workflowEventText(value: string | null | undefined) {
  if (!value) return "-";
  const normalized = value.toLowerCase();
  const labels: Record<string, string> = {
    push: "推送",
    pull_request: "拉取请求",
    workflow_dispatch: "手动触发",
    schedule: "定时触发",
    dynamic: "动态触发",
    release: "发布",
    repository_dispatch: "仓库事件",
  };
  return labels[normalized] ?? value;
}

export function workflowStateText(value: string | null | undefined) {
  if (!value) return "-";
  const normalized = value.toLowerCase();
  const labels: Record<string, string> = {
    success: "成功",
    failure: "失败",
    cancelled: "已取消",
    skipped: "已跳过",
    neutral: "无结论",
    timed_out: "超时",
    action_required: "需要操作",
    completed: "已完成",
    queued: "排队中",
    requested: "已请求",
    waiting: "等待中",
    pending: "等待中",
    in_progress: "运行中",
  };
  return labels[normalized] ?? value;
}

export function formatActionBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
