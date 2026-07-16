import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { useDiscussionCreate } from "./useDiscussionCreate";
import { useDiscussionDetail } from "./useDiscussionDetail";
import { useDiscussionList } from "./useDiscussionList";

export type RepoDiscussionsStore = ReturnType<typeof createRepoDiscussionsStore>;

const stores = new Map<string, RepoDiscussionsStore>();
const retainCounts = new Map<string, number>();

export function repoDiscussionsStore(repoFullName: string) {
  let store = stores.get(repoFullName);
  if (!store) {
    store = createRepoDiscussionsStore(repoFullName);
    stores.set(repoFullName, store);
  }
  return store;
}

export function disposeRepoDiscussionsStore(repoFullName: string) {
  const store = stores.get(repoFullName);
  if (!store) return;
  store.dispose();
  stores.delete(repoFullName);
}

export function useRepoDiscussionsStore(repoFullName: () => string) {
  const initialRepo = repoFullName();
  const current = shallowRef(repoDiscussionsStore(initialRepo));
  let retainedRepo: string | null = null;

  watch(repoFullName, (nextRepo) => {
    if (retainedRepo === nextRepo) return;
    if (retainedRepo) releaseRepoDiscussionsStore(retainedRepo);
    retainedRepo = nextRepo;
    retainCounts.set(nextRepo, (retainCounts.get(nextRepo) ?? 0) + 1);
    current.value = repoDiscussionsStore(nextRepo);
  }, { immediate: true });

  onBeforeUnmount(() => {
    if (retainedRepo) releaseRepoDiscussionsStore(retainedRepo);
    retainedRepo = null;
  });

  return computed(() => current.value);
}

export function resetRepoDiscussionsStoresForTests() {
  stores.forEach((store) => store.dispose());
  stores.clear();
  retainCounts.clear();
}

function releaseRepoDiscussionsStore(repoFullName: string) {
  const nextCount = (retainCounts.get(repoFullName) ?? 1) - 1;
  if (nextCount > 0) {
    retainCounts.set(repoFullName, nextCount);
    return;
  }
  retainCounts.delete(repoFullName);
  disposeRepoDiscussionsStore(repoFullName);
}

function createRepoDiscussionsStore(repoFullName: string) {
  const list = useDiscussionList(repoFullName);
  const detail = useDiscussionDetail(repoFullName);
  const create = useDiscussionCreate(repoFullName, list.metadata);

  async function createDiscussion() {
    const created = await create.submit();
    if (!created) return null;
    list.upsert(created);
    detail.setCreatedDetail(created);
    return created;
  }

  function dispose() {
    list.dispose();
    detail.dispose();
    create.dispose();
  }

  return { repoFullName, list, detail, create, createDiscussion, dispose };
}
