import type { DiscoveryRepositoryInput } from "../discovery/types";
import type { GitHubIssue, RepoSummary } from "../workspace/types";
import {
  conflictRoute,
  issueRoute,
  pullRequestRoute,
  releaseRoute,
  repositoryRoute,
  workflowRoute,
} from "./routes";
import type { ControlCenterInput, WorkItem, WorkItemPriority } from "./types";

const PRIORITY_RANK: Record<WorkItemPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function buildWorkItems(input: ControlCenterInput): WorkItem[] {
  const now = input.now ?? Date.now();
  const repositories = repositoryLookup(input.repositories, input.localRepositories);
  const candidates: WorkItem[] = [];
  const scan = input.scan;

  for (const entry of scan?.pendingPullRequests.items ?? []) {
    const repository = repositories.get(key(entry.repoFullName));
    const reviewRequested = entry.reasons.includes("review_requested");
    candidates.push({
      id: githubItemId(entry.repoFullName, "pr", entry.pullRequest.number),
      kind: reviewRequested ? "review" : "pull_request",
      bucket: "attention",
      priority: reviewRequested ? "high" : "normal",
      prioritySource: reviewRequested ? "等待你的 Review" : "Pull Request 已分配给你",
      title: entry.pullRequest.title,
      repository: entry.repoFullName,
      repoId: repository?.id ?? null,
      reason: reviewRequested
        ? `#${entry.pullRequest.number} 请求你的审查${entry.reasons.includes("assigned") ? "，并已分配给你" : ""}`
        : `#${entry.pullRequest.number} 已分配给你`,
      nextAction: {
        label: reviewRequested ? "进入代码审查" : "查看 Pull Request",
        route: pullRequestRoute(repository?.id ?? null, entry.repoFullName, entry.pullRequest.number),
      },
      updatedAt: dateValue(entry.pullRequest.updatedAt, now),
      pinned: false,
    });
  }

  for (const entry of scan?.assignedIssues.items ?? []) {
    const repository = repositories.get(key(entry.repoFullName));
    candidates.push(issueWorkItem(entry.repoFullName, repository, entry.issue, now));
  }

  for (const entry of input.accountItems ?? []) {
    const repository = repositories.get(key(entry.repoFullName));
    const id = githubItemId(entry.repoFullName, entry.pullRequest ? "pr" : "issue", entry.issue.number);
    candidates.push({
      id,
      kind: entry.pullRequest ? "pull_request" : "issue",
      bucket: entry.pullRequest ? "attention" : "today",
      priority: entry.pullRequest ? "high" : "normal",
      prioritySource: "GitHub 分配状态",
      title: entry.issue.title,
      repository: entry.repoFullName,
      repoId: repository?.id ?? null,
      reason: `#${entry.issue.number} 已分配给你`,
      nextAction: {
        label: entry.pullRequest ? "查看 Pull Request" : "处理 Issue",
        route: entry.pullRequest
          ? pullRequestRoute(repository?.id ?? null, entry.repoFullName, entry.issue.number)
          : issueRoute(repository?.id ?? null, entry.repoFullName, entry.issue.number),
      },
      updatedAt: dateValue(entry.issue.updatedAt, now),
      pinned: false,
    });
  }

  for (const entry of scan?.failedWorkflows.items ?? []) {
    const repository = repositories.get(key(entry.repoFullName));
    const id = githubItemId(entry.repoFullName, "workflow", entry.run.id);
    candidates.push({
      id,
      kind: "workflow",
      bucket: "attention",
      priority: "critical",
      prioritySource: "Workflow 失败",
      title: entry.run.displayTitle || entry.run.name,
      repository: entry.repoFullName,
      repoId: repository?.id ?? null,
      reason: `${entry.run.branch || "默认分支"} 的运行结果为 ${entry.run.conclusion ?? "失败"}`,
      nextAction: {
        label: "查看失败步骤",
        route: workflowRoute(repository?.id ?? null, entry.repoFullName, entry.run.id),
      },
      updatedAt: dateValue(entry.run.updatedAt, now),
      pinned: false,
    });
  }

  for (const entry of scan?.recentReleases.items ?? []) {
    const repository = repositories.get(key(entry.repoFullName));
    const id = githubItemId(entry.repoFullName, "release", entry.release.id);
    candidates.push({
      id,
      kind: "release",
      bucket: "today",
      priority: entry.release.draft ? "normal" : "low",
      prioritySource: entry.release.draft ? "Release 草稿" : "近期发布",
      title: entry.release.name || entry.release.tagName,
      repository: entry.repoFullName,
      repoId: repository?.id ?? null,
      reason: entry.release.draft ? `${entry.release.tagName} 仍是草稿` : `${entry.release.tagName} 已发布，可核对发布结果`,
      nextAction: {
        label: "查看 Release",
        route: releaseRoute(repository?.id ?? null, entry.repoFullName, entry.release.tagName),
      },
      updatedAt: dateValue(entry.release.publishedAt ?? entry.release.createdAt, now),
      pinned: false,
    });
  }

  for (const repository of input.localRepositories) {
    const dirty = repository.stagedCount + repository.unstagedCount + repository.untrackedCount;
    const syncSignals = repository.ahead + repository.behind + repository.remotesNeedingPull + repository.remotesNeedingPush;
    if (!repository.conflictCount && !dirty && !syncSignals) continue;
    const repoName = repository.githubFullName || repository.name;
    const id = `local:${repository.id}:worktree`;
    if (repository.conflictCount) {
      candidates.push({
        id,
        kind: "sync_conflict",
        bucket: "attention",
        priority: "critical",
        prioritySource: "Git 冲突阻塞",
        title: `${repository.name} 存在未解决冲突`,
        repository: repoName,
        repoId: repository.id,
        reason: `${repository.conflictCount} 个冲突文件${dirty ? `，工作区另有 ${dirty} 项改动` : ""}`,
        nextAction: { label: "继续解决冲突", route: conflictRoute(repository.id) },
        updatedAt: repository.lastCommitAt ?? now,
        sourceRevision: localRevision(repository),
        pinned: false,
      });
      continue;
    }
    candidates.push({
      id,
      kind: "local_changes",
      bucket: dirty ? "attention" : "today",
      priority: dirty ? "high" : "normal",
      prioritySource: dirty ? "本地未提交工作" : "分支同步状态",
      title: dirty ? `${repository.name} 有未提交工作` : `${repository.name} 需要同步`,
      repository: repoName,
      repoId: repository.id,
      reason: localRepositoryReason(repository, dirty),
      nextAction: {
        label: dirty ? "继续本地工作" : "查看同步状态",
        route: repositoryRoute(repository.id, repoName, dirty ? "changes" : "repo"),
      },
      updatedAt: repository.lastCommitAt ?? now,
      sourceRevision: localRevision(repository),
      pinned: false,
    });
  }

  return stableSortWorkItems(dedupeWorkItems(candidates));
}

