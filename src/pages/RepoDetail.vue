<script setup lang="ts">
import {
  FolderOpen,
  GitPullRequestArrow,
  KeyRound,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  Upload,
} from "@lucide/vue";
import RepoProjectPanel from "../components/repo/RepoProjectPanel.vue";
import RepoPushError from "../components/repo/RepoPushError.vue";
import { useRepoDetailController } from "../composables/useRepoDetailController";
import "../styles/page.css";

const {
  activeTab,
  commitMessage,
  actionError,
  actionRunning,
  conflictAcceptConfirm,
  launchTerminalVisible,
  conflictChoices,
  selectedCommitHash,
  repoId,
  remoteOnly,
  detail,
  summary,
  repoTitle,
  repoMetaItems,
  changes,
  conflictOperationActive,
  supportedConflictOperation,
  previewChange,
  conflictSelectedCount,
  canResolveSelectedConflict,
  canContinueConflictOperation,
  canCommit,
  launchConfig,
  launchStatus,
  launchCandidates,
  launchLogs,
  launchLoading,
  languageStatsRefreshing,
  usingSystemGit,
  launchRunning,
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
  activeProjectTab,
  activeProjectIssue,
  activeProjectRun,
  tabs,
  load,
  focusChange,
  focusConflict,
  pickConflictHunk,
  stageUnstagedChanges,
  unstageStagedChanges,
  commitSelected,
  mergePull,
  push,
  useDefaultTokenAuth,
  showConflicts,
  acceptConflict,
  resolveSelectedConflict,
  markConflictResolved,
  abortConflict,
  continueConflict,
  startLaunch,
  stopLaunch,
  selectLaunchCandidate,
  checkout,
  openCommit,
  closeCommit,
  openFolder,
  openConflictFolder,
  commitMetaTitle,
} = useRepoDetailController();
</script>
<template>
  <section class="repo-workbench">
    <div class="repo-workbench__top">
      <header class="repo-header">
        <div class="repo-header__identity">
          <h1>{{ repoTitle }}</h1>
          <div class="repo-header__meta" :title="repoMetaItems.join(' · ')">
            <span v-for="item in repoMetaItems" :key="item">{{ item }}</span>
            <span v-if="usingSystemGit" class="repo-header__credential">
              <KeyRound :size="12" aria-hidden="true" />
              系统 git 凭证
            </span>
          </div>
        </div>
        <div class="repo-header__actions overview-actions" aria-label="仓库操作">
          <button
            v-if="!remoteOnly && usingSystemGit"
            type="button"
            class="overview-actions__btn"
            title="恢复默认 token 推送"
            aria-label="恢复默认 token 推送"
            :disabled="actionRunning"
            @click="useDefaultTokenAuth"
          >
            <RotateCcw :size="17" aria-hidden="true" />
          </button>
          <button
            v-if="!remoteOnly"
            type="button"
            class="overview-actions__btn"
            title="刷新"
            aria-label="刷新"
            :disabled="actionRunning || languageStatsRefreshing"
            @click="load"
          >
            <RefreshCw :size="17" aria-hidden="true" />
          </button>
          <button
            v-if="!remoteOnly"
            type="button"
            class="overview-actions__btn"
            title="文件夹"
            aria-label="文件夹"
            :disabled="!summary?.path"
            @click="openFolder"
          >
            <FolderOpen :size="17" aria-hidden="true" />
          </button>
          <button
            v-if="!remoteOnly"
            type="button"
            class="overview-actions__btn"
            title="拉取"
            aria-label="拉取"
            :disabled="actionRunning || hasConflicts"
            @click="mergePull"
          >
            <GitPullRequestArrow :size="17" aria-hidden="true" />
          </button>
          <button
            v-if="!remoteOnly && hasConflicts"
            type="button"
            class="overview-actions__btn overview-actions__btn--primary"
            :disabled="actionRunning"
            @click="showConflicts"
          >
            <TriangleAlert :size="17" aria-hidden="true" />
            处理冲突
          </button>
          <button
            v-else-if="!remoteOnly"
            type="button"
            class="overview-actions__btn overview-actions__btn--primary"
            :disabled="actionRunning || !summary?.ahead"
            @click="push"
          >
            <Upload :size="17" aria-hidden="true" />
            Push
          </button>
        </div>
      </header>

      <div v-if="actionError || recentSyncError" class="repo-workbench__status">
        <p v-if="actionError" class="error-line">{{ actionError }}</p>
        <RepoPushError
          v-if="recentSyncError"
          :message="recentSyncError.message"
          :retrying="recentSyncError.retrying"
          :action-running="actionRunning"
          @retry="push"
        />
      </div>
    </div>

    <div class="repo-workbench__body">
      <main class="workbench-main workbench-main--project">
        <RepoProjectPanel
          :repo-id="repoId"
          :repo-title="repoTitle"
          :repo-full-name="summary?.githubFullName"
          :repo-path="summary?.path"
          :active-git-tab="activeTab"
          :git-tabs="tabs"
          :changes="changes"
          :preview-change="previewChange"
          :commit-message="commitMessage"
          :has-conflicts="hasConflicts"
          :can-commit="canCommit"
          :status-commits="statusCommits"
          :selected-commit-hash="selectedCommitHash"
          :branches="detail?.branches ?? []"
          :conflict-operation-text="conflictOperationText"
          :conflict-summary-text="conflictSummaryText"
          :conflict-continue-text="conflictContinueText"
          :conflict-abort-text="conflictAbortText"
          :conflict-files="panelConflictFiles"
          :conflict-operation-active="conflictOperationActive"
          :conflicts="panelConflicts"
          :focused-conflict="panelFocusedConflict"
          :conflict-choices="conflictChoices"
          :conflict-selected-count="conflictSelectedCount"
          :conflict-accept-confirm="conflictAcceptConfirm"
          :can-continue-conflict-operation="canContinueConflictOperation"
          :can-resolve-selected-conflict="canResolveSelectedConflict"
          :supported-conflict-operation="supportedConflictOperation"
          :commit-meta-title="commitMetaTitle"
          :loading="launchLoading"
          :launch-config="launchConfig"
          :launch-status="launchStatus"
          :launch-candidates="launchCandidates"
          :launch-logs="launchLogs"
          :launch-terminal-visible="launchTerminalVisible"
          :action-running="actionRunning"
          :launch-running="launchRunning"
          @start="startLaunch"
          @stop="stopLaunch"
          @open-terminal="launchTerminalVisible = true"
          @hide-terminal="launchTerminalVisible = false"
          @select-launch-candidate="selectLaunchCandidate"
          :remote-only="remoteOnly"
          :project-tab="activeProjectTab"
          :project-issue-number="activeProjectIssue"
          :project-run-id="activeProjectRun"
          @update-active-git-tab="activeTab = $event"
          @update-commit-message="commitMessage = $event"
          @stage-unstaged-changes="stageUnstagedChanges"
          @unstage-staged-changes="unstageStagedChanges"
          @focus-change="focusChange"
          @commit="commitSelected"
          @checkout="checkout"
          @open-commit="openCommit"
          @close-commit="closeCommit"
          @continue-conflict="continueConflict"
          @abort-conflict="abortConflict"
          @focus-conflict="focusConflict"
          @pick-conflict-hunk="pickConflictHunk"
          @resolve-selected-conflict="resolveSelectedConflict"
          @accept-conflict="acceptConflict"
          @mark-conflict-resolved="markConflictResolved"
          @open-conflict-folder="openConflictFolder"
        />
      </main>
    </div>
  </section>
