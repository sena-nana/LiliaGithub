import { aggregateRepositories } from "./aggregate";
import { getGitHubDiscoveryRepositoryStatus } from "./client";
import { discoveryRequestLimiter } from "./concurrency";
import type {
  DiscoveryAggregateResult,
  DiscoveryLoadOptions,
  DiscoveryRepositoryStatusItem,
} from "./types";

export function loadDiscoveryRepositoryStatuses(
  repoFullNames: readonly string[],
  options: DiscoveryLoadOptions = {},
): Promise<DiscoveryAggregateResult<DiscoveryRepositoryStatusItem>> {
  return aggregateRepositories(repoFullNames, async (repoFullName) => ({
    items: [{
      repoFullName,
      status: await discoveryRequestLimiter.run(() =>
        getGitHubDiscoveryRepositoryStatus(repoFullName, options)),
    }],
    truncated: false,
  }));
}
