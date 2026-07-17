import { onUnmounted, ref, watch, type Ref } from "vue";
import { scanGitHubDiscovery } from "../../services/discovery/client";
import type {
  DiscoveryRepositoryInput,
  DiscoveryScanResult,
} from "../../services/discovery/types";

export function useDiscoveryScan(
  repositories: Readonly<Ref<readonly DiscoveryRepositoryInput[]>>,
  refreshToken: Readonly<Ref<number>>,
) {
  const result = ref<DiscoveryScanResult | null>(null) as Ref<DiscoveryScanResult | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  let generation = 0;

  async function load(forceRefresh = false) {
    const current = ++generation;
    const repoFullNames = repositories.value.map((repository) => repository.fullName);
    if (!repoFullNames.length) {
      result.value = emptyDiscoveryScan();
      loading.value = false;
      error.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const next = await scanGitHubDiscovery(repoFullNames, { forceRefresh });
      if (current === generation) result.value = next;
    } catch (reason) {
      if (current === generation) error.value = reason instanceof Error ? reason.message : String(reason);
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  watch(
    () => [
      repositories.value.map((repository) => repository.fullName.toLocaleLowerCase()).join("\n"),
      refreshToken.value,
    ] as const,
    ([, token], previous) => void load(Boolean(previous && token !== previous[1])),
    { immediate: true },
  );
  onUnmounted(() => { generation += 1; });

  return { result, loading, error, load };
}

function emptyDiscoveryScan(): DiscoveryScanResult {
  const section = () => ({
    items: [],
    failures: [],
    truncated: false,
    requestedRepositoryCount: 0,
    successfulRepositoryCount: 0,
  });
  return {
    pendingPullRequests: section(),
    assignedIssues: section(),
    failedWorkflows: section(),
    recentReleases: section(),
    repositoryStatuses: section(),
  };
}
