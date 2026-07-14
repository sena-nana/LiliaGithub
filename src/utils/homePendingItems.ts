import type {
  GitHubActionNotification,
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRepoSummary,
  RepoSummary,
} from "../services/workspace";
import type { RepoSyncIssueDisplay } from "../composables/workspace/state";
import { type WorkflowRunTone } from "./repoDisplay";

export type HomePendingItemKind = "operation" | "issue" | "pull" | "workflow";

export type HomePendingItemTarget = {
  kind: "repo";
  repoId: string;
  view?: "conflicts";
} | {
  kind: "issue";
  repoFullName: string;
  localRepoId: string | null;
  number: number;
  state: GitHubIssue["state"];
} | {
  kind: "pull";
  repoFullName: string;
  localRepoId: string | null;
  number: number;
  state: GitHubPullRequest["state"];
  merged: boolean;
} | {
  kind: "workflow";
  repoFullName: string;
  localRepoId: string | null;
  runId: number | null;
};

export type HomePendingItem = {
  id: string;
  kind: HomePendingItemKind;
  title: string;
  detail: string;
  summary: string;
  timestamp: number;
  priority: number;
  target: HomePendingItemTarget;
  tone?: WorkflowRunTone;
};

export type HomePendingRepoSource = {
  githubRepo: GitHubRepoSummary;
  localRepo: RepoSummary | null;
  syncIssue: RepoSyncIssueDisplay | null;
  issues: readonly GitHubIssue[];
  pullRequests: readonly GitHubPullRequest[];
  pullRequestChecksByPull: Record<number, readonly GitHubPullRequestCheck[] | undefined> | undefined;
  actionNotifications: readonly GitHubActionNotification[];
};

const PRIORITY_OPERATION_ERROR = 500;
const PRIORITY_WORKFLOW_ERROR = 480;
const PRIORITY_PULL_CHECK_ERROR = 460;
const PRIORITY_CONFLICT = 440;
const PRIORITY_PULL_CHECK_PENDING = 360;
const PRIORITY_PULL_OPEN = 320;
const PRIORITY_ISSUE_OPEN = 260;
const PRIORITY_SYNC_STATE = 180;

export function buildHomePendingItems(sources: readonly HomePendingRepoSource[], limit?: number) {
  const normalizedLimit = normalizePendingItemLimit(limit);
  if (normalizedLimit === 0) return [];
  if (normalizedLimit == null) {
    return sources
      .flatMap(buildHomePendingItemsForRepo)
      .filter(isUsableHomePendingItem)
      .sort(compareHomePendingItems);
  }

  const items: HomePendingItem[] = [];
  for (const source of sources) {
    for (const item of buildHomePendingItemsForRepo(source)) {
      collectTopHomePendingItem(items, item, normalizedLimit);
    }
  }
  return items;
}

function normalizePendingItemLimit(limit: number | undefined) {
  if (limit == null || !Number.isFinite(limit)) return null;
  return Math.max(0, Math.floor(limit));
}

function collectTopHomePendingItem(items: HomePendingItem[], item: HomePendingItem, limit: number) {
  if (!isUsableHomePendingItem(item)) return;
  const index = items.findIndex((current) => compareHomePendingItems(item, current) < 0);
  if (index < 0) {
    if (items.length < limit) items.push(item);
    return;
  }
  items.splice(index, 0, item);
  if (items.length > limit) items.pop();
}

