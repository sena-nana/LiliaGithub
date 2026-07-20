import { useRouter, type LocationQueryRaw, type RouteLocationNormalizedLoaded, type Router } from "vue-router";
import { useWorkspace } from "./useWorkspace";
import type { WorkspaceRecentContextV1 } from "../services/workspace";
import {
  normalizeRepoProjectTab,
  repoCommitRoute,
  repoRoute,
  repoRouteTabFromRoute,
} from "../utils/repoRoutes";

const CONTEXT_VERSION = 1 as const;

const PROJECT_FILTER_KEYS = {
  issues: [
    "issueState", "issueQ", "issueCreator", "issueAssignee", "issueLabels",
    "issueMilestone", "issueProject", "issueSort", "issueDirection",
  ],
  pulls: [
    "pullState", "pullQ", "pullCreator", "pullAssignee", "pullLabels",
    "pullMilestone", "pullProject", "pullSort", "pullDirection", "pullReview",
  ],
  discussions: [
    "discussionState", "discussionCategory", "discussionAnswered",
    "discussionSort", "discussionDirection",
  ],
  actions: [
    "actionState", "actionQ", "actionWorkflow", "actionBranch", "actionEvent",
    "actionActor", "actionStatus", "actionSort", "actionDirection",
  ],
} as const;
const PROJECT_TARGET_KEYS = {
  issues: "issue",
  pulls: "pr",
  discussions: "discussion",
  actions: "run",
} as const;

type WorkspaceApi = ReturnType<typeof useWorkspace>;
type PendingWrite = { workspaceId: string; context: WorkspaceRecentContextV1 | null };

const controllers = new WeakMap<Router, ReturnType<typeof createWorkspaceRecentContextController>>();
const activeControllers = new Set<ReturnType<typeof createWorkspaceRecentContextController>>();

export async function flushWorkspaceRecentContexts() {
  await Promise.all([...activeControllers].map((controller) => controller.flush()));
}

export function useWorkspaceRecentContext() {
  const router = useRouter();
  const existing = controllers.get(router);
  if (existing) return existing;
  const controller = createWorkspaceRecentContextController(router, useWorkspace());
  controllers.set(router, controller);
  activeControllers.add(controller);
  return controller;
}

export function normalizeWorkspaceRecentContextRoute(
  router: Router,
  route: Pick<RouteLocationNormalizedLoaded, "meta" | "params" | "path" | "query">,
): string | null {
  const repoId = route.params.repoId;
  if (typeof repoId !== "string" || !repoId.trim() || !route.path.startsWith("/repos/")) return null;

  const hash = route.params.hash;
  if (typeof hash === "string" && hash.trim()) {
    return router.resolve(repoCommitRoute(repoId, hash.trim())).fullPath;
  }

  const tab = repoRouteTabFromRoute(route);
  const path = repoRoute(repoId, tab);
  const query: LocationQueryRaw = {};

  if (tab === "files") {
    copyString(route, query, "ref");
    if (copyString(route, query, "file")) copyString(route, query, "hash");
  } else if (tab === "changes") {
    copyString(route, query, "change");
  } else if (tab === "repo") {
    const projectTab = normalizeRepoProjectTab(route.query.projectTab);
    if (projectTab && projectTab !== "readme") {
      query.projectTab = projectTab;
      if (projectTab in PROJECT_FILTER_KEYS) {
        const key = projectTab as keyof typeof PROJECT_FILTER_KEYS;
        const hasTarget = copyPositiveInteger(route, query, PROJECT_TARGET_KEYS[key]);
        if (key === "actions" && hasTarget) copyPositiveInteger(route, query, "job");
        copyKeys(route, query, PROJECT_FILTER_KEYS[key]);
      } else if (projectTab === "release") {
        copyString(route, query, "releaseTag");
        copyEnum(route, query, "releaseType", ["all", "stable", "latest", "prerelease", "draft"]);
      }
    }
  }

  return router.resolve({ path, query }).fullPath;
}

