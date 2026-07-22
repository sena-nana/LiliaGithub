import type { GitHubRepoSummary, RepoSummary } from "../services/workspace";
import type { RepoSyncIssueDisplay } from "../composables/workspace/state";
import type { HomePendingItem } from "./homePendingItems";

export type ProjectMomentumState = "healthy" | "attention" | "blocked" | "inactive";

export type ProjectMomentum = {
  state: ProjectMomentumState;
  label: string;
  reason: string;
};

const INACTIVE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export function buildProjectMomentum(input: {
  githubRepo: Pick<GitHubRepoSummary, "fullName" | "updatedAt" | "archived">;
  localRepo: RepoSummary | null;
  syncIssue: RepoSyncIssueDisplay | null;
  pendingItems?: readonly HomePendingItem[];
  now?: number;
}): ProjectMomentum {
  const now = input.now ?? Date.now();
  const local = input.localRepo;
  const pending = input.pendingItems ?? [];
  const dirty = local ? local.stagedCount + local.unstagedCount + local.untrackedCount : 0;

  if (local?.conflictCount) {
    return momentum("blocked", "阻塞", `${local.conflictCount} 个 Git 冲突待处理`);
  }
  if (input.syncIssue && !input.syncIssue.label.includes("跳过")) {
    return momentum("blocked", "阻塞", input.syncIssue.message || input.syncIssue.label);
  }
  if (pending.some((item) => item.kind === "workflow" && item.tone === "error")) {
    return momentum("blocked", "阻塞", "存在失败 Workflow");
  }
  if (pending.some((item) => item.kind === "review")) {
    return momentum("attention", "需关注", "有待处理 Review");
  }
  if (dirty > 0) {
    return momentum("attention", "需关注", `${dirty} 项本地改动尚未提交`);
  }
  if (local && (local.behind > 0 || local.remotesNeedingPull > 0 || local.ahead > 0 || local.remotesNeedingPush > 0)) {
    return momentum("attention", "需关注", `待同步 ↑${local.ahead} / ↓${local.behind}`);
  }
  if (input.githubRepo.archived) {
    return momentum("inactive", "不活跃", "仓库已归档");
  }
  const updatedAt = Date.parse(input.githubRepo.updatedAt);
  if (!Number.isFinite(updatedAt) || now - updatedAt >= INACTIVE_AFTER_MS) {
    return momentum("inactive", "不活跃", "超过 90 天没有可见活动");
  }
  return momentum("healthy", "健康", "没有发现阻塞或待处理风险");
}

function momentum(state: ProjectMomentumState, label: string, reason: string): ProjectMomentum {
  return { state, label, reason };
}
