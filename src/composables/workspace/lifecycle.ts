import { getCurrentWindow } from "@tauri-apps/api/window";
import { ref } from "vue";
import { replaceRepos, state } from "./state";
import {
  refreshRepoSummaries,
  refreshRepos,
  requestRepoStatusRefresh,
} from "./repositories";
import {
  hydrateRepoRemoteCheckedAt,
  ensureRepoRefreshEventsReady,
  setRepoRefreshLifecycleFocused,
} from "./repoRefreshEvents";
import { loadWorkspaceService } from "./serviceLoader";
import { hasRecentInput } from "../../utils/lowPriorityScheduler";

export const FOCUS_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

let lastFocusEventAt = Date.now();
let lifecycleGeneration = 0;
let chooseWorkspaceRootPromise: Promise<string | null> | null = null;
export const choosingWorkspaceRoot = ref(false);

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
    const settingsPromise = service.getWorkspaceSettings();
    const startupCachePromise = service.readStartupCache().catch(() => null);
    const settings = await settingsPromise;
    if (generation !== lifecycleGeneration) return;
    state.settings = settings;
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
    const startupCache = await startupCachePromise;
    if (generation !== lifecycleGeneration) return;
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
    await ensureRepoRefreshEventsReady();
    if (generation !== lifecycleGeneration) return;
    if (settings.workspaceRoot) {
      await refreshRepos();
    }
    if (generation !== lifecycleGeneration) return;
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

export function chooseWorkspaceRoot() {
  if (chooseWorkspaceRootPromise) return chooseWorkspaceRootPromise;

  choosingWorkspaceRoot.value = true;
  const pending = (async () => {
    try {
      lifecycleGeneration += 1;
      state.loading = false;
      state.error = null;
      const service = await loadWorkspaceService();
      const picked = await service.pickWorkspaceRoot();
      if (!picked) return null;
      state.settings = await service.setWorkspaceRoot(picked);
      await refreshRepos();
      return picked;
    } catch (err) {
      state.error = String(err);
      throw err;
    }
  })().finally(() => {
    if (chooseWorkspaceRootPromise === pending) {
      chooseWorkspaceRootPromise = null;
      choosingWorkspaceRoot.value = false;
    }
  });
  chooseWorkspaceRootPromise = pending;
  return pending;
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
