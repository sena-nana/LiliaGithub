import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invalidateSessionContextSnapshot } from "./sessionContext";
import { useComponentEpoch } from "./useComponentEpoch";
import { createLatestAsyncLoader } from "./useLatestAsyncLoader";
import { useWorkspace } from "./useWorkspace";
import {
  getGitHubBindingStatus,
  isGitHubBindingExpiredError,
  listGitHubRepos,
  listGitHubRepoOwners,
  preloadGitHubRepos,
  readCachedGitHubRepos,
  type GitHubBindingStatus,
  type GitHubRepoOwner,
  type GitHubRepoSummary,
  type GitHubRepositoryScope,
  type RepoSummary,
} from "../services/workspace";
import {
  ALL_GITHUB_REPOSITORIES,
  githubOrganizationAccessLimited,
  githubOrganizationAccessMessage,
  githubOrganizationAccessRecovery,
  githubOrganizationOwners,
  githubRepositoryScopeKey,
  githubUserFacingError,
} from "../utils/githubRepositoryScope";
import { githubRepositoryIdentityKey } from "../utils/remoteRepo";

type UseCloneRepoDialogOptions = {
  onCloned: (repo: RepoSummary, groupId: string | null) => void | Promise<void>;
};

function normalizeGitHubCloneInput(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const matched = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (matched) return `${matched[1]}/${matched[2]}`;
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) return trimmed.replace(/\.git$/i, "");
  return null;
}