</template>

<style>
.repo-workbench {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  height: calc(100vh - 76px);
  min-height: 0;
  overflow: hidden;
}

.repo-workbench__top {
  display: grid;
  gap: 14px;
  min-height: 0;
}

.repo-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
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

.repo-header__credential {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--accent);
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

.repo-header__actions.overview-actions {
  gap: 2px;
  flex-wrap: nowrap;
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

.repo-workbench__status {
  display: grid;
  grid-template-rows: minmax(0, auto);
  gap: 14px;
  min-height: 0;
}

.repo-workbench__body {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.workbench-main {
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: auto;
  padding: 0;
}

.workbench-main--project {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  height: 100%;
  overflow: hidden;
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
.repo-panel h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-toolbar p,
.repo-panel__title p {
  margin: 4px 0 0;
}

.repo-panel {
  padding: 14px 16px 16px;
}

.repo-panel--history {
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: auto;
}

.repo-empty {
  margin: 0;
}

.repo-list-panel {
  display: grid;
}

.branch-row {
  border-top: 1px solid var(--border-soft);
}

.branch-row:first-of-type {
  border-top: 0;
}

.change-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
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

.history-list {
  display: grid;
  align-content: start;
  position: relative;
}

.history-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(72px, var(--history-graph-width, 112px)) minmax(0, 1fr) minmax(150px, 190px);
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 6px 0 0;
  border-top: 1px solid var(--border-soft);
  border-radius: 6px;
  text-align: left;
  color: var(--text);
}

.history-row:first-child {
  border-top: 0;
}

.history-row:hover,
.history-row:focus-visible,
.history-row.is-active {
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
  align-self: stretch;
  min-width: 0;
  min-height: 28px;
  padding-left: 8px;
  overflow: hidden;
}

.history-graph__svg {
  display: block;
  flex: 0 0 auto;
  overflow: visible;
}

.history-graph__segment,
.history-graph__connector {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.history-graph__node {
  fill: var(--bg-elev);
  stroke-width: 2;
}

.history-row__body,
.history-row__main,
.history-row__tail {
  min-width: 0;
}

.history-row__body {
  display: block;
  overflow: hidden;
}

.history-row__main {
  display: flex;
  align-items: center;
  gap: 6px;
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
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 5px;
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 11px;
  font-weight: 600;
}

.history-row__author {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 11px;
}

.history-row__tail {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.history-row__time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 11px;
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

.launch-panel {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  margin-bottom: 0;
}

.launch-command-button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 34px;
  padding: 7px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  color: var(--text);
}

.launch-command-button:hover {
  background: var(--bg-hover);
}

.launch-command-button strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.launch-run-button {
  flex: 0 0 auto;
  width: 36px;
  min-width: 36px;
  padding: 0;
  justify-content: center;
}

.error-line {
  margin: 0;
  color: var(--err);
}

@media (max-width: 1180px) {
  .conflict-workspace {
    grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
  }

  .conflict-sidepanel {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .repo-workbench {
    height: calc(100vh - 60px);
  }

  .repo-header,
  .repo-push-error,
  .conflict-workspace {
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
    align-self: flex-start;
    justify-content: flex-start;
  }

  .repo-header__actions.overview-actions {
    align-self: stretch;
    flex-wrap: wrap;
    width: 100%;
    height: auto;
    min-height: 40px;
    max-width: 100%;
  }

  .repo-header__actions .overview-actions__btn {
    flex: 0 0 32px;
  }

  .repo-header__actions .overview-actions__btn--primary {
    flex: 1 1 96px;
    min-width: 96px;
  }

  .repo-header__meta {
    display: grid;
    gap: 2px;
  }

  .repo-header__meta span:not(:last-child)::after {
    content: "";
    margin-left: 0;
  }

  .branch-row,
  .branch-row button {
    grid-column: auto;
  }

  .conflict-hunk__columns {
    grid-template-columns: 1fr;
  }

  .history-row {
    grid-template-columns: minmax(72px, min(var(--history-graph-width, 84px), 34vw)) minmax(0, 1fr);
    min-height: 32px;
  }

  .history-row__tail {
    display: none;
  }

  .history-popover {
    left: 84px;
    width: calc(100vw - 64px);
  }

  .branch-row button {
    justify-self: start;
  }
}
</style>
