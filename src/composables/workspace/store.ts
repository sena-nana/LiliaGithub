import {
  inject,
  readonly,
  type App,
  type InjectionKey,
} from "vue";
import {
  createWorkspaceClient,
  type WorkspaceClient,
} from "../../services/workspace/client";
import type { WorkspaceTransport } from "../../services/workspace/transport";
import { createWorkspaceStateFeature } from "./state";
import { createWorkspaceTaskWaitersFeature } from "./taskWaiters";
import { createWorkspaceSystemFeature, type WorkspaceServiceLoader } from "./system";
import { createWorkspaceRepositoriesFeature } from "./repositories";
import { createWorkspaceRepoRefreshEventsFeature } from "./repoRefreshEvents";
import { createWorkspaceLaunchFeature } from "./launch";
import { createWorkspaceLaunchEventsFeature } from "./launchEvents";
import { createWorkspaceBulkFeature } from "./bulk";
import { createWorkspaceAccountFeature } from "./account";
import { createWorkspaceAuthFeature } from "./auth";
import { createWorkspaceLifecycleFeature } from "./lifecycle";
import type { SessionContext } from "../sessionContext";

export interface CreateWorkspaceStoreOptions {
  sessionContext: SessionContext;
  transport?: WorkspaceTransport;
  client?: WorkspaceClient;
  loadService?: WorkspaceServiceLoader;
}

/**
 * Creates the complete workspace runtime for one Vue application.
 *
 * No mutable state, generation counter, timer or in-flight cache is shared
 * between calls. This is the composition root for workspace features.
 */
export function createWorkspaceStore(options: CreateWorkspaceStoreOptions) {
  const client = options.client ?? (
    options.transport ? createWorkspaceClient(options.transport) : null
  );
  if (!client) {
    throw new Error("Workspace store requires an explicit client or transport.");
  }
  const loadService = options.loadService ?? (async () => client);
  const stateFeature = createWorkspaceStateFeature(options.sessionContext);
  const taskWaiters = createWorkspaceTaskWaitersFeature(stateFeature);
  const system = createWorkspaceSystemFeature(loadService);
  const repositoriesCore = createWorkspaceRepositoriesFeature(stateFeature, taskWaiters, loadService);
  const repoRefresh = createWorkspaceRepoRefreshEventsFeature(
    stateFeature,
    taskWaiters,
    repositoriesCore,
    loadService,
  );
  const launchCore = createWorkspaceLaunchFeature(stateFeature, loadService);
  const launchEvents = createWorkspaceLaunchEventsFeature(stateFeature);
  const repositories = {
    ...repositoriesCore,
    ...repoRefresh,
  };
  const bulk = createWorkspaceBulkFeature(
    stateFeature,
    repositoriesCore,
    loadService,
    options.sessionContext,
  );
  const account = createWorkspaceAccountFeature(stateFeature, repositoriesCore, loadService);
  const auth = createWorkspaceAuthFeature(stateFeature, system, account, loadService);
  const lifecycle = createWorkspaceLifecycleFeature(
    stateFeature,
    repositoriesCore,
    repoRefresh,
    launchCore,
    bulk,
    loadService,
  );
  const session = {
    state: readonly(stateFeature.state),
    deviceFlow: readonly(stateFeature.deviceFlow),
    workspaceRoot: stateFeature.workspaceRoot,
    activeWorkspace: stateFeature.activeWorkspace,
    workspaceCatalog: stateFeature.workspaceCatalog,
    switchingWorkspace: stateFeature.switchingWorkspace,
    contextRevision: stateFeature.contextRevision,
    githubBinding: stateFeature.githubBinding,
    hasAvailableWorkspaceRoot: stateFeature.hasAvailableWorkspaceRoot,
    isAuthorized: stateFeature.isAuthorized,
    isReady: stateFeature.isReady,
    authBindingStatusText: stateFeature.authBindingStatusText,
    authPendingStatusText: stateFeature.authPendingStatusText,
    authRemainingText: stateFeature.authRemainingText,
    repoById: stateFeature.repoById,
    repoUsesSystemGit: stateFeature.repoUsesSystemGit,
    ...lifecycle,
    ...auth,
  };
  const githubCache = {
    readCachedGitHubRepos: client.readCachedGitHubRepos,
    clearGitHubRepoCache: client.clearGitHubRepoCache,
    clearGitHubRepoOwnerCache: client.clearGitHubRepoOwnerCache,
    clearGitHubRepoLicenseCache: client.clearGitHubRepoLicenseCache,
  };
  const github = {
    ...account,
    ...auth,
    ...githubCache,
    /** The concrete typed client owned by this application instance. */
    client,
    /** App-scoped typed service entry point for feature controllers. */
    service: loadService,
  };
  const tasks = {
    waitForWorkspaceTask: taskWaiters.waitForWorkspaceTask,
    refreshWorkspaceTasks: repositoriesCore.refreshWorkspaceTasks,
    cancelWorkspaceTask: repositoriesCore.cancelWorkspaceTask,
  };
  const launch = { ...launchCore, ...launchEvents };
  const dispose = () => {
    auth.resetAuthRuntime();
    repoRefresh.resetRepoRefreshRuntime();
    repositoriesCore.resetRepositoryRuntime();
    launchCore.resetLaunchRuntime();
    bulk.resetBulkRuntime();
  };

  return {
    sessionContext: options.sessionContext,
    session,
    repositories,
    tasks,
    github,
    launch,
    bulk,
    system,
    dispose,
    stateFeature,
    ...session,
    ...repositories,
    ...bulk,
    ...launch,
    ...system,
    ...account,
    ...githubCache,
  };
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export const workspaceStoreKey: InjectionKey<WorkspaceStore> = Symbol("LiliaGithubWorkspaceStore");

export function provideWorkspaceStore(app: App, store: WorkspaceStore) {
  app.provide(workspaceStoreKey, store);
  app.onUnmount(store.dispose);
  return store;
}

export function useWorkspaceStore() {
  const store = inject(workspaceStoreKey, null);
  if (!store) {
    throw new Error("Workspace store is unavailable. Create and provide it at the application root.");
  }
  return store;
}
