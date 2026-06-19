import type { RouteLocationNormalizedLoaded } from "vue-router";

export type RepoRouteTab = "files" | "repo" | "changes" | "history" | "stash" | "run";
export type RepoProjectTab = "readme" | "issues" | "pulls" | "actions" | "settings";

export function repoRoute(repoId: string, tab: RepoRouteTab = "repo") {
  const base = `/repos/${encodeURIComponent(repoId)}`;
  return tab === "repo" ? base : `${base}/${tab}`;
}

export function repoProjectRoute(
  repoId: string,
  projectTab: Exclude<RepoProjectTab, "readme">,
  focusId?: number | null,
) {
  const query = new URLSearchParams({ projectTab });
  if (projectTab === "issues" && focusId) query.set("issue", String(focusId));
  if (projectTab === "pulls" && focusId) query.set("pr", String(focusId));
  if (projectTab === "actions" && focusId) query.set("run", String(focusId));
  return `${repoRoute(repoId)}?${query.toString()}`;
}

export function repoRouteTabFromRoute(route: Pick<RouteLocationNormalizedLoaded, "meta" | "query">): RepoRouteTab {
  const metaTab = route.meta.repoTab;
  if (isRepoRouteTab(metaTab)) return metaTab;

  const queryTab = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab;
  if (queryTab === "changes" || queryTab === "history") return queryTab;
  return "repo";
}

function isRepoRouteTab(value: unknown): value is RepoRouteTab {
  return value === "files" || value === "repo" || value === "changes" || value === "history" || value === "stash" || value === "run";
}
