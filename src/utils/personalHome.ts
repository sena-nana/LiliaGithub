import type { RecentLocalRepoVisit, RemoteRepoShortcut, RepoSummary } from "../services/workspace";
import type { PersonalHomeNotification } from "../services/personalHome";
import { remoteRepoRoute } from "./remoteRepo";
import { repoRoute } from "./repoRoutes";

export interface PersonalHomeRecentRepository {
  key: string;
  name: string;
  detail: string;
  openedAt: number;
  to: string;
  source: "local" | "remote";
}

export function personalHomeRecentRepositories(
  settings: {
    readonly recentLocalRepos: readonly Readonly<RecentLocalRepoVisit>[];
    readonly hiddenRepoIds: readonly string[];
    readonly remoteRepoShortcuts: readonly Readonly<RemoteRepoShortcut>[];
  } | null,
  repos: readonly RepoSummary[],
  limit = 6,
): PersonalHomeRecentRepository[] {
  if (!settings) return [];
  const reposById = new Map(repos.map((repo) => [repo.id, repo]));
  const local = (settings.recentLocalRepos ?? []).flatMap((visit) => {
    const repo = reposById.get(visit.repoId);
    if (!repo || settings.hiddenRepoIds.includes(repo.id)) return [];
    return [{
      key: `local:${repo.id}`,
      name: repo.name,
      detail: repo.githubFullName || repo.relativePath || repo.path,
      openedAt: visit.openedAt,
      to: repoRoute(repo.id),
      source: "local" as const,
    }];
  });
  const remote = settings.remoteRepoShortcuts.map((repo) => ({
    key: `remote:${repo.fullName.toLocaleLowerCase()}`,
    name: repo.name || repo.fullName.split("/").slice(-1)[0] || repo.fullName,
    detail: repo.fullName,
    openedAt: repo.openedAt,
    to: remoteRepoRoute(repo.fullName),
    source: "remote" as const,
  }));
  return [...local, ...remote]
    .sort((left, right) => right.openedAt - left.openedAt || left.detail.localeCompare(right.detail))
    .slice(0, Math.max(0, limit));
}

export function notificationTypeCounts(notifications: readonly PersonalHomeNotification[]) {
  const counts = new Map<string, number>();
  for (const notification of notifications) {
    if (!notification.unread) continue;
    const key = notificationTypeLabel(notification.subjectType);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function notificationTypeLabel(type: string) {
  const normalized = type.toLocaleLowerCase();
  if (normalized.includes("pull")) return "Pull Request";
  if (normalized.includes("issue")) return "Issue";
  if (normalized.includes("discussion")) return "Discussion";
  if (normalized.includes("release")) return "Release";
  if (normalized.includes("workflow") || normalized.includes("check")) return "Actions";
  return "其他";
}

export function formatPersonalHomeTime(timestamp: number | string, now = Date.now()) {
  const value = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(value)) return "时间未知";
  const delta = Math.max(0, now - value);
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 2_592_000_000) return `${Math.floor(delta / 86_400_000)} 天前`;
  return new Date(value).toLocaleDateString();
}
