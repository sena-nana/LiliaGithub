import { listen } from "@tauri-apps/api/event";
import type { RepoChangedEvent } from "../../services/workspace";
import { state } from "./state";
import { requestRepoStatusRefresh, refreshManagedRepoSummary } from "./repositories";

export const REPO_CHANGED_EVENT = "workspace://repo-changed";

function isRepoChangedEvent(value: unknown): value is RepoChangedEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<RepoChangedEvent>;
  return (
    typeof event.repoId === "string" &&
    (event.kind === "worktree" || event.kind === "git-metadata")
  );
}

function currentRepoRouteId() {
  if (typeof window === "undefined") return null;
  const match = (window.location.pathname || "").match(/\/repos\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function applyRepoChangedEvent(payload: unknown) {
  if (!isRepoChangedEvent(payload)) return;
  if (!state.settings?.workspaceRoot || state.loading || state.scanning || state.bulkRunning) return;
  if (!state.repos.some((repo) => repo.id === payload.repoId)) return;

  if (currentRepoRouteId() === payload.repoId) {
    void requestRepoStatusRefresh(payload.repoId, {}, { immediate: false });
    return;
  }
  void refreshManagedRepoSummary(payload.repoId);
}

export async function installRepoChangedEvents(): Promise<() => void> {
  const cleanups = [installBrowserRepoChangedEvent()];
  const tauriCleanup = await listen<RepoChangedEvent>(REPO_CHANGED_EVENT, (event) => {
    applyRepoChangedEvent(event.payload);
  }).catch(() => null);
  if (tauriCleanup) cleanups.push(tauriCleanup);
  return () => cleanups.forEach((cleanup) => cleanup());
}

function installBrowserRepoChangedEvent() {
  if (typeof window === "undefined") return () => undefined;
  const onChanged = (event: Event) => {
    applyRepoChangedEvent((event as CustomEvent<unknown>).detail);
  };
  window.addEventListener(REPO_CHANGED_EVENT, onChanged);
  return () => window.removeEventListener(REPO_CHANGED_EVENT, onChanged);
}
