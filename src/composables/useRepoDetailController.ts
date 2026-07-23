import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  REPO_SETTING_ITEMS,
  repoSettingValue,
  type RepoSettingKey,
} from "../config/repoSettingsManifest";
import { useComponentEpoch } from "./useComponentEpoch";
import { createLatestAsyncLoader } from "./useLatestAsyncLoader";
import { createPendingTaskTracker } from "./usePendingTaskTracker";
import { useWorkspace } from "./useWorkspace";
import { repoSyncIssueForRepo } from "./workspace/state";
import {
  markActiveRepoLocalReady,
  requestManualRepoRemoteRefresh,
  setActiveRepoForRefresh,
} from "./workspace/repoRefreshEvents";
import type {
  BranchSummary,
  CommitSummary,
  ProjectLaunchCandidate,
  RepoChange,
  RepoConflictChoice,
  RepoConflictState,
  RepoRemoteSyncConfig,
  RepoRemoteSyncPolicy,
  RepoSummary,
  RepoSyncOperationResult,
  SystemOpenTarget,
} from "../services/workspace";
import { formatRelativeRepoTime, formatRepoTime, repoDisplayName } from "../utils/repoDisplay";
import { hasRepoTag, resolveRepoContext } from "../utils/repoContext";
import { parseRemoteRepoId, remoteRepoName } from "../utils/remoteRepo";
import { isConfirmedMissingResource } from "../services/workspace/client";
import { useWorkspaceRecentContext } from "./useWorkspaceRecentContext";
import { isLocalRepositoryConfirmedMissing } from "../utils/workspaceTruth";
import {
  normalizeRepoProjectTab,
  repoCommitRoute,
  repoRoute,
  repoRouteTabFromRoute,
  type RepoProjectTab,
  type RepoRouteTab,
} from "../utils/repoRoutes";

type RepoToolbarTab = Extract<RepoRouteTab, "files" | "repo" | "changes" | "history" | "stash">;
type RepoPullStrategy = "pull" | "merge" | "rebase";
type HistoryCommit = {
  readonly hash: string;
  readonly shortHash: string;
  readonly author: string;
  readonly authorEmail?: string | null;
  readonly timestamp: number;
  readonly subject: string;
  readonly parents: readonly string[];
  readonly refs: readonly string[];
};

type RepoBranchPickerItem = BranchSummary & {
  readonly canonicalName: string;
  readonly displayName: string;
  readonly sourceLabel: string;
  readonly defaultBranch?: boolean;
  readonly section: "current" | "local" | "remote";
  readonly relativeTime: string;
  readonly checkedOutInWorktree: boolean;
  readonly worktreePathsLabel: string;
  readonly searchText: string;
};

