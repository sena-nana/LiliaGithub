import type { GitHubIssue, GitHubPullRequest, GitHubRelease, GitHubWorkflowRun } from "../workspace/types";
import type { DiscoveryPullRequestReason } from "./types";

const ACTIONABLE_WORKFLOW_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
]);

export const DISCOVERY_SOURCE_PAGE_SIZE = 100;
export const DISCOVERY_RECENT_DAYS = 30;

export interface PendingPullRequestCandidate {
  pullRequest: GitHubPullRequest;
  reasons: DiscoveryPullRequestReason[];
}

export function mergePendingPullRequestCandidates(
  reviewRequested: readonly GitHubPullRequest[],
  assigned: readonly GitHubPullRequest[],
): PendingPullRequestCandidate[] {
  const candidates = new Map<number, PendingPullRequestCandidate>();
  addCandidates(candidates, reviewRequested, "review_requested");
  addCandidates(candidates, assigned, "assigned");
  return [...candidates.values()]
    .filter(({ pullRequest }) => pullRequest.state === "open" && !pullRequest.draft)
    .sort((left, right) => compareDatesDescending(left.pullRequest.updatedAt, right.pullRequest.updatedAt));
}

export function isAssignedOpenIssue(issue: GitHubIssue): boolean {
  return issue.state === "open" && !/\/pull\/\d+(?:[/?#]|$)/i.test(issue.htmlUrl);
}

export function isRecentActionableWorkflowRun(run: GitHubWorkflowRun, now: Date): boolean {
  return ACTIONABLE_WORKFLOW_CONCLUSIONS.has(run.conclusion ?? "")
    && isWithinRecentWindow(run.updatedAt || run.createdAt, now, DISCOVERY_RECENT_DAYS);
}

export function isRecentPublishedRelease(release: GitHubRelease, now: Date): boolean {
  return !release.draft
    && release.publishedAt != null
    && isWithinRecentWindow(release.publishedAt, now, DISCOVERY_RECENT_DAYS);
}

export function compareDatesDescending(left: string, right: string): number {
  return timestamp(right) - timestamp(left);
}

function addCandidates(
  target: Map<number, PendingPullRequestCandidate>,
  pulls: readonly GitHubPullRequest[],
  reason: DiscoveryPullRequestReason,
) {
  for (const pullRequest of pulls) {
    const current = target.get(pullRequest.number);
    if (current) {
      if (!current.reasons.includes(reason)) current.reasons.push(reason);
      continue;
    }
    target.set(pullRequest.number, { pullRequest, reasons: [reason] });
  }
}

function isWithinRecentWindow(value: string, now: Date, days: number): boolean {
  const valueTime = timestamp(value);
  const nowTime = now.getTime();
  if (!Number.isFinite(valueTime) || !Number.isFinite(nowTime)) return false;
  const cutoff = nowTime - days * 24 * 60 * 60 * 1000;
  return valueTime >= cutoff && valueTime <= nowTime;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
