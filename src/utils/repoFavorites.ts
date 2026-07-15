import type {
  RemoteRepoShortcut,
  RepoSummary,
} from "../services/workspace";
import { repoDisplayName, repoDisplayTitle } from "./repoDisplay";
import { githubRepositoryIdentityKey } from "./remoteRepo";

export interface FavoriteRepositoryEntry {
  key: string;
  name: string;
  title: string;
  localRepo: RepoSummary | null;
  remoteShortcut: Readonly<RemoteRepoShortcut> | null;
  localFavorite: boolean;
  remoteFavorite: boolean;
}

interface FavoriteRepositorySettings {
  readonly favoriteRepoIds: readonly string[];
  readonly remoteRepoShortcuts: readonly Readonly<RemoteRepoShortcut>[];
}

function localFavoriteKey(repo: RepoSummary) {
  return repo.githubFullName
    ? `github:${githubRepositoryIdentityKey(repo.githubFullName)}`
    : `local:${repo.id}`;
}

export function favoriteRepositories(
  settings: FavoriteRepositorySettings | null,
  repos: readonly RepoSummary[],
): FavoriteRepositoryEntry[] {
  if (!settings) return [];
  const entries = new Map<string, FavoriteRepositoryEntry>();
  const reposById = new Map(repos.map((repo) => [repo.id, repo]));
  const reposByFullName = new Map(
    repos.flatMap((repo) => repo.githubFullName
      ? [[githubRepositoryIdentityKey(repo.githubFullName), repo] as const]
      : []),
  );

  for (const repoId of settings.favoriteRepoIds ?? []) {
    const repo = reposById.get(repoId);
    if (!repo) continue;
    const key = localFavoriteKey(repo);
    entries.set(key, {
      key,
      name: repoDisplayName(repo),
      title: repoDisplayTitle(repo),
      localRepo: repo,
      remoteShortcut: null,
      localFavorite: true,
      remoteFavorite: false,
    });
  }

  for (const shortcut of settings.remoteRepoShortcuts.filter((repo) => repo.favorite)) {
    const identity = githubRepositoryIdentityKey(shortcut.fullName);
    const key = `github:${identity}`;
    const localRepo = reposByFullName.get(identity) ?? null;
    const current = entries.get(key);
    entries.set(key, {
      key,
      name: localRepo ? repoDisplayName(localRepo) : shortcut.name,
      title: localRepo ? repoDisplayTitle(localRepo) : shortcut.fullName,
      localRepo,
      remoteShortcut: shortcut,
      localFavorite: current?.localFavorite ?? false,
      remoteFavorite: true,
    });
  }

  return [...entries.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
    left.key.localeCompare(right.key),
  );
}
