import { listGitHubPullRequests, listGitHubWorkflowRuns } from "../workspace/client";
import type { GitHubPullRequest, GitHubWorkflowRun } from "../workspace/types";
import type {
  HomeAttentionFailedWorkflowRun,
  HomeAttentionLoadOptions,
  HomeAttentionPendingPullRequest,
  HomeAttentionPullRequestReason,
  HomeAttentionRepositoryFailure,
  HomeAttentionResult,
  HomeAttentionSection,
} from "./types";

const ACTIONABLE_WORKFLOW_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
]);
const SOURCE_PAGE_SIZE = 100;
const RECENT_DAYS = 30;

interface HomeAttentionFallbackOptions extends HomeAttentionLoadOptions {
  now?: Date;
}

export async function listHomeAttentionFallback(
  repoFullNames: readonly string[],
  options: HomeAttentionFallbackOptions = {},
): Promise<HomeAttentionResult> {
  const [pendingPullRequests, failedWorkflows] = await Promise.all([
    loadPendingPullRequests(repoFullNames, options),
    loadFailedWorkflows(repoFullNames, options),
  ]);
  return { pendingPullRequests, failedWorkflows };
}

async function loadPendingPullRequests(
  repoFullNames: readonly string[],
  options: HomeAttentionFallbackOptions,
) {
  const result = await aggregateHomeAttentionRepositories<HomeAttentionPendingPullRequest>(
    repoFullNames,
    async (repoFullName) => {
      const listOptions = {
        state: "open" as const,
        perPage: SOURCE_PAGE_SIZE,
        sort: "updated" as const,
        direction: "desc" as const,
      };
      const [reviewRequested, assigned] = await Promise.all([
        listGitHubPullRequests(
          repoFullName,
          { ...listOptions, query: "review-requested:@me" },
          { forceRefresh: options.forceRefresh },
        ),
        listGitHubPullRequests(
          repoFullName,
          { ...listOptions, assignee: "@me" },
          { forceRefresh: options.forceRefresh },
        ),
      ]);
      const items = mergeHomeAttentionPullRequestCandidates(reviewRequested, assigned)
        .map((candidate) => ({ repoFullName, ...candidate }));
      return {
        items,
        truncated: reviewRequested.length >= SOURCE_PAGE_SIZE || assigned.length >= SOURCE_PAGE_SIZE,
      };
    },
  );
  result.items.sort((left, right) => compareHomeAttentionDates(
    left.pullRequest.updatedAt,
    right.pullRequest.updatedAt,
  ));
  return result;
}

async function loadFailedWorkflows(
  repoFullNames: readonly string[],
  options: HomeAttentionFallbackOptions,
) {
  const now = options.now ?? new Date();
  const result = await aggregateHomeAttentionRepositories<HomeAttentionFailedWorkflowRun>(
    repoFullNames,
    async (repoFullName) => {
      const runs = await listGitHubWorkflowRuns(
        repoFullName,
        SOURCE_PAGE_SIZE,
        { forceRefresh: options.forceRefresh },
      );
      return {
        items: runs
          .filter((run) => isRecentHomeAttentionWorkflowRun(run, now))
          .map((run) => ({ repoFullName, run })),
        truncated: runs.length >= SOURCE_PAGE_SIZE,
      };
    },
  );
  result.items.sort((left, right) => compareHomeAttentionDates(left.run.updatedAt, right.run.updatedAt));
  return result;
}

export function mergeHomeAttentionPullRequestCandidates(
  reviewRequested: readonly GitHubPullRequest[],
  assigned: readonly GitHubPullRequest[],
) {
  const candidates = new Map<number, {
    pullRequest: GitHubPullRequest;
    reasons: HomeAttentionPullRequestReason[];
  }>();
  addPullRequestCandidates(candidates, reviewRequested, "review_requested");
  addPullRequestCandidates(candidates, assigned, "assigned");
  return [...candidates.values()]
    .filter(({ pullRequest }) => pullRequest.state === "open" && !pullRequest.draft)
    .sort((left, right) => compareHomeAttentionDates(left.pullRequest.updatedAt, right.pullRequest.updatedAt));
}

export function isRecentHomeAttentionWorkflowRun(run: GitHubWorkflowRun, now: Date) {
  return ACTIONABLE_WORKFLOW_CONCLUSIONS.has(run.conclusion ?? "")
    && isWithinRecentWindow(run.updatedAt || run.createdAt, now);
}

async function aggregateHomeAttentionRepositories<T>(
  repoFullNames: readonly string[],
  load: (repoFullName: string) => Promise<{ items: T[]; truncated: boolean }>,
): Promise<HomeAttentionSection<T>> {
  const repositories = [...repoFullNames];
  const settled = await Promise.all(repositories.map(async (repoFullName) => {
    try {
      return { repoFullName, value: await load(repoFullName) } as const;
    } catch (error) {
      return { repoFullName, error } as const;
    }
  }));
  const items: T[] = [];
  const failures: HomeAttentionRepositoryFailure[] = [];
  let truncated = false;
  for (const entry of settled) {
    if ("error" in entry) {
      failures.push({
        repoFullName: entry.repoFullName,
        message: entry.error instanceof Error ? entry.error.message : String(entry.error),
      });
    } else {
      items.push(...entry.value.items);
      truncated ||= entry.value.truncated;
    }
  }
  return {
    items,
    failures,
    truncated,
    requestedRepositoryCount: repositories.length,
    successfulRepositoryCount: repositories.length - failures.length,
  };
}

function addPullRequestCandidates(
  target: Map<number, { pullRequest: GitHubPullRequest; reasons: HomeAttentionPullRequestReason[] }>,
  pulls: readonly GitHubPullRequest[],
  reason: HomeAttentionPullRequestReason,
) {
  for (const pullRequest of pulls) {
    const current = target.get(pullRequest.number);
    if (current) {
      if (!current.reasons.includes(reason)) current.reasons.push(reason);
    } else {
      target.set(pullRequest.number, { pullRequest, reasons: [reason] });
    }
  }
}

function compareHomeAttentionDates(left: string, right: string) {
  return timestamp(right) - timestamp(left);
}

function isWithinRecentWindow(value: string, now: Date) {
  const valueTime = timestamp(value);
  const nowTime = now.getTime();
  if (!Number.isFinite(valueTime) || !Number.isFinite(nowTime)) return false;
  const cutoff = nowTime - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return valueTime >= cutoff && valueTime <= nowTime;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