function buildHomePendingItemsForRepo(source: HomePendingRepoSource): HomePendingItem[] {
  const { githubRepo, localRepo } = source;
  const localRepoId = localRepo?.id ?? null;
  const items: HomePendingItem[] = [];

  if (localRepo && source.syncIssue) {
    items.push({
      id: `operation-error:${localRepo.id}:${source.syncIssue.updatedAt}`,
      kind: "operation",
      title: source.syncIssue.label,
      detail: source.syncIssue.message,
      summary: githubRepo.fullName,
      timestamp: source.syncIssue.updatedAt,
      priority: PRIORITY_OPERATION_ERROR,
      target: { kind: "repo", repoId: localRepo.id },
      tone: source.syncIssue.label.includes("跳过") ? "warn" : "error",
    });
  }

  if (localRepo && localRepo.conflictCount > 0) {
    items.push({
      id: `operation-conflict:${localRepo.id}:${localRepo.conflictCount}`,
      kind: "operation",
      title: "冲突待处理",
      detail: `${localRepo.conflictCount} 个冲突文件`,
      summary: githubRepo.fullName,
      timestamp: repoPendingTimestamp(githubRepo, localRepo),
      priority: PRIORITY_CONFLICT,
      target: { kind: "repo", repoId: localRepo.id, view: "conflicts" },
      tone: "error",
    });
  }

  for (const notification of source.actionNotifications) {
    const tone = actionNotificationTone(notification);
    const runId = actionNotificationRunId(notification);
    items.push({
      id: `workflow-notification:${notification.id}`,
      kind: "workflow",
      title: tone === "error" ? "Actions 报错" : "Actions 通知",
      detail: notification.title,
      summary: `${githubRepo.fullName} · ${notification.reason}`,
      timestamp: parseGitHubTime(notification.updatedAt),
      priority: PRIORITY_WORKFLOW_ERROR,
      target: { kind: "workflow", repoFullName: githubRepo.fullName, localRepoId, runId },
      tone,
    });
  }

  for (const pullRequest of source.pullRequests) {
    if (!isOpenActionablePullRequest(pullRequest)) continue;
    const checks = source.pullRequestChecksByPull?.[pullRequest.number] ?? [];
    const checksOverview = pullRequestChecksOverview(checks);
    items.push({
      id: `pull-request:${githubRepo.fullName}:${pullRequest.number}`,
      kind: "pull",
      title: `PR #${pullRequest.number}`,
      detail: pullRequest.title,
      summary: `${githubRepo.fullName} · ${checksOverview.detail}`,
      timestamp: parseGitHubTime(pullRequest.updatedAt),
      priority: pullRequestPriority(checksOverview.tone),
      target: {
        kind: "pull",
        repoFullName: githubRepo.fullName,
        localRepoId,
        number: pullRequest.number,
        state: pullRequest.state,
        merged: pullRequest.merged,
      },
      tone: checksOverview.tone,
    });
  }

  for (const issue of source.issues) {
    if (issue.state !== "open") continue;
    items.push({
      id: `issue:${githubRepo.fullName}:${issue.number}`,
      kind: "issue",
      title: `Issue #${issue.number}`,
      detail: issue.title,
      summary: githubRepo.fullName,
      timestamp: parseGitHubTime(issue.updatedAt),
      priority: PRIORITY_ISSUE_OPEN,
      target: {
        kind: "issue",
        repoFullName: githubRepo.fullName,
        localRepoId,
        number: issue.number,
        state: issue.state,
      },
    });
  }

  if (localRepo && (localRepo.ahead > 0 || localRepo.behind > 0)) {
    items.push({
      id: `operation-sync-state:${localRepo.id}:${localRepo.ahead}:${localRepo.behind}`,
      kind: "operation",
      title: "仓库同步状态",
      detail: `待处理提交 ↑${localRepo.ahead} / ↓${localRepo.behind}`,
      summary: githubRepo.fullName,
      timestamp: repoPendingTimestamp(githubRepo, localRepo),
      priority: PRIORITY_SYNC_STATE,
      target: { kind: "repo", repoId: localRepo.id },
      tone: "warn",
    });
  }

  return items;
}

function isUsableHomePendingItem(item: HomePendingItem) {
  return Number.isFinite(item.timestamp) && item.timestamp > 0;
}

function compareHomePendingItems(left: HomePendingItem, right: HomePendingItem) {
  return right.priority - left.priority ||
    right.timestamp - left.timestamp ||
    right.id.localeCompare(left.id);
}

function isOpenActionablePullRequest(pullRequest: GitHubPullRequest) {
  return pullRequest.state === "open" && !pullRequest.merged && !pullRequest.draft;
}

function pullRequestPriority(tone: WorkflowRunTone | undefined) {
  if (tone === "error") return PRIORITY_PULL_CHECK_ERROR;
  if (tone === "warn") return PRIORITY_PULL_CHECK_PENDING;
  return PRIORITY_PULL_OPEN;
}

function actionNotificationTone(notification: GitHubActionNotification): WorkflowRunTone {
  const text = `${notification.title} ${notification.reason} ${notification.subjectType}`.toLowerCase();
  if (text.includes("fail") || text.includes("error") || text.includes("cancel") || text.includes("timed out")) {
    return "error";
  }
  return "warn";
}

function actionNotificationRunId(notification: GitHubActionNotification) {
  const url = notification.subjectUrl ?? notification.latestCommentUrl ?? "";
  const match = /\/actions\/runs\/(\d+)(?:\/|$)/.exec(url);
  if (!match) return null;
  const runId = Number(match[1]);
  return Number.isSafeInteger(runId) ? runId : null;
}

function pullRequestChecksOverview(checks: readonly GitHubPullRequestCheck[]): { detail: string; tone?: WorkflowRunTone } {
  if (!checks.length) return { detail: "无 checks", tone: "muted" };
  const pending = checks.filter((check) => check.status !== "completed");
  if (pending.length) {
    return { detail: `Checks 运行中：${formatCheckNames(pending)}`, tone: "warn" };
  }
  const failed = checks.filter((check) => !isSuccessfulPullRequestCheck(check));
  if (failed.length) {
    return { detail: `Checks 失败：${formatCheckNames(failed)}`, tone: "error" };
  }
  return { detail: `Checks 通过：${checks.length} 项`, tone: "ok" };
}

function isSuccessfulPullRequestCheck(check: GitHubPullRequestCheck) {
  return check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped";
}

function formatCheckNames(checks: readonly GitHubPullRequestCheck[]) {
  const names = checks.map((check) => check.name).filter(Boolean).slice(0, 2);
  const suffix = checks.length > names.length ? ` 等 ${checks.length} 项` : "";
  return `${names.join("、") || `${checks.length} 项`}${suffix}`;
}

function repoPendingTimestamp(githubRepo: GitHubRepoSummary, localRepo: RepoSummary) {
  return localRepo.lastCommitAt ? localRepo.lastCommitAt * 1000 : parseGitHubTime(githubRepo.updatedAt);
}

function parseGitHubTime(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
