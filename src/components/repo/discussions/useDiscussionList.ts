import { computed, reactive, ref } from "vue";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import {
  getGitHubRepositoryDiscussionMetadata,
  listGitHubRepositoryDiscussions,
} from "../../../services/workspace/discussions/client";
import type {
  GitHubRepositoryDiscussionDirection,
  GitHubRepositoryDiscussionMetadata,
  GitHubRepositoryDiscussionSort,
  GitHubRepositoryDiscussionState,
  GitHubRepositoryDiscussionSummary,
} from "../../../services/workspace/discussions/types";

const PAGE_SIZE = 25;

export function useDiscussionList(repoFullName: string) {
  const metadata = ref<GitHubRepositoryDiscussionMetadata | null>(null);
  const items = ref<GitHubRepositoryDiscussionSummary[]>([]);
  const totalCount = ref(0);
  const endCursor = ref<string | null>(null);
  const hasNextPage = ref(false);
  const metadataLoading = ref(false);
  const listLoading = ref(false);
  const listLoadingMore = ref(false);
  const metadataError = ref<string | null>(null);
  const listError = ref<string | null>(null);
  const loaded = ref(false);
  const filters = reactive<{
    categoryId: string | null;
    answered: boolean | null;
    state: GitHubRepositoryDiscussionState;
    sort: GitHubRepositoryDiscussionSort;
    direction: GitHubRepositoryDiscussionDirection;
  }>({
    categoryId: null,
    answered: null,
    state: "open",
    sort: "updated",
    direction: "desc",
  });
  const metadataLoader = createLatestAsyncLoader({ trackSessionContext: false });
  const listLoader = createLatestAsyncLoader({ trackSessionContext: false });
  const filterKey = computed(() => JSON.stringify(filters));

  async function loadMetadata(force = false) {
    if (!force && metadata.value) return metadata.value;
    await metadataLoader.run(repoFullName, async (runId) => {
      metadataLoading.value = true;
      metadataError.value = null;
      try {
        const next = await getGitHubRepositoryDiscussionMetadata(repoFullName);
        if (metadataLoader.isCurrent(runId)) metadata.value = next;
      } catch (error) {
        if (metadataLoader.isCurrent(runId)) metadataError.value = readableError(error);
      } finally {
        if (metadataLoader.isCurrent(runId)) metadataLoading.value = false;
      }
    }, { reusePending: !force });
    return metadata.value;
  }

  async function load(reset = true) {
    const key = `${filterKey.value}:${reset ? "reset" : endCursor.value ?? "end"}`;
    if (!reset && (!hasNextPage.value || listLoadingMore.value)) return;
    await listLoader.run(key, async (runId) => {
      if (reset) listLoading.value = true;
      else listLoadingMore.value = true;
      listError.value = null;
      try {
        const page = await listGitHubRepositoryDiscussions(repoFullName, {
          first: PAGE_SIZE,
          after: reset ? null : endCursor.value,
          ...filters,
        });
        if (!listLoader.isCurrent(runId)) return;
        items.value = reset ? dedupe(page.items) : dedupe([...items.value, ...page.items]);
        totalCount.value = page.totalCount;
        endCursor.value = page.pageInfo.endCursor;
        hasNextPage.value = page.pageInfo.hasNextPage;
        loaded.value = true;
      } catch (error) {
        if (listLoader.isCurrent(runId)) listError.value = readableError(error);
      } finally {
        if (listLoader.isCurrent(runId)) {
          listLoading.value = false;
          listLoadingMore.value = false;
        }
      }
    }, { reusePending: true });
  }

  async function ensureLoaded() {
    const nextMetadata = await loadMetadata();
    if (nextMetadata?.enabled && !loaded.value) await load(true);
  }

  async function updateFilters(next: Partial<typeof filters>) {
    Object.assign(filters, next);
    endCursor.value = null;
    hasNextPage.value = false;
    await load(true);
  }

  function upsert(summary: GitHubRepositoryDiscussionSummary) {
    items.value = dedupe([summary, ...items.value]);
    totalCount.value = Math.max(totalCount.value, items.value.length);
  }

  function dispose() {
    metadataLoader.invalidate();
    listLoader.invalidate();
  }

  return {
    metadata,
    items,
    totalCount,
    endCursor,
    hasNextPage,
    metadataLoading,
    listLoading,
    listLoadingMore,
    metadataError,
    listError,
    loaded,
    filters,
    ensureLoaded,
    loadMetadata,
    load,
    loadMore: () => load(false),
    updateFilters,
    upsert,
    dispose,
  };
}

function dedupe(items: readonly GitHubRepositoryDiscussionSummary[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function readableError(error: unknown) {
  return String(error).replace(/^Error:\s*/, "");
}
