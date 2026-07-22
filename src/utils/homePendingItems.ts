import type {
  GitHubAccountIssueItem,
  GitHubActionNotification,
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubRepositoryPermissions,
  GitHubRepoSummary,
  GitHubWorkflowRun,
  RepoSummary,
} from "../services/workspace";
import type { RepoSyncIssueDisplay } from "../composables/workspace/state";
import type {
  HomeAttentionPendingPullRequest,
  HomeAttentionWorkflowRun,
} from "../services/homeAttention/types";
import {
  type WorkflowRunTone,
  workflowRunStatusText,
  workflowRunStatusTone,
} from "./repoDisplay";
import { workflowRunCancelAvailability } from "./workflowActions";

export type HomePendingItemKind = "operation" | "issue" | "pull" | "review" | "workflow";

export type HomePendingItemBucket = "attention" | "today";

export type HomePendingItemTarget = {
  kind: "repo";
  repoId: string;
  view?: "changes" | "conflicts";
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
  run: GitHubWorkflowRun | null;
  permissions: Pick<GitHubRepositoryPermissions, "push" | "admin"> | null | undefined;
};

export type HomePendingItem = {
  id: string;
  kind: HomePendingItemKind;
  bucket: HomePendingItemBucket;
  title: string;
  detail: string;
  summary: string;
  reason?: string;
  timestamp: number;
  priority: number;
  target: HomePendingItemTarget;
  tone?: WorkflowRunTone;
};

export type HomePendingRepoSource = {
  githubRepo: Pick<GitHubRepoSummary, "fullName" | "updatedAt" | "permissions">;
  localRepo: RepoSummary | null;
  syncIssue: RepoSyncIssueDisplay | null;
  issues: readonly GitHubIssue[];
  pullRequests: readonly GitHubPullRequest[];
  pullRequestChecksByPull: Record<number, readonly GitHubPullRequestCheck[] | undefined> | undefined;
  actionNotifications: readonly GitHubActionNotification[];
  attentionPullRequests: readonly HomeAttentionPendingPullRequest[];
  workflowRuns: readonly HomeAttentionWorkflowRun[];
};

const PRIORITY_OPERATION_ERROR = 500;
const PRIORITY_WORKFLOW_ERROR = 480;
const PRIORITY_WORKFLOW_ACTIVE = 475;
const PRIORITY_REVIEW_REQUEST = 470;
const PRIORITY_PULL_CHECK_ERROR = 460;
const PRIORITY_CONFLICT = 440;
const PRIORITY_ASSIGNED_PULL = 400;
const PRIORITY_LOCAL_CHANGES = 380;
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

function homePendingItemBucket(item: Pick<HomePendingItem, "kind" | "priority" | "tone">): HomePendingItemBucket {
  if (item.kind === "review" || item.kind === "workflow") return "attention";
  if (item.kind === "operation") {
    return item.priority >= PRIORITY_LOCAL_CHANGES ? "attention" : "today";
  }
  if (item.kind === "pull") {
    return item.tone === "error" || item.tone === "warn" || item.priority >= PRIORITY_ASSIGNED_PULL
      ? "attention"
      : "today";
  }
  return "today";
}

