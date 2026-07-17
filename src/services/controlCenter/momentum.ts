import type { DiscoveryRepositoryInput, DiscoveryScanResult } from "../discovery/types";
import type { RepoSummary } from "../workspace/types";
import { conflictRoute, pullRequestRoute, releaseRoute, repositoryRoute, workflowRoute } from "./routes";
import type { ProjectMomentum, ProjectMomentumReason, ProjectMomentumState } from "./types";

const INACTIVE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
const STALE_REVIEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function buildProjectMomentum(input: {
  repositories: readonly DiscoveryRepositoryInput[];
  localRepositories: readonly RepoSummary[];
  scan: DiscoveryScanResult | null;
  now?: number;
}): ProjectMomentum[] {
  const now = input.now ?? Date.now();
  const repositories = new Map<string, { fullName: string; local: RepoSummary | null; updatedAt: number }>();
  for (const entry of input.repositories) {
    repositories.set(key(entry.fullName), {
      fullName: entry.fullName,
      local: entry.localRepo,
      updatedAt: dateValue(entry.remote?.updatedAt, entry.localRepo?.lastCommitAt ?? 0),
    });
  }
  for (const local of input.localRepositories) {
    const fullName = local.githubFullName || local.name;
    const current = repositories.get(key(fullName));
    repositories.set(key(fullName), {
      fullName: current?.fullName ?? fullName,
      local,
      updatedAt: Math.max(current?.updatedAt ?? 0, local.lastCommitAt ?? 0),
    });
  }

  return [...repositories.values()].map((repository) => {
    const repoId = repository.local?.id ?? remoteId(repository.fullName);
    const reasons: ProjectMomentumReason[] = [];
    const failedRuns = input.scan?.failedWorkflows.items.filter((item) => key(item.repoFullName) === key(repository.fullName)) ?? [];
    const pullRequests = input.scan?.pendingPullRequests.items.filter((item) => key(item.repoFullName) === key(repository.fullName)) ?? [];
    const releases = input.scan?.recentReleases.items.filter((item) => key(item.repoFullName) === key(repository.fullName)) ?? [];
    const local = repository.local;
    const dirty = local ? local.stagedCount + local.unstagedCount + local.untrackedCount : 0;

    if (local?.conflictCount) reasons.push(reason("conflicts", `${local.conflictCount} 个 Git 冲突待处理`, "danger"));
    if (failedRuns.length) reasons.push(reason("workflow", `${failedRuns.length} 个失败 Workflow`, "danger"));
    if (pullRequests.some((item) => item.pullRequest.mergeable === false || item.pullRequest.mergeableState === "dirty")) {
      reasons.push(reason("blocked-pr", "Pull Request 被合并冲突阻塞", "danger"));
    }
    const staleReviews = pullRequests.filter((item) =>
      item.reasons.includes("review_requested") && now - dateValue(item.pullRequest.updatedAt, now) >= STALE_REVIEW_AFTER_MS
    );
    if (staleReviews.length) reasons.push(reason("stale-review", `${staleReviews.length} 个 Review 已等待超过 7 天`, "warning"));
    if (dirty) reasons.push(reason("dirty", `${dirty} 项本地改动尚未提交`, "warning"));
    if (local?.behind || local?.remotesNeedingPull) reasons.push(reason("behind", "本地分支落后远端", "warning"));
    if (local?.ahead || local?.remotesNeedingPush) reasons.push(reason("ahead", "本地提交尚未全部推送", "normal"));
    const latestRelease = releases[0];
    if (latestRelease) {
      reasons.push(reason(
        "recent-release",
        latestRelease.release.draft ? `${latestRelease.release.tagName} 仍是发布草稿` : `近期已发布 ${latestRelease.release.tagName}`,
        latestRelease.release.draft ? "warning" : "normal",
      ));
    }

    const state = momentumState(reasons, repository.updatedAt, now);
    if (!reasons.length) {
      reasons.push(state === "inactive"
        ? reason("inactive", "超过 90 天没有可见活动", "normal")
        : reason("healthy", "没有发现阻塞或待处理风险", "normal"));
    }
    const action = nextMomentumAction(repository.fullName, local, failedRuns, pullRequests, releases, state);
    return {
      repository: repository.fullName,
      repoId,
      state,
      reasons,
      nextAction: action,
      updatedAt: repository.updatedAt,
    };
  }).sort((left, right) => {
    const stateDelta = stateRank(left.state) - stateRank(right.state);
    if (stateDelta) return stateDelta;
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.repository.localeCompare(right.repository);
  });
}

function momentumState(reasons: readonly ProjectMomentumReason[], updatedAt: number, now: number): ProjectMomentumState {
  if (reasons.some((item) => item.tone === "danger")) return "blocked";
  if (reasons.some((item) => item.tone === "warning")) return "attention";
  if (updatedAt <= 0 || now - updatedAt >= INACTIVE_AFTER_MS) return "inactive";
  return "healthy";
}

function nextMomentumAction(
  fullName: string,
  local: RepoSummary | null,
  failedRuns: NonNullable<DiscoveryScanResult>["failedWorkflows"]["items"],
  pullRequests: NonNullable<DiscoveryScanResult>["pendingPullRequests"]["items"],
  releases: NonNullable<DiscoveryScanResult>["recentReleases"]["items"],
  state: ProjectMomentumState,
) {
  if (local?.conflictCount) return { label: "处理冲突", route: conflictRoute(local.id) };
  const failed = failedRuns[0];
  if (failed) return { label: "查看失败运行", route: workflowRoute(local?.id ?? null, fullName, failed.run.id) };
  const blockedPull = pullRequests.find((item) => item.pullRequest.mergeable === false || item.pullRequest.mergeableState === "dirty")
    ?? pullRequests[0];
  if (blockedPull) {
    return {
      label: "查看 Pull Request",
      route: pullRequestRoute(local?.id ?? null, fullName, blockedPull.pullRequest.number),
    };
  }
  const release = releases[0];
  if (release) return { label: "查看近期发布", route: releaseRoute(local?.id ?? null, fullName, release.release.tagName) };
  return {
    label: state === "inactive" ? "打开仓库" : "查看仓库状态",
    route: repositoryRoute(local?.id ?? null, fullName),
  };
}

function reason(id: string, label: string, tone: ProjectMomentumReason["tone"]): ProjectMomentumReason {
  return { id, label, tone };
}

function key(value: string) {
  return value.trim().toLocaleLowerCase();
}

function remoteId(fullName: string) {
  return `github:${fullName}`;
}

function dateValue(value: string | null | undefined, fallback: number) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stateRank(state: ProjectMomentumState) {
  return { blocked: 0, attention: 1, healthy: 2, inactive: 3 }[state];
}
