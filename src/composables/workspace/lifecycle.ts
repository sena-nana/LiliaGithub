import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyWorkspaceBootstrap, replaceRepos, state } from "./state";
import {
  refreshRepoContributions,
  refreshRepoSummaries,
  refreshRepos,
  requestRepoStatusRefresh,
} from "./repositories";
import {
  hydrateRepoRemoteCheckedAt,
  ensureRepoRefreshEventsReady,
  resetRepoRefreshRuntime,
  setRepoRefreshLifecycleFocused,
} from "./repoRefreshEvents";
import { loadWorkspaceService } from "./serviceLoader";
import { hasRecentInput } from "../../utils/lowPriorityScheduler";
import type {
  WorkspaceBootstrap,
  WorkspaceRecentContextV1,
  WorkspaceViewPreferences,
} from "../../services/workspace";
import { resetRepositoryRuntime } from "./repositories";
import { resetLaunchRuntime } from "./launch";
import { resetBulkRuntime } from "./bulk";

export const FOCUS_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

let lastFocusEventAt = Date.now();
let lifecycleGeneration = 0;
let workspaceSwitchPromise: Promise<WorkspaceBootstrap> | null = null;

export async function initialize() {
  if (state.loading) return;
  const generation = ++lifecycleGeneration;
  state.loading = true;
  state.error = null;
  try {
    const service = await loadWorkspaceService();
    const bindingStatusPromise = service.getGitHubBindingStatus().catch((err) => {
      if (generation === lifecycleGeneration) state.error = String(err);
      return null;
    });
    const bootstrap = await service.getWorkspaceBootstrap();
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
        state.bindingStatus = bindingStatus;
        if (bindingStatus.state !== "bound") {
          void service.clearStartupCache().catch(() => undefined);
        }
      });
    } else {
      const bindingStatus = await bindingStatusPromise;
      if (generation !== lifecycleGeneration) return;
      if (!bindingStatus) return;
      state.bindingStatus = bindingStatus;
    }
    hydrateWorkspaceBootstrapCache(bootstrap);
    await ensureRepoRefreshEventsReady();
    if (generation !== lifecycleGeneration) return;
    const repos = hasAvailableWorkspaceRoot(settings) ? await refreshRepos() : null;
    if (generation !== lifecycleGeneration) return;
    if (repos && !bootstrap.startupCache?.contributions) void refreshRepoContributions();
    if (provisionalBindingStatus && !state.bindingStatus) state.bindingStatus = provisionalBindingStatus;
  } catch (err) {
    if (generation !== lifecycleGeneration) return;
    state.error = String(err);
  } finally {
    if (generation === lifecycleGeneration) {
      state.loading = false;
    }
  }
}

export async function pickWorkspaceRoot() {
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
  resetRepoRefreshRuntime();
  resetRepositoryRuntime();
  resetLaunchRuntime();
  resetBulkRuntime();
}

async function transitionToWorkspaceBootstrap(bootstrap: WorkspaceBootstrap) {
  lifecycleGeneration += 1;
  resetWorkspaceRuntimeForContextChange();
  state.loading = false;
  applyWorkspaceBootstrap(bootstrap);
  hydrateWorkspaceBootstrapCache(bootstrap);
  await ensureRepoRefreshEventsReady();
  if (hasAvailableWorkspaceRoot(bootstrap.settings)) await refreshRepos();
  return bootstrap;
}

export function switchWorkspace(workspaceId: string) {
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

export async function createWorkspace(name: string, rootPath: string) {
  const service = await loadWorkspaceService();
  const bootstrap = await service.createWorkspace(name, rootPath);
  await transitionToWorkspaceBootstrap(bootstrap);
  return bootstrap.settings;
}

export async function renameWorkspace(workspaceId: string, name: string) {
  const service = await loadWorkspaceService();
  const settings = await service.renameWorkspace(workspaceId, name);
  state.settings = settings;
  return settings;
}

export async function deleteWorkspace(workspaceId: string) {
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

export async function addWorkspaceRoot(workspaceId: string, rootPath: string) {
  const service = await loadWorkspaceService();
  return applyRootsMutation(() => service.addWorkspaceRoot(workspaceId, rootPath));
}

export async function removeWorkspaceRoot(workspaceId: string, rootId: string) {
  const service = await loadWorkspaceService();
  return applyRootsMutation(() => service.removeWorkspaceRoot(workspaceId, rootId));
}

export async function setPrimaryWorkspaceRoot(workspaceId: string, rootId: string) {
  const service = await loadWorkspaceService();
  return applyRootsMutation(() => service.setPrimaryWorkspaceRoot(workspaceId, rootId));
}

export async function updateWorkspaceViewPreferences(preferences: WorkspaceViewPreferences) {
  const service = await loadWorkspaceService();
  const settings = await service.updateWorkspaceViewPreferences(preferences);
  state.settings = settings;
  return settings;
}

export async function updateWorkspaceRecentContext(
  workspaceId: string,
  context: WorkspaceRecentContextV1 | null,
) {
  const service = await loadWorkspaceService();
  return service.updateWorkspaceRecentContext(workspaceId, context);
}

export async function installWorkspaceFocusRefresh(): Promise<() => void> {
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
