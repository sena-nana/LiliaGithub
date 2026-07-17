import { listGitHubReleases } from "../workspace/client";
import { aggregateRepositories } from "./aggregate";
import {
  compareDatesDescending,
  DISCOVERY_SOURCE_PAGE_SIZE,
  isRecentPublishedRelease,
} from "./rules";
import type { DiscoveryAggregateResult, DiscoveryLoadOptions, DiscoveryRecentRelease } from "./types";

export async function loadDiscoveryRecentReleases(
  repoFullNames: readonly string[],
  options: DiscoveryLoadOptions = {},
): Promise<DiscoveryAggregateResult<DiscoveryRecentRelease>> {
  const now = options.now ?? new Date();
  const result = await aggregateRepositories(repoFullNames, async (repoFullName) => {
    const releases = await listGitHubReleases(
      repoFullName,
      { forceRefresh: options.forceRefresh },
    );
    return {
      items: releases
        .filter((release) => isRecentPublishedRelease(release, now))
        .map((release) => ({ repoFullName, release })),
      truncated: releases.length >= DISCOVERY_SOURCE_PAGE_SIZE,
    };
  });
  result.items.sort((left, right) => compareDatesDescending(
    left.release.publishedAt ?? left.release.createdAt,
    right.release.publishedAt ?? right.release.createdAt,
  ));
  return result;
}
