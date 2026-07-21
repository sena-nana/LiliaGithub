import { listen } from "@tauri-apps/api/event";
import { watch } from "vue";
import type {
  WorkspaceRepoRefreshRequest,
  WorkspaceRepoRefreshedEvent,
  WorkspaceTask,
} from "../../services/workspace";
import { repoAutoSyncEnabled } from "../../config/repoSettingsManifest";
import { autoSyncRepoIfNeeded } from "./repositories";
import { loadWorkspaceService } from "./serviceLoader";
import {
  setRepoDetailPatch,
  setWorkspaceTasks,
  state,
  isCurrentWorkspaceContext,
  upsertRepo,
  upsertWorkspaceTask,
} from "./state";
import {
  resetWorkspaceTaskWaitersForTests,
  settleWorkspaceTaskWaiters,
  waitForWorkspaceTask,
} from "./taskWaiters";

export { waitForWorkspaceTask };

export const WORKSPACE_TASK_CHANGED_EVENT = "workspace://task-changed";
export const WORKSPACE_REPO_REFRESHED_EVENT = "workspace://repo-refreshed";
export const REMOTE_REPO_REFRESH_TTL_MS = 10 * 60 * 1000;
export const ACTIVE_REMOTE_REPO_REFRESH_TTL_MS = 60 * 1000;
const REMOTE_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

let activeRepoId: string | null = null;
let activeRepoLocalReady = false;
let activeRepoTimer: ReturnType<typeof setTimeout> | null = null;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleFocused = true;
let lifecycleVisible = true;
let installGeneration = 0;
let installationPromise: Promise<() => void> | null = null;
let installedCleanup: (() => void) | null = null;
let localRefreshPausedApplied: boolean | null = null;
const remoteFailureCounts = new Map<string, number>();
const remoteNextAttemptAt = new Map<string, number>();

function isWorkspaceTask(value: unknown): value is WorkspaceTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<WorkspaceTask>;
  return typeof task.id === "string" &&
    typeof task.kind === "string" &&
    typeof task.title === "string" &&
    typeof task.priority === "string" &&
    typeof task.status === "string" &&
    typeof task.createdAt === "number" &&
    typeof task.updatedAt === "number" &&
    typeof task.cancellable === "boolean" &&
    (typeof task.workspaceId === "string" || task.workspaceId === null) &&
    typeof task.contextRevision === "number";
}

function isRepoRefreshedEvent(value: unknown): value is WorkspaceRepoRefreshedEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<WorkspaceRepoRefreshedEvent>;
  return typeof event.repoId === "string" &&
    (event.mode === "local" || event.mode === "remote") &&
    (typeof event.workspaceId === "string" || event.workspaceId === null) &&
    typeof event.contextRevision === "number" &&
    Boolean(event.summary && typeof event.summary === "object");
}

export function applyWorkspaceTaskChanged(payload: unknown) {
  if (!isWorkspaceTask(payload)) return;
  if (!isCurrentWorkspaceContext(payload)) return;
  upsertWorkspaceTask(payload);
  settleWorkspaceTaskWaiters(payload);
  if (payload.kind !== "repoRemote" || !payload.repoId) return;

  if (payload.status === "pending" || payload.status === "running") return;
  const repoId = payload.repoId;
  if (payload.status === "error") {
    const failures = Math.min((remoteFailureCounts.get(repoId) ?? 0) + 1, REMOTE_RETRY_DELAYS_MS.length);
    remoteFailureCounts.set(repoId, failures);
    remoteNextAttemptAt.set(repoId, Date.now() + REMOTE_RETRY_DELAYS_MS[failures - 1]);
    if (activeRepoId === repoId) scheduleActiveRepoRefresh(REMOTE_RETRY_DELAYS_MS[failures - 1]);
    scheduleAutoSyncRepoRefreshes();
  }
}

export function applyWorkspaceRepoRefreshed(payload: unknown) {
  if (!isRepoRefreshedEvent(payload)) return;
  if (!isCurrentWorkspaceContext(payload)) return;
  if (payload.detailPatch) setRepoDetailPatch(payload.detailPatch, payload.repoId);
  else upsertRepo(payload.summary);

  if (payload.mode === "remote") {
    const checkedAt = payload.remoteCheckedAt ?? Date.now();
    state.repoRemoteCheckedAt[payload.repoId] = checkedAt;
    remoteFailureCounts.delete(payload.repoId);
    remoteNextAttemptAt.delete(payload.repoId);
    if (activeRepoId === payload.repoId) scheduleActiveRepoRefresh(remoteRefreshDelay(payload.repoId));
    if (repoAutoSyncEnabled(state.settings, payload.repoId)) {
      void Promise.resolve().then(() => autoSyncRepoIfNeeded(payload.repoId, { summary: payload.summary }));
    }
    scheduleAutoSyncRepoRefreshes();
    return;
  }

  if (payload.summary.remoteUrl && repoAutoSyncEnabled(state.settings, payload.repoId)) {
    scheduleAutoSyncRepoRefreshes();
  }
}

