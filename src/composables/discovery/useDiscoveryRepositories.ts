import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryValue } from "vue-router";
import type { DiscoveryRepositoryInput } from "../../services/discovery/types";
import {
  listGitHubRepoOwners,
  listGitHubRepos,
  preloadGitHubRepos,
} from "../../services/workspace/client";
import type {
  GitHubRepoOwner,
  GitHubRepoSummary,
  GitHubRepositoryScope,
} from "../../services/workspace/types";
import { favoriteRepositories } from "../../utils/repoFavorites";
import { githubRepositoryIdentityKey } from "../../utils/remoteRepo";
import {
  githubOrganizationOwners,
  githubRepositoryScopeFromQuery,
  githubRepositoryScopeKey,
  githubRepositoryScopeQuery,
} from "../../utils/githubRepositoryScope";
import { useWorkspace } from "../useWorkspace";

const BATCH_SIZE = 12;
export type DiscoveryRepositoryScope = { kind: "frequent" } | GitHubRepositoryScope;

export function useDiscoveryRepositories() {
  const workspace = useWorkspace();
  const route = useRoute();
  const router = useRouter();
  const scope = ref<DiscoveryRepositoryScope>({ kind: "frequent" });
  const owners = ref<GitHubRepoOwner[]>([]);
  const allRepos = ref<GitHubRepoSummary[]>([]);
  const nextPage = ref<number | null>(null);
  const visibleCount = ref(BATCH_SIZE);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  const refreshToken = ref(0);
  let generation = 0;

  const login = computed(() => workspace.githubBinding.value?.login ?? "");
  const organizations = computed(() => githubOrganizationOwners(owners.value));
  const localByFullName = computed(() => new Map(workspace.state.repos.flatMap((repo) => repo.githubFullName
    ? [[githubRepositoryIdentityKey(repo.githubFullName), repo] as const]
    : [])));
  const frequentRepositories = computed<DiscoveryRepositoryInput[]>(() => {
    const byKey = new Map<string, DiscoveryRepositoryInput>();
    const add = (fullName: string, localRepo: DiscoveryRepositoryInput["localRepo"] = null) => {
      const key = githubRepositoryIdentityKey(fullName);
      if (!key || byKey.has(key)) return;
      byKey.set(key, {
        fullName,
        localRepo: localRepo ?? localByFullName.value.get(key) ?? null,
        remote: allRepos.value.find((repo) => githubRepositoryIdentityKey(repo.fullName) === key) ?? null,
      });
    };
    for (const favorite of favoriteRepositories(workspace.state.settings, workspace.state.repos)) {
      const fullName = favorite.localRepo?.githubFullName ?? favorite.remoteShortcut?.fullName;
      if (fullName) add(fullName, favorite.localRepo);
    }
    for (const visit of [...(workspace.state.settings?.recentLocalRepos ?? [])].sort((a, b) => b.openedAt - a.openedAt)) {
      const repo = workspace.state.repos.find((item) => item.id === visit.repoId);
      if (repo?.githubFullName) add(repo.githubFullName, repo);
    }
    for (const shortcut of [...(workspace.state.settings?.remoteRepoShortcuts ?? [])].sort((a, b) => b.openedAt - a.openedAt)) {
      add(shortcut.fullName);
    }
    for (const repo of workspace.state.repos) {
      if (repo.githubFullName) add(repo.githubFullName, repo);
    }
    return [...byKey.values()].slice(0, BATCH_SIZE);
  });

  const pagedRepositories = computed<DiscoveryRepositoryInput[]>(() => allRepos.value
    .slice(0, visibleCount.value)
    .map((remote) => ({
      fullName: remote.fullName,
      remote,
      localRepo: localByFullName.value.get(githubRepositoryIdentityKey(remote.fullName)) ?? null,
    })));
  const repositories = computed(() => scope.value.kind === "frequent"
    ? frequentRepositories.value
    : pagedRepositories.value);
  const hasMore = computed(() => scope.value.kind !== "frequent"
    && (visibleCount.value < allRepos.value.length || nextPage.value != null));

  async function loadRepositories(force = false) {
    const current = ++generation;
    loading.value = true;
    error.value = null;
    try {
      if (scope.value.kind === "frequent") {
        visibleCount.value = BATCH_SIZE;
        if (force) refreshToken.value += 1;
        return;
      }
      const page = await preloadGitHubRepos({ force, scope: scope.value });
      if (current !== generation) return;
      allRepos.value = dedupe(page.items);
      nextPage.value = page.nextPage;
      visibleCount.value = BATCH_SIZE;
      if (force) refreshToken.value += 1;
    } catch (reason) {
      if (current === generation) error.value = cleanError(reason);
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  async function loadMore() {
    if (scope.value.kind === "frequent") return;
    if (visibleCount.value < allRepos.value.length) {
      visibleCount.value = Math.min(visibleCount.value + BATCH_SIZE, allRepos.value.length);
      return;
    }
    if (!nextPage.value || loadingMore.value) return;
    const current = generation;
    const pageNumber = nextPage.value;
    loadingMore.value = true;
    error.value = null;
    try {
      const page = await listGitHubRepos(scope.value, pageNumber);
      if (current !== generation) return;
      allRepos.value = dedupe([...allRepos.value, ...page.items]);
      nextPage.value = page.nextPage;
      visibleCount.value = Math.min(visibleCount.value + BATCH_SIZE, allRepos.value.length);
    } catch (reason) {
      if (current === generation) error.value = cleanError(reason);
    } finally {
      if (current === generation) loadingMore.value = false;
    }
  }

  async function setScope(next: DiscoveryRepositoryScope) {
    if (discoveryScopeKey(next) === discoveryScopeKey(scope.value)) return;
    scope.value = next;
    await router.replace({ query: { ...route.query, ...discoveryScopeQuery(next) } });
    await loadRepositories();
  }

  watch(
    () => [workspace.isReady.value, workspace.githubBinding.value?.boundAt ?? 0] as const,
    async ([ready]) => {
      generation += 1;
      allRepos.value = [];
      nextPage.value = null;
      if (!ready) return;
      try { owners.value = await listGitHubRepoOwners(); } catch { owners.value = []; }
      scope.value = discoveryScopeFromQuery(
        route.query.githubScope,
        route.query.githubOwner,
        login.value,
        owners.value,
      );
      await loadRepositories();
    },
    { immediate: true },
  );

  onUnmounted(() => { generation += 1; });

  return {
    scope, login, organizations, repositories, frequentRepositories, loading, loadingMore,
    error, hasMore, refreshToken, setScope, loadMore, refresh: () => loadRepositories(true),
  };
}

function dedupe(repos: readonly GitHubRepoSummary[]) {
  return [...new Map(repos.map((repo) => [githubRepositoryIdentityKey(repo.fullName), repo])).values()];
}

function discoveryScopeKey(scope: DiscoveryRepositoryScope) {
  return scope.kind === "frequent" ? "frequent" : githubRepositoryScopeKey(scope);
}

function discoveryScopeQuery(scope: DiscoveryRepositoryScope) {
  return scope.kind === "frequent"
    ? { githubScope: "frequent", githubOwner: undefined }
    : githubRepositoryScopeQuery(scope);
}

function discoveryScopeFromQuery(
  scope: LocationQueryValue | LocationQueryValue[] | undefined,
  owner: LocationQueryValue | LocationQueryValue[] | undefined,
  login: string,
  owners: readonly GitHubRepoOwner[],
): DiscoveryRepositoryScope {
  if (scope == null || scope === "frequent") return { kind: "frequent" };
  return githubRepositoryScopeFromQuery(scope, owner, login, owners);
}

function cleanError(reason: unknown) {
  return (reason instanceof Error ? reason.message : String(reason)).replace(/^Error:\s*/, "");
}
