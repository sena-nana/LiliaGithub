export * from "./types";

import { createCachedAsyncModule } from "../../utils/asyncModule";
import { call } from "../workspace/client";
import type {
  HomeAttentionLoadOptions,
  HomeAttentionResult,
  HomeAttentionSection,
} from "./types";

const fallbackModule = createCachedAsyncModule(() => import("./fallback"));

export function listGitHubHomeAttention(
  repoFullNames: readonly string[],
  options: HomeAttentionLoadOptions = {},
): Promise<HomeAttentionResult> {
  const repositories = normalizeRepositories(repoFullNames);
  return call(
    "github_list_home_attention",
    {
      repoFullNames: repositories,
      forceRefresh: options.forceRefresh ?? null,
    },
    async () => (await fallbackModule.load()).listHomeAttentionFallback(repositories, options),
  );
}

export function mergeHomeAttentionResult(
  previous: HomeAttentionResult | null,
  next: HomeAttentionResult,
): HomeAttentionResult {
  if (!previous) return next;
  return {
    pendingPullRequests: preserveFailedRepositoryItems(
      previous.pendingPullRequests,
      next.pendingPullRequests,
      (item) => `${item.repoFullName.toLocaleLowerCase()}:${item.pullRequest.number}`,
    ),
    failedWorkflows: preserveFailedRepositoryItems(
      previous.failedWorkflows,
      next.failedWorkflows,
      (item) => `${item.repoFullName.toLocaleLowerCase()}:${item.run.id}`,
    ),
  };
}

function normalizeRepositories(repoFullNames: readonly string[]) {
  const seen = new Set<string>();
  return repoFullNames.flatMap((value) => {
    const repoFullName = value.trim();
    const key = repoFullName.toLocaleLowerCase();
    if (!repoFullName || seen.has(key)) return [];
    seen.add(key);
    return [repoFullName];
  });
}

function preserveFailedRepositoryItems<T extends { repoFullName: string }>(
  previous: HomeAttentionSection<T>,
  next: HomeAttentionSection<T>,
  key: (item: T) => string,
): HomeAttentionSection<T> {
  const failedRepos = new Set(next.failures.map((failure) => failure.repoFullName.toLocaleLowerCase()));
  if (!failedRepos.size) return next;
  const items = [
    ...next.items,
    ...previous.items.filter((item) => failedRepos.has(item.repoFullName.toLocaleLowerCase())),
  ];
  return {
    ...next,
    items: [...new Map(items.map((item) => [key(item), item])).values()],
  };
}