export function groupHomePendingItemsByBucket(items: readonly HomePendingItem[]) {
  const attention: HomePendingItem[] = [];
  const today: HomePendingItem[] = [];
  for (const item of items) {
    if (item.bucket === "attention") attention.push(item);
    else today.push(item);
  }
  return { attention, today };
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
    items.push(createHomePendingItem({
      id: `operation-error:${localRepo.id}:${source.syncIssue.updatedAt}`,
      kind: "operation",
      title: source.syncIssue.label,
      detail: source.syncIssue.message,
      summary: githubRepo.fullName,
      timestamp: source.syncIssue.updatedAt,
      priority: PRIORITY_OPERATION_ERROR,
      target: { kind: "repo", repoId: localRepo.id },
      tone: source.syncIssue.label.includes("跳过") ? "warn" : "error",
    }));
  }

  if (localRepo && localRepo.conflictCount > 0) {
    const dirty = localRepoDirtyCount(localRepo);
    items.push(createHomePendingItem({
      id: `operation-conflict:${localRepo.id}:${localRepo.conflictCount}`,
      kind: "operation",
      title: "冲突待处理",
      detail: `${localRepo.conflictCount} 个冲突文件${dirty ? `，另有 ${dirty} 项本地改动` : ""}`,
      summary: githubRepo.fullName,
      reason: "Git 冲突阻塞后续同步与提交",
      timestamp: repoPendingTimestamp(githubRepo, localRepo),
      priority: PRIORITY_CONFLICT,
      target: { kind: "repo", repoId: localRepo.id, view: "conflicts" },
      tone: "error",
    }));
  }

  const workflowRunIds = new Set(source.workflowRuns.map(({ run }) => run.id));
  for (const { run } of source.workflowRuns) {
    const priority = workflowPendingPriority(run);
    if (priority == null) continue;
    const statusText = workflowRunStatusText(run);
    items.push(createHomePendingItem({
      id: `workflow-run:${githubRepo.fullName}:${run.id}`,
      kind: "workflow",
      title: statusText,
      detail: run.displayTitle || run.name,
      summary: `${githubRepo.fullName} · ${run.branch || "默认分支"} · ${statusText}`,
      reason: `${run.branch || "默认分支"} 的运行结果为 ${statusText}`,
      timestamp: parseGitHubTime(run.updatedAt || run.createdAt),
      priority,
      target: {
        kind: "workflow",
        repoFullName: githubRepo.fullName,
        localRepoId,
        runId: run.id,
        run,
        permissions: githubRepo.permissions,
      },
      tone: workflowRunStatusTone(run),
    }));
  }

  for (const notification of source.actionNotifications) {
    const tone = actionNotificationTone(notification);
    const runId = actionNotificationRunId(notification);
    if (runId != null && workflowRunIds.has(runId)) continue;
    items.push(createHomePendingItem({
      id: `workflow-notification:${notification.id}`,
      kind: "workflow",
      title: tone === "error" ? "Actions 报错" : "Actions 通知",
      detail: notification.title,
      summary: `${githubRepo.fullName} · ${notification.reason}`,
      reason: notification.reason || "Actions 通知需要关注",
      timestamp: parseGitHubTime(notification.updatedAt),
      priority: PRIORITY_WORKFLOW_ERROR,
      target: {
        kind: "workflow",
        repoFullName: githubRepo.fullName,
        localRepoId,
        runId,
        run: null,
        permissions: githubRepo.permissions,
      },
      tone,
    }));
  }

  const attentionPullRequests = new Map(
    source.attentionPullRequests.map((entry) => [entry.pullRequest.number, entry]),
  );
  for (const { pullRequest, reasons } of attentionPullRequests.values()) {
    if (!isOpenActionablePullRequest(pullRequest)) continue;
    const reviewRequested = reasons.includes("review_requested");
    items.push(createHomePendingItem({
      id: `${reviewRequested ? "review-request" : "assigned-pull"}:${githubRepo.fullName}:${pullRequest.number}`,
      kind: reviewRequested ? "review" : "pull",
      title: `${reviewRequested ? "Review 请求" : "已分配"} · PR #${pullRequest.number}`,
      detail: pullRequest.title,
      summary: `${githubRepo.fullName} · ${reviewRequested ? "等待你的 Review" : "已分配给你"}`,
      reason: reviewRequested
        ? `#${pullRequest.number} 请求你的审查${reasons.includes("assigned") ? "，并已分配给你" : ""}`
        : `#${pullRequest.number} 已分配给你`,
      timestamp: parseGitHubTime(pullRequest.updatedAt),
      priority: reviewRequested ? PRIORITY_REVIEW_REQUEST : PRIORITY_ASSIGNED_PULL,
      target: {
        kind: "pull",
        repoFullName: githubRepo.fullName,
        localRepoId,
        number: pullRequest.number,
        state: pullRequest.state,
        merged: pullRequest.merged,
      },
      tone: reviewRequested ? "warn" : undefined,
    }));
  }

  for (const pullRequest of source.pullRequests) {
    if (!isOpenActionablePullRequest(pullRequest)) continue;
    if (attentionPullRequests.has(pullRequest.number)) continue;
    const checks = source.pullRequestChecksByPull?.[pullRequest.number] ?? [];
    const checksOverview = pullRequestChecksOverview(checks);
    items.push(createHomePendingItem({
      id: `pull-request:${githubRepo.fullName}:${pullRequest.number}`,
      kind: "pull",
      title: `PR #${pullRequest.number}`,
      detail: pullRequest.title,
      summary: `${githubRepo.fullName} · ${checksOverview.detail}`,
      reason: checksOverview.detail,
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
    }));
  }

  if (localRepo && localRepo.conflictCount === 0) {
    const dirty = localRepoDirtyCount(localRepo);
    if (dirty > 0) {
      items.push(createHomePendingItem({
        id: `operation-local-changes:${localRepo.id}:${localRevision(localRepo)}`,
        kind: "operation",
        title: "本地改动待处理",
        detail: `${dirty} 项未提交改动`,
        summary: githubRepo.fullName,
        reason: "本地未提交工作会阻塞同步与交接",
        timestamp: repoPendingTimestamp(githubRepo, localRepo),
        priority: PRIORITY_LOCAL_CHANGES,
        target: { kind: "repo", repoId: localRepo.id, view: "changes" },
        tone: "warn",
      }));
    }
  }

  for (const issue of source.issues) {
    if (issue.state !== "open") continue;
    items.push(createHomePendingItem({
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
    }));
  }

  if (localRepo && (localRepo.ahead > 0 || localRepo.behind > 0)) {
    items.push(createHomePendingItem({
      id: `operation-sync-state:${localRepo.id}:${localRepo.ahead}:${localRepo.behind}`,
      kind: "operation",
      title: "仓库同步状态",
      detail: `待处理提交 ↑${localRepo.ahead} / ↓${localRepo.behind}`,
      summary: githubRepo.fullName,
      timestamp: repoPendingTimestamp(githubRepo, localRepo),
      priority: PRIORITY_SYNC_STATE,
      target: { kind: "repo", repoId: localRepo.id },
      tone: "warn",
    }));
  }

  return items;
}

