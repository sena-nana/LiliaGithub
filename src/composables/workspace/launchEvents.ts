import { listen } from "@tauri-apps/api/event";
import { state } from "./state";
import type { ProjectLaunchStatus } from "../../services/workspace";

export const REPO_LAUNCH_STATUS_EVENT = "repo-launch-status";

function isLaunchStatus(value: unknown): value is ProjectLaunchStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<ProjectLaunchStatus>;
  return (
    typeof status.repoId === "string" &&
    (status.state === "idle" || status.state === "running" || status.state === "exited" || status.state === "error")
  );
}

export function applyLaunchStatusEvent(payload: unknown) {
  if (!isLaunchStatus(payload)) return;
  state.launchStatuses[payload.repoId] = payload;
}

export async function installLaunchStatusEvents(): Promise<() => void> {
  const cleanups = [installBrowserLaunchStatusEvent()];
  const tauriCleanup = await listen<ProjectLaunchStatus>(REPO_LAUNCH_STATUS_EVENT, (event) => {
    applyLaunchStatusEvent(event.payload);
  }).catch(() => null);
  if (tauriCleanup) cleanups.push(tauriCleanup);
  return () => cleanups.forEach((cleanup) => cleanup());
}

function installBrowserLaunchStatusEvent() {
  if (typeof window === "undefined") return () => undefined;

  const onStatus = (event: Event) => {
    applyLaunchStatusEvent((event as CustomEvent<unknown>).detail);
  };
  window.addEventListener(REPO_LAUNCH_STATUS_EVENT, onStatus);
  return () => {
    window.removeEventListener(REPO_LAUNCH_STATUS_EVENT, onStatus);
  };
}
