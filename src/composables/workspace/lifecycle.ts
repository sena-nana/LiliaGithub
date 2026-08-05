import { getCurrentWindow } from "@tauri-apps/api/window";
import { createKeyedAsyncResource } from "../useKeyedAsyncResource";
import { hasRecentInput } from "../../utils/lowPriorityScheduler";
import type {
  WorkspaceBootstrap,
  WorkspaceRecentContextV1,
  WorkspaceViewPreferences,
} from "../../services/workspace";
import type { WorkspaceStateFeature } from "./state";
import type { WorkspaceRepositoriesFeature } from "./repositories";
import type { WorkspaceRepoRefreshEventsFeature } from "./repoRefreshEvents";
import type { WorkspaceLaunchFeature } from "./launch";
import type { WorkspaceBulkFeature } from "./bulk";
import type { WorkspaceServiceLoader } from "./system";

export const FOCUS_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

export function createWorkspaceLifecycleFeature(
  stateFeature: WorkspaceStateFeature,
  repositories: WorkspaceRepositoriesFeature,
  repoRefreshEvents: WorkspaceRepoRefreshEventsFeature,
  launch: WorkspaceLaunchFeature,
  bulk: WorkspaceBulkFeature,
  loadWorkspaceService: WorkspaceServiceLoader,
) {
const { applyBindingStatus, applyWorkspaceBootstrap, replaceRepos, state } = stateFeature;
const {
  refreshRepoContributions,
  refreshRepoSummaries,
  refreshRepos,
  requestRepoStatusRefresh,
  resetRepositoryRuntime,
} = repositories;
const {
  hydrateRepoRemoteCheckedAt,
  ensureRepoRefreshEventsReady,
  resetRepoRefreshRuntime,
  setRepoRefreshLifecycleFocused,
} = repoRefreshEvents;
const { resetLaunchRuntime } = launch;
const { resetBulkRuntime } = bulk;
const bootstrapResource = createKeyedAsyncResource<number, WorkspaceBootstrap>({
  trackSessionContext: false,
});

let lastFocusEventAt = Date.now();
let lifecycleGeneration = 0;
let workspaceSwitchPromise: Promise<WorkspaceBootstrap> | null = null;

async function initialize() {
  if (state.loading || state.bootstrapStatus === "ready") return;
  const generation = ++lifecycleGeneration;
  state.bootstrapStatus = "loading";
  state.loading = true;
  state.error = null;
  try {
    const service = await loadWorkspaceService();
    const bindingStatusPromise = service.getGitHubBindingStatus().catch((err) => {
      if (generation === lifecycleGeneration) state.error = String(err);
      return null;
    });
    const bootstrap = await bootstrapResource.load(
      generation,
      () => service.getWorkspaceBootstrap(),
      { preserveData: false },
    );
    if (!bootstrap) {
      if (generation !== lifecycleGeneration) return;
      const resourceError = bootstrapResource.state.value.error;
      if (resourceError) throw resourceError;
      return;
    }
    if (generation !== lifecycleGeneration) return;
    const settings = bootstrap.settings;
    applyWorkspaceBootstrap(bootstrap);
    const provisionalBindingStatus = settings.githubBinding
      ? {
          state: "bound" as const,
          clientIdConfigured: true,
          clientIdSource: settings.githubBinding.clientIdSource,
          binding: settings.githubBinding,
        }
      : null;
    if (settings.githubBinding) {
      void bindingStatusPromise.then((bindingStatus) => {
        if (generation !== lifecycleGeneration) return;
        if (!bindingStatus) return;
        applyBindingStatus(bindingStatus);
        if (bindingStatus.state !== "bound") {
          void service.clearStartupCache().catch(() => undefined);
          return;
        }
        void service.listGitHubRepoOwners().catch(() => undefined);
      });
    } else {
      const bindingStatus = await bindingStatusPromise;
      if (generation !== lifecycleGeneration) return;
      if (!bindingStatus) return;
      applyBindingStatus(bindingStatus);
      if (bindingStatus.state === "bound") {
        void service.listGitHubRepoOwners().catch(() => undefined);
      }
    }
    hydrateWorkspaceBootstrapCache(bootstrap);
    await ensureRepoRefreshEventsReady();
    if (generation !== lifecycleGeneration) return;
    const repos = hasAvailableWorkspaceRoot(settings) ? await refreshRepos() : null;
    if (generation !== lifecycleGeneration) return;
    if (repos && !bootstrap.startupCache?.contributions) void refreshRepoContributions();
    if (provisionalBindingStatus && !state.bindingStatus) applyBindingStatus(provisionalBindingStatus);
    state.bootstrapStatus = "ready";
  } catch (err) {
    if (generation !== lifecycleGeneration) return;
    state.error = String(err);
    state.bootstrapStatus = "error";
  } finally {
    if (generation === lifecycleGeneration) {
      state.loading = false;
    }
  }
}

async function pickWorkspaceRoot() {
  const service = await loadWorkspaceService();
  return service.pickWorkspaceRoot();
}

function hydrateWorkspaceBootstrapCache(bootstrap: WorkspaceBootstrap) {
  const { settings, startupCache } = bootstrap;
  if (startupCache?.contributions) {
    state.githubContributions = {
      days: startupCache.contributions.days,
      meta: startupCache.contributions.meta,
      loading: false,
      error: null,
    };
  }
  if (startupCache) {
    const hiddenRepoIds = new Set(settings.hiddenRepoIds);
    replaceRepos(settings.managedRepoIds.flatMap((repoId) => {
      const cached = startupCache.reposById[repoId];
      return cached && !hiddenRepoIds.has(repoId) ? [{ ...cached.summary, id: repoId }] : [];
    }));
  }
  hydrateRepoRemoteCheckedAt(startupCache?.reposById);
}

function hasAvailableWorkspaceRoot(settings: WorkspaceBootstrap["settings"]) {
  return settings.activeWorkspace?.roots.some((root) => root.available) ?? Boolean(settings.workspaceRoot);
}

function resetWorkspaceRuntimeForContextChange() {
  bootstrapResource.invalidate();
  resetRepoRefreshRuntime();
  resetRepositoryRuntime();
  resetLaunchRuntime();
  resetBulkRuntime();
}

async function transitionToWorkspaceBootstrap(bootstrap: WorkspaceBootstrap) {
  lifecycleGeneration += 1;
  resetWorkspaceRuntimeForContextChange();
  state.bootstrapStatus = "ready";
  state.loading = false;
  applyWorkspaceBootstrap(bootstrap);
  hydrateWorkspaceBootstrapCache(bootstrap);
  await ensureRepoRefreshEventsReady();
  if (hasAvailableWorkspaceRoot(bootstrap.settings)) await refreshRepos();
  return bootstrap;
}

function switchWorkspace(workspaceId: string) {
  if (workspaceSwitchPromise) return workspaceSwitchPromise;
  state.switchingWorkspace = true;
  const pending = (async () => {
    const service = await loadWorkspaceService();
    const bootstrap = await service.switchWorkspace(workspaceId);
    return transitionToWorkspaceBootstrap(bootstrap);
  })().finally(() => {
    if (workspaceSwitchPromise === pending) {
      workspaceSwitchPromise = null;
      state.switchingWorkspace = false;
    }
  });
  workspaceSwitchPromise = pending;
  return pending;
}

async function createWorkspace(name: string, rootPath: string) {
  const service = await loadWorkspaceService();
  const bootstrap = await service.createWorkspace(name, rootPath);
  await transitionToWorkspaceBootstrap(bootstrap);
  return bootstrap.settings;
}

async function renameWorkspace(workspaceId: string, name: string) {
  const service = await loadWorkspaceService();
  const settings = await service.renameWorkspace(workspaceId, name);
  state.settings = settings;
  return settings;
}

async function deleteWorkspace(workspaceId: string) {
  const service = await loadWorkspaceService();
  const bootstrap = await service.deleteWorkspace(workspaceId);
  await transitionToWorkspaceBootstrap(bootstrap);
  return bootstrap.settings;
}

async function applyRootsMutation(request: () => Promise<WorkspaceBootstrap>) {
  const previousRevision = state.contextRevision;
  const bootstrap = await request();
  if (bootstrap.contextRevision !== previousRevision) {
    await transitionToWorkspaceBootstrap(bootstrap);
  } else {
    state.settings = bootstrap.settings;
  }
  return bootstrap.settings;
}

async function addWorkspaceRoot(workspaceId: string, rootPath: string) {
  const service = await loadWorkspaceService();
  return applyRootsMutation(() => service.addWorkspaceRoot(workspaceId, rootPath));
}

async function removeWorkspaceRoot(workspaceId: string, rootId: string) {
  const service = await loadWorkspaceService();
  return applyRootsMutation(() => service.removeWorkspaceRoot(workspaceId, rootId));
}

async function setPrimaryWorkspaceRoot(workspaceId: string, rootId: string) {
  const service = await loadWorkspaceService();
  return applyRootsMutation(() => service.setPrimaryWorkspaceRoot(workspaceId, rootId));
}

async function updateWorkspaceViewPreferences(preferences: WorkspaceViewPreferences) {
  const service = await loadWorkspaceService();
  const settings = await service.updateWorkspaceViewPreferences(preferences);
  state.settings = settings;
  return settings;
}

async function updateWorkspaceRecentContext(
  workspaceId: string,
  context: WorkspaceRecentContextV1 | null,
) {
  const service = await loadWorkspaceService();
  return service.updateWorkspaceRecentContext(workspaceId, context);
}

async function installWorkspaceFocusRefresh(): Promise<() => void> {
  lastFocusEventAt = Date.now();
  hasRecentInput();

  const handleFocusChange = (focused: boolean) => {
    const now = Date.now();
    const elapsed = now - lastFocusEventAt;
    lastFocusEventAt = now;
    setRepoRefreshLifecycleFocused(focused);

    if (!focused || elapsed < FOCUS_REFRESH_THRESHOLD_MS) return;
    if (!state.settings?.workspaceRoot || state.loading || state.scanning || state.bulkRunning) return;
    if (hasRecentInput()) return;
    const activeRepoId = currentRepoRouteId();
    if (activeRepoId && state.repos.some((repo) => repo.id === activeRepoId)) {
      void requestRepoStatusRefresh(activeRepoId, {}, { immediate: true });
    }
    void refreshRepoSummaries({ automatic: true });
  };

  const tauriCleanup = await installTauriFocusListener(handleFocusChange);
  if (tauriCleanup) return tauriCleanup;

  return installBrowserFocusListener(handleFocusChange);
}

function currentRepoRouteId() {
  if (typeof window === "undefined") return null;
  const pathname = window.location.pathname || "";
  const match = pathname.match(/\/repos\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function installTauriFocusListener(
  handleFocusChange: (focused: boolean) => void,
): Promise<(() => void) | null> {
  try {
    const appWindow = getCurrentWindow();
    if (typeof appWindow.onFocusChanged !== "function") return null;
    return await appWindow.onFocusChanged(({ payload }) => {
      handleFocusChange(payload);
    });
  } catch {
    return null;
  }
}

function installBrowserFocusListener(handleFocusChange: (focused: boolean) => void) {
  if (typeof window === "undefined") return () => undefined;

  const onFocus = () => handleFocusChange(true);
  const onBlur = () => handleFocusChange(false);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);

  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  };
}

return {
  initialize,
  pickWorkspaceRoot,
  switchWorkspace,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  addWorkspaceRoot,
  removeWorkspaceRoot,
  setPrimaryWorkspaceRoot,
  updateWorkspaceViewPreferences,
  updateWorkspaceRecentContext,
  installWorkspaceFocusRefresh,
  bootstrapResource,
};
}

export type WorkspaceLifecycleFeature = ReturnType<typeof createWorkspaceLifecycleFeature>;
