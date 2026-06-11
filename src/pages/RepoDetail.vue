<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  AlertCircle,
  Check,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  LoaderCircle,
  GitPullRequestArrow,
  Play,
  RefreshCw,
  RotateCw,
  Settings,
  Square,
  Terminal,
  TriangleAlert,
  Upload,
} from "@lucide/vue";
import { useWorkspace } from "../composables/useWorkspace";
import type { RepoChange, RepoConflictChoice } from "../services/workspace";
import { repoDisplayName } from "../utils/repoDisplay";
import "../styles/page.css";

type RepoTab = "conflicts" | "changes" | "history" | "branches";
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

const route = useRoute();
const router = useRouter();
const workspace = useWorkspace();
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
    repo.path,
  ].filter(Boolean);
});
const changes = computed(() => detail.value?.changes ?? []);
const conflicts = computed(() => detail.value?.conflicts ?? { operation: "none", files: [], allResolved: true });
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
const canCommit = computed(() => selectedFiles.value.size > 0 && commitMessage.value.trim().length > 0);
const launchConfig = computed(() => workspace.state.launchConfigs[repoId.value] ?? null);
const launchStatus = computed(() => workspace.state.launchStatuses[repoId.value] ?? null);
const launchLogs = computed(() => workspace.state.launchLogs[repoId.value] ?? []);
const launchState = computed(() => launchStatus.value?.state ?? "idle");
const launchRunning = computed(() => launchState.value === "running");
const hasLaunchCommand = computed(() => Boolean(launchConfig.value?.command.trim()));
const selectedSummaryText = computed(() => {
  if (!selectedFileList.value.length) return "未选择文件";
  if (selectedFileList.value.length === 1) return `已选 1 个文件`;
  return `已选 ${selectedFileList.value.length} 个文件`;
});
const selectedFilePreview = computed(() => selectedFileList.value.slice(0, 3));
const historyBranches = computed(() => ({
  local: detail.value?.branches.filter((branch) => !branch.remote) ?? [],
  remote: detail.value?.branches.filter((branch) => branch.remote) ?? [],
}));
const historyRefNames = computed(() => {
  const refs = new Set<string>();
  for (const commit of detail.value?.commits ?? []) {
    for (const refName of commit.refs) refs.add(refName);
  }
  return Array.from(refs);
});
const recentPushError = computed(() => {
  const recent = workspace.state.recentPush;
  if (!recent) return null;
  const result = recent.results.find((item) => item.repoId === repoId.value && item.status === "error");
  if (!result) return null;
  return {
    message: result.message,
    retrying: recent.retryingRepoIds.includes(repoId.value),
  };
});
const hasConflicts = computed(() => Boolean(summary.value?.conflictCount || conflictFiles.value.length));
const conflictSummaryText = computed(() => {
  if (!conflictFiles.value.length) return "没有待处理冲突";
  return `已处理 ${conflictResolvedCount.value} / ${conflictFiles.value.length}`;
});
const conflictOperationText = computed(() => {
  if (conflicts.value.operation === "merge") return "合并冲突";
  if (conflicts.value.operation === "rebase") return "rebase 冲突";
  if (conflicts.value.operation === "cherry-pick") return "cherry-pick 冲突";
  return "冲突处理";
});
const unsupportedConflictText = computed(() => {
  if (!conflictFiles.value.length || conflicts.value.operation === "merge") return "";
  if (conflicts.value.operation === "rebase") return "当前检测到 rebase 冲突，第一版暂不支持在应用内继续 rebase。请在外部 Git 工具完成后返回标记解决。";
  if (conflicts.value.operation === "cherry-pick") return "当前检测到 cherry-pick 冲突，第一版暂不支持在应用内继续 cherry-pick。请在外部 Git 工具完成后返回标记解决。";
  return "当前冲突操作暂不支持在应用内继续，请在外部 Git 工具完成后返回标记解决。";
});

