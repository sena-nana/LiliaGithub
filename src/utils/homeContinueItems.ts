import type { RepoSummary, WorkspaceRecentContextV1 } from "../services/workspace";
import { repoDisplayName } from "./repoDisplay";
import { repoRoute } from "./repoRoutes";

export type HomeContinueItem = {
  id: string;
  title: string;
  detail: string;
  route: string;
  timestamp: number;
};

const CONTINUE_LIMIT = 6;

export function buildHomeContinueItems(input: {
  recentContext: WorkspaceRecentContextV1 | null | undefined;
  recentLocalRepos: readonly { repoId: string; openedAt: number }[];
  repos: readonly RepoSummary[];
  currentRoute?: string | null;
}): HomeContinueItem[] {
  const byId = new Map(input.repos.map((repo) => [repo.id, repo]));
  const items: HomeContinueItem[] = [];
  const seenRoutes = new Set<string>();
  const seenRepos = new Set<string>();
  const currentRoute = normalizeRoute(input.currentRoute);

  const recentRoute = normalizeRoute(input.recentContext?.route);
  if (recentRoute && recentRoute !== "/" && recentRoute !== "/overview" && recentRoute !== currentRoute) {
    const match = matchRepoRoute(recentRoute, byId);
    if (match?.repoId) seenRepos.add(match.repoId);
    pushItem(items, seenRoutes, {
      id: `context:${recentRoute}`,
      title: match?.title ?? "继续上次工作",
      detail: match?.detail ?? recentRoute,
      route: recentRoute,
      timestamp: Date.now(),
    });
  }

  for (const visit of [...input.recentLocalRepos].sort((a, b) => b.openedAt - a.openedAt)) {
    if (items.length >= CONTINUE_LIMIT) break;
    if (seenRepos.has(visit.repoId)) continue;
    const repo = byId.get(visit.repoId);
    if (!repo) continue;
    const route = repoRoute(repo.id, "repo");
    if (normalizeRoute(route) === currentRoute) continue;
    seenRepos.add(repo.id);
    pushItem(items, seenRoutes, {
      id: `recent:${repo.id}`,
      title: repoDisplayName(repo) || repo.name,
      detail: repo.currentBranch ? `分支 ${repo.currentBranch}` : repo.path,
      route,
      timestamp: visit.openedAt,
    });
  }

  return items;
}

function pushItem(items: HomeContinueItem[], seen: Set<string>, item: HomeContinueItem) {
  const key = normalizeRoute(item.route);
  if (!key || seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

function normalizeRoute(route: string | null | undefined) {
  if (!route?.trim()) return "";
  const path = route.trim().split(/[?#]/)[0] ?? "";
  if (!path || path === "/") return path;
  return path.replace(/\/+$/, "") || "/";
}

function matchRepoRoute(route: string, repos: Map<string, RepoSummary>) {
  const match = /^\/repos\/([^/]+)/.exec(route);
  if (!match) return null;
  const repoId = decodeURIComponent(match[1] ?? "");
  const repo = repos.get(repoId);
  if (!repo) return { repoId, title: "继续仓库工作", detail: route };
  return {
    repoId,
    title: repoDisplayName(repo) || repo.name,
    detail: continueDetailForRoute(route, repo),
  };
}

function continueDetailForRoute(route: string, repo: RepoSummary) {
  if (route.includes("/pulls/")) return "继续 Pull Request";
  if (route.includes("/issues/")) return "继续 Issue";
  if (route.includes("/actions/")) return "继续 Actions";
  if (route.includes("/changes")) return "继续本地变更";
  return repo.currentBranch ? `分支 ${repo.currentBranch}` : repo.path;
}