function createHomePendingItem(item: Omit<HomePendingItem, "bucket">): HomePendingItem {
  return { ...item, bucket: homePendingItemBucket(item) };
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

function localRepoDirtyCount(repo: RepoSummary) {
  return repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
}

function localRevision(repo: RepoSummary) {
  return `${repo.currentBranch ?? ""}:${repo.stagedCount}:${repo.unstagedCount}:${repo.untrackedCount}`;
}

function pullRequestPriority(tone: WorkflowRunTone | undefined) {
  if (tone === "error") return PRIORITY_PULL_CHECK_ERROR;
  if (tone === "warn") return PRIORITY_PULL_CHECK_PENDING;
  return PRIORITY_PULL_OPEN;
}

function workflowPendingPriority(run: GitHubWorkflowRun) {
  if (run.status === "completed") return PRIORITY_WORKFLOW_ERROR;
  if (workflowRunCancelAvailability(run).available) return PRIORITY_WORKFLOW_ACTIVE;
  return null;
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

function repoPendingTimestamp(
  githubRepo: Pick<GitHubRepoSummary, "updatedAt">,
  localRepo: RepoSummary,
) {
  return localRepo.lastCommitAt
    ? localRepo.lastCommitAt * 1000
    : parseGitHubTime(githubRepo.updatedAt) || 1;
}

function parseGitHubTime(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function cloneGitHubIssue(issue: GitHubIssue): GitHubIssue {
  return {
    ...issue,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
    milestone: issue.milestone ? { ...issue.milestone } : null,
    projectItems: issue.projectItems?.map((project) => ({ ...project })) ?? [],
    developmentItems: issue.developmentItems?.map((item) => ({ ...item })) ?? [],
  };
}

export function cloneGitHubPullRequest(pullRequest: GitHubPullRequest): GitHubPullRequest {
  return {
    ...pullRequest,
    labels: [...pullRequest.labels],
    assignees: [...pullRequest.assignees],
    milestone: pullRequest.milestone ? { ...pullRequest.milestone } : null,
    projectItems: pullRequest.projectItems?.map((project) => ({ ...project })) ?? [],
    reviewers: pullRequest.reviewers?.map((reviewer) => ({ ...reviewer })) ?? [],
    developmentItems: pullRequest.developmentItems?.map((item) => ({ ...item })) ?? [],
  };
}

export function replaceReposByFullName<T>(
  current: Record<string, T[] | undefined>,
  repos: readonly GitHubRepoSummary[],
  values: Record<string, T[] | undefined>,
) {
  const next = { ...current };
  for (const repo of repos) {
    next[repo.fullName] = values[repo.fullName] ?? [];
  }
  return next;
}

export function accountIssueItemToPullRequest(item: GitHubAccountIssueItem): GitHubPullRequest {
  const issue = cloneGitHubIssue(item.issue);
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    draft: false,
    body: issue.body,
    labels: issue.labels,
    assignees: issue.assignees,
    author: issue.author ?? "",
    milestone: issue.milestone ?? null,
    comments: issue.comments ?? 0,
    projectItems: issue.projectItems ?? [],
    developmentItems: issue.developmentItems ?? [],
    htmlUrl: issue.htmlUrl,
    updatedAt: issue.updatedAt,
    createdAt: issue.createdAt,
    baseBranch: "",
    headBranch: "",
    merged: false,
    mergeable: null,
    mergeableState: null,
  };
}

export function groupAccountIssuesByRepo(
  items: readonly GitHubAccountIssueItem[],
  repos: readonly GitHubRepoSummary[],
) {
  const repoNames = new Set(repos.map((repo) => repo.fullName));
  const issues: Record<string, GitHubIssue[]> = {};
  const pullRequests: Record<string, GitHubPullRequest[]> = {};
  for (const item of items) {
    if (!repoNames.has(item.repoFullName)) continue;
    if (item.pullRequest) {
      (pullRequests[item.repoFullName] ??= []).push(accountIssueItemToPullRequest(item));
    } else {
      (issues[item.repoFullName] ??= []).push(cloneGitHubIssue(item.issue));
    }
  }
  return { issues, pullRequests };
}

export function groupActionNotificationsByRepo(
  notifications: readonly GitHubActionNotification[],
  repos: readonly GitHubRepoSummary[],
) {
  const repoNames = new Set(repos.map((repo) => repo.fullName));
  const byRepo: Record<string, GitHubActionNotification[]> = {};
  for (const notification of notifications) {
    if (!repoNames.has(notification.repoFullName)) continue;
    (byRepo[notification.repoFullName] ??= []).push({ ...notification });
  }
  return byRepo;
}

export function shouldLoadHomePendingAccountIssues(
  repos: readonly GitHubRepoSummary[],
  issuesByRepo: Record<string, GitHubIssue[] | undefined>,
  pullRequestsByRepo: Record<string, GitHubPullRequest[] | undefined>,
  refresh = false,
) {
  if (!repos.length) return false;
  if (refresh) return true;
  return repos.some((repo) =>
    issuesByRepo[repo.fullName] == null ||
    pullRequestsByRepo[repo.fullName] == null,
  );
}

export function shouldLoadHomePendingActionNotifications(
  repos: readonly GitHubRepoSummary[],
  actionNotificationsByRepo: Record<string, GitHubActionNotification[] | undefined>,
  refresh = false,
) {
  if (!repos.length) return false;
  if (refresh) return true;
  return repos.some((repo) => actionNotificationsByRepo[repo.fullName] == null);
}