export function dedupeWorkItems(items: readonly WorkItem[]) {
  const byId = new Map<string, WorkItem>();
  for (const item of items) {
    const current = byId.get(item.id);
    if (!current) {
      byId.set(item.id, item);
      continue;
    }
    const preferred = compareWorkItems(item, current) < 0 ? item : current;
    const other = preferred === item ? current : item;
    byId.set(item.id, {
      ...preferred,
      reason: preferred.reason === other.reason ? preferred.reason : `${preferred.reason}；${other.reason}`,
      updatedAt: Math.max(preferred.updatedAt, other.updatedAt),
    });
  }
  return [...byId.values()];
}

export function stableSortWorkItems(items: readonly WorkItem[]) {
  return [...items].sort(compareWorkItems);
}

function compareWorkItems(left: WorkItem, right: WorkItem) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const bucket = bucketRank(left.bucket) - bucketRank(right.bucket);
  if (bucket) return bucket;
  const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priority) return priority;
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
  return left.id.localeCompare(right.id);
}

function issueWorkItem(
  repoFullName: string,
  repository: RepoSummary | undefined,
  issue: GitHubIssue,
  now: number,
): WorkItem {
  const id = githubItemId(repoFullName, "issue", issue.number);
  return {
    id,
    kind: "issue",
    bucket: "today",
    priority: "normal",
    prioritySource: "Issue 已分配给你",
    title: issue.title,
    repository: repoFullName,
    repoId: repository?.id ?? null,
    reason: `#${issue.number} 等待推进`,
    nextAction: { label: "处理 Issue", route: issueRoute(repository?.id ?? null, repoFullName, issue.number) },
    updatedAt: dateValue(issue.updatedAt, now),
    pinned: false,
  };
}

function repositoryLookup(inputs: readonly DiscoveryRepositoryInput[], locals: readonly RepoSummary[]) {
  const map = new Map<string, RepoSummary>();
  for (const repository of locals) {
    if (repository.githubFullName) map.set(key(repository.githubFullName), repository);
  }
  for (const input of inputs) {
    if (input.localRepo) map.set(key(input.fullName), input.localRepo);
  }
  return map;
}

function localRepositoryReason(repository: RepoSummary, dirty: number) {
  const parts = [
    dirty ? `${dirty} 项未提交改动` : null,
    repository.ahead ? `领先 ${repository.ahead}` : null,
    repository.behind ? `落后 ${repository.behind}` : null,
    repository.remotesNeedingPull ? `${repository.remotesNeedingPull} 个远端待拉取` : null,
    repository.remotesNeedingPush ? `${repository.remotesNeedingPush} 个远端待推送` : null,
  ].filter(Boolean);
  return parts.join("，") || "仓库需要检查";
}

function localRevision(repository: RepoSummary) {
  return [
    repository.currentBranch ?? "",
    repository.stagedCount,
    repository.unstagedCount,
    repository.untrackedCount,
    repository.conflictCount,
    repository.ahead,
    repository.behind,
    repository.remotesNeedingPull,
    repository.remotesNeedingPush,
  ].join(":");
}

function githubItemId(repository: string, kind: string, id: string | number) {
  return `github:${key(repository)}:${kind}:${id}`;
}

function key(value: string) {
  return value.trim().toLocaleLowerCase();
}

function bucketRank(bucket: WorkItem["bucket"]) {
  return bucket === "attention" ? 0 : 1;
}

function dateValue(value: string | null | undefined, fallback: number) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}