export async function setActiveRepoForRefresh(repoId: string | null) {
  if (activeRepoId === repoId) return;
  activeRepoId = repoId;
  activeRepoLocalReady = false;
  clearActiveRepoTimer();
  const service = await loadWorkspaceService();
  await service.setActiveWorkspaceRepo(repoId);
}

export function markActiveRepoLocalReady(repoId: string) {
  if (!repoId || activeRepoId !== repoId) return;
  activeRepoLocalReady = true;
  scheduleActiveRepoRefresh(remoteRefreshDelay(repoId));
}

export function setRepoRefreshLifecycleFocused(focused: boolean) {
  lifecycleFocused = focused;
  reconcileRefreshLifecycle();
}

export function hydrateRepoRemoteCheckedAt(
  reposById: Record<string, { remoteCheckedAt?: number | null }> | null | undefined,
) {
  state.repoRemoteCheckedAt = Object.fromEntries(
    Object.entries(reposById ?? {}).flatMap(([repoId, entry]) =>
      typeof entry.remoteCheckedAt === "number" ? [[repoId, entry.remoteCheckedAt]] : []
    ),
  );
}

export async function requestManualRepoRemoteRefresh(
  repoId: string,
  options: { includeCommits?: boolean; includeBranches?: boolean } = {},
) {
  const taskId = await enqueueRepoRefresh({
    repoId,
    mode: "remote",
    priority: "high",
    force: true,
    detailScope: "detail",
    includeCommits: options.includeCommits,
    includeBranches: options.includeBranches,
    trigger: "manual",
  });
  await waitForWorkspaceTask(taskId);
  return taskId;
}

async function requestActiveRepoRemoteRefresh(repoId: string) {
  const repo = state.repos.find((item) => item.id === repoId);
  if (!repo?.remoteUrl || activeRepoId !== repoId || !activeRepoLocalReady || !canRunActiveRepoRefresh()) return null;
  clearActiveRepoTimer();
  return enqueueRepoRefresh({
    repoId,
    mode: "remote",
    priority: "normal",
    force: false,
    detailScope: "detail",
    trigger: "activeRepo",
  });
}

async function enqueueRepoRefresh(request: WorkspaceRepoRefreshRequest) {
  const service = await loadWorkspaceService();
  const taskId = await service.enqueueRepoRefresh(request);
  return taskId;
}

export function scheduleAutoSyncRepoRefreshes(now = Date.now()) {
  clearAutoSyncTimer();
  if (!canRunActiveRepoRefresh()) return;
  const repos = state.repos.filter((repo) =>
    Boolean(repo.remoteUrl) && repoAutoSyncEnabled(state.settings, repo.id)
  );
  if (!repos.length) return;
  const dueAt = (repoId: string) => remoteNextAttemptAt.get(repoId) ?? (
    state.repoRemoteCheckedAt[repoId] == null
      ? now
      : state.repoRemoteCheckedAt[repoId]! + REMOTE_REPO_REFRESH_TTL_MS
  );
  const nextAt = Math.min(...repos.map((repo) => dueAt(repo.id)));
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    if (!canRunActiveRepoRefresh()) return;
    const startedAt = Date.now();
    for (const repo of repos) {
      if (dueAt(repo.id) > startedAt) continue;
      remoteNextAttemptAt.set(repo.id, startedAt + REMOTE_REPO_REFRESH_TTL_MS);
      void enqueueRepoRefresh({
        repoId: repo.id,
        mode: "remote",
        priority: "low",
        force: false,
        detailScope: activeRepoId === repo.id ? "detail" : "summary",
        trigger: "autoSync",
      });
    }
    scheduleAutoSyncRepoRefreshes(startedAt);
  }, Math.max(0, nextAt - now));
}

function remoteRefreshDelay(repoId: string, now = Date.now()) {
  const checkedAt = state.repoRemoteCheckedAt[repoId];
  if (checkedAt == null) return 0;
  return Math.max(0, checkedAt + ACTIVE_REMOTE_REPO_REFRESH_TTL_MS - now);
}

function scheduleActiveRepoRefresh(delay: number) {
  clearActiveRepoTimer();
  if (!activeRepoId || !activeRepoLocalReady || !canRunActiveRepoRefresh()) return;
  const repoId = activeRepoId;
  activeRepoTimer = setTimeout(() => {
    activeRepoTimer = null;
    void requestActiveRepoRemoteRefresh(repoId);
  }, Math.max(0, delay));
}

