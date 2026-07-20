import type { RouteLocationNormalizedLoaded } from "vue-router";

export type RepoRouteTab = "files" | "repo" | "changes" | "history" | "stash" | "run";
export type RepoProjectTab = "readme" | "issues" | "pulls" | "discussions" | "actions" | "release" | "settings";
export type RepoProjectCreateFlow = "issue" | "pull" | "discussion" | "release";

const createFlowTabs: Record<RepoProjectCreateFlow, Exclude<RepoProjectTab, "readme">> = {
  issue: "issues",
  pull: "pulls",
  discussion: "discussions",
  release: "release",
};

export function repoRoute(repoId: string, tab: RepoRouteTab = "repo") {
  const base = `/repos/${encodeURIComponent(repoId)}`;
  return tab === "repo" ? base : `${base}/${tab}`;
}

export function repoCommitRoute(repoId: string, hash: string) {
  return `${repoRoute(repoId)}/commits/${encodeURIComponent(hash)}`;
}

export function repoConflictRoute(repoId: string) {
  return `${repoRoute(repoId, "changes")}?resolveConflicts=1`;
}

export function repoProjectRoute(
  repoId: string,
  projectTab: Exclude<RepoProjectTab, "readme">,
  focusId?: number | null,
  jobId?: number | null,
  releaseTag?: string | null,
) {
  const query = new URLSearchParams({ projectTab });
  if (projectTab === "issues" && focusId) query.set("issue", String(focusId));
  if (projectTab === "pulls" && focusId) query.set("pr", String(focusId));
  if (projectTab === "discussions" && focusId) query.set("discussion", String(focusId));
  if (projectTab === "actions" && focusId) {
    query.set("run", String(focusId));
    if (jobId) query.set("job", String(jobId));
  }
  if (projectTab === "release" && releaseTag) query.set("releaseTag", releaseTag);
  return `${repoRoute(repoId)}?${query.toString()}`;
}

export function normalizeRepoProjectTab(value: unknown): RepoProjectTab | null {
  const next = Array.isArray(value) ? value[0] : value;
  if (
    next === "readme" ||
    next === "issues" ||
    next === "pulls" ||
    next === "discussions" ||
    next === "actions" ||
    next === "release" ||
    next === "settings"
  ) return next;
  return null;
}

export function normalizeRepoProjectCreateFlow(value: unknown): RepoProjectCreateFlow | null {
  const next = Array.isArray(value) ? value[0] : value;
  if (next === "issue" || next === "pull" || next === "discussion" || next === "release") return next;
  return null;
}

export function repoProjectCreateRoute(repoId: string, createFlow: RepoProjectCreateFlow) {
  const query = new URLSearchParams({
    projectTab: createFlowTabs[createFlow],
    create: createFlow,
  });
  return `${repoRoute(repoId)}?${query.toString()}`;
}

export function repoRouteTabFromRoute(route: Pick<RouteLocationNormalizedLoaded, "meta" | "path" | "query">): RepoRouteTab {
  const metaTab = route.meta.repoTab;
  if (isRepoRouteTab(metaTab)) return metaTab;

  const queryTab = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab;
  if (queryTab === "changes" || queryTab === "history") return queryTab;
  const pathSegments = route.path.split("?")[0]?.split("/").filter(Boolean) ?? [];
  const pathTab = pathSegments[pathSegments.length - 1];
  if (isRepoRouteTab(pathTab) && pathTab !== "repo") return pathTab;
  return "repo";
}

function isRepoRouteTab(value: unknown): value is RepoRouteTab {
  return value === "files" || value === "repo" || value === "changes" || value === "history" || value === "stash" || value === "run";
}
