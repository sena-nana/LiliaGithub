import { getGitHubPullRequest, listGitHubPullRequests } from "../workspace/client";
import { aggregateRepositories } from "./aggregate";
import { compareDatesDescending, DISCOVERY_SOURCE_PAGE_SIZE, mergePendingPullRequestCandidates } from "./rules";
import type { DiscoveryAggregateResult, DiscoveryLoadOptions, DiscoveryPendingPullRequest } from "./types";

export async function loadDiscoveryPendingPullRequests(
  repoFullNames: readonly string[],
  options: DiscoveryLoadOptions = {},
): Promise<DiscoveryAggregateResult<DiscoveryPendingPullRequest>> {
  const result = await aggregateRepositories(repoFullNames, async (repoFullName) => {
    const fetchOptions = { forceRefresh: options.forceRefresh };
    const baseOptions = {
      state: "open" as const,
      perPage: DISCOVERY_SOURCE_PAGE_SIZE,
      sort: "updated" as const,
      direction: "desc" as const,
    };
    const [reviewRequested, assigned] = await Promise.all([
      listGitHubPullRequests(
        repoFullName,
        { ...baseOptions, query: "review-requested:@me" },
        fetchOptions,
      ),
      listGitHubPullRequests(
        repoFullName,
        { ...baseOptions, assignee: "@me" },
        fetchOptions,
      ),
    ]);
    const candidates = mergePendingPullRequestCandidates(reviewRequested, assigned);
    const items = await Promise.all(candidates.map(async (candidate) => ({
      repoFullName,
      pullRequest: await getGitHubPullRequest(repoFullName, candidate.pullRequest.number),
      reasons: candidate.reasons,
    })));
    return {
      items: items.filter(({ pullRequest }) => pullRequest.state === "open" && !pullRequest.draft),
      truncated: reviewRequested.length >= DISCOVERY_SOURCE_PAGE_SIZE
        || assigned.length >= DISCOVERY_SOURCE_PAGE_SIZE,
    };
  });
  result.items.sort((left, right) => compareDatesDescending(
    left.pullRequest.updatedAt,
    right.pullRequest.updatedAt,
  ));
  return result;
}