export function useRepoDetailController() {
  const route = useRoute();
  const router = useRouter();
  const workspace = useWorkspace();
  const workspaceRecentContext = useWorkspaceRecentContext();
  const activeTab = computed<RepoRouteTab>(() => repoRouteTabFromRoute(route));
  const activeProjectTab = computed<RepoProjectTab>(
    () => normalizeRepoProjectTab(route.query.projectTab) ?? "readme",
  );
  const activeProjectIssue = computed<number | null>(() => normalizePositiveIntegerQuery(route.query.issue));
  const activeProjectPullRequest = computed<number | null>(() => normalizePositiveIntegerQuery(route.query.pr));
  const activeProjectDiscussion = computed<number | null>(() => normalizePositiveIntegerQuery(route.query.discussion));
  const activeProjectRun = computed<number | null>(() => normalizePositiveIntegerQuery(route.query.run));
  const activeProjectJob = computed<number | null>(() => normalizePositiveIntegerQuery(route.query.job));
  const activeFilePath = computed<string | null>(() => normalizeStringQuery(route.query.file));
  const activeFileHash = computed<string | null>(() => normalizeStringQuery(route.query.hash));
  const activeChangePath = computed<string | null>(() => normalizeStringQuery(route.query.change));
  const activeRemoteRef = computed<string | null>(() => normalizeStringQuery(route.query.ref));
  const commitMessage = ref("");
  const actionError = ref<string | null>(null);
  const relocatingMissingRepo = ref(false);
  const repoDetailLoading = ref(false);
  const repoDetailError = ref<string | null>(null);
  const launchError = ref<string | null>(null);
  const launchTerminalVisible = ref(false);
  const pullStrategy = ref<RepoPullStrategy>("merge");
  const openTarget = ref<SystemOpenTarget>("folder");
  const focusedChangePath = ref<string | null>(activeChangePath.value);
  const selectedCommitHash = ref<string | null>(null);
  const githubBranches = ref<BranchSummary[]>([]);
  const githubCommits = ref<CommitSummary[]>([]);
  const githubDefaultBranch = ref<string | null>(null);
  const activeRemoteBranch = ref<string | null>(activeRemoteRef.value);
  const githubBranchLoading = ref(false);
  const deletingRemoteBranchName = ref<string | null>(null);
  const deletedRemoteBranchNames = ref<string[]>([]);
  const discardingChangePaths = ref<string[]>([]);
  const remoteSyncConfig = ref<RepoRemoteSyncConfig | null>(null);
  const remoteSyncConfigLoading = ref(false);
  const remoteSyncConfigSaving = ref(false);
  const remoteSyncConfigError = ref<string | null>(null);
  const remoteSyncDialogOpen = ref(false);
  const syncOperationResult = ref<RepoSyncOperationResult | null>(null);
  const conflictDialogOpen = ref(false);
  const pushRunning = ref(false);
  const componentEpoch = useComponentEpoch();
  const repoDetailLoader = createLatestAsyncLoader({ componentEpoch });
  const githubBranchesLoader = createLatestAsyncLoader({ componentEpoch });
  const githubCommitsLoader = createLatestAsyncLoader({ componentEpoch });
  const launchRefreshLoader = createLatestAsyncLoader({ componentEpoch });
  const actionTracker = createPendingTaskTracker();
  const actionRunning = actionTracker.running;
  let launchPollTimer: number | null = null;
  let actionGeneration = 0;

  const repoId = computed(() => String(route.params.repoId ?? ""));
  const remoteFullName = computed(() => parseRemoteRepoId(repoId.value));
  const remoteContextRestored = computed(() => !remoteFullName.value || workspace.state.settings !== null);
  const remoteShortcut = computed(() =>
    workspace.state.settings?.remoteRepoShortcuts.find((repo) => repo.fullName === remoteFullName.value) ?? null,
  );
  const remoteBrowseBranch = computed(() =>
    activeRemoteBranch.value ?? githubDefaultBranch.value ?? remoteShortcut.value?.defaultBranch ?? null
  );
  const remoteSummary = computed<RepoSummary | null>(() => {
    const fullName = remoteFullName.value;
    if (!fullName) return null;
    const shortcut = remoteShortcut.value;
    return {
      id: repoId.value,
      name: shortcut?.name ?? remoteRepoName(fullName),
      path: "",
      relativePath: fullName,
      currentBranch: remoteBrowseBranch.value,
      remoteUrl: shortcut?.cloneUrl ?? `https://github.com/${fullName}.git`,
      githubFullName: fullName,
      ahead: 0,
      behind: 0,
      remoteBranchStates: [],
      remotesNeedingPull: 0,
      remotesNeedingPush: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
      lastCommitAt: null,
      lastCommitMessage: null,
      languageStats: [],
      languageStatsUpdatedAt: 0,
      worktree: {
        role: "standalone",
        sharedRepoKey: fullName,
        mainRepoId: null,
      },
    };
  });
  const detail = computed(() => workspace.state.repoDetails[repoId.value] ?? null);
  const summary = computed(() => remoteSummary.value ?? detail.value?.summary ?? workspace.repoById(repoId.value));
  const conflicts = computed(() => detail.value?.conflicts ?? ({
    operation: "none",
    files: [],
    allResolved: true,
  } satisfies RepoConflictState));
  const githubAuthorized = computed(() => {
    if (workspace.state.bindingStatus) {
      return workspace.state.bindingStatus.state === "bound" && Boolean(workspace.state.bindingStatus.binding);
    }
    if (workspace.state.settings) return Boolean(workspace.state.settings.githubBinding);
    return false;
  });
  const repoContext = computed(() => resolveRepoContext({
    repoId: repoId.value,
    repoSummary: summary.value,
    settings: workspace.state.settings,
    githubAuthorized: githubAuthorized.value,
  }));
  const hasLocalRepo = computed(() => hasRepoTag(repoContext.value, "local"));
  const githubRepoFullName = computed(() => repoContext.value.githubFullName ?? null);
  const canShowChanges = computed(() => repoContext.value.capabilities.changes.available);
  const canLoadFiles = computed(() => remoteContextRestored.value && repoContext.value.capabilities.files.available);
  const filesUnavailableMessage = computed(() =>
    remoteContextRestored.value
      ? repoContext.value.capabilities.files.reason ?? "文件树暂不可用。"
      : "正在恢复仓库上下文。"
  );
  const branchBrowseUsesGitHub = computed(() => repoContext.value.capabilities.branchBrowse.provider === "github");
  const historyUsesGitHub = computed(() => repoContext.value.capabilities.history.provider === "github");
  const canUseGitHubData = computed(() => repoContext.value.capabilities.issues.available);
  const repoTitle = computed(() => repoDisplayName(summary.value));
  const changes = computed(() => detail.value?.changes ?? []);
  const unstagedChangePaths = computed(() =>
    changes.value
      .filter((change) => change.unstaged || change.untracked || change.conflicted)
      .map((change) => change.path),
  );
  const stagedChangePaths = computed(() =>
    changes.value.filter((change) => change.staged).map((change) => change.path),
  );
  const focusedChange = computed(() =>
    changes.value.find((change) => change.path === focusedChangePath.value) ?? null,
  );
  const previewChange = computed(() => focusedChange.value);
  const canCommit = computed(() => stagedChangePaths.value.length > 0 && commitMessage.value.trim().length > 0);
  const launchConfig = computed(() => workspace.state.launchConfigs[repoId.value] ?? null);
  const launchCandidates = computed(() => workspace.state.launchCandidates[repoId.value] ?? []);
  const launchStatus = computed(() => workspace.state.launchStatuses[repoId.value] ?? null);
  const launchLogs = computed(() => workspace.state.launchLogs[repoId.value] ?? []);
  const launchRunning = computed(() => launchStatus.value?.state === "running");
  const statusCommits = computed<CommitSummary[]>(() =>
    (historyUsesGitHub.value ? githubCommits.value : (detail.value?.commits ?? [])).map((commit) => ({
      ...commit,
      parents: [...commit.parents],
      refs: [...commit.refs],
    })),
  );
  const activeFileRepoRef = computed(() =>
    repoContext.value.capabilities.files.provider === "github" ? remoteBrowseBranch.value : null
  );
  const repoSyncIssue = computed(() => repoSyncIssueForRepo(repoId.value));
  const hasConflicts = computed(() =>
    conflicts.value.files.length > 0 || conflicts.value.operation !== "none",
  );
  const localRepoConfirmedMissing = computed(() => {
    const active = workspace.state.settings?.activeWorkspace;
    return isLocalRepositoryConfirmedMissing({
      repoId: repoId.value,
      remoteRepo: Boolean(remoteFullName.value),
      loading: workspace.state.loading,
      scanning: workspace.state.scanning,
      activeWorkspaceId: active?.id ?? null,
      rootsAvailable: Boolean(active?.roots.length && active.roots.every((root) => root.available)),
      verifiedWorkspaceId: workspace.state.repoListVerifiedWorkspaceId,
      repoPresent: workspace.repoById(repoId.value) != null,
    });
  });

  const toolbarTabs = computed<Array<{ key: RepoToolbarTab; title: string }>>(() =>
    [
      { key: "repo", title: "项目" },
      canLoadFiles.value ? { key: "files", title: "文件树" } : null,
      canShowChanges.value ? { key: "changes", title: "变更" } : null,
      { key: "history", title: "历史" },
      repoContext.value.capabilities.stash.available ? { key: "stash", title: "Stash" } : null,
    ].filter((tab): tab is { key: RepoToolbarTab; title: string } => Boolean(tab)),
  );
  const launchCommandOptions = computed(() => {
    const candidates = [...launchCandidates.value];
    const current = launchConfig.value?.command.trim()
      ? candidates.find((item) => item.command === launchConfig.value?.command && item.cwd === launchConfig.value?.cwd)
      : null;
    const options = current || !launchConfig.value?.command.trim()
      ? candidates
      : [{
          command: launchConfig.value.command,
          label: "当前指令",
          hint: launchConfig.value.cwd || null,
          kind: "current",
          cwd: launchConfig.value.cwd,
        } satisfies ProjectLaunchCandidate, ...candidates];

    return options.map((candidate) => ({
      value: launchOptionValue(candidate.command, candidate.cwd),
      label: candidate.label || candidate.command,
      command: candidate.command,
      hint: [candidate.kind, candidate.hint, candidate.cwd].filter(Boolean).join(" · "),
      candidate,
    }));
  });
  const activeLaunchValue = computed(() =>
    launchOptionValue(launchConfig.value?.command ?? "", launchConfig.value?.cwd ?? null),
  );
  const pullStrategyOptions = [
    { value: "pull", label: "仅快进拉取" },
    { value: "merge", label: "抓取后合并上游" },
    { value: "rebase", label: "抓取后变基上游" },
  ] as const;
  const activePullStrategyValue = computed(() => pullStrategy.value);
  const openTargetOptions = [
    { value: "folder", label: "文件夹" },
    { value: "terminal", label: "终端" },
    { value: "vscode", label: "VSCode" },
    { value: "liliacode", label: "LiliaCode" },
  ] as const satisfies ReadonlyArray<{ value: SystemOpenTarget; label: string }>;
  const activeOpenTargetValue = computed(() => openTarget.value);
  const openTargetLabel = computed(() =>
    openTargetOptions.find((option) => option.value === openTarget.value)?.label ?? "文件夹",
  );
  const branchActionRunning = computed(() =>
    githubBranchLoading.value || deletingRemoteBranchName.value !== null,
  );
  const branchItems = computed<RepoBranchPickerItem[]>(() =>
    [...(branchBrowseUsesGitHub.value ? githubBranches.value : (detail.value?.branches ?? []))]
      .filter((branch) =>
        !branch.remote ||
        branchBrowseUsesGitHub.value ||
        !deletedRemoteBranchNames.value.includes(remoteBranchShortName(branch.name)),
      )
      .map((branch) => {
        const browseBranch = remoteBrowseBranch.value;
        const section: RepoBranchPickerItem["section"] =
          branchBrowseUsesGitHub.value ? "remote" : branch.current && !branch.remote ? "current" : branch.remote ? "remote" : "local";
        const checkedOutWorktreePaths = [...branch.checkedOutWorktreePaths];
        const canonicalName = branch.name;
        const displayName = branchBrowseUsesGitHub.value
          ? canonicalName
          : branch.remote ? remoteBranchShortName(canonicalName) : canonicalName;
        const sourceLabel = branchBrowseUsesGitHub.value ? "" : branch.remote ? remoteBranchSourceLabel(canonicalName) : "";
        const githubBranch = branch.remote
          ? githubBranches.value.find((item) => item.name === displayName) ?? null
          : null;
        const defaultBranch = branch.remote
          ? displayName === githubDefaultBranch.value
          : false;
        return {
          ...branch,
          current: branchBrowseUsesGitHub.value ? branch.name === browseBranch : branch.current,
          protected: githubBranch?.protected ?? branch.protected,
          canonicalName,
          displayName,
          sourceLabel,
          defaultBranch,
          checkedOutWorktreePaths,
          section,
          relativeTime: formatRelativeRepoTime(branch.tipTimestamp),
          checkedOutInWorktree: !branch.remote && checkedOutWorktreePaths.length > 0,
          worktreePathsLabel: checkedOutWorktreePaths.join("\n"),
          searchText: [
            displayName,
            canonicalName,
            branch.upstream ?? "",
            sourceLabel,
            defaultBranch ? "默认分支" : "",
          ].join(" ").toLowerCase(),
        };
      })
      .sort((a, b) =>
        Number(Boolean(b.defaultBranch)) - Number(Boolean(a.defaultBranch)) ||
        branchSectionOrder(a.section) - branchSectionOrder(b.section) ||
        (b.tipTimestamp ?? 0) - (a.tipTimestamp ?? 0) ||
        a.name.localeCompare(b.name),
      ),
  );
  const activeBranchName = computed(() => {
    if (branchBrowseUsesGitHub.value) return remoteBrowseBranch.value ?? "远程分支";
    return summary.value?.currentBranch ?? "detached";
  });
  const needsPublish = computed(() => {
    const currentBranch = summary.value?.currentBranch?.trim();
    if (!hasLocalRepo.value || !summary.value?.remoteUrl || !currentBranch) return false;
    const localBranch = branchItems.value.find((branch) =>
      !branch.remote && branch.canonicalName === currentBranch
    );
    if (!localBranch) return false;
    const upstream = localBranch.upstream?.trim();
    return !upstream || !branchItems.value.some((branch) => branch.remote && branch.canonicalName === upstream);
  });
  const aheadCount = computed(() => summary.value?.ahead ?? 0);
  const behindCount = computed(() => summary.value?.behind ?? 0);
  const remotesNeedingPull = computed(() => {
    const sourceNames = new Set(remoteSyncConfig.value?.resolvedPolicy.pullRemotes ?? []);
    if (!sourceNames.size) return summary.value?.remotesNeedingPull ?? 0;
    return summary.value?.remoteBranchStates.filter((state) =>
      sourceNames.has(state.remote) && state.needsPull
    ).length ?? 0;
  });
  const remotesNeedingPush = computed(() => {
    const targetNames = new Set(remoteSyncConfig.value?.resolvedPolicy.pushRemotes ?? []);
    if (!targetNames.size) return 0;
    return summary.value?.remoteBranchStates.filter((state) =>
      targetNames.has(state.remote) && state.needsPush
    ).length ?? 0;
  });
  const pullRemoteCount = computed(() => remoteSyncConfig.value?.resolvedPolicy.pullRemotes.length ?? 0);
  const pushRemoteNames = computed(() => remoteSyncConfig.value?.resolvedPolicy.pushRemotes ?? []);
  const remoteSyncUnavailableReason = computed(() => {
    if (remoteSyncConfigLoading.value && !remoteSyncConfig.value) return "正在读取远端同步配置";
    if (remoteSyncConfigError.value && !remoteSyncConfig.value) return remoteSyncConfigError.value;
    return remoteSyncConfig.value?.validationErrors[0] ?? null;
  });
  const repoSettingValues = computed(() => Object.fromEntries(
    REPO_SETTING_ITEMS.map((setting) => [
      setting.key,
      repoSettingValue(workspace.state.settings, repoId.value, setting.key),
    ]),
  ) as Record<RepoSettingKey, boolean>);
  onMounted(() => {
    void load();
    launchPollTimer = window.setInterval(() => {
      if (repoId.value && repoContext.value.capabilities.launch.available) {
        void refreshLaunch();
      }
    }, 1500);
  });

  async function selectMissingLocalRepo() {
    const previousId = repoId.value;
    if (!previousId || relocatingMissingRepo.value) return;
    relocatingMissingRepo.value = true;
    actionError.value = null;
    try {
      const result = await workspace.relocateLocalRepo(previousId);
      await workspace.refreshRepos();
      if (result.repo.id !== previousId) {
        await router.replace(repoRoute(result.repo.id));
      } else {
        await load();
      }
    } catch (reason) {
      const message = String(reason).replace(/^Error:\s*/, "");
      if (!message.includes("已取消")) {
        actionError.value = message || "选择仓库失败";
      }
    } finally {
      relocatingMissingRepo.value = false;
    }
  }

  onUnmounted(() => {
    void setActiveRepoForRefresh(null);
    repoDetailLoader.invalidate();
    githubBranchesLoader.invalidate();
    githubCommitsLoader.invalidate();
    launchRefreshLoader.invalidate();
    invalidateActions();
    if (launchPollTimer !== null) {
      window.clearInterval(launchPollTimer);
    }
  });

  watch(repoId, () => {
    commitMessage.value = "";
    launchTerminalVisible.value = false;
    focusedChangePath.value = activeChangePath.value;
    selectedCommitHash.value = null;
    openTarget.value = "folder";
    repoDetailLoader.invalidate();
    githubBranchesLoader.invalidate();
    githubCommitsLoader.invalidate();
    launchRefreshLoader.invalidate();
    invalidateActions();
    githubBranches.value = [];
    githubCommits.value = [];
    githubDefaultBranch.value = null;
    activeRemoteBranch.value = activeRemoteRef.value;
    githubBranchLoading.value = false;
    repoDetailLoading.value = false;
    repoDetailError.value = null;
    deletingRemoteBranchName.value = null;
    deletedRemoteBranchNames.value = [];
    discardingChangePaths.value = [];
    remoteSyncConfig.value = null;
    remoteSyncConfigLoading.value = false;
    remoteSyncConfigSaving.value = false;
    remoteSyncConfigError.value = null;
    remoteSyncDialogOpen.value = false;
    syncOperationResult.value = null;
    conflictDialogOpen.value = false;
    pushRunning.value = false;
    void load();
  });

  watch(remoteContextRestored, (ready, wasReady) => {
    if (ready && !wasReady) void load();
  });

  watch(changes, () => {
    syncFocusedChange();
  });

  watch(activeChangePath, (path) => {
    focusedChangePath.value = path;
    syncFocusedChange();
  });

  watch(activeRemoteRef, (branch) => {
    if (branch !== activeRemoteBranch.value) activeRemoteBranch.value = branch;
  });

  watch(
    [
      () => route.query.resolveConflicts,
      repoDetailLoading,
      detail,
    ],
    ([request, loading, currentDetail]) => {
      const requested = (Array.isArray(request) ? request[0] : request) === "1";
      if (!requested || loading || !currentDetail) return;
      if (hasConflicts.value) openConflictDialog();
      const query = { ...route.query };
      delete query.resolveConflicts;
      void router.replace({ path: route.path, query, hash: route.hash });
    },
  );

  watch([conflictDialogOpen, hasConflicts], ([open, present]) => {
    if (open && !present) conflictDialogOpen.value = false;
  });

  watch(activeTab, (tab) => {
    if (tab !== "history") selectedCommitHash.value = null;
    if (!hasLocalRepo.value) {
      if (tab === "files") void loadGitHubBranches(githubRepoFullName.value);
      else if (tab === "history") void loadGitHubCommits(githubRepoFullName.value);
      return;
    }
    if (tab === "history") {
      void workspace.requestRepoStatusRefresh(repoId.value, { includeCommits: true }, { immediate: true });
    } else if (tab === "changes" && canShowChanges.value) {
      void workspace.requestRepoStatusRefresh(repoId.value, {}, { immediate: true });
    }
  });

  watch(
    [activeTab, canShowChanges, repoId],
    ([tab, changesAvailable, nextRepoId]) => {
      if (tab !== "changes" || changesAvailable || !nextRepoId) return;
      void router.replace(repoRoute(nextRepoId));
    },
    { immediate: true },
  );

  watch(statusCommits, () => {
    if (
      selectedCommitHash.value &&
      !statusCommits.value.some((commit) => commit.hash === selectedCommitHash.value)
    ) {
      selectedCommitHash.value = null;
    }
  });

  function normalizePositiveIntegerQuery(value: unknown): number | null {
    const next = Array.isArray(value) ? value[0] : value;
    if (typeof next !== "string") return null;
    const parsed = Number.parseInt(next, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return parsed;
  }

  function normalizeStringQuery(value: unknown): string | null {
    const next = Array.isArray(value) ? value[0] : value;
    if (typeof next !== "string") return null;
    const trimmed = next.trim();
    return trimmed || null;
  }

  function branchSectionOrder(section: RepoBranchPickerItem["section"]) {
    if (section === "current") return 0;
    if (section === "local") return 1;
    return 2;
  }

  function remoteBranchShortName(branchName: string) {
    return branchName.split("/").slice(1).join("/") || branchName;
  }

  function remoteBranchSourceLabel(branchName: string) {
    return branchName.split("/")[0] || "remote";
  }

  async function load() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    await repoDetailLoader.run(targetRepoId, async (runId) => {
      actionError.value = null;
      launchError.value = null;
      if (!hasLocalRepo.value) {
        await setActiveRepoForRefresh(null);
        repoDetailLoading.value = false;
        repoDetailError.value = null;
        if (!remoteContextRestored.value) return;
        if (githubRepoFullName.value && canUseGitHubData.value) {
          try {
            await workspace.getGitHubRepoManagement(githubRepoFullName.value);
          } catch (err) {
            if (isConfirmedMissingResource(err)) await workspaceRecentContext.replaceAfterConfirmedMissing("/");
            else actionError.value = String(err);
            return;
          }
        }
        await loadVisibleRemoteGitHubData(githubRepoFullName.value);
        return;
      }
      const launchLoad = loadLaunchData(targetRepoId, runId);
      const remoteSyncLoad = loadRemoteSyncConfig(targetRepoId, runId);
      repoDetailLoading.value = true;
      repoDetailError.value = null;
      try {
        await setActiveRepoForRefresh(targetRepoId);
        if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
        await workspace.loadRepoDetail(targetRepoId);
        if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
        await workspace.recordRecentLocalRepo(targetRepoId);
        if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
        syncFocusedChange();
        markActiveRepoLocalReady(targetRepoId);
      } catch (err) {
        if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
        const message = String(err);
        repoDetailError.value = message;
        actionError.value = message;
      } finally {
        if (repoDetailLoader.isCurrent(runId) && repoId.value === targetRepoId) {
          repoDetailLoading.value = false;
        }
      }
      if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
      resetGitHubRemoteState();
      await Promise.all([launchLoad, remoteSyncLoad]);
    });
  }

  async function loadRemoteSyncConfig(targetRepoId = repoId.value, runId?: number) {
    if (!targetRepoId) return;
    remoteSyncConfigLoading.value = true;
    remoteSyncConfigError.value = null;
    try {
      const config = await workspace.getRemoteSyncConfig(targetRepoId);
      if (repoId.value !== targetRepoId || (runId != null && !repoDetailLoader.isCurrent(runId))) return;
      remoteSyncConfig.value = config;
    } catch (err) {
      if (repoId.value !== targetRepoId || (runId != null && !repoDetailLoader.isCurrent(runId))) return;
      remoteSyncConfigError.value = String(err);
    } finally {
      if (repoId.value === targetRepoId && (runId == null || repoDetailLoader.isCurrent(runId))) {
        remoteSyncConfigLoading.value = false;
      }
    }
  }

  async function loadLaunchData(targetRepoId: string, runId: number) {
    if (!repoContext.value.capabilities.launch.available) return;
    try {
      await workspace.loadLaunch(targetRepoId);
    } catch (err) {
      if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
      const message = String(err);
      if (activeTab.value === "run") launchError.value = message;
      else actionError.value ??= message;
    }
  }

  async function loadRemoteGitHubData(repoFullName: string | null, forceRefresh = false) {
    await Promise.all([
      loadGitHubBranches(repoFullName, forceRefresh),
      loadGitHubCommits(repoFullName, forceRefresh),
    ]);
  }

  async function loadVisibleRemoteGitHubData(repoFullName: string | null) {
    if (activeTab.value === "files") await loadGitHubBranches(repoFullName);
    else if (activeTab.value === "history") await loadGitHubCommits(repoFullName);
  }

  function requestGitHubBranches() {
    void loadGitHubBranches(githubRepoFullName.value);
  }

  async function loadGitHubBranches(repoFullName: string | null, forceRefresh = false) {
    if (!repoFullName) return;
    if (!canUseGitHubData.value) {
      resetGitHubRemoteState();
      return;
    }
    await githubBranchesLoader.run(repoFullName, async (runId) => {
      githubBranchLoading.value = true;
      githubBranches.value = [];
      githubDefaultBranch.value = null;
      try {
        const [management, branches] = await Promise.all([
          workspace.getGitHubRepoManagement(repoFullName, { forceRefresh }),
          workspace.listGitHubBranches(repoFullName),
        ]);
        if (!githubBranchesLoader.isCurrent(runId) || repoFullName !== githubRepoFullName.value) return;
        githubDefaultBranch.value = management.defaultBranch || null;
        githubBranches.value = branches;
        if (branchBrowseUsesGitHub.value) {
          const current = activeRemoteBranch.value;
          const nextBranch = current && branches.some((branch) => branch.name === current)
            ? current
            : management.defaultBranch || branches[0]?.name || null;
          activeRemoteBranch.value = nextBranch;
          if (current && current !== nextBranch) replaceRouteQuery("ref", null);
        }
      } catch (err) {
        if (!githubBranchesLoader.isCurrent(runId)) return;
        actionError.value = String(err);
      } finally {
        if (githubBranchesLoader.isCurrent(runId)) {
          githubBranchLoading.value = false;
        }
      }
    });
  }

  async function loadGitHubCommits(repoFullName: string | null, forceRefresh = false) {
    if (!repoFullName) return;
    if (!canUseGitHubData.value) return;
    await githubCommitsLoader.run(repoFullName, async (runId) => {
      githubCommits.value = [];
      try {
        const commits = await workspace.listGitHubRepoCommits(
          repoFullName,
          { perPage: 100 },
          { forceRefresh },
        );
        if (!githubCommitsLoader.isCurrent(runId) || repoFullName !== githubRepoFullName.value) return;
        githubCommits.value = commits;
      } catch (err) {
        if (!githubCommitsLoader.isCurrent(runId)) return;
        actionError.value = String(err);
      }
    });
  }

  function resetGitHubRemoteState() {
    githubBranchesLoader.invalidate();
    githubCommitsLoader.invalidate();
    githubBranches.value = [];
    githubDefaultBranch.value = null;
    githubCommits.value = [];
    activeRemoteBranch.value = null;
  }

  async function refreshLaunch() {
    const targetRepoId = repoId.value;
    if (!targetRepoId || !repoContext.value.capabilities.launch.available) return;
    await launchRefreshLoader.run(targetRepoId, async (runId) => {
      try {
        const status = await workspace.refreshLaunchStatus(targetRepoId);
        if (!launchRefreshLoader.isCurrent(runId) || repoId.value !== targetRepoId || !repoContext.value.capabilities.launch.available) return;
        if (status.state === "running" || launchTerminalVisible.value) {
          await workspace.refreshLaunchLogs(targetRepoId);
        }
      } catch {
        // The explicit action path surfaces errors; polling should stay quiet.
      }
    }, { reusePending: true });
  }

  function syncFocusedChange() {
    if (!focusedChangePath.value) return;
    if (!changes.value.some((change) => change.path === focusedChangePath.value)) {
      focusedChangePath.value = null;
      replaceRouteQuery("change", null);
    }
  }

  function focusChange(path: string) {
    focusedChangePath.value = path;
    replaceRouteQuery("change", path);
  }

  function replaceRouteQuery(key: string, value: string | null) {
    const query = { ...route.query };
    if (value) query[key] = value;
    else delete query[key];
    void router.replace({ path: route.path, query, hash: route.hash });
  }

  function shouldOfferSystemGitPush(error: unknown) {
    const message = String(error).toLowerCase();
    return (
      message.includes("当前 github 绑定无权限") ||
      message.includes("无法认证 github 仓库") ||
      message.includes("authentication failed") ||
      message.includes("could not read username") ||
      message.includes("permission denied (publickey)")
    );
  }

  async function retryPushWithSystemGitIfConfirmed(error: unknown, targetRepoId: string) {
    if (!shouldOfferSystemGitPush(error)) {
      throw error;
    }
    const confirmed = window.confirm(
      "GitHub token 推送失败。是否改用系统 git 推送？\n\n如果系统 git 推送成功，此仓库后续将默认使用系统 git 凭证。",
    );
    if (!confirmed) {
      await workspace.loadRepoDetail(targetRepoId).catch(() => undefined);
      throw error;
    }
    await workspace.pushWithSystemGit(targetRepoId);
  }

  async function runPushWithFallback(targetRepoId: string, pushAction: () => Promise<unknown>) {
    try {
      const value = await pushAction();
      const result = syncResultFromValue(value);
      const authFailedRemotes = result?.steps
        .filter((step) => step.operation === "push" && step.status === "error" && shouldOfferSystemGitPush(step.message))
        .map((step) => step.remote) ?? [];
      if (!result || !authFailedRemotes.length) return value;
      const failedRemotes = [...new Set(authFailedRemotes)];
      const confirmed = window.confirm(
        `${failedRemotes.join("、")} 的 GitHub token 推送认证失败。是否仅对这些远端改用系统 git 凭证重试？`,
      );
      if (!confirmed) return value;
      const retryResult = await workspace.pushWithSystemGit(targetRepoId, failedRemotes);
      return replaceSyncResult(value, mergePushRetryResult(result, retryResult, failedRemotes));
    } catch (err) {
      return retryPushWithSystemGitIfConfirmed(err, targetRepoId);
    }
  }

  function isSyncOperationResult(value: unknown): value is RepoSyncOperationResult {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<RepoSyncOperationResult>;
    return (
      (candidate.status === "success" || candidate.status === "partial" || candidate.status === "conflicts" || candidate.status === "error") &&
      Array.isArray(candidate.steps)
    );
  }

  function syncResultFromValue(value: unknown) {
    if (isSyncOperationResult(value)) return value;
    if (!value || typeof value !== "object") return null;
    const nestedResult = (value as { pushResult?: unknown }).pushResult;
    return isSyncOperationResult(nestedResult) ? nestedResult : null;
  }

  function replaceSyncResult(value: unknown, result: RepoSyncOperationResult) {
    if (isSyncOperationResult(value)) return result;
    if (!value || typeof value !== "object") return result;
    return { ...value, pushResult: result };
  }

  function mergePushRetryResult(
    original: RepoSyncOperationResult,
    retry: RepoSyncOperationResult,
    retriedRemotes: readonly string[],
  ): RepoSyncOperationResult {
    const retried = new Set(retriedRemotes);
    const steps = [
      ...original.steps.filter((step) => !(step.operation === "push" && retried.has(step.remote))),
      ...retry.steps,
    ];
    const hasConflicts = retry.status === "conflicts" || steps.some((step) => step.status === "conflicts");
    const hasErrors = steps.some((step) => step.status === "error");
    const hasSuccess = steps.some((step) => step.status === "success");
    const status: RepoSyncOperationResult["status"] = hasConflicts
      ? "conflicts"
      : hasErrors && hasSuccess
        ? "partial"
        : hasErrors
          ? "error"
          : "success";
    return {
      status,
      message: status === "success" ? "推送完成" : status === "partial" ? "部分远端推送失败" : retry.message,
      summary: retry.summary,
      conflicts: retry.conflicts,
      steps,
    };
  }

  function captureSyncOperationResult(value: unknown) {
    const result = syncResultFromValue(value);
    if (!result) return;
    syncOperationResult.value = result.status === "success" ? null : result;
  }

  function invalidateActions() {
    actionGeneration += 1;
    actionTracker.reset();
    pushRunning.value = false;
  }

  function isActionCurrent(generation: number, targetRepoId: string) {
    return generation === actionGeneration && repoId.value === targetRepoId;
  }

  async function runAction(action: () => Promise<unknown>) {
    const generation = actionGeneration;
    const targetRepoId = repoId.value;
    if (!targetRepoId) return false;
    actionError.value = null;
    try {
      await actionTracker.run(action);
      return true;
    } catch (err) {
      if (isActionCurrent(generation, targetRepoId)) {
        actionError.value = String(err);
      }
      return false;
    }
  }

  async function runLaunchAction(action: () => Promise<unknown>) {
    const generation = actionGeneration;
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    launchError.value = null;
    actionError.value = null;
    try {
      await actionTracker.run(action);
    } catch (err) {
      if (!isActionCurrent(generation, targetRepoId)) return;
      const message = String(err);
      if (activeTab.value === "run") launchError.value = message;
      else actionError.value = message;
    }
  }

  function stageUnstagedChanges(paths?: string[]) {
    const files = paths?.length ? paths : unstagedChangePaths.value;
    void runAction(async () => {
      await workspace.stage(repoId.value, files);
    });
  }

  function unstageStagedChanges(paths?: string[]) {
    const files = paths?.length ? paths : stagedChangePaths.value;
    void runAction(async () => {
      await workspace.unstage(repoId.value, files);
    });
  }

  function runChangeAction(
    action: "stage" | "unstage" | "discard" | "gitignore" | "copyPath",
    change: RepoChange,
    paths?: string[],
  ) {
    const files = paths?.length ? paths : [change.path];
    if (action === "discard") {
      setDiscardingChangePaths(files, true);
      void runAction(
        () => workspace.discardChanges(repoId.value, files),
      )
        .finally(() => setDiscardingChangePaths(files, false));
      return;
    }

    void runAction(() => {
      if (action === "stage") return workspace.stage(repoId.value, files);
      if (action === "unstage") return workspace.unstage(repoId.value, files);
      if (action === "gitignore") return workspace.addFilesToGitignore(repoId.value, files);
      return workspace.copyText(change.path);
    });
  }

  function setDiscardingChangePaths(paths: readonly string[], pending: boolean) {
    if (!paths.length) return;
    const next = new Set(discardingChangePaths.value);
    for (const path of paths) {
      if (pending) next.add(path);
      else next.delete(path);
    }
    discardingChangePaths.value = [...next];
  }

  function commitSelected(pushAfter: boolean) {
    const targetRepoId = repoId.value;
    const targetPaths = stagedChangePaths.value;
    const message = commitMessage.value.trim();
    if (!targetRepoId || !targetPaths.length || !message) return;
    commitMessage.value = "";
    void runAction(async () => {
      await workspace.commit(targetRepoId, targetPaths, message, false);
    }).then((success) => {
      if (
        !success &&
        repoId.value === targetRepoId &&
        stagedChangePaths.value.length > 0 &&
        !commitMessage.value.trim()
      ) {
        commitMessage.value = message;
        return;
      }
      if (success && pushAfter && repoId.value === targetRepoId) {
        void runPushAction(targetRepoId, () => workspace.push(targetRepoId));
      }
    });
  }

  function mergePull() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    void runAction(async () => {
      captureSyncOperationResult(await workspace.mergePull(targetRepoId, "stash"));
    });
  }

  async function refreshGitInfo() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    const localRepo = hasLocalRepo.value;
    const repoFullName = githubRepoFullName.value;
    const includeCommits = activeTab.value === "history";

    await runAction(async () => {
      if (!localRepo) {
        await loadRemoteGitHubData(repoFullName, true);
        return;
      }
      await requestManualRepoRemoteRefresh(targetRepoId, {
        includeCommits,
        includeBranches: true,
      });
    });
  }

  async function refreshLaunchPage() {
    const targetRepoId = repoId.value;
    if (!targetRepoId || !repoContext.value.capabilities.launch.available) return;
    await runLaunchAction(() => workspace.loadLaunch(targetRepoId, { forceRefresh: true }));
  }

  function selectPullStrategy(value: string) {
    if (value === "pull" || value === "merge" || value === "rebase") {
      pullStrategy.value = value;
    }
  }

  function setRepoSetting(key: RepoSettingKey, value: boolean) {
    void runAction(
      () => workspace.setRepoSetting(repoId.value, key, value),
    );
  }

  function openRemoteSyncSettings() {
    if (!hasLocalRepo.value) return;
    remoteSyncDialogOpen.value = true;
    if (!remoteSyncConfig.value || remoteSyncConfigError.value) {
      void loadRemoteSyncConfig();
    }
  }

  function closeRemoteSyncSettings() {
    if (remoteSyncConfigSaving.value) return;
    remoteSyncDialogOpen.value = false;
  }

  async function saveRemoteSyncPolicy(policy: RepoRemoteSyncPolicy) {
    const targetRepoId = repoId.value;
    if (!targetRepoId || remoteSyncConfigSaving.value) return;
    remoteSyncConfigSaving.value = true;
    remoteSyncConfigError.value = null;
    try {
      const config = await workspace.setRemoteSyncPolicy(targetRepoId, policy);
      if (repoId.value !== targetRepoId) return;
      remoteSyncConfig.value = config;
      remoteSyncDialogOpen.value = false;
    } catch (err) {
      if (repoId.value === targetRepoId) remoteSyncConfigError.value = String(err);
    } finally {
      if (repoId.value === targetRepoId) remoteSyncConfigSaving.value = false;
    }
  }

  function closeSyncResultDialog() {
    if (!pushRunning.value) syncOperationResult.value = null;
  }

  function openConflictDialog() {
    if (!hasConflicts.value) return;
    actionError.value = null;
    conflictDialogOpen.value = true;
  }

  function closeConflictDialog() {
    if (!actionRunning.value) conflictDialogOpen.value = false;
  }

  async function openConflictDialogFromSyncResult() {
    if (syncOperationResult.value?.status !== "conflicts") return;
    syncOperationResult.value = null;
    await nextTick();
    openConflictDialog();
  }

  async function resolveConflictFile(payload: { path: string; choices: RepoConflictChoice[] }) {
    await runAction(
      () => workspace.resolveConflictFile(repoId.value, payload.path, payload.choices, true),
    );
  }

  async function acceptConflictFile(payload: { path: string; side: RepoConflictChoice["side"] }) {
    await runAction(
      () => workspace.acceptConflictFile(repoId.value, payload.path, payload.side, true),
    );
  }

  async function markConflictResolved(path: string) {
    await runAction(
      () => workspace.markConflictFileResolved(repoId.value, path),
    );
  }

  async function continueConflictOperation() {
    const completed = await runAction(
      () => workspace.continueConflictOperation(repoId.value),
    );
    if (completed) conflictDialogOpen.value = false;
  }

  async function abortConflictOperation() {
    const completed = await runAction(
      () => workspace.abortConflictOperation(repoId.value),
    );
    if (completed) conflictDialogOpen.value = false;
  }

  async function retryFailedRemotePush(remoteNames: string[]) {
    const targetRepoId = repoId.value;
    if (!targetRepoId || !syncOperationResult.value) return;
    await runPushAction(targetRepoId, () => workspace.push(targetRepoId, remoteNames));
  }

  async function runPushAction(targetRepoId: string, pushAction: () => Promise<unknown>) {
    if (!targetRepoId || pushRunning.value) return;
    const generation = actionGeneration;
    pushRunning.value = true;
    actionError.value = null;
    try {
      const result = await runPushWithFallback(targetRepoId, pushAction);
      if (isActionCurrent(generation, targetRepoId)) captureSyncOperationResult(result);
    } catch (err) {
      if (isActionCurrent(generation, targetRepoId)) actionError.value = String(err);
    } finally {
      if (isActionCurrent(generation, targetRepoId)) pushRunning.value = false;
    }
  }

  function isOpenTarget(value: string): value is SystemOpenTarget {
    return value === "folder" || value === "terminal" || value === "vscode" || value === "liliacode";
  }

  function selectOpenTarget(value: string) {
    if (!isOpenTarget(value)) return;
    openTarget.value = value;
    openSelectedTarget();
  }

  function openSelectedTarget() {
    const path = summary.value?.path;
    if (!path) return;
    const target = openTarget.value;
    void runAction(
      () => workspace.openPathTarget(path, target),
    );
  }

  function runSelectedPullStrategy() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    void runAction(async () => {
      if (pullRemoteCount.value > 1) {
        captureSyncOperationResult(await workspace.mergePull(targetRepoId, "stash"));
        return;
      }
      if (pullStrategy.value === "pull") {
        captureSyncOperationResult(await workspace.pull(targetRepoId, "stash"));
        return;
      }
      if (pullStrategy.value === "rebase") {
        captureSyncOperationResult(await workspace.startRebase(targetRepoId, null, "stash"));
        return;
      }
      captureSyncOperationResult(await workspace.mergePull(targetRepoId, "stash"));
    });
  }

  function push() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    void runPushAction(targetRepoId, () => workspace.push(targetRepoId));
  }

  function pushCurrentBranchWithUpstream() {
    const targetRepoId = repoId.value;
    const branch = summary.value?.currentBranch ?? null;
    if (!targetRepoId || !branch) return;
    void runPushAction(targetRepoId, () =>
      workspace.pushNewBranch(targetRepoId, null, branch),
    );
  }

  function setCurrentBranchUpstream() {
    const branch = summary.value?.currentBranch?.trim();
    if (!branch) return;
    const next = window.prompt("输入 upstream（例如 origin/main）", `origin/${branch}`)?.trim();
    if (!next) return;
    void runAction(
      () => workspace.setUpstream(repoId.value, branch, next),
    );
  }

  function useDefaultTokenAuth() {
    void runAction(
      () => workspace.useDefaultTokenAuthForRepo(repoId.value),
    );
  }

  function runLaunchCommand(command: string) {
    const targetRepoId = repoId.value;
    const trimmedCommand = command.trim();
    if (!targetRepoId || !trimmedCommand || launchRunning.value) return;
    void runLaunchAction(async () => {
      const currentCommand = launchConfig.value?.command.trim() ?? "";
      const currentCwd = launchConfig.value?.cwd ?? null;
      if (currentCommand !== trimmedCommand) {
        await workspace.saveLaunchConfig(targetRepoId, trimmedCommand, currentCwd);
      } else {
        await workspace.loadLaunch(targetRepoId);
      }
      await workspace.startLaunch(targetRepoId);
      if (repoId.value !== targetRepoId) return;
      launchTerminalVisible.value = true;
    });
  }

  function stopLaunch() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    void runLaunchAction(
      () => workspace.stopLaunch(targetRepoId),
    );
  }

  function selectLaunchCandidate(candidate: ProjectLaunchCandidate) {
    if (launchRunning.value) return;
    const current = launchConfig.value;
    if (current?.command === candidate.command && current.cwd === candidate.cwd) return;
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    void runLaunchAction(async () => {
      await workspace.saveLaunchConfig(targetRepoId, candidate.command, candidate.cwd);
      if (repoId.value !== targetRepoId) return;
      launchTerminalVisible.value = true;
    });
  }

  function selectLaunchCandidateByValue(value: string) {
    const option = launchCommandOptions.value.find((item) => item.value === value);
    if (!option) return;
    selectLaunchCandidate(option.candidate);
  }

  function checkout(branch: string) {
    if (branchBrowseUsesGitHub.value) {
      activeRemoteBranch.value = branch.trim() || activeRemoteBranch.value;
      replaceRouteQuery("ref", activeRemoteBranch.value);
      return;
    }
    void runAction(
      () => workspace.checkout(repoId.value, branch),
    );
  }

  async function createBranchFromRef(name: string, fromRef: string, checkoutAfter: boolean) {
    const branchName = name.trim();
    const baseRef = fromRef.trim();
    if (!branchName || !baseRef) return;
    await runAction(
      () => workspace.createBranch(repoId.value, branchName, baseRef, checkoutAfter),
    );
  }

  async function renameBranchTo(oldName: string, newName: string) {
    const from = oldName.trim();
    const to = newName.trim();
    if (!from || !to) return;
    await runAction(
      () => workspace.renameBranch(repoId.value, from, to),
    );
  }

  function mergeBranch(branch: string) {
    if (!branch || branch === summary.value?.currentBranch) return;
    void runAction(
      () => workspace.mergeBranch(repoId.value, branch),
    );
  }

  function deleteBranch(branch: string) {
    if (!branch) return;
    const target = branchItems.value.find((item) => item.canonicalName === branch);
    if (!target) return;
    if (target.remote) {
      const repoFullName = githubRepoFullName.value;
      if (!repoFullName || target.defaultBranch || target.protected || deletingRemoteBranchName.value) return;
      const branchName = branchBrowseUsesGitHub.value ? target.name : remoteBranchShortName(target.canonicalName);
      if (!branchName) return;
      const generation = actionGeneration;
      const targetRepoId = repoId.value;
      deletingRemoteBranchName.value = branchName;
      actionError.value = null;
      void (async () => {
        try {
          await actionTracker.run(
            () => workspace.deleteGitHubBranch(repoFullName, branchName),
          );
          if (!isActionCurrent(generation, targetRepoId)) return;
          githubBranches.value = githubBranches.value.filter((item) => item.name !== branchName);
          if (activeRemoteBranch.value === branchName) {
            activeRemoteBranch.value = githubDefaultBranch.value && githubDefaultBranch.value !== branchName
              ? githubDefaultBranch.value
              : githubBranches.value[0]?.name ?? null;
          }
          if (!deletedRemoteBranchNames.value.includes(branchName)) {
            deletedRemoteBranchNames.value = [...deletedRemoteBranchNames.value, branchName];
          }
        } catch (err) {
          if (isActionCurrent(generation, targetRepoId)) {
            actionError.value = String(err);
          }
        } finally {
          if (isActionCurrent(generation, targetRepoId)) {
            deletingRemoteBranchName.value = null;
          }
        }
      })();
      return;
    }
    if (branch === summary.value?.currentBranch) return;
    void runAction(
      () => workspace.deleteBranch(repoId.value, branch),
    );
  }

  function updateCurrentBranch() {
    mergePull();
  }

  function openCommit(commit: HistoryCommit) {
    void router.push(repoCommitRoute(repoId.value, commit.hash));
  }

  function cherryPickCommit(hash: string) {
    void runAction(
      () => workspace.cherryPickCommit(repoId.value, hash),
    );
  }

  function revertCommit(hash: string) {
    void runAction(
      () => workspace.revertCommit(repoId.value, hash),
    );
  }

  function resetCommit(hash: string, mode: "soft" | "mixed" | "hard" = "mixed") {
    const confirmed = mode === "hard"
      ? window.confirm("hard reset 会丢弃当前工作区改动，确认继续？")
      : true;
    if (!confirmed) return;
    void runAction(
      () => workspace.resetToCommit(repoId.value, hash, mode),
    );
  }

  function createBranchFromCommit(hash: string) {
    const name = window.prompt("新分支名", "feature/from-commit")?.trim();
    if (!name) return;
    void runAction(
      () => workspace.createBranch(repoId.value, name, hash, true),
    );
  }

  function closeCommit() {
    selectedCommitHash.value = null;
  }

  function commitMetaTitle(commit: HistoryCommit) {
    return [
      commit.hash,
      commit.authorEmail ? `${commit.author} <${commit.authorEmail}>` : commit.author,
      formatRepoTime(commit.timestamp),
      commit.parents.length ? `parents: ${commit.parents.join(", ")}` : "root commit",
      commit.refs.length ? `refs: ${commit.refs.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }

  function launchOptionValue(command: string, cwd: string | null) {
    return JSON.stringify([command, cwd ?? null]);
  }

    return {
      activeTab,
      commitMessage,
      actionError,
      repoDetailLoading,
      repoDetailError,
      localRepoConfirmedMissing,
      relocatingMissingRepo,
      selectMissingLocalRepo,
      launchError,
      actionRunning,
      launchTerminalVisible,
      selectedCommitHash,
      repoId,
      repoContext,
      summary,
      repoTitle,
      changes,
      discardingChangePaths,
      previewChange,
      canCommit,
      launchConfig,
      launchLogs,
      launchRunning,
      statusCommits,
      canLoadFiles,
      activeFileRepoRef,
      filesUnavailableMessage,
      repoSyncIssue,
      hasConflicts,
      conflicts,
      conflictDialogOpen,
      activeProjectTab,
      activeProjectIssue,
      activeProjectPullRequest,
      activeProjectDiscussion,
      activeProjectRun,
      activeProjectJob,
      activeFilePath,
      activeFileHash,
      toolbarTabs,
      launchCommandOptions,
      activeLaunchValue,
      pullStrategyOptions,
      activePullStrategyValue,
      openTargetOptions,
      activeOpenTargetValue,
      openTargetLabel,
      branchItems,
      branchActionRunning,
      activeBranchName,
      needsPublish,
      aheadCount,
      behindCount,
      remotesNeedingPull,
      remotesNeedingPush,
      pullRemoteCount,
      pushRemoteNames,
      remoteSyncUnavailableReason,
      repoSettingValues,
      remoteSyncConfig,
      remoteSyncConfigLoading,
      remoteSyncConfigSaving,
      remoteSyncConfigError,
      remoteSyncDialogOpen,
      syncOperationResult,
      pushRunning,
      focusChange,
      stageUnstagedChanges,
      unstageStagedChanges,
      runChangeAction,
      commitSelected,
      requestGitHubBranches,
      refreshGitInfo,
      refreshLaunchPage,
      selectPullStrategy,
      setRepoSetting,
      openRemoteSyncSettings,
      closeRemoteSyncSettings,
      loadRemoteSyncConfig,
      saveRemoteSyncPolicy,
      closeSyncResultDialog,
      retryFailedRemotePush,
      openConflictDialog,
      closeConflictDialog,
      openConflictDialogFromSyncResult,
      resolveConflictFile,
      acceptConflictFile,
      markConflictResolved,
      continueConflictOperation,
      abortConflictOperation,
      selectOpenTarget,
      openSelectedTarget,
      runSelectedPullStrategy,
      push,
      pushCurrentBranchWithUpstream,
      setCurrentBranchUpstream,
      useDefaultTokenAuth,
      runLaunchCommand,
      stopLaunch,
      selectLaunchCandidateByValue,
      checkout,
      createBranchFromRef,
      renameBranchTo,
      mergeBranch,
      deleteBranch,
      updateCurrentBranch,
      openCommit,
      closeCommit,
      cherryPickCommit,
      revertCommit,
      resetCommit,
      createBranchFromCommit,
      commitMetaTitle,
    };
}
