import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkspace } from "./useWorkspace";
import { recentSyncErrorForRepo } from "./workspace/state";
import type { CommitSummary, RepoConflictChoice, RepoConflictFile, RepoConflictState } from "../services/workspace";
import { formatRepoTime, repoDisplayName } from "../utils/repoDisplay";

type RepoTab = "conflicts" | "changes" | "history" | "branches";
type RepoView = "project" | "git";
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

export function useRepoDetailController() {
  const route = useRoute();
  const router = useRouter();
  const workspace = useWorkspace();
  const activeView = ref<RepoView>(normalizeView(route.query.view) ?? "git");
  const activeTab = ref<RepoTab>(normalizeTab(route.query.tab) ?? "changes");
  const selectedFiles = ref<Set<string>>(new Set());
  const commitMessage = ref("");
  const pushAfter = ref(true);
  const actionError = ref<string | null>(null);
  const actionRunning = ref(false);
  const conflictAbortConfirm = ref(false);
  const conflictAcceptConfirm = ref<null | "ours" | "theirs">(null);
  const launchEditing = ref(false);
  const launchTerminalVisible = ref(false);
  const launchCommandInput = ref("");
  const launchCwdInput = ref("");
  const focusedChangePath = ref<string | null>(null);
  const focusedConflictPath = ref<string | null>(null);
  const conflictChoices = ref<Record<string, "ours" | "theirs">>({});
  let launchPollTimer: number | null = null;

  const repoId = computed(() => String(route.params.repoId ?? ""));
  const detail = computed(() => workspace.state.repoDetails[repoId.value] ?? null);
  const summary = computed(() => detail.value?.summary ?? workspace.repoById(repoId.value));
  const repoTitle = computed(() => repoDisplayName(summary.value));
  const repoMetaItems = computed(() => {
    const repo = summary.value;
    if (!repo) return [repoId.value];
    return [
      repo.githubFullName ?? "未识别 GitHub",
      repo.currentBranch ?? "detached",
    ].filter(Boolean);
  });
  const changes = computed(() => detail.value?.changes ?? []);
  const conflicts = computed(() => detail.value?.conflicts ?? { operation: "none", files: [], allResolved: true });
  const conflictOperationActive = computed(() => conflicts.value.operation !== "none");
  const supportedConflictOperation = computed(() =>
    conflicts.value.operation === "merge" ||
    conflicts.value.operation === "rebase" ||
    conflicts.value.operation === "cherry-pick",
  );
  const selectedFileList = computed(() => Array.from(selectedFiles.value));
  const focusedChange = computed(() =>
    changes.value.find((change) => change.path === focusedChangePath.value) ?? null,
  );
  const previewChange = computed(() => {
    if (focusedChange.value) return focusedChange.value;
    if (selectedFileList.value.length !== 1) return null;
    return changes.value.find((change) => change.path === selectedFileList.value[0]) ?? null;
  });
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
  const canCommit = computed(() => selectedFiles.value.size > 0 && commitMessage.value.trim().length > 0);
  const launchConfig = computed(() => workspace.state.launchConfigs[repoId.value] ?? null);
  const launchStatus = computed(() => workspace.state.launchStatuses[repoId.value] ?? null);
  const launchLogs = computed(() => workspace.state.launchLogs[repoId.value] ?? []);
  const launchLoading = computed(() => workspace.state.launchLoading);
  const languageStatsRefreshing = computed(() =>
    workspace.state.languageStatsLoadingRepoIds.includes(repoId.value),
  );
  const launchRunning = computed(() => launchStatus.value?.state === "running");
  const hasLaunchCommand = computed(() => Boolean(launchConfig.value?.command.trim()));
  const selectedSummaryText = computed(() => {
    if (!selectedFileList.value.length) return "未选择文件";
    if (selectedFileList.value.length === 1) return `已选 1 个文件`;
    return `已选 ${selectedFileList.value.length} 个文件`;
  });
  const selectedFilePreview = computed(() => selectedFileList.value.slice(0, 3));
  const statusCommits = computed<CommitSummary[]>(() =>
    (detail.value?.commits ?? []).map((commit) => ({
      ...commit,
      parents: [...commit.parents],
      refs: [...commit.refs],
    })),
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

  const tabs: Array<{ key: RepoTab; label: string }> = [
    { key: "conflicts", label: "冲突" },
    { key: "changes", label: "变更" },
    { key: "history", label: "历史" },
    { key: "branches", label: "分支" },
  ];
  const views: Array<{ key: RepoView; label: string }> = [
    { key: "project", label: "项目信息" },
    { key: "git", label: "Git 信息" },
  ];

  onMounted(() => {
    void load();
    launchPollTimer = window.setInterval(() => {
      if (repoId.value) {
        void refreshLaunch();
      }
    }, 1500);
  });

  onUnmounted(() => {
    if (launchPollTimer !== null) {
      window.clearInterval(launchPollTimer);
    }
  });

  watch(repoId, () => {
    selectedFiles.value = new Set();
    commitMessage.value = "";
    launchEditing.value = false;
    launchTerminalVisible.value = false;
    focusedChangePath.value = null;
    focusedConflictPath.value = null;
    conflictChoices.value = {};
    conflictAbortConfirm.value = false;
    conflictAcceptConfirm.value = null;
    activeView.value = "git";
    void load();
  });

  watch(
    () => route.query.view,
    (view) => {
      const normalized = normalizeView(view);
      if (normalized) activeView.value = normalized;
    },
  );

  watch(
    () => route.query.tab,
    (tab) => {
      const normalized = normalizeTab(tab);
      if (normalized) activeTab.value = normalized;
    },
  );

  watch(changes, () => {
    syncFocusedChange();
  });

  function normalizeTab(value: unknown): RepoTab | null {
    if (
      value === "conflicts" ||
      value === "changes" ||
      value === "history" ||
      value === "branches"
    ) return value;
    return null;
  }

  function normalizeView(value: unknown): RepoView | null {
    if (value === "project" || value === "git") return value;
    return null;
  }

  async function load() {
    if (!repoId.value) return;
    actionError.value = null;
    try {
      const [nextDetail] = await Promise.all([
        workspace.loadRepoDetail(repoId.value),
        workspace.loadLaunch(repoId.value),
      ]);
      await workspace.refreshRepoLanguageStats(repoId.value).catch((err) => {
        actionError.value = String(err);
      });
      resetLaunchForm();
      syncFocusedChange();
      syncFocusedConflict();
      if (
        (nextDetail.summary.conflictCount > 0 ||
          nextDetail.conflicts.files.length > 0 ||
          nextDetail.conflicts.operation !== "none") &&
        activeTab.value !== "conflicts"
      ) {
        activeTab.value = "conflicts";
      }
    } catch (err) {
      actionError.value = String(err);
    }
  }

  async function refreshLaunch() {
    if (!repoId.value) return;
    try {
      const status = await workspace.refreshLaunchStatus(repoId.value);
      if (status.state === "running" || launchTerminalVisible.value) {
        await workspace.refreshLaunchLogs(repoId.value);
      }
    } catch {
      // The explicit action path surfaces errors; polling should stay quiet.
    }
  }

  function resetLaunchForm() {
    launchCommandInput.value = launchConfig.value?.command ?? "";
    launchCwdInput.value = launchConfig.value?.cwd ?? "";
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
    if (!conflictFiles.value.length && activeTab.value === "conflicts") {
      activeTab.value = "changes";
    }
  });

  function focusChange(path: string) {
    focusedChangePath.value = path;
  }

  function focusConflict(path: string) {
    focusedConflictPath.value = path;
    resetConflictConfirmation();
    syncConflictChoices();
  }

  function toggleFile(path: string) {
    const next = new Set(selectedFiles.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    selectedFiles.value = next;
    focusedChangePath.value = path;
  }

  function selectAll() {
    selectedFiles.value = new Set(changes.value.map((change) => change.path));
    focusedChangePath.value = changes.value[0]?.path ?? null;
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

  async function runAction(action: () => Promise<unknown>) {
    actionRunning.value = true;
    actionError.value = null;
    try {
      await action();
    } catch (err) {
      actionError.value = String(err);
    } finally {
      actionRunning.value = false;
    }
  }

  function stageSelected() {
    void runAction(async () => {
      await workspace.stage(repoId.value, selectedFileList.value);
      selectedFiles.value = new Set();
    });
  }

  function unstageSelected() {
    void runAction(async () => {
      await workspace.unstage(repoId.value, selectedFileList.value);
      selectedFiles.value = new Set();
    });
  }

  function commitSelected() {
    void runAction(async () => {
      await workspace.commit(repoId.value, selectedFileList.value, commitMessage.value, pushAfter.value);
      selectedFiles.value = new Set();
      commitMessage.value = "";
    });
  }

  function mergePull() {
    void runAction(async () => {
      await workspace.mergePull(repoId.value);
      if (hasConflicts.value) activeTab.value = "conflicts";
    });
  }

  function push() {
    void runAction(() => workspace.push(repoId.value));
  }

  function showConflicts() {
    activeTab.value = "conflicts";
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
    void runAction(async () => {
      await workspace.startLaunch(repoId.value);
      launchTerminalVisible.value = true;
    });
  }

  function stopLaunch() {
    void runAction(() => workspace.stopLaunch(repoId.value));
  }

  function editLaunchConfig() {
    resetLaunchForm();
    launchEditing.value = true;
  }

  function cancelLaunchConfig() {
    resetLaunchForm();
    launchEditing.value = false;
  }

  function saveLaunchConfig() {
    void runAction(async () => {
      await workspace.saveLaunchConfig(repoId.value, launchCommandInput.value, launchCwdInput.value);
      launchEditing.value = false;
    });
  }

  function checkout(branch: string) {
    void runAction(() => workspace.checkout(repoId.value, branch));
  }

  function openCommit(commit: HistoryCommit) {
    void router.push(`/repos/${repoId.value}/commits/${commit.hash}`);
  }

  function openFolder() {
    if (!summary.value?.path) return;
    void workspace.openPath(summary.value.path);
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

    return {
      activeTab,
      selectedFiles,
      commitMessage,
      pushAfter,
      actionError,
      actionRunning,
      conflictAcceptConfirm,
      activeView,
      launchEditing,
      launchTerminalVisible,
      launchCommandInput,
      launchCwdInput,
      conflictChoices,
      repoId,
      detail,
      summary,
      repoTitle,
      repoMetaItems,
      changes,
      conflicts,
      conflictOperationActive,
      supportedConflictOperation,
      selectedFileList,
      previewChange,
      conflictFiles,
      focusedConflict,
      conflictResolvedCount,
      conflictSelectedCount,
      canResolveSelectedConflict,
      canContinueConflictOperation,
      canCommit,
      launchConfig,
      launchStatus,
      launchLogs,
      launchLoading,
      languageStatsRefreshing,
      launchRunning,
      hasLaunchCommand,
      selectedSummaryText,
      selectedFilePreview,
      statusCommits,
      panelConflictFiles,
      panelConflicts,
      panelFocusedConflict,
      recentSyncError,
      hasConflicts,
      conflictSummaryText,
      conflictOperationText,
      conflictAbortText,
      conflictContinueText,
      tabs,
      views,
      load,
      refreshLaunch,
      focusChange,
      focusConflict,
      toggleFile,
      selectAll,
      pickConflictHunk,
      stageSelected,
      unstageSelected,
      commitSelected,
      mergePull,
      push,
      showConflicts,
      acceptConflict,
      resolveSelectedConflict,
      markConflictResolved,
      abortConflict,
      continueConflict,
      startLaunch,
      stopLaunch,
      editLaunchConfig,
      cancelLaunchConfig,
      saveLaunchConfig,
      checkout,
      openCommit,
      openFolder,
      openConflictFolder,
      commitMetaTitle,
    };
}
