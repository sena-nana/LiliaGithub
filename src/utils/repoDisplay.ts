import type { ProjectLaunchConfig, ProjectLaunchStatus, RepoChange, RepoSummary } from "../services/workspace";

type RepoIdentity = Pick<RepoSummary, "name" | "path" | "githubFullName">;
type RepoSyncSummary = Pick<RepoSummary, "ahead" | "behind" | "conflictCount">;
type RepoCommitSummary = Pick<RepoSummary, "lastCommitMessage">;
type HistoryCommitSummary = {
  readonly subject: string;
};
type ConflictStatusSource = {
  binary: boolean;
  hunks: readonly unknown[];
  resolved: boolean;
};

export function repoDisplayName(repo: RepoIdentity | null | undefined) {
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

export function formatRepoTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

export function formatNullableRepoTime(timestamp: number | null | undefined, fallback = "无提交") {
  if (!timestamp) return fallback;
  return formatRepoTime(timestamp);
}

export function formatCompactRepoTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function lastCommitText(
  commits: readonly HistoryCommitSummary[] | undefined,
  summary: RepoCommitSummary | null | undefined,
) {
  const latestCommit = commits?.[0];
  if (latestCommit) return latestCommit.subject;
  return summary?.lastCommitMessage ?? "无提交";
}

export function syncStatusText(summary: RepoSyncSummary | null | undefined) {
  if (!summary) return "未知";
  if (!summary.ahead && !summary.behind) return "已同步";
  return `↑${summary.ahead} / ↓${summary.behind}`;
}

export function syncStatusTone(summary: RepoSyncSummary | null | undefined) {
  if (!summary) return "";
  if (summary.conflictCount > 0) return "repo-status-strip__value--err";
  if (summary.behind > 0) return "repo-status-strip__value--warn";
  if (summary.ahead > 0) return "repo-status-strip__value--accent";
  return "repo-status-strip__value--ok";
}

export function conflictStatusText(file: ConflictStatusSource) {
  if (file.binary) return "二进制 / 不可解析";
  if (!file.hunks.length) return "文件级处理";
  if (file.resolved) return "已解决";
  return `${file.hunks.length} 个分段`;
}

export function conflictStatusTone(file: ConflictStatusSource) {
  if (file.resolved) return "change-badge--ok";
  if (file.binary || !file.hunks.length) return "change-badge--warn";
  return "change-badge--err";
}

export function launchStatusText(status: ProjectLaunchStatus | null | undefined) {
  const state = status?.state ?? "idle";
  if (state === "running") return "运行中";
  if (state === "exited") return `已退出${status?.exitCode != null ? ` · ${status.exitCode}` : ""}`;
  if (state === "error") return "异常";
  return "未运行";
}

export function launchSourceText(config: ProjectLaunchConfig | null | undefined) {
  return config?.source === "manual" ? "手动配置" : "自动推断";
}

export function streamLabel(stream: string) {
  if (stream === "stderr") return "ERR";
  if (stream === "stdout") return "OUT";
  return "SYS";
}

export function bulkResultTone(result: { status: string }) {
  return result.status === "success" ? "sync-results__item--success" : "sync-results__item--error";
}

export function commitFileStatusText(status: string) {
  if (status === "renamed") return "重命名";
  if (status === "added") return "新增";
  if (status === "deleted") return "删除";
  if (status === "copied") return "复制";
  return "修改";
}

export function commitDiffLineMark(kind: string) {
  if (kind === "added") return "+";
  if (kind === "deleted") return "-";
  return "";
}
