import {
  createWorkspaceStore,
  workspaceStoreKey,
  type WorkspaceStore,
} from "../../src/composables/workspace/store";
import {
  createDefaultWorkspaceTransport,
  createWorkspaceClient,
  type WorkspaceClient,
} from "../../src/services/workspace/client";
import {
  createSessionContext,
  sessionContextKey,
  type SessionContext,
} from "../../src/composables/sessionContext";

export function createWorkspaceStoreFixture(
  overrides: Partial<WorkspaceClient> = {},
  sessionContext: SessionContext = createSessionContext(),
): WorkspaceStore {
  const client = Object.assign(
    createWorkspaceClient(createDefaultWorkspaceTransport()),
    overrides,
  );
  return createWorkspaceStore({
    sessionContext,
    client,
    loadService: async () => client,
  });
}

export function resetWorkspaceStoreFixture(store: WorkspaceStore) {
  store.resetAuthRuntime();
  store.resetRepositoryRuntimeForTests();
  store.resetRepoRefreshRuntimeForTests();
  store.stateFeature.resetWorkspaceStateForTests();
}

export function provideWorkspaceStoreFixture(store: WorkspaceStore) {
  return {
    [workspaceStoreKey as symbol]: store,
    [sessionContextKey as symbol]: store.sessionContext,
  };
}
