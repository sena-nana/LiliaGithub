import type { DiscoveryAggregateResult, DiscoveryRepositoryFailure } from "./types";

interface RepositoryItems<T> {
  items: T[];
  truncated: boolean;
}

export function normalizeRepositoryBatch(repoFullNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of repoFullNames) {
    const repoFullName = value.trim();
    const key = repoFullName.toLowerCase();
    if (!repoFullName || seen.has(key)) continue;
    seen.add(key);
    result.push(repoFullName);
  }
  return result;
}

export async function aggregateRepositories<T>(
  repoFullNames: readonly string[],
  load: (repoFullName: string) => Promise<RepositoryItems<T>>,
): Promise<DiscoveryAggregateResult<T>> {
  const repositories = normalizeRepositoryBatch(repoFullNames);
  const settled = await Promise.all(repositories.map(async (repoFullName) => {
    try {
      return { repoFullName, value: await load(repoFullName) } as const;
    } catch (error) {
      return { repoFullName, error } as const;
    }
  }));
  const items: T[] = [];
  const failures: DiscoveryRepositoryFailure[] = [];
  let truncated = false;

  for (const entry of settled) {
    if ("error" in entry) {
      failures.push({ repoFullName: entry.repoFullName, message: errorMessage(entry.error) });
      continue;
    }
    items.push(...entry.value.items);
    truncated ||= entry.value.truncated;
  }

  return {
    items,
    failures,
    truncated,
    requestedRepositoryCount: repositories.length,
    successfulRepositoryCount: repositories.length - failures.length,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
