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
  preloadGitHubRepos,
  readCachedGitHubRepos,
  type GitHubBindingStatus,
  type GitHubRepoSummary,
  type RepoSummary,
} from "../services/workspace";

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
    if (seen.has(item.fullName)) continue;
    seen.add(item.fullName);
    next.push(item);
  }
  return next;
}

export function useCloneRepoDialog(options: UseCloneRepoDialogOptions) {
  const workspace = useWorkspace();
  const router = useRouter();
  const componentEpoch = useComponentEpoch();
  const cloneBindingLoader = createLatestAsyncLoader({ componentEpoch });
  const cloneRepoPageLoader = createLatestAsyncLoader({ componentEpoch });

  const cloneOpen = ref(false);
  const cloneRemoteUrl = ref("");
  const cloneDirectoryName = ref("");
  const cloneTouchedDirectory = ref(false);
  const cloneBusy = ref(false);
  const cloneError = ref<string | null>(null);
  const cloneBindingStatus = ref<GitHubBindingStatus | null>(null);
  const cloneRepoItems = ref<GitHubRepoSummary[]>([]);
  const cloneRepoDropdownOpen = ref(false);
  const cloneRepoLoading = ref(false);
  const cloneRepoLoadingMore = ref(false);
  const cloneRepoLoadError = ref<string | null>(null);
  const cloneNextRepoPage = ref<number | null>(null);
  const cloneSelectedRepo = ref<GitHubRepoSummary | null>(null);
  const cloneSelectedGroupId = ref<string | null>(null);

  const canSubmitClone = computed(() => cloneRemoteUrl.value.trim().length > 0 && !cloneBusy.value);
  const cloneGitHubBound = computed(() => cloneBindingStatus.value?.state === "bound");
  const cloneQueryTrimmed = computed(() => cloneRemoteUrl.value.trim());
  const cloneBindingExpired = computed(() => cloneError.value?.includes("GitHub 绑定已失效") === true);
  const cloneDirectGitHubRepo = computed(() => normalizeGitHubCloneInput(cloneQueryTrimmed.value));
  const filteredCloneRepos = computed(() => {
    const text = cloneQueryTrimmed.value.toLowerCase();
    if (!text) return cloneRepoItems.value;
    return cloneRepoItems.value.filter((repo) =>
      repo.fullName.toLowerCase().includes(text) ||
      repo.name.toLowerCase().includes(text) ||
      (repo.description ?? "").toLowerCase().includes(text),
    );
  });

  function applyCloneRepoPage(result: { items: GitHubRepoSummary[]; nextPage: number | null }, append = false) {
    cloneRepoLoadError.value = null;
    cloneNextRepoPage.value = result.nextPage;
    cloneRepoItems.value = append
      ? dedupeCloneRepos([...cloneRepoItems.value, ...result.items])
      : result.items;
  }

  function showCloneRepoLoadError(err: unknown) {
    const expired = isGitHubBindingExpiredError(err);
    cloneRepoLoadError.value = expired
      ? "GitHub 绑定已失效，请重新绑定后再加载账号仓库。"
      : `仓库列表加载失败：${String(err)}`;
    if (expired) {
      cloneError.value = "GitHub 绑定已失效，请重新绑定。";
    }
    cloneRepoItems.value = [];
    cloneNextRepoPage.value = null;
    cloneSelectedRepo.value = null;
  }

  async function loadCloneRepoPage(
    page = 1,
    append = false,
    loadOptions: { force?: boolean; showLoading?: boolean } = {},
  ) {
    if (!cloneGitHubBound.value) return;
    const key = `${append ? "append" : "replace"}:${page}:${loadOptions.force ? "force" : "cache"}`;
    await cloneRepoPageLoader.run(key, async (runId) => {
      const showLoading = loadOptions.showLoading ?? !append;
      if (append) {
        cloneRepoLoadingMore.value = true;
      } else if (showLoading) {
        cloneRepoLoading.value = true;
      }
      try {
        const result = page === 1
          ? await preloadGitHubRepos({ force: loadOptions.force })
          : await listGitHubRepos(page);
        if (!cloneRepoPageLoader.isCurrent(runId) || !cloneOpen.value || !cloneGitHubBound.value) return;
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

  function startCloneReposLoad() {
    if (!cloneGitHubBound.value || cloneRepoLoading.value || cloneRepoItems.value.length > 0) return;
    void loadCloneRepoPage(1).catch(() => undefined);
  }

  async function maybeLoadMoreCloneRepos() {
    if (!cloneGitHubBound.value || !cloneNextRepoPage.value || cloneRepoLoadingMore.value) return;
    if (filteredCloneRepos.value.length > 0 && cloneQueryTrimmed.value) return;
    await loadCloneRepoPage(cloneNextRepoPage.value, true);
  }

  async function openCloneDialog(groupId: string | null = null) {
    cloneBindingLoader.invalidate();
    cloneRepoPageLoader.invalidate();
    cloneOpen.value = true;
    cloneRemoteUrl.value = "";
    cloneDirectoryName.value = "";
    cloneTouchedDirectory.value = false;
    cloneError.value = null;
    cloneBindingStatus.value = null;
    cloneRepoItems.value = [];
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
          const cached = readCachedGitHubRepos();
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
    cloneBindingLoader.invalidate();
    cloneRepoPageLoader.invalidate();
    cloneOpen.value = false;
    cloneError.value = null;
    cloneRepoLoading.value = false;
    cloneRepoLoadingMore.value = false;
  }

  async function submitClone() {
    if (!canSubmitClone.value) return;
    cloneBusy.value = true;
    cloneError.value = null;
    try {
      const selected = cloneSelectedRepo.value;
      const remote = selected?.cloneUrl ?? cloneDirectGitHubRepo.value ?? cloneRemoteUrl.value.trim();
      const summary = await workspace.cloneRepo(
        remote,
        cloneDirectoryName.value.trim() || selected?.name || null,
      );
      cloneBindingLoader.invalidate();
      cloneRepoPageLoader.invalidate();
      cloneOpen.value = false;
      await options.onCloned(summary, cloneSelectedGroupId.value);
    } catch (err) {
      if (isGitHubBindingExpiredError(err)) {
        showCloneRepoLoadError(err);
      } else {
        cloneError.value = String(err);
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
    cloneOpen.value = false;
    cloneRepoLoading.value = false;
    cloneRepoLoadingMore.value = false;
    await router.push({ path: "/settings", query: { tab: "repositories" } });
  }

  watch(cloneRemoteUrl, (value) => {
    if (cloneTouchedDirectory.value) return;
    cloneDirectoryName.value = cloneSelectedRepo.value?.name ?? inferCloneDirectoryName(value);
  });

  onUnmounted(() => {
    cloneBindingLoader.invalidate();
    cloneRepoPageLoader.invalidate();
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
    selectedGroupId: cloneSelectedGroupId.value,
  }));

  const events = {
    close: closeCloneDialog,
    submit: submitClone,
    openSettings: openGitHubBindingSettings,
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
  };

  return reactive({
    open: cloneOpen,
    props,
    events,
    openDialog: openCloneDialog,
  });
}
