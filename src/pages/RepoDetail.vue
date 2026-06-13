<script setup lang="ts">
import {
  ExternalLink,
  FolderOpen,
  GitPullRequestArrow,
  RefreshCw,
  TriangleAlert,
  Upload,
} from "@lucide/vue";
import RepoBranchesPanel from "../components/repo/RepoBranchesPanel.vue";
import RepoChangesPanel from "../components/repo/RepoChangesPanel.vue";
import RepoCommitPanel from "../components/repo/RepoCommitPanel.vue";
import RepoConflictsPanel from "../components/repo/RepoConflictsPanel.vue";
import RepoHistoryPanel from "../components/repo/RepoHistoryPanel.vue";
import RepoGitHubPanel from "../components/repo/RepoGitHubPanel.vue";
import RepoLaunchPanel from "../components/repo/RepoLaunchPanel.vue";
import RepoPushError from "../components/repo/RepoPushError.vue";
import RepoStatusStrip from "../components/repo/RepoStatusStrip.vue";
import { useRepoDetailController } from "../composables/useRepoDetailController";
import "../styles/page.css";

const {
  activeTab,
  selectedFiles,
  commitMessage,
  pushAfter,
  actionError,
  actionRunning,
  conflictAcceptConfirm,
  launchEditing,
  launchTerminalVisible,
  launchCommandInput,
  launchCwdInput,
  conflictChoices,
  detail,
  summary,
  repoTitle,
  repoMetaItems,
  changes,
  conflictOperationActive,
  supportedConflictOperation,
  selectedFileList,
  previewChange,
  conflictSelectedCount,
  canResolveSelectedConflict,
  canContinueConflictOperation,
  canCommit,
  launchConfig,
  launchStatus,
  launchLogs,
  launchLoading,
  languageStatsRefreshing,
  launchState,
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
  load,
  refreshLaunch,
  dirtyCount,
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
  openGitHub,
  openFolder,
  openConflictFolder,
  commitMetaTitle,
} = useRepoDetailController();
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
      <div class="repo-header__actions overview-actions" aria-label="仓库操作">
        <button
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
          type="button"
          class="overview-actions__btn"
          title="GitHub"
          aria-label="GitHub"
          :disabled="!summary?.githubFullName"
          @click="openGitHub"
        >
          <ExternalLink :size="17" aria-hidden="true" />
        </button>
        <button
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
          v-if="hasConflicts"
          type="button"
          class="overview-actions__btn overview-actions__btn--primary"
          :disabled="actionRunning"
          @click="showConflicts"
        >
          <TriangleAlert :size="17" aria-hidden="true" />
          处理冲突
        </button>
        <button
          v-else
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

    <RepoStatusStrip
      v-if="summary"
      :commits="statusCommits"
      :summary="summary"
      :launch-status="launchStatus"
      :launch-config="launchConfig"
      :launch-running="launchRunning"
      :launch-state="launchState"
      :dirty-count="dirtyCount"
    />

    <p v-if="actionError" class="error-line">{{ actionError }}</p>
    <RepoPushError
      v-if="recentSyncError"
      :message="recentSyncError.message"
      :retrying="recentSyncError.retrying"
      :action-running="actionRunning"
      @retry="push"
    />

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

        <RepoChangesPanel
          v-if="activeTab === 'changes'"
          :changes="changes"
          :selected-files="selectedFiles"
          :selected-summary-text="selectedSummaryText"
          :preview-change="previewChange"
          @select-all="selectAll"
          @stage-selected="stageSelected"
          @unstage-selected="unstageSelected"
          @focus-change="focusChange"
          @toggle-file="toggleFile"
        />

        <RepoConflictsPanel
          v-else-if="activeTab === 'conflicts'"
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
          :action-running="actionRunning"
          @continue-conflict="continueConflict"
          @abort-conflict="abortConflict"
          @focus-conflict="focusConflict"
          @pick-conflict-hunk="pickConflictHunk"
          @resolve-selected-conflict="resolveSelectedConflict"
          @accept-conflict="acceptConflict"
          @mark-conflict-resolved="markConflictResolved"
          @open-conflict-folder="openConflictFolder"
        />

        <RepoHistoryPanel
          v-else-if="activeTab === 'history'"
          :commits="statusCommits"
          :commit-meta-title="commitMetaTitle"
          @open-commit="openCommit"
        />

        <RepoBranchesPanel
          v-else-if="activeTab === 'branches'"
          :branches="detail?.branches ?? []"
          @checkout="checkout"
        />

        <RepoGitHubPanel
          v-else
          :repo-full-name="summary?.githubFullName"
        />
      </main>

      <aside class="workbench-side">
        <RepoCommitPanel
          v-model:commit-message="commitMessage"
          v-model:push-after="pushAfter"
          :selected-summary-text="selectedSummaryText"
          :selected-file-preview="selectedFilePreview"
          :selected-file-count="selectedFileList.length"
          :has-conflicts="hasConflicts"
          :can-commit="canCommit"
          :action-running="actionRunning"
          @commit="commitSelected"
        />

        <RepoLaunchPanel
          v-model:launch-command-input="launchCommandInput"
          v-model:launch-cwd-input="launchCwdInput"
          :loading="launchLoading"
          :launch-editing="launchEditing"
          :has-launch-command="hasLaunchCommand"
          :launch-config="launchConfig"
          :launch-status="launchStatus"
          :launch-logs="launchLogs"
          :launch-terminal-visible="launchTerminalVisible"
          :action-running="actionRunning"
          :launch-running="launchRunning"
          @refresh="refreshLaunch"
          @start="startLaunch"
          @stop="stopLaunch"
          @toggle-terminal="launchTerminalVisible = !launchTerminalVisible"
          @edit-config="editLaunchConfig"
          @save="saveLaunchConfig"
          @cancel="cancelLaunchConfig"
          @hide-terminal="launchTerminalVisible = false"
        />
      </aside>
    </div>
  </section>
</template>

<style>
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

.repo-header__actions.overview-actions {
  gap: 2px;
  flex-wrap: nowrap;
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
.launch-panel h2 {
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
  min-width: 0;
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
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 6px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
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

.change-row__file,
.checkbox-line {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 1px;
  min-width: 0;
}

.change-row__path {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.25;
}

.change-row__file small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
  font-size: 10px;
  line-height: 1.2;
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

.history-list {
  display: grid;
  position: relative;
}

.history-row {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) minmax(150px, 190px);
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
  min-height: 28px;
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

.commit-panel,
.launch-panel {
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

.launch-actions {
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

  .launch-actions button {
    justify-content: flex-start;
  }

  .change-row {
    grid-template-columns: 24px minmax(0, 1fr);
    min-height: 34px;
    padding: 4px 6px;
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
  .launch-actions {
    grid-template-columns: 1fr;
  }

  .conflict-hunk__columns {
    grid-template-columns: 1fr;
  }

  .history-row {
    grid-template-columns: 32px minmax(0, 1fr);
    min-height: 32px;
  }

  .history-row__tail {
    display: none;
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
