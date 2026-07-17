import { onUnmounted, ref, watch, type Ref } from "vue";
import type { DiscoveryRepositoryInput, DiscoverySectionResult } from "../../components/discovery/types";

export interface DiscoverySectionProps {
  repositories: readonly DiscoveryRepositoryInput[];
  login?: string;
  refreshToken?: number;
}

export function useDiscoverySection<T>(
  props: DiscoverySectionProps,
  loader: (forceRefresh: boolean) => Promise<DiscoverySectionResult<T>>,
) {
  const result = ref<DiscoverySectionResult<T> | null>(null) as Ref<DiscoverySectionResult<T> | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  let generation = 0;

  async function load(forceRefresh = false) {
    const current = ++generation;
    if (!props.repositories.length) {
      result.value = { items: [], failures: [], truncated: false };
      error.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const next = await loader(forceRefresh);
      if (generation === current) result.value = next;
    } catch (reason) {
      if (generation === current) {
        error.value = reason instanceof Error ? reason.message : String(reason);
      }
    } finally {
      if (generation === current) loading.value = false;
    }
  }

  watch(
    () => [
      props.repositories.map((repo) => repo.fullName.toLocaleLowerCase()).join("\n"),
      props.login ?? "",
      props.refreshToken ?? 0,
    ] as const,
    ([, , refreshToken], previous) => void load(Boolean(previous && refreshToken !== previous[2])),
    { immediate: true },
  );

  onUnmounted(() => { generation += 1; });

  return { result, loading, error, load };
}
