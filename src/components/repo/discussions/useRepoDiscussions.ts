import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { useWorkspace } from "../../../composables/useWorkspace";
import type { WorkspaceStore } from "../../../composables/workspace/store";
import { useDiscussionCreate } from "./useDiscussionCreate";
import { useDiscussionDetail } from "./useDiscussionDetail";
import { useDiscussionList } from "./useDiscussionList";

export type RepoDiscussionsStore = ReturnType<typeof createRepoDiscussionsStore>;

interface RepoDiscussionsRuntime {
  stores: Map<string, RepoDiscussionsStore>;
  retainCounts: Map<string, number>;
}

const runtimes = new WeakMap<WorkspaceStore, RepoDiscussionsRuntime>();
const testRuntimes = import.meta.env.MODE === "test" ? new Set<RepoDiscussionsRuntime>() : null;

function runtimeFor(workspace: WorkspaceStore) {
  let runtime = runtimes.get(workspace);
  if (!runtime) {
    runtime = { stores: new Map(), retainCounts: new Map() };
    runtimes.set(workspace, runtime);
    testRuntimes?.add(runtime);
  }
  return runtime;
}

export function repoDiscussionsStore(workspace: WorkspaceStore, repoFullName: string) {
  const runtime = runtimeFor(workspace);
  let store = runtime.stores.get(repoFullName);
  if (!store) {
    store = createRepoDiscussionsStore(repoFullName, workspace.github.client);
    runtime.stores.set(repoFullName, store);
  }
  return store;
}

export function disposeRepoDiscussionsStore(workspace: WorkspaceStore, repoFullName: string) {
  const runtime = runtimeFor(workspace);
  const store = runtime.stores.get(repoFullName);
  if (!store) return;
  store.dispose();
  runtime.stores.delete(repoFullName);
}

export function useRepoDiscussionsStore(repoFullName: () => string) {
  const workspace = useWorkspace();
  const runtime = runtimeFor(workspace);
  const initialRepo = repoFullName();
  const current = shallowRef(repoDiscussionsStore(workspace, initialRepo));
  let retainedRepo: string | null = null;

  watch(repoFullName, (nextRepo) => {
    if (retainedRepo === nextRepo) return;
    if (retainedRepo) releaseRepoDiscussionsStore(workspace, retainedRepo);
    retainedRepo = nextRepo;
    runtime.retainCounts.set(nextRepo, (runtime.retainCounts.get(nextRepo) ?? 0) + 1);
    current.value = repoDiscussionsStore(workspace, nextRepo);
  }, { immediate: true });

  onBeforeUnmount(() => {
    if (retainedRepo) releaseRepoDiscussionsStore(workspace, retainedRepo);
    retainedRepo = null;
  });

  return computed(() => current.value);
}

export function resetRepoDiscussionsStoresForTests() {
  testRuntimes?.forEach((runtime) => {
    runtime.stores.forEach((store) => store.dispose());
    runtime.stores.clear();
    runtime.retainCounts.clear();
  });
  testRuntimes?.clear();
}

function releaseRepoDiscussionsStore(workspace: WorkspaceStore, repoFullName: string) {
  const runtime = runtimeFor(workspace);
  const nextCount = (runtime.retainCounts.get(repoFullName) ?? 1) - 1;
  if (nextCount > 0) {
    runtime.retainCounts.set(repoFullName, nextCount);
    return;
  }
  runtime.retainCounts.delete(repoFullName);
  disposeRepoDiscussionsStore(workspace, repoFullName);
}

function createRepoDiscussionsStore(repoFullName: string, github: WorkspaceStore["github"]["client"]) {
  const list = useDiscussionList(repoFullName, github);
  const detail = useDiscussionDetail(repoFullName, github);
  const create = useDiscussionCreate(repoFullName, list.metadata, github);

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