function inferCloneDirectoryName(remoteUrl: string) {
  const input = normalizeGitHubCloneInput(remoteUrl) ?? remoteUrl.trim();
  const trimmed = input.replace(/\/+$/, "").replace(/\.git$/i, "");
  const scpPath = trimmed.match(/^[\w.-]+@[^:]+:(.+)$/)?.[1];
  const source = scpPath ?? trimmed;
  const parts = source.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function dedupeCloneRepos(items: GitHubRepoSummary[]) {
  const seen = new Set<string>();
  const next: GitHubRepoSummary[] = [];
  for (const item of items) {
    const key = githubRepositoryIdentityKey(item.fullName);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

function cloneErrorMessage(err: unknown) {
  return githubUserFacingError(err);
}

export function useCloneRepoDialog(options: UseCloneRepoDialogOptions) {
  const workspace = useWorkspace();
  const router = useRouter();
  const componentEpoch = useComponentEpoch();
  const cloneBindingLoader = createLatestAsyncLoader({ componentEpoch });
  const cloneRepoPageLoader = createLatestAsyncLoader({ componentEpoch });
  const cloneRepoOwnersLoader = createLatestAsyncLoader({ componentEpoch });

  const cloneOpen = ref(false);
  const cloneRemoteUrl = ref("");
  const cloneDirectoryName = ref("");
  const cloneTouchedDirectory = ref(false);
  const cloneBusy = ref(false);
  const cloneError = ref<string | null>(null);
  const cloneBindingStatus = ref<GitHubBindingStatus | null>(null);
  const cloneRepoItems = ref<GitHubRepoSummary[]>([]);
  const cloneRepoOwners = ref<GitHubRepoOwner[]>([]);
  const cloneRepoOwnersLoading = ref(false);
  const cloneRepoOwnersError = ref<string | null>(null);
  const cloneRepositoryScope = ref<GitHubRepositoryScope>(ALL_GITHUB_REPOSITORIES);
  const cloneRepoLoaded = ref(false);
  const cloneRepoDropdownOpen = ref(false);
  const cloneRepoLoading = ref(false);
  const cloneRepoLoadingMore = ref(false);
  const cloneRepoLoadError = ref<string | null>(null);
  const cloneNextRepoPage = ref<number | null>(null);
  const cloneSelectedRepo = ref<GitHubRepoSummary | null>(null);
  const cloneSelectedGroupId = ref<string | null>(null);
  const cloneScopePages = new Map<string, {
    items: GitHubRepoSummary[];
    nextPage: number | null;
    loaded: boolean;
    error: string | null;
  }>();
  let cloneSearchPaginationRun = 0;
  let cloneSearchPagesLoading = false;

  const canSubmitClone = computed(() => cloneRemoteUrl.value.trim().length > 0 && !cloneBusy.value);
  const cloneGitHubBound = computed(() => cloneBindingStatus.value?.state === "bound");
  const cloneQueryTrimmed = computed(() => cloneRemoteUrl.value.trim());
  const cloneBindingExpired = computed(() => cloneError.value?.includes("GitHub 绑定已失效") === true);
  const cloneDirectGitHubRepo = computed(() => normalizeGitHubCloneInput(cloneQueryTrimmed.value));
  const cloneOrganizationOwners = computed(() => githubOrganizationOwners(cloneRepoOwners.value));
  const cloneOrganizationAccessLimited = computed(() =>
    githubOrganizationAccessLimited(cloneBindingStatus.value?.binding?.scopes, cloneRepoOwners.value),
  );
  const cloneOrganizationRecovery = computed(() => githubOrganizationAccessRecovery(cloneRepoOwners.value));
  const cloneOrganizationAccessMessage = computed(() => githubOrganizationAccessMessage(cloneRepoOwners.value));
  const filteredCloneRepos = computed(() => {
    const text = cloneQueryTrimmed.value.toLowerCase();
    if (!text) return cloneRepoItems.value;
    return cloneRepoItems.value.filter((repo) =>
      repo.fullName.toLowerCase().includes(text) ||
      repo.name.toLowerCase().includes(text) ||
      (repo.description ?? "").toLowerCase().includes(text),
    );
  });
  const localCloneRepoFullNames = computed(() => workspace.state.repos
    .map((repo) => repo.githubFullName)
    .filter((fullName): fullName is string => Boolean(fullName)));

  function applyCloneRepoPage(result: { items: GitHubRepoSummary[]; nextPage: number | null }, append = false) {
    cloneRepoLoadError.value = null;
    cloneNextRepoPage.value = result.nextPage;
    cloneRepoItems.value = append
      ? dedupeCloneRepos([...cloneRepoItems.value, ...result.items])
      : result.items;
    cloneRepoLoaded.value = true;
    rememberCloneScopePage();
  }

  function rememberCloneScopePage() {
    cloneScopePages.set(githubRepositoryScopeKey(cloneRepositoryScope.value), {
      items: cloneRepoItems.value.map((repo) => ({ ...repo })),
      nextPage: cloneNextRepoPage.value,
      loaded: cloneRepoLoaded.value,
      error: cloneRepoLoadError.value,
    });
  }

  function restoreCloneScopePage(scope: GitHubRepositoryScope) {
    const page = cloneScopePages.get(githubRepositoryScopeKey(scope));
    cloneRepoItems.value = page?.items.map((repo) => ({ ...repo })) ?? [];
    cloneNextRepoPage.value = page?.nextPage ?? null;
    cloneRepoLoaded.value = page?.loaded ?? false;
    cloneRepoLoadError.value = page?.error ?? null;
    cloneSelectedRepo.value = null;
  }

  function showCloneRepoLoadError(err: unknown) {
    const expired = isGitHubBindingExpiredError(err);
    cloneRepoLoadError.value = expired
      ? "GitHub 绑定已失效，请重新绑定后再加载账号仓库。"
      : `仓库列表加载失败：${githubUserFacingError(err)}`;
    if (expired) {
      cloneError.value = "GitHub 绑定已失效，请重新绑定。";
    }
    cloneRepoItems.value = [];
    cloneNextRepoPage.value = null;
    cloneSelectedRepo.value = null;
    cloneRepoLoaded.value = false;
    rememberCloneScopePage();
  }

  async function loadCloneRepoPage(
    page = 1,
    append = false,
    loadOptions: { force?: boolean; showLoading?: boolean } = {},
  ) {
    if (!cloneGitHubBound.value) return;
    const scope = cloneRepositoryScope.value;
    const scopeKey = githubRepositoryScopeKey(scope);
    const key = `${scopeKey}:${append ? "append" : "replace"}:${page}:${loadOptions.force ? "force" : "cache"}`;
    await cloneRepoPageLoader.run(key, async (runId) => {
      const showLoading = loadOptions.showLoading ?? !append;
      if (append) {
        cloneRepoLoadingMore.value = true;
      } else if (showLoading) {
        cloneRepoLoading.value = true;
      }
      try {
        const result = page === 1
          ? await preloadGitHubRepos({ force: loadOptions.force, scope })
          : await listGitHubRepos(scope, page);
        if (!cloneRepoPageLoader.isCurrent(runId) || !cloneOpen.value || !cloneGitHubBound.value) return;
        if (githubRepositoryScopeKey(cloneRepositoryScope.value) !== scopeKey) return;
        applyCloneRepoPage(result, append);
      } catch (err) {
        if (!cloneRepoPageLoader.isCurrent(runId) || !cloneOpen.value) return;
        showCloneRepoLoadError(err);
      } finally {
        if (!cloneRepoPageLoader.isCurrent(runId)) return;
        if (showLoading) {
          cloneRepoLoading.value = false;
        }
        cloneRepoLoadingMore.value = false;
      }
    });
  }

  async function loadCloneRepoOwners() {
    if (!cloneGitHubBound.value) return;
    await cloneRepoOwnersLoader.run("clone-repo-owners", async (runId) => {
      cloneRepoOwnersLoading.value = true;
      cloneRepoOwnersError.value = null;
      try {
        const owners = await listGitHubRepoOwners();
        if (!cloneRepoOwnersLoader.isCurrent(runId) || !cloneOpen.value) return;
        cloneRepoOwners.value = owners;
      } catch (err) {
        if (!cloneRepoOwnersLoader.isCurrent(runId) || !cloneOpen.value) return;
        cloneRepoOwnersError.value = `账号与组织加载失败：${githubUserFacingError(err)}`;
      } finally {
        if (cloneRepoOwnersLoader.isCurrent(runId)) cloneRepoOwnersLoading.value = false;
      }
    });
  }

  async function selectCloneRepositoryScope(scope: GitHubRepositoryScope) {
    if (githubRepositoryScopeKey(scope) === githubRepositoryScopeKey(cloneRepositoryScope.value)) return;
    invalidateCloneSearchPagination();
    const hadSelectedRepo = cloneSelectedRepo.value !== null;
    rememberCloneScopePage();
    cloneRepositoryScope.value = scope;
    restoreCloneScopePage(scope);
    if (hadSelectedRepo) cloneRemoteUrl.value = "";
    if (!cloneRepoLoaded.value) await loadCloneRepoPage(1);
  }

  function startCloneReposLoad() {
    if (!cloneGitHubBound.value || cloneRepoLoading.value || cloneRepoLoaded.value) return;
    void loadCloneRepoPage(1).catch(() => undefined);
  }

  async function maybeLoadMoreCloneRepos() {
    if (cloneQueryTrimmed.value) {
      await loadRemainingCloneSearchPages();
      return;
    }
    if (!cloneGitHubBound.value || !cloneNextRepoPage.value || cloneRepoLoadingMore.value) return;
    await loadCloneRepoPage(cloneNextRepoPage.value, true);
  }

  function invalidateCloneSearchPagination() {
    cloneSearchPaginationRun += 1;
    cloneSearchPagesLoading = false;
  }

  async function loadRemainingCloneSearchPages() {
    if (
      cloneSearchPagesLoading
      || !cloneOpen.value
      || !cloneGitHubBound.value
      || !cloneQueryTrimmed.value
      || !cloneNextRepoPage.value
      || cloneRepoLoading.value
      || cloneRepoLoadingMore.value
    ) return;
    const run = ++cloneSearchPaginationRun;
    cloneSearchPagesLoading = true;
    try {
      while (
        run === cloneSearchPaginationRun
        && cloneOpen.value
        && cloneGitHubBound.value
        && cloneQueryTrimmed.value
        && cloneNextRepoPage.value
      ) {
        const pageNumber: number = cloneNextRepoPage.value;
        await loadCloneRepoPage(pageNumber, true);
        if (cloneNextRepoPage.value === pageNumber) break;
      }
    } finally {
      if (run !== cloneSearchPaginationRun) return;
      cloneSearchPagesLoading = false;
      if (cloneQueryTrimmed.value && cloneNextRepoPage.value) {
        void Promise.resolve().then(loadRemainingCloneSearchPages);
      }
    }
  }

  async function openCloneDialog(groupId: string | null = null) {
    invalidateCloneSearchPagination();
    cloneBindingLoader.invalidate();
    cloneRepoPageLoader.invalidate();
    cloneRepoOwnersLoader.invalidate();
    cloneOpen.value = true;
    cloneRemoteUrl.value = "";
    cloneDirectoryName.value = "";
    cloneTouchedDirectory.value = false;
    cloneError.value = null;
    cloneBindingStatus.value = null;
    cloneRepoItems.value = [];
    cloneRepoOwners.value = [];
    cloneRepoOwnersLoading.value = false;
    cloneRepoOwnersError.value = null;
    cloneRepositoryScope.value = ALL_GITHUB_REPOSITORIES;
    cloneRepoLoaded.value = false;
    cloneScopePages.clear();
    cloneRepoDropdownOpen.value = false;
    cloneRepoLoading.value = false;
    cloneRepoLoadingMore.value = false;
    cloneRepoLoadError.value = null;
    cloneNextRepoPage.value = null;
    cloneSelectedRepo.value = null;
    cloneSelectedGroupId.value = groupId;
    await cloneBindingLoader.run("clone-binding", async (runId) => {
      try {
        const status = await getGitHubBindingStatus();
        if (!cloneBindingLoader.isCurrent(runId) || !cloneOpen.value) return;
        cloneBindingStatus.value = status;
        if (cloneGitHubBound.value) {
          void loadCloneRepoOwners();
          const cached = readCachedGitHubRepos(cloneRepositoryScope.value);
          if (cached) {
            applyCloneRepoPage(cached);
          }
          void loadCloneRepoPage(1, false, {
            force: Boolean(cached),
            showLoading: !cached,
          }).catch(() => undefined);
        }
      } catch (err) {
        if (!cloneBindingLoader.isCurrent(runId) || !cloneOpen.value) return;
        cloneError.value = String(err);
      }
    });
  }

  function closeCloneDialog() {
    if (cloneBusy.value) return;
    if (cloneOpen.value) invalidateSessionContextSnapshot();
    invalidateCloneSearchPagination();
    cloneBindingLoader.invalidate();
    cloneRepoPageLoader.invalidate();
    cloneRepoOwnersLoader.invalidate();
    cloneOpen.value = false;
    cloneError.value = null;
    cloneRepoLoading.value = false;
    cloneRepoLoadingMore.value = false;
    cloneRepoOwnersLoading.value = false;
  }

  async function submitClone() {
    if (!canSubmitClone.value) return;
    cloneBusy.value = true;
    cloneError.value = null;
    try {
      const selected = cloneSelectedRepo.value;
      const directGitHubRepo = cloneDirectGitHubRepo.value;
      const remote = selected?.cloneUrl
        ?? (directGitHubRepo ? `https://github.com/${directGitHubRepo}.git` : cloneRemoteUrl.value.trim());
      const customPath = cloneDirectoryName.value.trim();
      const summary = await workspace.cloneRepo({
        remoteUrl: remote,
        repository: selected ? {
          id: selected.id,
          fullName: selected.fullName,
          cloneUrl: selected.cloneUrl,
        } : null,
        target: cloneTouchedDirectory.value && customPath
          ? { kind: "custom", path: customPath }
          : { kind: "default" },
      });
      cloneBindingLoader.invalidate();
      cloneRepoPageLoader.invalidate();
      cloneRepoOwnersLoader.invalidate();
      cloneOpen.value = false;
      await options.onCloned(summary, cloneSelectedGroupId.value);
    } catch (err) {
      if (isGitHubBindingExpiredError(err)) {
        showCloneRepoLoadError(err);
      } else {
        cloneError.value = cloneErrorMessage(err);
      }
    } finally {
      cloneBusy.value = false;
    }
  }

  function selectCloneRepo(repo: GitHubRepoSummary) {
    cloneSelectedRepo.value = repo;
    cloneRemoteUrl.value = repo.fullName;
    if (!cloneTouchedDirectory.value) {
      cloneDirectoryName.value = repo.name;
    }
    cloneRepoDropdownOpen.value = false;
  }

  function clearSelectedCloneRepoIfNeeded() {
    if (cloneSelectedRepo.value && cloneSelectedRepo.value.fullName !== cloneQueryTrimmed.value) {
      cloneSelectedRepo.value = null;
    }
  }

  function useDirectCloneTarget() {
    cloneSelectedRepo.value = null;
    cloneRepoDropdownOpen.value = false;
  }

  function openCloneRepoDropdown() {
    cloneRepoDropdownOpen.value = true;
    startCloneReposLoad();
  }

  function handleCloneRepoInput() {
    clearSelectedCloneRepoIfNeeded();
    cloneRepoDropdownOpen.value = true;
    startCloneReposLoad();
    if (cloneQueryTrimmed.value) {
      void maybeLoadMoreCloneRepos();
    }
  }

  async function openGitHubBindingSettings() {
    invalidateSessionContextSnapshot();
    cloneBindingLoader.invalidate();
    cloneRepoPageLoader.invalidate();
    cloneRepoOwnersLoader.invalidate();
    cloneOpen.value = false;
    cloneRepoLoading.value = false;
    cloneRepoLoadingMore.value = false;
    cloneRepoOwnersLoading.value = false;
    await router.push({ path: "/settings", query: { tab: "repositories" } });
  }

  async function openOrganizationAuthorization() {
    if (cloneOrganizationRecovery.value.url) {
      await workspace.openUrl(cloneOrganizationRecovery.value.url);
      return;
    }
    await openGitHubBindingSettings();
  }

  watch(cloneRemoteUrl, (value) => {
    if (cloneTouchedDirectory.value) return;
    cloneDirectoryName.value = cloneSelectedRepo.value?.name ?? inferCloneDirectoryName(value);
  });

  watch(
    () => [
      cloneOpen.value,
      cloneQueryTrimmed.value,
      cloneNextRepoPage.value,
      cloneRepoLoading.value,
      cloneRepoLoadingMore.value,
      githubRepositoryScopeKey(cloneRepositoryScope.value),
    ] as const,
    ([open, query, nextPage, loading, loadingMore]) => {
      if (open && query && nextPage && !loading && !loadingMore) {
        void loadRemainingCloneSearchPages();
      }
    },
  );

  onUnmounted(() => {
    invalidateCloneSearchPagination();
    cloneBindingLoader.invalidate();
    cloneRepoPageLoader.invalidate();
    cloneRepoOwnersLoader.invalidate();
  });

  const props = computed(() => ({
    busy: cloneBusy.value,
    canSubmit: canSubmitClone.value,
    error: cloneError.value,
    bindingExpired: cloneBindingExpired.value,
    gitHubBound: cloneGitHubBound.value,
    bindingStatus: cloneBindingStatus.value,
    remoteUrl: cloneRemoteUrl.value,
    directoryName: cloneDirectoryName.value,
    repoDropdownOpen: cloneRepoDropdownOpen.value,
    filteredRepos: filteredCloneRepos.value,
    repoLoading: cloneRepoLoading.value,
    repoLoadingMore: cloneRepoLoadingMore.value,
    repoLoadError: cloneRepoLoadError.value,
    nextRepoPage: cloneNextRepoPage.value,
    selectedRepo: cloneSelectedRepo.value,
    directRepo: cloneDirectGitHubRepo.value,
    repositoryScope: cloneRepositoryScope.value,
    personalLogin: cloneBindingStatus.value?.binding?.login ?? "",
    organizations: cloneOrganizationOwners.value,
    ownersLoading: cloneRepoOwnersLoading.value,
    ownersError: cloneRepoOwnersError.value,
    organizationAccessLimited: cloneOrganizationAccessLimited.value,
    organizationAccessMessage: cloneOrganizationAccessMessage.value,
    organizationRecoveryUrl: cloneOrganizationRecovery.value.url,
    localRepoFullNames: localCloneRepoFullNames.value,
    repoLoaded: cloneRepoLoaded.value,
    selectedGroupId: cloneSelectedGroupId.value,
  }));

  const events = {
    close: closeCloneDialog,
    submit: submitClone,
    openSettings: openGitHubBindingSettings,
    openOrganizationAuthorization,
    loadMore: maybeLoadMoreCloneRepos,
    openRepoDropdown: openCloneRepoDropdown,
    handleRepoInput: handleCloneRepoInput,
    selectRepo: selectCloneRepo,
    updateRemoteUrl: (value: string) => {
      cloneRemoteUrl.value = value;
    },
    updateDirectoryName: (value: string) => {
      cloneDirectoryName.value = value;
    },
    markDirectoryTouched: () => {
      cloneTouchedDirectory.value = true;
    },
    clearSelectedRepo: useDirectCloneTarget,
    updateSelectedGroup: (groupId: string | null) => {
      cloneSelectedGroupId.value = groupId;
    },
    updateRepositoryScope: selectCloneRepositoryScope,
    retryOwners: loadCloneRepoOwners,
    retryRepos: () => loadCloneRepoPage(1, false, { force: true }),
  };

  return reactive({
    open: cloneOpen,
    props,
    events,
    openDialog: openCloneDialog,
  });
}