export function createWorkspaceRecentContextController(router: Router, workspace: WorkspaceApi) {
  const initialFullPath = router.currentRoute.value.fullPath;
  const savedByWorkspace = new Map<string, WorkspaceRecentContextV1 | null>();
  let ready = false;
  let recordingPaused = false;
  let pending: PendingWrite | null = null;
  let writer: Promise<void> | null = null;

  const removeAfterEach = router.afterEach((to) => {
    if (!ready || recordingPaused) return;
    recordRoute(to);
  });

  async function initialize() {
    await workspace.initialize();
    if (initialFullPath === "/" && router.currentRoute.value.fullPath === "/") {
      await restoreActiveWorkspace();
    } else {
      ready = true;
      recordRoute(router.currentRoute.value);
    }
  }

  async function switchWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === workspace.activeWorkspace.value?.id) return;
    recordRoute(router.currentRoute.value);
    await flush();
    await withRecordingPaused(async () => {
      await workspace.switchWorkspace(workspaceId);
      await replaceWithActiveWorkspaceContext();
    });
    recordRoute(router.currentRoute.value);
  }

  async function createWorkspace(name: string, rootPath: string) {
    recordRoute(router.currentRoute.value);
    await flush();
    await withRecordingPaused(async () => {
      await workspace.createWorkspace(name, rootPath);
      await router.replace("/");
    });
  }

  async function deleteWorkspace(workspaceId: string) {
    await withRecordingPaused(async () => {
      await workspace.deleteWorkspace(workspaceId);
      await replaceWithActiveWorkspaceContext();
    });
    recordRoute(router.currentRoute.value);
  }

  async function restoreActiveWorkspace() {
    await withRecordingPaused(replaceWithActiveWorkspaceContext);
    recordRoute(router.currentRoute.value);
  }

  async function withRecordingPaused<T>(action: () => Promise<T>): Promise<T> {
    recordingPaused = true;
    try {
      return await action();
    } finally {
      recordingPaused = false;
      ready = true;
    }
  }

  async function replaceAfterConfirmedMissing(target: string) {
    await router.replace(target);
    const workspaceId = workspace.activeWorkspace.value?.id;
    if (!workspaceId) return;
    const normalized = normalizeWorkspaceRecentContextRoute(router, router.currentRoute.value);
    queueWrite(workspaceId, normalized ? { version: CONTEXT_VERSION, route: normalized } : null);
    await flush();
  }

  async function replaceWithActiveWorkspaceContext() {
    const active = workspace.activeWorkspace.value;
    if (!active) {
      await router.replace("/");
      return;
    }
    const stored = active.recentContext;
    const resolved = stored?.version === CONTEXT_VERSION
      ? router.resolve(stored.route)
      : null;
    const normalized = resolved
      ? normalizeWorkspaceRecentContextRoute(router, resolved)
      : null;
    if (!normalized) {
      if (stored) queueWrite(active.id, null);
      if (router.currentRoute.value.fullPath !== "/") await router.replace("/");
      return;
    }
    if (stored?.route === normalized) savedByWorkspace.set(active.id, stored);
    await router.replace(normalized);
  }

  function recordRoute(route: RouteLocationNormalizedLoaded) {
    const workspaceId = workspace.activeWorkspace.value?.id;
    if (!workspaceId) return;
    const normalized = normalizeWorkspaceRecentContextRoute(router, route);
    if (!normalized) return;
    queueWrite(workspaceId, { version: CONTEXT_VERSION, route: normalized });
  }

  function queueWrite(workspaceId: string, context: WorkspaceRecentContextV1 | null) {
    const saved = savedByWorkspace.get(workspaceId);
    if (sameContext(saved, context)) return;
    if (pending?.workspaceId === workspaceId && sameContext(pending.context, context)) return;
    pending = { workspaceId, context };
    if (!writer) writer = drainWrites();
  }

  async function drainWrites() {
    try {
      while (pending) {
        const next = pending;
        pending = null;
        try {
          await workspace.updateWorkspaceRecentContext(next.workspaceId, next.context);
          savedByWorkspace.set(next.workspaceId, next.context);
        } catch {
          // Persistence is retried on the next eligible route; navigation remains usable.
        }
      }
    } finally {
      writer = null;
    }
  }

  async function flush() {
    while (writer) await writer;
  }

  function dispose() {
    removeAfterEach();
    if (controllers.get(router) === controller) controllers.delete(router);
    activeControllers.delete(controller);
  }

  const controller = {
    initialize,
    switchWorkspace,
    createWorkspace,
    deleteWorkspace,
    replaceAfterConfirmedMissing,
    flush,
    dispose,
  };
  return controller;
}

function copyKeys(
  route: Pick<RouteLocationNormalizedLoaded, "query">,
  query: LocationQueryRaw,
  keys: readonly string[],
) {
  for (const key of keys) copyString(route, query, key);
}

function copyString(route: Pick<RouteLocationNormalizedLoaded, "query">, query: LocationQueryRaw, key: string) {
  const raw = route.query[key];
  const values = (Array.isArray(raw) ? raw : [raw])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  if (!values.length) return false;
  query[key] = values.length === 1 ? values[0] : values;
  return true;
}

function copyPositiveInteger(route: Pick<RouteLocationNormalizedLoaded, "query">, query: LocationQueryRaw, key: string) {
  const raw = Array.isArray(route.query[key]) ? route.query[key][0] : route.query[key];
  if (typeof raw !== "string" || !/^\d+$/.test(raw) || Number(raw) < 1) return false;
  query[key] = String(Number(raw));
  return true;
}

function copyEnum(
  route: Pick<RouteLocationNormalizedLoaded, "query">,
  query: LocationQueryRaw,
  key: string,
  allowed: readonly string[],
) {
  const raw = Array.isArray(route.query[key]) ? route.query[key][0] : route.query[key];
  if (typeof raw !== "string" || !allowed.includes(raw)) return false;
  query[key] = raw;
  return true;
}

function sameContext(left: WorkspaceRecentContextV1 | null | undefined, right: WorkspaceRecentContextV1 | null) {
  return left === right || Boolean(
    left && right && left.version === right.version && left.route === right.route,
  );
}
