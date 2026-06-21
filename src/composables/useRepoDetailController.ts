import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { repoAutoSyncEnabled } from "../config/repoSettingsManifest";
import { deleteGitHubBranch, getGitHubRepoManagement, listGitHubBranches, listGitHubRepoCommits } from "../services/workspace";
import { createLatestAsyncLoader } from "./useLatestAsyncLoader";
import { createPendingTaskTracker } from "./usePendingTaskTracker";
import { useWorkspace } from "./useWorkspace";
import { recentSyncErrorForRepo } from "./workspace/state";
import type {
  BranchSummary,
  CommitSummary,
  ProjectLaunchCandidate,
  RepoChange,
  RepoConflictChoice,
  RepoConflictFile,
  RepoConflictState,
  RepoSummary,
  SystemOpenTarget,
} from "../services/workspace";
import { formatRelativeRepoTime, formatRepoTime, repoDisplayName } from "../utils/repoDisplay";
import { hasRepoTag, resolveRepoContext } from "../utils/repoContext";
import { parseRemoteRepoId, remoteRepoName } from "../utils/remoteRepo";
import { repoRoute, repoRouteTabFromRoute, type RepoRouteTab } from "../utils/repoRoutes";

type RepoProjectTab = "readme" | "issues" | "pulls" | "actions" | "settings";
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
  const activeTab = computed<RepoRouteTab>(() => repoRouteTabFromRoute(route));
  const activeProjectTab = computed<RepoProjectTab>(
    () => normalizeProjectTab(route.query.projectTab) ?? "readme",
  );
  const activeProjectIssue = computed<number | null>(() => normalizePositiveIntegerQuery(route.query.issue));
  const activeProjectPullRequest = computed<number | null>(() => normalizePositiveIntegerQuery(route.query.pr));
  const activeProjectRun = computed<number | null>(() => normalizePositiveIntegerQuery(route.query.run));
  const commitMessage = ref("");
  const actionError = ref<string | null>(null);
  const launchError = ref<string | null>(null);
  const conflictAbortConfirm = ref(false);
  const conflictAcceptConfirm = ref<null | "ours" | "theirs">(null);
  const launchTerminalVisible = ref(false);
  const pullStrategy = ref<RepoPullStrategy>("merge");
  const openTarget = ref<SystemOpenTarget>("folder");
  const focusedChangePath = ref<string | null>(null);
  const focusedConflictPath = ref<string | null>(null);
  const selectedCommitHash = ref<string | null>(null);
  const conflictChoices = ref<Record<string, "ours" | "theirs">>({});
  const githubBranches = ref<BranchSummary[]>([]);
  const githubCommits = ref<CommitSummary[]>([]);
  const githubDefaultBranch = ref<string | null>(null);
  const activeRemoteBranch = ref<string | null>(null);
  const githubBranchLoading = ref(false);
  const deletingRemoteBranchName = ref<string | null>(null);
  const deletedRemoteBranchNames = ref<string[]>([]);
  const projectRefreshToken = ref(0);
  const repoDetailLoader = createLatestAsyncLoader();
  const githubBranchesLoader = createLatestAsyncLoader();
  const githubCommitsLoader = createLatestAsyncLoader();
  const launchRefreshLoader = createLatestAsyncLoader();
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
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
      lastCommitAt: null,
      lastCommitMessage: null,
      languageStats: [],
      workingTreeLanguageStats: [],
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
  const canShowFilesTab = computed(() =>
    canLoadFiles.value || (!remoteContextRestored.value && Boolean(remoteFullName.value))
  );
  const filesUnavailableMessage = computed(() =>
    remoteContextRestored.value
      ? repoContext.value.capabilities.files.reason ?? "文件树暂不可用。"
      : "正在恢复仓库上下文。"
  );
  const branchBrowseUsesGitHub = computed(() => repoContext.value.capabilities.branchBrowse.provider === "github");
  const historyUsesGitHub = computed(() => repoContext.value.capabilities.history.provider === "github");
  const canUseGitHubData = computed(() => repoContext.value.capabilities.issues.available);
  const repoTitle = computed(() => repoDisplayName(summary.value));
  const repoMetaItems = computed(() => {
    const repo = summary.value;
    if (!repo) return [repoId.value];
    return [
      repo.githubFullName ?? "未识别 GitHub",
      repo.currentBranch ?? "detached",
      hasRepoTag(repoContext.value, "github-remote") ? "远程仓库" : null,
    ].filter((item): item is string => Boolean(item));
  });
  const changes = computed(() => detail.value?.changes ?? []);
  const conflicts = computed(() => detail.value?.conflicts ?? { operation: "none", files: [], allResolved: true });
  const conflictOperationActive = computed(() => conflicts.value.operation !== "none");
  const supportedConflictOperation = computed(() =>
    conflicts.value.operation === "merge" ||
    conflicts.value.operation === "rebase" ||
    conflicts.value.operation === "cherry-pick",
  );
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
  const conflictFiles = computed(() => conflicts.value.files ?? []);
  const focusedConflict = computed(() =>
    conflictFiles.value.find((file) => file.path === focusedConflictPath.value) ?? conflictFiles.value[0] ?? null,
  );
  const conflictResolvedCount = computed(() => conflictFiles.value.filter((file) => file.resolved).length);
  const conflictSelectedCount = computed(() => Object.keys(conflictChoices.value).length);
  const canResolveSelectedConflict = computed(() =>
    Boolean(
      focusedConflict.value &&
      focusedConflict.value.hunks.length > 0 &&
      focusedConflict.value.hunks.every((hunk) => Boolean(conflictChoices.value[hunk.id])),
    ),
  );
  const canContinueConflictOperation = computed(() => supportedConflictOperation.value && !conflictFiles.value.length);
  const canCommit = computed(() => stagedChangePaths.value.length > 0 && commitMessage.value.trim().length > 0);
  const launchConfig = computed(() => workspace.state.launchConfigs[repoId.value] ?? null);
  const launchCandidates = computed(() => workspace.state.launchCandidates[repoId.value] ?? []);
  const launchStatus = computed(() => workspace.state.launchStatuses[repoId.value] ?? null);
  const launchLogs = computed(() => workspace.state.launchLogs[repoId.value] ?? []);
  const launchLoading = computed(() => workspace.state.launchLoading);
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
  const panelConflictFiles = computed<RepoConflictFile[]>(() =>
    conflictFiles.value.map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk) => ({
        ...hunk,
        oursLines: [...hunk.oursLines],
        theirsLines: [...hunk.theirsLines],
      })),
    })),
  );
  const panelConflicts = computed<RepoConflictState>(() => ({
    operation: conflicts.value.operation,
    files: panelConflictFiles.value,
    allResolved: conflicts.value.allResolved,
  }));
  const panelFocusedConflict = computed(
    () => panelConflictFiles.value.find((file) => file.path === focusedConflict.value?.path) ?? null,
  );
  const recentSyncError = computed(() => {
    return recentSyncErrorForRepo(repoId.value);
  });
  const hasConflicts = computed(() =>
    Boolean(summary.value?.conflictCount || conflictFiles.value.length || conflictOperationActive.value),
  );
  const conflictSummaryText = computed(() => {
    if (!conflictFiles.value.length && conflictOperationActive.value) return "冲突文件已处理，等待继续操作";
    if (!conflictFiles.value.length) return "没有待处理冲突";
    return `已处理 ${conflictResolvedCount.value} / ${conflictFiles.value.length}`;
  });
  const conflictOperationText = computed(() => {
    if (conflicts.value.operation === "merge") return "合并冲突";
    if (conflicts.value.operation === "rebase") return "rebase 冲突";
    if (conflicts.value.operation === "cherry-pick") return "cherry-pick 冲突";
    return "冲突处理";
  });
  const conflictAbortText = computed(() => {
    if (conflicts.value.operation === "rebase") return conflictAbortConfirm.value ? "确认终止 rebase" : "终止 rebase";
    if (conflicts.value.operation === "cherry-pick") return conflictAbortConfirm.value ? "确认终止 cherry-pick" : "终止 cherry-pick";
    if (conflicts.value.operation !== "merge") return "终止操作";
    return conflictAbortConfirm.value ? "确认终止合并" : "终止合并";
  });
  const conflictContinueText = computed(() => {
    if (conflicts.value.operation === "rebase") return "继续 rebase";
    if (conflicts.value.operation === "cherry-pick") return "继续 cherry-pick";
    if (conflicts.value.operation !== "merge") return "继续操作";
    return "完成合并";
  });

  const toolbarTabs = computed<Array<{ key: RepoToolbarTab; title: string }>>(() =>
    [
      { key: "files", title: "文件树" },
      { key: "repo", title: "项目" },
      canShowChanges.value ? { key: "changes", title: "变更" } : null,
      { key: "history", title: "历史" },
      repoContext.value.capabilities.stash.available ? { key: "stash", title: "Stash" } : null,
    ].filter((tab): tab is { key: RepoToolbarTab; title: string } => {
      if (!tab) return false;
      return tab.key !== "files" || canShowFilesTab.value;
    }),
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
      hint: [candidate.kind, candidate.hint, candidate.cwd].filter(Boolean).join(" · "),
      candidate,
    }));
  });
  const activeLaunchValue = computed(() =>
    launchOptionValue(launchConfig.value?.command ?? "", launchConfig.value?.cwd ?? null),
  );
  const launchCommandText = computed(() => launchConfig.value?.command?.trim() || "选择启动指令");
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
    actionRunning.value || githubBranchLoading.value || deletingRemoteBranchName.value !== null,
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
  const aheadCount = computed(() => summary.value?.ahead ?? 0);
  const behindCount = computed(() => summary.value?.behind ?? 0);
  const autoSyncEnabled = computed(() => repoAutoSyncEnabled(workspace.state.settings, repoId.value));
  const repoActionError = computed(() => workspace.state.repoActionErrors[repoId.value]?.message ?? null);
  onMounted(() => {
    void load();
    launchPollTimer = window.setInterval(() => {
      if (repoId.value && repoContext.value.capabilities.launch.available) {
        void refreshLaunch();
      }
    }, 1500);
  });

  onUnmounted(() => {
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
    focusedChangePath.value = null;
    focusedConflictPath.value = null;
    selectedCommitHash.value = null;
    conflictChoices.value = {};
    conflictAbortConfirm.value = false;
    conflictAcceptConfirm.value = null;
    openTarget.value = "folder";
    repoDetailLoader.invalidate();
    githubBranchesLoader.invalidate();
    githubCommitsLoader.invalidate();
    launchRefreshLoader.invalidate();
    invalidateActions();
    githubBranches.value = [];
    githubCommits.value = [];
    githubDefaultBranch.value = null;
    activeRemoteBranch.value = null;
    githubBranchLoading.value = false;
    deletingRemoteBranchName.value = null;
    deletedRemoteBranchNames.value = [];
    void load();
  });

  watch(remoteContextRestored, (ready, wasReady) => {
    if (ready && !wasReady) void load();
  });

  watch(changes, () => {
    syncFocusedChange();
  });

  watch(activeTab, (tab) => {
    if (tab !== "history") selectedCommitHash.value = null;
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

  function normalizeProjectTab(value: unknown): RepoProjectTab | null {
    if (
      value === "readme" ||
      value === "issues" ||
      value === "pulls" ||
      value === "actions" ||
      value === "settings"
    ) return value;
    return null;
  }

  function normalizePositiveIntegerQuery(value: unknown): number | null {
    const next = Array.isArray(value) ? value[0] : value;
    if (typeof next !== "string") return null;
    const parsed = Number.parseInt(next, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return parsed;
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
        if (!remoteContextRestored.value) return;
        await loadRemoteGitHubData(githubRepoFullName.value);
        return;
      }
      try {
        await workspace.loadRepoDetail(targetRepoId);
        if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
        syncFocusedChange();
        syncFocusedConflict();
      } catch (err) {
        if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
        actionError.value = String(err);
      }
      if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
      if (!canUseGitHubData.value) {
        resetGitHubRemoteState();
      } else {
        await loadGitHubBranches(githubRepoFullName.value);
      }
      if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
      try {
        await workspace.loadLaunch(targetRepoId);
      } catch (err) {
        if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
        const message = String(err);
        if (activeTab.value === "run") launchError.value = message;
        else actionError.value ??= message;
      }
      if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
      await workspace.refreshRepoLanguageStats(targetRepoId).catch((err) => {
        if (!repoDetailLoader.isCurrent(runId) || repoId.value !== targetRepoId) return;
        actionError.value = String(err);
      });
    });
  }

  async function loadRemoteGitHubData(repoFullName: string | null) {
    await Promise.all([
      loadGitHubBranches(repoFullName),
      loadGitHubCommits(repoFullName),
    ]);
  }

  async function loadGitHubBranches(repoFullName: string | null) {
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
          getGitHubRepoManagement(repoFullName),
          listGitHubBranches(repoFullName),
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

  async function loadGitHubCommits(repoFullName: string | null) {
    if (!repoFullName) return;
    if (!canUseGitHubData.value) return;
    await githubCommitsLoader.run(repoFullName, async (runId) => {
      githubCommits.value = [];
      try {
        const commits = await listGitHubRepoCommits(repoFullName, { perPage: 100 });
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

  function syncFocusedConflict() {
    if (focusedConflictPath.value && conflictFiles.value.some((file) => file.path === focusedConflictPath.value)) {
      syncConflictChoices();
      return;
    }
    focusedConflictPath.value = conflictFiles.value[0]?.path ?? null;
    syncConflictChoices();
  }

  function syncFocusedChange() {
    if (!focusedChangePath.value) return;
    if (!changes.value.some((change) => change.path === focusedChangePath.value)) {
      focusedChangePath.value = null;
    }
  }

  watch(conflictFiles, () => {
    syncFocusedConflict();
  });

  function focusChange(path: string) {
    focusedChangePath.value = path;
  }

  function focusConflict(path: string) {
    focusedConflictPath.value = path;
    resetConflictConfirmation();
    syncConflictChoices();
  }

  function syncConflictChoices() {
    const current = focusedConflict.value;
    if (!current) {
      conflictChoices.value = {};
      return;
    }
    const next: Record<string, "ours" | "theirs"> = {};
    for (const hunk of current.hunks) {
      const existing = conflictChoices.value[hunk.id];
      if (existing) next[hunk.id] = existing;
    }
    conflictChoices.value = next;
  }

  function pickConflictHunk(hunkId: string, side: "ours" | "theirs") {
    conflictChoices.value = {
      ...conflictChoices.value,
      [hunkId]: side,
    };
  }

  function resetConflictConfirmation() {
    conflictAbortConfirm.value = false;
    conflictAcceptConfirm.value = null;
  }

  function shouldOfferSystemGitPush(error: unknown) {
    const message = String(error);
    return message.includes("当前 GitHub 绑定无权限") || message.includes("无法认证 GitHub 仓库");
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
      await pushAction();
    } catch (err) {
      await retryPushWithSystemGitIfConfirmed(err, targetRepoId);
    }
  }

  function invalidateActions() {
    actionGeneration += 1;
    actionTracker.reset();
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
    void runAction(async () => {
      await workspace.stage(repoId.value, paths?.length ? paths : unstagedChangePaths.value);
    });
  }

  function unstageStagedChanges(paths?: string[]) {
    void runAction(async () => {
      await workspace.unstage(repoId.value, paths?.length ? paths : stagedChangePaths.value);
    });
  }

  function runChangeAction(
    action: "stage" | "unstage" | "discard" | "gitignore" | "copyPath",
    change: RepoChange,
    paths?: string[],
  ) {
    const files = paths?.length ? paths : [change.path];
    void runAction(() => {
      if (action === "stage") return workspace.stage(repoId.value, files);
      if (action === "unstage") return workspace.unstage(repoId.value, files);
      if (action === "discard") return workspace.discardChanges(repoId.value, files);
      if (action === "gitignore") return workspace.addFilesToGitignore(repoId.value, files);
      return workspace.copyText(change.path);
    });
  }

  function commitSelected(pushAfter: boolean) {
    const targetRepoId = repoId.value;
    const targetPaths = stagedChangePaths.value;
    const message = commitMessage.value.trim();
    if (!targetRepoId || !targetPaths.length || !message) return;
    void runAction(async () => {
      const commitAction = () =>
        workspace.commit(targetRepoId, targetPaths, message, pushAfter);
      if (pushAfter) await runPushWithFallback(targetRepoId, commitAction);
      else await commitAction();
      if (repoId.value !== targetRepoId) return;
      commitMessage.value = "";
    });
  }

  function mergePull() {
    void runAction(async () => {
      await workspace.mergePull(repoId.value);
    });
  }

  function fetchRepo() {
    void runAction(() => workspace.fetch(repoId.value));
  }

  function refreshAndFetchRepo() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;

    void runAction(async () => {
      if (!hasLocalRepo.value) {
        await loadRemoteGitHubData(githubRepoFullName.value);
        projectRefreshToken.value += 1;
        return;
      }
      await workspace.fetch(targetRepoId);
      await load();
      await workspace.autoSyncRepoIfNeeded(targetRepoId, { refreshDetail: true, throwOnError: true });
      projectRefreshToken.value += 1;
    });
  }

  function selectPullStrategy(value: string) {
    if (value === "pull" || value === "merge" || value === "rebase") {
      pullStrategy.value = value;
    }
  }

  function setAutoSync(value: boolean) {
    void runAction(() => workspace.setRepoAutoSync(repoId.value, value));
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
    void runAction(() => workspace.openPathTarget(path, target));
  }

  function runSelectedPullStrategy() {
    void runAction(async () => {
      if (pullStrategy.value === "pull") {
        await workspace.pull(repoId.value);
        return;
      }
      if (pullStrategy.value === "rebase") {
        await workspace.startRebase(repoId.value, null);
        return;
      }
      await workspace.mergePull(repoId.value);
    });
  }

  function push() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    void runAction(() => runPushWithFallback(targetRepoId, () => workspace.push(targetRepoId)));
  }

  function pushCurrentBranchWithUpstream() {
    const targetRepoId = repoId.value;
    const branch = summary.value?.currentBranch ?? null;
    if (!targetRepoId || !branch) return;
    void runAction(() =>
      runPushWithFallback(targetRepoId, () =>
        workspace.pushNewBranch(targetRepoId, "origin", branch)
      )
    );
  }

  function setCurrentBranchUpstream() {
    const branch = summary.value?.currentBranch?.trim();
    if (!branch) return;
    const next = window.prompt("输入 upstream（例如 origin/main）", `origin/${branch}`)?.trim();
    if (!next) return;
    void runAction(() => workspace.setUpstream(repoId.value, branch, next));
  }

  function useDefaultTokenAuth() {
    void runAction(() => workspace.useDefaultTokenAuthForRepo(repoId.value));
  }

  function acceptConflict(side: "ours" | "theirs") {
    const file = focusedConflict.value;
    if (!file) return;
    if (conflictAcceptConfirm.value !== side) {
      conflictAcceptConfirm.value = side;
      return;
    }
    void runAction(async () => {
      await workspace.acceptConflictFile(repoId.value, file.path, side, true);
      resetConflictConfirmation();
    });
  }

  function resolveSelectedConflict() {
    const file = focusedConflict.value;
    if (!file) return;
    const choices: RepoConflictChoice[] = file.hunks.map((hunk) => ({
      hunkId: hunk.id,
      side: conflictChoices.value[hunk.id],
    }));
    void runAction(async () => {
      await workspace.resolveConflictFile(repoId.value, file.path, choices, true);
      resetConflictConfirmation();
    });
  }

  function markConflictResolved() {
    const file = focusedConflict.value;
    if (!file) return;
    void runAction(async () => {
      await workspace.markConflictFileResolved(repoId.value, file.path);
      resetConflictConfirmation();
    });
  }

  function abortConflict() {
    if (!conflictAbortConfirm.value) {
      conflictAbortConfirm.value = true;
      return;
    }
    void runAction(async () => {
      await workspace.abortConflictOperation(repoId.value);
      resetConflictConfirmation();
    });
  }

  function continueConflict() {
    void runAction(async () => {
      await workspace.continueConflictOperation(repoId.value);
      resetConflictConfirmation();
    });
  }

  function startLaunch() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    void runLaunchAction(async () => {
      await workspace.loadLaunch(targetRepoId);
      await workspace.startLaunch(targetRepoId);
      if (repoId.value !== targetRepoId) return;
      launchTerminalVisible.value = true;
    });
  }

  function stopLaunch() {
    const targetRepoId = repoId.value;
    if (!targetRepoId) return;
    void runLaunchAction(() => workspace.stopLaunch(targetRepoId));
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
      return;
    }
    void runAction(() => workspace.checkout(repoId.value, branch));
  }

  async function createBranchFromRef(name: string, fromRef: string, checkoutAfter: boolean) {
    const branchName = name.trim();
    const baseRef = fromRef.trim();
    if (!branchName || !baseRef) return;
    await runAction(() => workspace.createBranch(repoId.value, branchName, baseRef, checkoutAfter));
  }

  async function renameBranchTo(oldName: string, newName: string) {
    const from = oldName.trim();
    const to = newName.trim();
    if (!from || !to) return;
    await runAction(() => workspace.renameBranch(repoId.value, from, to));
  }

  function mergeBranch(branch: string) {
    if (!branch || branch === summary.value?.currentBranch) return;
    void runAction(() => workspace.mergeBranch(repoId.value, branch));
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
          await deleteGitHubBranch(repoFullName, branchName);
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
    void runAction(() => workspace.deleteBranch(repoId.value, branch));
  }

  function updateCurrentBranch() {
    mergePull();
  }

  function openCommit(commit: HistoryCommit) {
    void router.push(repoRoute(repoId.value, "history"));
    selectedCommitHash.value = commit.hash;
  }

  function cherryPickCommit(hash: string) {
    void runAction(() => workspace.cherryPickCommit(repoId.value, hash));
  }

  function revertCommit(hash: string) {
    void runAction(() => workspace.revertCommit(repoId.value, hash));
  }

  function resetCommit(hash: string, mode: "soft" | "mixed" | "hard" = "mixed") {
    const confirmed = mode === "hard"
      ? window.confirm("hard reset 会丢弃当前工作区改动，确认继续？")
      : true;
    if (!confirmed) return;
    void runAction(() => workspace.resetToCommit(repoId.value, hash, mode));
  }

  function createBranchFromCommit(hash: string) {
    const name = window.prompt("新分支名", "feature/from-commit")?.trim();
    if (!name) return;
    void runAction(() => workspace.createBranch(repoId.value, name, hash, true));
  }

  function closeCommit() {
    selectedCommitHash.value = null;
  }

  function openConflictFolder() {
    const file = focusedConflict.value;
    if (!file || !summary.value?.path) return;
    const path = `${summary.value.path}\\${file.path.replace(/\//g, "\\")}`;
    void workspace.openPath(path);
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
      launchError,
      actionRunning,
      conflictAcceptConfirm,
      launchTerminalVisible,
      conflictChoices,
      selectedCommitHash,
      repoId,
      repoContext,
      detail,
      summary,
      repoTitle,
      repoMetaItems,
      changes,
      conflicts,
      conflictOperationActive,
      supportedConflictOperation,
      previewChange,
      conflictFiles,
      focusedConflict,
      conflictResolvedCount,
      conflictSelectedCount,
      canResolveSelectedConflict,
      canContinueConflictOperation,
      canCommit,
      launchConfig,
      launchCandidates,
      launchStatus,
      launchLogs,
      launchLoading,
      launchRunning,
      statusCommits,
      canLoadFiles,
      activeFileRepoRef,
      filesUnavailableMessage,
      panelConflictFiles,
      panelConflicts,
      panelFocusedConflict,
      recentSyncError,
      hasConflicts,
      conflictSummaryText,
      conflictOperationText,
      conflictAbortText,
      conflictContinueText,
      activeProjectTab,
      activeProjectIssue,
      activeProjectPullRequest,
      activeProjectRun,
      projectRefreshToken,
      toolbarTabs,
      launchCommandOptions,
      activeLaunchValue,
      launchCommandText,
      pullStrategyOptions,
      activePullStrategyValue,
      openTargetOptions,
      activeOpenTargetValue,
      openTargetLabel,
      branchItems,
      branchActionRunning,
      activeBranchName,
      aheadCount,
      behindCount,
      autoSyncEnabled,
      repoActionError,
      load,
      refreshLaunch,
      focusChange,
      focusConflict,
      pickConflictHunk,
      stageUnstagedChanges,
      unstageStagedChanges,
      runChangeAction,
      commitSelected,
      refreshAndFetchRepo,
      fetchRepo,
      selectPullStrategy,
      setAutoSync,
      selectOpenTarget,
      openSelectedTarget,
      runSelectedPullStrategy,
      push,
      pushCurrentBranchWithUpstream,
      setCurrentBranchUpstream,
      useDefaultTokenAuth,
      acceptConflict,
      resolveSelectedConflict,
      markConflictResolved,
      abortConflict,
      continueConflict,
      startLaunch,
      stopLaunch,
      selectLaunchCandidate,
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
      openConflictFolder,
      commitMetaTitle,
    };
}
