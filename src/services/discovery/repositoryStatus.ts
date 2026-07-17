import { aggregateRepositories } from "./aggregate";
import { getGitHubDiscoveryRepositoryStatus } from "./client";
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
      status: await getGitHubDiscoveryRepositoryStatus(repoFullName, options),
    }],
    truncated: false,
  }));
}