const tabs: Array<{ key: RepoTab; label: string }> = [
  { key: "conflicts", label: "冲突" },
  { key: "changes", label: "变更" },
  { key: "history", label: "历史" },
  { key: "branches", label: "分支" },
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
  void load();
});

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
  if (value === "conflicts" || value === "changes" || value === "history" || value === "branches") return value;
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
    resetLaunchForm();
    syncFocusedChange();
    syncFocusedConflict();
    if ((nextDetail.summary.conflictCount > 0 || nextDetail.conflicts.files.length > 0) && activeTab.value !== "conflicts") {
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

function dirtyCount(changeSummary = summary.value) {
  if (!changeSummary) return 0;
  return changeSummary.stagedCount + changeSummary.unstagedCount + changeSummary.untrackedCount;
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

function pull() {
  void runAction(() => workspace.pull(repoId.value));
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

function openGitHub() {
  if (!summary.value?.githubFullName) return;
  void workspace.openUrl(`https://github.com/${summary.value.githubFullName}`);
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

function statusText(change: RepoChange) {
  if (change.conflicted) return "冲突";
  if (change.untracked) return "未跟踪";
  if (change.staged && change.unstaged) return "已暂存/有修改";
  if (change.staged) return "已暂存";
  return "未暂存";
}

function statusTone(change: RepoChange) {
  if (change.conflicted) return "change-badge--err";
  if (change.untracked) return "change-badge--warn";
  if (change.staged && change.unstaged) return "change-badge--accent";
  if (change.staged) return "change-badge--ok";
  return "change-badge--muted";
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function formatCompactTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function commitMetaTitle(commit: HistoryCommit) {
  return [
    commit.hash,
    commit.authorEmail ? `${commit.author} <${commit.authorEmail}>` : commit.author,
    formatTime(commit.timestamp),
    commit.parents.length ? `parents: ${commit.parents.join(", ")}` : "root commit",
    commit.refs.length ? `refs: ${commit.refs.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function lastCommitText() {
  const latestCommit = detail.value?.commits[0];
  if (latestCommit) return latestCommit.subject;
  if (summary.value?.lastCommitMessage) return summary.value.lastCommitMessage;
  return "无提交";
}

function syncStatusText() {
  if (!summary.value) return "未知";
  if (!summary.value.ahead && !summary.value.behind) return "已同步";
  return `↑${summary.value.ahead} / ↓${summary.value.behind}`;
}

function syncStatusTone() {
  if (!summary.value) return "";
  if (summary.value.conflictCount > 0) return "repo-status-strip__value--err";
  if (summary.value.behind > 0) return "repo-status-strip__value--warn";
  if (summary.value.ahead > 0) return "repo-status-strip__value--accent";
  return "repo-status-strip__value--ok";
}

function conflictStatusText(file: {
  binary: boolean;
  hunks: readonly unknown[];
  resolved: boolean;
  status: string;
}) {
  if (file.binary) return "二进制 / 不可解析";
  if (!file.hunks.length) return "文件级处理";
  if (file.resolved) return "已解决";
  return `${file.hunks.length} 个分段`;
}

function conflictStatusTone(file: {
  binary: boolean;
  hunks: readonly unknown[];
  resolved: boolean;
}) {
  if (file.resolved) return "change-badge--ok";
  if (file.binary || !file.hunks.length) return "change-badge--warn";
  return "change-badge--err";
}

function launchStatusText() {
  if (launchState.value === "running") return "运行中";
  if (launchState.value === "exited") return `已退出${launchStatus.value?.exitCode != null ? ` · ${launchStatus.value.exitCode}` : ""}`;
  if (launchState.value === "error") return "异常";
  return "未运行";
}

function launchSourceText() {
  return launchConfig.value?.source === "manual" ? "手动配置" : "自动推断";
}

function streamText(stream: string) {
  if (stream === "stderr") return "ERR";
  if (stream === "stdout") return "OUT";
  return "SYS";
}
</script>

<template>
  <section class="repo-workbench">
    <header class="repo-header">
      <div class="repo-header__identity">
        <h1>{{ repoTitle }}</h1>
        <div class="repo-header__meta" :title="repoMetaItems.join(' · ')">
          <span v-for="item in repoMetaItems" :key="item">{{ item }}</span>
        </div>
      </div>
      <div class="repo-header__actions" aria-label="仓库操作">
        <button type="button" class="ghost" :disabled="actionRunning" @click="load">
          <RefreshCw :size="14" aria-hidden="true" />
          刷新
        </button>
        <button type="button" class="ghost" :disabled="actionRunning || dirtyCount() > 0" @click="pull">
          <GitPullRequestArrow :size="14" aria-hidden="true" />
          Pull
        </button>
        <button
          type="button"
          class="ghost"
          :disabled="actionRunning || hasConflicts"
          @click="mergePull"
        >
          <GitMerge :size="14" aria-hidden="true" />
          拉取并合并
        </button>
        <button v-if="hasConflicts" type="button" class="primary" :disabled="actionRunning" @click="showConflicts">
          <TriangleAlert :size="14" aria-hidden="true" />
          处理冲突
        </button>
        <button type="button" class="primary" :disabled="actionRunning || !summary?.ahead" @click="push">
          <Upload :size="14" aria-hidden="true" />
          Push
        </button>
        <button type="button" class="ghost" :disabled="!summary?.githubFullName" @click="openGitHub">
          <ExternalLink :size="14" aria-hidden="true" />
          GitHub
        </button>
        <button type="button" class="ghost" :disabled="!summary?.path" @click="openFolder">
          <FolderOpen :size="14" aria-hidden="true" />
          文件夹
        </button>
      </div>
    </header>

    <section v-if="summary" class="repo-status-strip" aria-label="仓库状态条">
      <div class="repo-status-strip__item">
        <span>分支</span>
        <strong>{{ summary.currentBranch ?? "detached" }}</strong>
      </div>
      <div class="repo-status-strip__item">
        <span>同步</span>
        <strong :class="syncStatusTone()">{{ syncStatusText() }}</strong>
      </div>
      <div class="repo-status-strip__item">
        <span>冲突</span>
        <strong :class="{ 'repo-status-strip__value--err': summary.conflictCount > 0 }">{{ summary.conflictCount }}</strong>
      </div>
      <div class="repo-status-strip__item">
        <span>变更</span>
        <strong :class="{ 'repo-status-strip__value--warn': dirtyCount(summary) > 0 }">{{ dirtyCount(summary) }}</strong>
      </div>
      <div class="repo-status-strip__item">
        <span>最近提交</span>
        <strong :title="lastCommitText()">{{ lastCommitText() }}</strong>
      </div>
      <div class="repo-status-strip__item">
        <span>启动</span>
        <strong :class="{ 'repo-status-strip__value--accent': launchRunning, 'repo-status-strip__value--warn': launchState === 'error' }">
          {{ hasLaunchCommand ? launchStatusText() : "未配置" }}
        </strong>
      </div>
      <div class="repo-status-strip__item">
        <span>远端</span>
        <strong>{{ summary.githubFullName ?? "未识别 GitHub" }}</strong>
      </div>
    </section>

    <p v-if="actionError" class="error-line">{{ actionError }}</p>
    <section v-if="recentPushError" class="repo-push-error" aria-label="最近推送失败">
      <AlertCircle :size="16" aria-hidden="true" />
      <div>
        <strong>最近推送失败</strong>
        <p>{{ recentPushError.message }}</p>
      </div>
      <button
        type="button"
        class="primary"
        :disabled="recentPushError.retrying || actionRunning"
        @click="push"
      >
        <LoaderCircle v-if="recentPushError.retrying" :size="14" aria-hidden="true" class="sb-spin" />
        <RotateCw v-else :size="14" aria-hidden="true" />
        重试
      </button>
    </section>

    <div class="workbench-grid" :class="{ 'workbench-grid--conflicts': activeTab === 'conflicts' }">
      <main class="workbench-main card">
        <div class="repo-tabs" role="tablist" aria-label="仓库视图">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="repo-tabs__tab"
            :class="{ 'is-active': activeTab === tab.key }"
            role="tab"
            :aria-selected="activeTab === tab.key"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <section v-if="activeTab === 'changes'" class="repo-panel">
          <div class="section-toolbar section-toolbar--compact">
            <div class="repo-panel__title">
              <h2>工作区变更</h2>
              <p class="muted">共 {{ changes.length }} 个文件，{{ selectedSummaryText }}</p>
            </div>
            <div class="toolbar">
              <button type="button" class="ghost" :disabled="!changes.length" @click="selectAll">全选</button>
              <button type="button" class="ghost" :disabled="!selectedFiles.size" @click="stageSelected">暂存</button>
              <button type="button" class="ghost" :disabled="!selectedFiles.size" @click="unstageSelected">取消暂存</button>
            </div>
          </div>

          <p v-if="!changes.length" class="muted repo-empty">没有本地变更。</p>
          <div v-else class="change-workspace">
            <div class="change-list" role="list" aria-label="工作区变更列表">
              <div
                v-for="change in changes"
                :key="change.path"
                class="change-row"
                :class="{ 'is-focused': previewChange?.path === change.path }"
                role="button"
                tabindex="0"
                @click="focusChange(change.path)"
                @keydown.enter.prevent="focusChange(change.path)"
                @keydown.space.prevent="focusChange(change.path)"
              >
                <span class="change-row__select" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selectedFiles.has(change.path)"
                    @change="toggleFile(change.path)"
                  />
                </span>
                <span class="change-row__path" :title="change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path">
                  <span>{{ change.path }}</span>
                  <small v-if="change.oldPath">来自 {{ change.oldPath }}</small>
                </span>
                <span class="change-badge" :class="statusTone(change)">{{ statusText(change) }}</span>
              </div>
            </div>

            <section class="diff-preview" aria-label="变更预览">
              <div class="section-toolbar section-toolbar--compact">
                <div class="repo-panel__title">
                  <h2>差异预览</h2>
                  <p class="muted">{{ previewChange?.path ?? "选择一个文件查看差异" }}</p>
                </div>
              </div>
              <div v-if="previewChange?.diff" class="diff-preview__body">
                <pre><code>{{ previewChange.diff }}</code></pre>
              </div>
              <p v-else class="muted diff-preview__empty">当前没有可展示的差异内容。</p>
            </section>
          </div>
        </section>

        <section v-else-if="activeTab === 'conflicts'" class="repo-panel">
          <div class="section-toolbar section-toolbar--compact">
            <div class="repo-panel__title">
              <h2>{{ conflictOperationText }}</h2>
              <p class="muted">{{ conflictSummaryText }}</p>
            </div>
            <div class="toolbar">
              <button
                type="button"
                class="ghost danger"
                :disabled="actionRunning || conflicts.operation !== 'merge'"
                @click="abortConflict"
              >
                <TriangleAlert :size="14" aria-hidden="true" />
                {{ conflictAbortConfirm ? "确认终止合并" : "终止合并" }}
              </button>
            </div>
          </div>

          <p v-if="!conflictFiles.length" class="muted repo-empty">当前没有需要处理的冲突。</p>
          <div v-else class="conflict-flow">
            <p v-if="unsupportedConflictText" class="conflict-warning">
              <TriangleAlert :size="14" aria-hidden="true" />
              <span>{{ unsupportedConflictText }}</span>
            </p>
          <div class="conflict-workspace">
            <div class="conflict-list" role="list" aria-label="冲突文件列表">
              <button
                v-for="file in conflictFiles"
                :key="file.path"
                type="button"
                class="conflict-row"
                :class="{ 'is-focused': focusedConflict?.path === file.path }"
                @click="focusConflict(file.path)"
              >
                <span class="conflict-row__path">
                  <strong>{{ file.path }}</strong>
                  <small>{{ file.status }} · {{ conflictStatusText(file) }}</small>
                </span>
                <span class="change-badge" :class="conflictStatusTone(file)">
                  {{ file.resolved ? "已解决" : "待处理" }}
                </span>
              </button>
            </div>

            <section class="conflict-editor" aria-label="冲突分段处理">
              <div class="section-toolbar section-toolbar--compact">
                <div class="repo-panel__title">
                  <h2>分段处理</h2>
                  <p class="muted">{{ focusedConflict?.path ?? "选择左侧冲突文件" }}</p>
                </div>
              </div>
              <p v-if="!focusedConflict" class="muted diff-preview__empty">没有选中的冲突文件。</p>
              <p v-else-if="focusedConflict.binary" class="muted diff-preview__empty">该文件无法解析为文本冲突，请使用文件级处理或外部编辑。</p>
              <p v-else-if="!focusedConflict.hunks.length" class="muted diff-preview__empty">该文件没有可分段解析的 marker，请使用文件级处理或外部编辑。</p>
              <div v-else class="conflict-hunk-list">
                <article v-for="hunk in focusedConflict.hunks" :key="hunk.id" class="conflict-hunk">
                  <header class="conflict-hunk__header">
                    <strong>{{ hunk.id }}</strong>
                    <span>第 {{ hunk.startLine }}-{{ hunk.endLine }} 行</span>
                  </header>
                  <div class="conflict-hunk__columns">
                    <section class="conflict-side" :class="{ 'is-selected': conflictChoices[hunk.id] === 'ours' }">
                      <div class="conflict-side__header">
                        <strong>{{ hunk.oursLabel }}</strong>
                        <button type="button" class="ghost" @click="pickConflictHunk(hunk.id, 'ours')">采用此段</button>
                      </div>
                      <pre><code>{{ hunk.oursLines.join("\n") || " " }}</code></pre>
                    </section>
                    <section class="conflict-side" :class="{ 'is-selected': conflictChoices[hunk.id] === 'theirs' }">
                      <div class="conflict-side__header">
                        <strong>{{ hunk.theirsLabel }}</strong>
                        <button type="button" class="ghost" @click="pickConflictHunk(hunk.id, 'theirs')">采用此段</button>
                      </div>
                      <pre><code>{{ hunk.theirsLines.join("\n") || " " }}</code></pre>
                    </section>
                  </div>
                </article>
              </div>
            </section>

            <aside class="conflict-sidepanel" aria-label="冲突处理操作">
              <div class="conflict-sidepanel__card">
                <div class="section-toolbar section-toolbar--compact">
                  <div class="repo-panel__title">
                    <h2>当前文件</h2>
                    <p class="muted">{{ focusedConflict?.path ?? "未选择" }}</p>
                  </div>
                </div>
                <dl class="side-kv">
                  <div>
                    <dt>冲突类型</dt>
                    <dd>{{ conflicts.operation }}</dd>
                  </div>
                  <div>
                    <dt>处理进度</dt>
                    <dd>{{ conflictSummaryText }}</dd>
                  </div>
                  <div>
                    <dt>已选分段</dt>
                    <dd>{{ conflictSelectedCount }}</dd>
                  </div>
                </dl>
                <div class="conflict-actions">
                  <button type="button" class="primary" :disabled="!canResolveSelectedConflict || actionRunning" @click="resolveSelectedConflict">
                    解决并暂存
                  </button>
                  <button type="button" class="ghost" :disabled="!focusedConflict || actionRunning" @click="acceptConflict('ours')">
                    {{ conflictAcceptConfirm === "ours" ? "确认整文件采用 ours 并暂存" : "整文件采用 ours" }}
                  </button>
                  <button type="button" class="ghost" :disabled="!focusedConflict || actionRunning" @click="acceptConflict('theirs')">
                    {{ conflictAcceptConfirm === "theirs" ? "确认整文件采用 theirs 并暂存" : "整文件采用 theirs" }}
                  </button>
                  <button type="button" class="ghost" :disabled="!focusedConflict || actionRunning" @click="markConflictResolved">
                    外部修改后标记解决
                  </button>
                  <button type="button" class="ghost" :disabled="!focusedConflict || actionRunning" @click="openConflictFolder">
                    打开文件
                  </button>
                </div>
              </div>
            </aside>
          </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'history'" class="repo-panel">
          <div class="section-toolbar section-toolbar--compact">
            <div class="repo-panel__title">
              <h2>提交历史</h2>
              <p class="muted">按时间倒序展示最近提交</p>
            </div>
          </div>
          <p v-if="!detail?.commits.length" class="muted repo-empty">没有提交历史。</p>
          <div v-else class="history-workspace" aria-label="提交历史和分支树">
            <aside class="history-tree" aria-label="历史和分支树">
              <section>
                <h3>本地分支</h3>
                <p v-if="!historyBranches.local.length" class="muted">无本地分支</p>
                <div v-for="branch in historyBranches.local" :key="branch.name" class="history-tree__item">
                  <GitBranch :size="13" aria-hidden="true" />
                  <span :title="branch.name">{{ branch.name }}</span>
                  <em v-if="branch.current">当前</em>
                </div>
              </section>
              <section>
                <h3>远端分支</h3>
                <p v-if="!historyBranches.remote.length" class="muted">无远端分支</p>
                <div v-for="branch in historyBranches.remote" :key="branch.name" class="history-tree__item">
                  <GitBranch :size="13" aria-hidden="true" />
                  <span :title="branch.name">{{ branch.name }}</span>
                </div>
              </section>
              <section v-if="historyRefNames.length">
                <h3>历史引用</h3>
                <div v-for="refName in historyRefNames" :key="refName" class="history-tree__item history-tree__item--ref">
                  <GitCommitHorizontal :size="13" aria-hidden="true" />
                  <span :title="refName">{{ refName }}</span>
                </div>
              </section>
            </aside>
            <div class="history-list" aria-label="提交历史密集列表">
              <button
                v-for="(commit, index) in detail?.commits"
                :key="commit.hash"
                type="button"
                class="history-row"
                :title="commitMetaTitle(commit)"
                @click="openCommit(commit)"
              >
                <span class="history-graph" aria-label="提交图谱">
                  <span class="history-graph__line" :class="{ 'is-first': index === 0, 'is-last': index === (detail?.commits.length ?? 0) - 1 }" />
                  <span class="history-graph__node" />
                </span>
                <span class="history-row__body">
                  <span class="history-row__main">
                    <strong>{{ commit.subject }}</strong>
                    <span class="history-row__refs" v-if="commit.refs.length">
                      <span v-for="ref in commit.refs.slice(0, 3)" :key="ref">{{ ref }}</span>
                    </span>
                  </span>
                  <span class="history-row__meta">
                    <span>{{ commit.shortHash }}</span>
                    <span>{{ commit.author }}</span>
                  </span>
                </span>
                <time class="history-row__time" :datetime="new Date(commit.timestamp * 1000).toISOString()">
                  {{ formatCompactTime(commit.timestamp) }}
                </time>
                <span class="history-popover" role="tooltip">
                  <strong>{{ commit.subject }}</strong>
                  <span>{{ commit.hash }}</span>
                  <span>{{ commit.authorEmail ? `${commit.author} <${commit.authorEmail}>` : commit.author }}</span>
                  <span>{{ formatTime(commit.timestamp) }}</span>
                  <span>{{ commit.parents.length ? `父提交 ${commit.parents.join(", ")}` : "根提交" }}</span>
                  <span v-if="commit.refs.length">引用 {{ commit.refs.join(", ") }}</span>
                </span>
              </button>
            </div>
          </div>
        </section>

        <section v-else class="repo-panel">
          <div class="section-toolbar section-toolbar--compact">
            <div class="repo-panel__title">
              <h2>分支</h2>
              <p class="muted">巡检当前和远端分支状态</p>
            </div>
          </div>
          <p v-if="!detail?.branches.length" class="muted repo-empty">没有分支信息。</p>
          <div v-else class="repo-list-panel">
            <div v-for="branch in detail?.branches" :key="`${branch.remote}:${branch.name}`" class="branch-row">
              <GitBranch :size="14" aria-hidden="true" />
              <div>
                <strong>{{ branch.name }}</strong>
                <span>{{ branch.remote ? "远端" : "本地" }} · ↑{{ branch.ahead }} / ↓{{ branch.behind }}</span>
              </div>
              <button
                type="button"
                class="ghost"
                :disabled="branch.current || branch.remote"
                @click="checkout(branch.name)"
              >
                <Check :size="14" aria-hidden="true" />
                Checkout
              </button>
            </div>
          </div>
        </section>
      </main>

      <aside class="workbench-side">
        <section v-if="summary" class="card repo-side-status" aria-label="仓库健康与执行状态">
          <div class="section-toolbar section-toolbar--compact">
            <div class="repo-panel__title">
              <h2>仓库健康</h2>
              <p class="muted">当前仓库的关键巡检信号</p>
            </div>
          </div>
          <dl class="side-kv">
            <div>
              <dt>当前分支</dt>
              <dd>{{ summary.currentBranch ?? "detached" }}</dd>
            </div>
            <div>
              <dt>同步状态</dt>
              <dd :class="syncStatusTone()">{{ syncStatusText() }}</dd>
            </div>
            <div>
              <dt>冲突数量</dt>
              <dd :class="{ 'repo-status-strip__value--err': summary.conflictCount > 0 }">{{ summary.conflictCount }}</dd>
            </div>
            <div>
              <dt>工作区变更</dt>
              <dd :class="{ 'repo-status-strip__value--warn': dirtyCount(summary) > 0 }">{{ dirtyCount(summary) }}</dd>
            </div>
            <div>
              <dt>启动状态</dt>
              <dd>{{ hasLaunchCommand ? launchStatusText() : "未配置" }}</dd>
            </div>
            <div>
              <dt>启动来源</dt>
              <dd>{{ hasLaunchCommand ? launchSourceText() : "无" }}</dd>
            </div>
          </dl>
          <div class="repo-side-status__actions">
            <button type="button" class="primary" :disabled="actionRunning || !hasLaunchCommand || launchRunning" @click="startLaunch">
              <Play :size="14" aria-hidden="true" />
              运行
            </button>
            <button type="button" class="ghost" :disabled="actionRunning || !launchRunning" @click="stopLaunch">
              <Square :size="14" aria-hidden="true" />
              停止
            </button>
            <button type="button" class="ghost" @click="launchTerminalVisible = !launchTerminalVisible">
              <Terminal :size="14" aria-hidden="true" />
              终端
            </button>
            <button type="button" class="ghost" @click="editLaunchConfig">
              <Settings :size="14" aria-hidden="true" />
              启动配置
            </button>
          </div>
        </section>

        <section class="card commit-panel" aria-label="提交并推送">
          <div class="section-toolbar section-toolbar--compact">
            <div class="repo-panel__title">
              <h2>提交并推送</h2>
              <p class="muted">从左侧变更列表选择文件后执行提交</p>
            </div>
          </div>
          <div class="commit-summary">
            <strong>{{ selectedSummaryText }}</strong>
            <p v-if="hasConflicts" class="muted">当前存在冲突，先完成冲突处理再提交。</p>
            <p v-if="selectedFilePreview.length" class="muted">
              {{ selectedFilePreview.join(" · ") }}<template v-if="selectedFileList.length > selectedFilePreview.length"> 等 {{ selectedFileList.length }} 个</template>
            </p>
            <p v-else class="muted">先在左侧勾选需要提交的文件。</p>
          </div>
          <input v-model="commitMessage" type="text" placeholder="提交说明" />
          <label class="checkbox-line">
            <input v-model="pushAfter" type="checkbox" />
            <span>提交后立即 push</span>
          </label>
          <button type="button" class="primary" :disabled="!canCommit || actionRunning || hasConflicts" @click="commitSelected">
            <GitCommitHorizontal :size="14" aria-hidden="true" />
            提交
          </button>
        </section>

        <section class="launch-panel card">
          <div class="section-toolbar section-toolbar--compact">
            <div>
              <h2>快速启动</h2>
              <p class="muted">
                {{ hasLaunchCommand ? launchStatusText() : "未识别启动脚本" }}
                <template v-if="hasLaunchCommand"> · {{ launchSourceText() }}</template>
              </p>
            </div>
            <button type="button" class="ghost" :disabled="workspace.state.launchLoading" @click="refreshLaunch">
              <RefreshCw :size="14" aria-hidden="true" />
              刷新状态
            </button>
          </div>

          <div v-if="launchEditing" class="launch-form">
            <label>
              <span>命令</span>
              <input v-model="launchCommandInput" type="text" placeholder="例如 yarn tauri:dev" />
            </label>
            <label>
              <span>工作目录</span>
              <input v-model="launchCwdInput" type="text" placeholder="留空使用仓库根目录" />
            </label>
            <div class="toolbar">
              <button type="button" class="primary" :disabled="!launchCommandInput.trim() || actionRunning" @click="saveLaunchConfig">
                保存配置
              </button>
              <button type="button" class="ghost" @click="cancelLaunchConfig">取消</button>
            </div>
          </div>
          <div v-else class="launch-command">
            <code>{{ launchConfig?.command || "暂无启动命令，请手动配置。" }}</code>
            <span v-if="launchConfig?.cwd">cwd: {{ launchConfig.cwd }}</span>
          </div>

          <p v-if="launchStatus?.error" class="error-line">{{ launchStatus.error }}</p>

          <div v-if="launchTerminalVisible" class="launch-terminal" aria-label="启动终端">
            <div class="launch-terminal__header">
              <span>运行输出</span>
              <button type="button" class="ghost" @click="launchTerminalVisible = false">隐藏</button>
            </div>
            <div class="launch-terminal__body">
              <p v-if="!launchLogs.length" class="muted">暂无输出。</p>
              <pre v-else><code><span
                v-for="entry in launchLogs"
                :key="entry.index"
                :class="`launch-log launch-log--${entry.stream}`"
              >[{{ streamText(entry.stream) }}] {{ entry.line }}
</span></code></pre>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.repo-workbench {
  display: grid;
  gap: 14px;
}

.repo-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.repo-header__identity {
  min-width: 0;
}

.repo-header h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}

.repo-header__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 13px;
}

.repo-header__meta span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.repo-header__meta span:not(:last-child)::after {
  content: "·";
  margin-left: 8px;
  color: var(--text-faint);
}

.repo-header__actions,
.toolbar,
.section-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.repo-header__actions {
  justify-content: flex-end;
  flex: 0 0 auto;
}

.repo-status-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.repo-status-strip__item {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.repo-status-strip__item span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.repo-status-strip__item strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.repo-status-strip__value--ok {
  color: var(--ok);
}

.repo-status-strip__value--accent {
  color: var(--accent);
}

.repo-status-strip__value--warn {
  color: var(--warn);
}

.repo-status-strip__value--err {
  color: var(--err);
}

.repo-push-error {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--err-soft);
  border-radius: 8px;
  background: var(--err-soft);
  color: var(--err);
}

.repo-push-error div {
  min-width: 0;
}

.repo-push-error strong,
.repo-push-error p {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-push-error strong {
  font-size: 13px;
}

.repo-push-error p {
  margin: 2px 0 0;
  color: var(--text);
  font-size: 12px;
}

.workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  align-items: start;
  gap: 14px;
}

.workbench-grid--conflicts {
  grid-template-columns: minmax(0, 1fr);
}

.workbench-main {
  min-width: 0;
  padding: 0;
}

.workbench-side {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.workbench-grid--conflicts .workbench-side {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.section-toolbar {
  width: 100%;
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-toolbar--compact {
  align-items: flex-start;
}

.repo-panel__title {
  min-width: 0;
}

.section-toolbar h2,
.repo-panel h2,
.commit-panel h2,
.launch-panel h2,
.repo-side-status h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-toolbar p,
.launch-panel p,
.repo-panel__title p {
  margin: 4px 0 0;
}

.repo-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--border);
}

.repo-tabs__tab {
  height: 34px;
  padding: 0 12px;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  color: var(--text-muted);
}

.repo-tabs__tab.is-active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.repo-panel {
  padding: 14px 16px 16px;
}

.repo-empty {
  margin: 0;
}

.change-list,
.repo-list-panel {
  display: grid;
}

.change-workspace {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(320px, 0.9fr);
  gap: 14px;
  align-items: start;
}

.change-list {
  align-content: start;
}

.change-row,
.branch-row {
  border-top: 1px solid var(--border-soft);
}

.change-row:first-of-type,
.branch-row:first-of-type {
  border-top: 0;
}

.change-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
}

.change-row:hover {
  background: var(--bg-hover);
}

.change-row.is-focused {
  background: var(--bg-active);
}

.change-row:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.change-row__select {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.change-row__path,
.checkbox-line {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}

.change-row__path span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-row__path small {
  color: var(--text-faint);
  font-size: 11px;
}

.change-row input,
.change-row__select input,
.checkbox-line input {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  padding: 0;
}

.change-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.change-badge--ok {
  color: var(--ok);
  background: var(--ok-soft);
}

.change-badge--warn {
  color: var(--warn);
  background: var(--warn-soft);
}

.change-badge--accent {
  color: var(--accent);
  background: var(--accent-soft);
}

.change-badge--err {
  color: var(--err);
  background: var(--err-soft);
}

.change-badge--muted {
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.conflict-workspace {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(420px, 1fr) minmax(260px, 320px);
  gap: 14px;
  align-items: start;
}

.conflict-flow {
  display: grid;
  gap: 12px;
}

.conflict-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--warn-soft);
  border-radius: 8px;
  background: color-mix(in srgb, var(--warn-soft) 72%, var(--bg-subtle));
  color: var(--text);
}

.conflict-warning svg {
  color: var(--warn);
  flex: 0 0 auto;
  margin-top: 1px;
}

.conflict-warning span {
  min-width: 0;
  line-height: 1.5;
}

.conflict-list,
.conflict-hunk-list {
  display: grid;
  gap: 8px;
}

.conflict-row {
  width: 100%;
  min-height: 56px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
  justify-content: space-between;
  text-align: left;
}

.conflict-row:hover {
  background: var(--bg-hover);
}

.conflict-row.is-focused {
  border-color: var(--accent);
  background: var(--bg-active);
}

.conflict-row__path {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.conflict-row__path strong,
.conflict-row__path small {
  overflow-wrap: anywhere;
}

.conflict-row__path small {
  color: var(--text-muted);
  font-size: 12px;
}

.conflict-editor,
.conflict-sidepanel__card,
.conflict-hunk,
.conflict-side {
  display: grid;
  gap: 10px;
}

.conflict-editor {
  min-width: 0;
}

.conflict-hunk {
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.conflict-hunk__header,
.conflict-side__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.conflict-hunk__header strong,
.conflict-side__header strong {
  font-size: 13px;
}

.conflict-hunk__header span,
.conflict-side__header span {
  color: var(--text-muted);
  font-size: 12px;
}

.conflict-hunk__columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.conflict-side {
  padding: 10px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-elev);
}

.conflict-side.is-selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 65%, var(--bg-elev));
}

.conflict-side pre {
  min-height: 120px;
  max-height: 320px;
}

.conflict-sidepanel {
  min-width: 0;
}

.conflict-actions {
  display: grid;
  gap: 8px;
}

.diff-preview {
  display: grid;
  gap: 10px;
  min-height: 100%;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.diff-preview__body,
.diff-preview__body pre {
  height: 100%;
}

.diff-preview pre {
  max-height: 320px;
}

.diff-preview__empty {
  margin: 0;
  min-height: 160px;
  display: flex;
  align-items: center;
}

.branch-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
}

.branch-row span {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
}

.branch-row strong {
  overflow-wrap: anywhere;
}

.history-workspace {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.history-tree {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.history-tree section {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.history-tree h3 {
  margin: 0 0 2px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.history-tree p {
  margin: 0;
  font-size: 12px;
}

.history-tree__item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 6px;
  border-radius: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.history-tree__item:hover {
  background: var(--bg-hover);
}

.history-tree__item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-tree__item em {
  padding: 1px 5px;
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
}

.history-tree__item--ref {
  color: var(--text);
}

.history-list {
  display: grid;
  position: relative;
}

.history-row {
  position: relative;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 128px;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 8px 0 0;
  border-top: 1px solid var(--border-soft);
  border-radius: 6px;
  text-align: left;
  color: var(--text);
}

.history-row:first-child {
  border-top: 0;
}

.history-row:hover,
.history-row:focus-visible {
  background: var(--bg-hover);
}

.history-row:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.history-graph {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  min-height: 34px;
}

.history-graph__line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--border);
}

.history-graph__line.is-first {
  top: 50%;
}

.history-graph__line.is-last {
  bottom: 50%;
}

.history-graph__node {
  position: relative;
  z-index: 1;
  width: 10px;
  height: 10px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: var(--bg-elev);
}

.history-row__body,
.history-row__main,
.history-row__meta {
  min-width: 0;
}

.history-row__body {
  display: grid;
  gap: 2px;
}

.history-row__main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-row__main strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.history-row__refs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 0 1 auto;
}

.history-row__refs span {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 11px;
  font-weight: 600;
}

.history-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.history-row__meta span:not(:last-child)::after {
  content: "·";
  margin-left: 8px;
  color: var(--text-faint);
}

.history-row__time {
  justify-self: end;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.history-popover {
  pointer-events: none;
  position: absolute;
  z-index: 5;
  left: 48px;
  top: calc(100% - 2px);
  display: none;
  width: min(420px, calc(100vw - 96px));
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  box-shadow: 0 14px 36px rgb(0 0 0 / 20%);
  color: var(--text);
}

.history-popover span,
.history-popover strong {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.history-popover strong {
  margin-bottom: 6px;
  font-size: 13px;
}

.history-popover span {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.history-row:hover .history-popover,
.history-row:focus-visible .history-popover {
  display: block;
}

.commit-panel,
.launch-panel,
.repo-side-status {
  display: grid;
  gap: 12px;
}

.commit-summary strong {
  display: block;
  font-size: 13px;
}

.commit-summary p {
  margin: 4px 0 0;
  font-size: 12px;
}

.commit-panel input[type="text"] {
  width: 100%;
}

.commit-panel > button.primary {
  justify-self: stretch;
}

.side-kv {
  display: grid;
  gap: 0;
  margin: 0;
}

.side-kv div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-soft);
}

.side-kv div:last-child {
  border-bottom: 0;
}

.side-kv dt {
  color: var(--text-muted);
  font-size: 12px;
}

.side-kv dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.repo-side-status__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.launch-form {
  display: grid;
  gap: 10px;
}

.launch-form label {
  display: grid;
  gap: 5px;
}

.launch-form label span {
  color: var(--text-muted);
  font-size: 12px;
}

.launch-form input {
  width: 100%;
}

.launch-command {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.launch-command code {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.launch-command span {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.launch-terminal {
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-subtle);
}

.launch-terminal__header {
  height: 34px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 12px;
}

.launch-terminal__body {
  max-height: 320px;
  overflow: auto;
}

.launch-terminal__body pre {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.launch-log {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.launch-log--stderr {
  color: var(--err);
}

.launch-log--system {
  color: var(--text-muted);
}

.error-line {
  margin: 0;
  color: var(--err);
}

@media (max-width: 1180px) {
  .repo-status-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .workbench-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .workbench-side {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workbench-grid--conflicts .workbench-side {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .change-workspace {
    grid-template-columns: 1fr;
  }

  .conflict-workspace {
    grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
  }

  .conflict-sidepanel {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .repo-header,
  .repo-status-strip,
  .repo-push-error,
  .conflict-workspace,
  .workbench-side {
    grid-template-columns: 1fr;
  }

  .conflict-sidepanel {
    grid-column: auto;
  }

  .repo-header {
    flex-direction: column;
    align-items: stretch;
  }

  .repo-header__actions {
    display: grid;
    grid-template-columns: 1fr;
    justify-content: flex-start;
  }

  .repo-header__meta {
    display: grid;
    gap: 2px;
  }

  .repo-header__meta span:not(:last-child)::after {
    content: "";
    margin-left: 0;
  }

  .repo-header__actions button,
  .repo-side-status__actions button {
    justify-content: flex-start;
  }

  .change-row {
    grid-template-columns: 28px minmax(0, 1fr);
    padding: 8px 10px;
  }

  .change-badge {
    grid-column: 2;
    justify-self: start;
  }

  .branch-row,
  .branch-row button {
    grid-column: auto;
  }

  .branch-row,
  .repo-side-status__actions {
    grid-template-columns: 1fr;
  }

  .history-workspace {
    grid-template-columns: 1fr;
  }

  .conflict-hunk__columns {
    grid-template-columns: 1fr;
  }

  .history-tree {
    grid-template-columns: 1fr;
  }

  .history-row {
    grid-template-columns: 32px minmax(0, 1fr);
    min-height: 42px;
  }

  .history-row__time {
    grid-column: 2;
    justify-self: start;
  }

  .history-popover {
    left: 32px;
    width: calc(100vw - 64px);
  }

  .branch-row button {
    justify-self: start;
  }
}
</style>