function resumeActiveRepoRefresh() {
  if (!activeRepoId || !activeRepoLocalReady || !canRunActiveRepoRefresh()) return;
  scheduleActiveRepoRefresh(remoteRefreshDelay(activeRepoId));
}

function canRunActiveRepoRefresh() {
  return lifecycleFocused && lifecycleVisible && !state.loading && !state.bulkRunning;
}

function clearActiveRepoTimer() {
  if (activeRepoTimer == null) return;
  clearTimeout(activeRepoTimer);
  activeRepoTimer = null;
}

function clearAutoSyncTimer() {
  if (autoSyncTimer == null) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = null;
}

function syncLocalRefreshPaused() {
  const paused = !lifecycleVisible || state.loading || state.bulkRunning;
  if (localRefreshPausedApplied === paused) return;
  localRefreshPausedApplied = paused;
  void loadWorkspaceService().then((service) => {
    return service.setWorkspaceRefreshPaused(paused);
  }).catch(() => {
    if (localRefreshPausedApplied === paused) localRefreshPausedApplied = null;
  });
}

function reconcileRefreshLifecycle() {
  syncLocalRefreshPaused();
  if (!canRunActiveRepoRefresh()) {
    clearActiveRepoTimer();
    clearAutoSyncTimer();
    return;
  }
  resumeActiveRepoRefresh();
  scheduleAutoSyncRepoRefreshes();
}

export async function ensureRepoRefreshEventsReady() {
  if (!installationPromise) installationPromise = performRepoRefreshEventsInstall();
  installedCleanup = await installationPromise;
}

export async function installRepoRefreshEvents(): Promise<() => void> {
  await ensureRepoRefreshEventsReady();
  return () => {
    installedCleanup?.();
    installedCleanup = null;
    installationPromise = null;
    installGeneration += 1;
  };
}

async function performRepoRefreshEventsInstall(): Promise<() => void> {
  const generation = ++installGeneration;
  lifecycleVisible = typeof document === "undefined" || document.visibilityState !== "hidden";
  const cleanups = [
    installBrowserWorkspaceEvent(WORKSPACE_TASK_CHANGED_EVENT, applyWorkspaceTaskChanged),
    installBrowserWorkspaceEvent(WORKSPACE_REPO_REFRESHED_EVENT, applyWorkspaceRepoRefreshed),
    installVisibilityListener(),
    watch(
      () => [state.settings?.repoSyncPreferences, state.repoListChange.revision] as const,
      () => scheduleAutoSyncRepoRefreshes(),
      { deep: true },
    ),
    watch(
      () => [state.loading, state.bulkRunning] as const,
      () => reconcileRefreshLifecycle(),
      { immediate: true },
    ),
  ];
  const [taskCleanup, repoCleanup] = await Promise.all([
    listen<WorkspaceTask>(WORKSPACE_TASK_CHANGED_EVENT, (event) => applyWorkspaceTaskChanged(event.payload)).catch(() => null),
    listen<WorkspaceRepoRefreshedEvent>(WORKSPACE_REPO_REFRESHED_EVENT, (event) =>
      applyWorkspaceRepoRefreshed(event.payload)
    ).catch(() => null),
  ]);
  if (taskCleanup) cleanups.push(taskCleanup);
  if (repoCleanup) cleanups.push(repoCleanup);

  const service = await loadWorkspaceService();
  const tasks = await service.listWorkspaceTasks().catch(() => []);
  if (generation === installGeneration) setWorkspaceTasks(tasks);
  if (generation === installGeneration) scheduleAutoSyncRepoRefreshes();
  return () => cleanups.forEach((cleanup) => cleanup());
}

function installBrowserWorkspaceEvent(name: string, apply: (payload: unknown) => void) {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => apply((event as CustomEvent<unknown>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

function installVisibilityListener() {
  if (typeof document === "undefined") return () => undefined;
  const listener = () => {
    lifecycleVisible = document.visibilityState !== "hidden";
    reconcileRefreshLifecycle();
  };
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

export function resetRepoRefreshRuntime() {
  installedCleanup?.();
  installedCleanup = null;
  installationPromise = null;
  installGeneration += 1;
  activeRepoId = null;
  activeRepoLocalReady = false;
  lifecycleFocused = true;
  lifecycleVisible = true;
  clearActiveRepoTimer();
  clearAutoSyncTimer();
  remoteFailureCounts.clear();
  remoteNextAttemptAt.clear();
  localRefreshPausedApplied = null;
  resetWorkspaceTaskWaitersForTests();
}

export function resetRepoRefreshRuntimeForTests() {
  resetRepoRefreshRuntime();
}
