import { listGitHubWorkflowRuns } from "../workspace/client";
import { aggregateRepositories } from "./aggregate";
import {
  compareDatesDescending,
  DISCOVERY_SOURCE_PAGE_SIZE,
  isRecentActionableWorkflowRun,
} from "./rules";
import type { DiscoveryAggregateResult, DiscoveryFailedWorkflowRun, DiscoveryLoadOptions } from "./types";

export async function loadDiscoveryFailedWorkflowRuns(
  repoFullNames: readonly string[],
  options: DiscoveryLoadOptions = {},
): Promise<DiscoveryAggregateResult<DiscoveryFailedWorkflowRun>> {
  const now = options.now ?? new Date();
  const result = await aggregateRepositories(repoFullNames, async (repoFullName) => {
    const runs = await listGitHubWorkflowRuns(
      repoFullName,
      DISCOVERY_SOURCE_PAGE_SIZE,
      { forceRefresh: options.forceRefresh },
    );
    return {
      items: runs
        .filter((run) => isRecentActionableWorkflowRun(run, now))
        .map((run) => ({ repoFullName, run })),
      truncated: runs.length >= DISCOVERY_SOURCE_PAGE_SIZE,
    };
  });
  result.items.sort((left, right) => compareDatesDescending(left.run.updatedAt, right.run.updatedAt));
  return result;
}
