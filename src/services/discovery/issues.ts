import { listGitHubIssues } from "../workspace/client";
import { aggregateRepositories } from "./aggregate";
import { discoveryRequestLimiter } from "./concurrency";
import { compareDatesDescending, DISCOVERY_SOURCE_PAGE_SIZE, isAssignedOpenIssue } from "./rules";
import type { DiscoveryAggregateResult, DiscoveryAssignedIssue, DiscoveryLoadOptions } from "./types";

export async function loadDiscoveryAssignedIssues(
  repoFullNames: readonly string[],
  options: DiscoveryLoadOptions = {},
): Promise<DiscoveryAggregateResult<DiscoveryAssignedIssue>> {
  const result = await aggregateRepositories(repoFullNames, async (repoFullName) => {
    const issues = await discoveryRequestLimiter.run(() => listGitHubIssues(repoFullName, {
      state: "open",
      assignee: "@me",
      perPage: DISCOVERY_SOURCE_PAGE_SIZE,
      sort: "updated",
      direction: "desc",
    }, { forceRefresh: options.forceRefresh }));
    return {
      items: issues.filter(isAssignedOpenIssue).map((issue) => ({ repoFullName, issue })),
      truncated: issues.length >= DISCOVERY_SOURCE_PAGE_SIZE,
    };
  });
  result.items.sort((left, right) => compareDatesDescending(left.issue.updatedAt, right.issue.updatedAt));
  return result;
}
