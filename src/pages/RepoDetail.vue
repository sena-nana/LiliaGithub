<script setup lang="ts">
import {
  CloudDownload,
  CloudUpload,
  Archive,
  Code2,
  FolderTree,
  FolderOpen,
  GitCompare,
  History,
  Monitor,
  Play,
  RotateCcw,
  ScrollText,
  Square,
  SquareTerminal,
  TriangleAlert,
} from "@lucide/vue";
import { defineAsyncComponent } from "vue";
import Dropdown from "../components/Dropdown.vue";
import RepoBranchPicker from "../components/repo/RepoBranchPicker.vue";
import RepoProjectPanel from "../components/repo/RepoProjectPanel.vue";
import RepoPushError from "../components/repo/RepoPushError.vue";
import { useRepoDetailController } from "../composables/useRepoDetailController";
import { repoRoute } from "../utils/repoRoutes";
import "../styles/page.css";

const RepoFilesPanel = defineAsyncComponent(() => import("../components/repo/RepoFilesPanel.vue"));
const RepoStashPanel = defineAsyncComponent(() => import("../components/repo/RepoStashPanel.vue"));
const RepoToolbarSettingsMenu = defineAsyncComponent(() => import("../components/repo/RepoToolbarSettingsMenu.vue"));

const {
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
  remoteOnly,
  summary,
  repoTitle,
  changes,
  conflictOperationActive,
  supportedConflictOperation,
  previewChange,
  conflictSelectedCount,
  canResolveSelectedConflict,
  canContinueConflictOperation,
  canCommit,
  launchConfig,
  launchLogs,
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
  focusChange,
  focusConflict,
  pickConflictHunk,
  stageUnstagedChanges,
  unstageStagedChanges,
  runChangeAction,
  commitSelected,
  refreshAndFetchRepo,
  selectOpenTarget,
  selectPullStrategy,
  setAutoSync,
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
  openSelectedTarget,
  openConflictFolder,
  commitMetaTitle,
} = useRepoDetailController();
</script>
<template>
  <section class="repo-workbench">
    <div class="repo-workbench__top">
      <header class="repo-header">
        <div class="repo-header__tabs-wrap">
          <h1 class="repo-header__sr-title">{{ repoTitle }}</h1>
          <div class="repo-toolbar" aria-label="仓库页面工具条">
            <nav class="repo-toolbar__group repo-toolbar__views" role="tablist" aria-label="仓库页面">
              <RouterLink
                v-for="tab in toolbarTabs"
                :key="tab.key"
                class="repo-toolbar__btn"
                :class="{
                  'is-active': activeTab === tab.key,
                  'repo-toolbar__btn--counted': tab.key === 'changes' && changes.length,
                }"
                role="tab"
                :aria-selected="activeTab === tab.key"
                :to="repoRoute(repoId, tab.key)"
                :title="tab.title"
                :aria-label="tab.title"
              >
                <FolderTree v-if="tab.key === 'files'" :size="17" aria-hidden="true" />
                <Monitor v-else-if="tab.key === 'repo'" :size="17" aria-hidden="true" />
                <GitCompare v-else-if="tab.key === 'changes'" :size="17" aria-hidden="true" />
                <History v-else-if="tab.key === 'history'" :size="17" aria-hidden="true" />
                <Archive v-else :size="17" aria-hidden="true" />
                <span v-if="tab.key === 'changes' && changes.length" class="repo-toolbar__badge repo-toolbar__badge--warn">
                  {{ changes.length }}
                </span>
              </RouterLink>
              <RepoBranchPicker
                v-if="branchItems.length"
                :display-label="activeBranchName"
                :branches="branchItems"
                button-class="repo-toolbar__btn repo-toolbar__branch-select"
                :disabled="branchActionRunning || !branchItems.length"
                :action-running="branchActionRunning"
                :allow-remote-checkout="!remoteOnly"
                :allow-remote-create="!remoteOnly"
                :allow-remote-delete="remoteOnly || Boolean(summary?.githubFullName)"
                :show-repository-actions="!remoteOnly"
                @checkout="checkout"
                @update-current="updateCurrentBranch"
                @create-branch="createBranchFromRef($event.name, $event.fromRef, $event.checkoutAfter)"
                @rename-branch="renameBranchTo($event.oldName, $event.newName)"
                @merge-branch="mergeBranch"
                @delete-branch="deleteBranch"
                @refresh-branches="refreshAndFetchRepo"
                @push-with-upstream="pushCurrentBranchWithUpstream"
                @set-upstream="setCurrentBranchUpstream"
              />
            </nav>

            <div v-if="!remoteOnly" class="repo-toolbar__group repo-toolbar__launch" role="group" aria-label="命令执行">
              <Dropdown
                :model-value="activeLaunchValue"
                :options="launchCommandOptions"
                :icon="SquareTerminal"
                :display-label="launchCommandText"
                placeholder="选择启动指令"
                placement="bottom"
                button-class="repo-toolbar__btn repo-toolbar__command-select"
                menu-width="280px"
                menu-label="启动指令候选"
                :disabled="actionRunning || launchRunning || !launchCommandOptions.length"
                @update:model-value="selectLaunchCandidateByValue"
              />
              <button
                type="button"
                class="repo-toolbar__btn"
                :aria-label="launchRunning ? '停止' : '运行'"
                :title="launchRunning ? '停止' : '运行'"
                :disabled="!launchRunning && (actionRunning || !launchConfig?.command?.trim())"
                @click="launchRunning ? stopLaunch() : startLaunch()"
              >
                <Square v-if="launchRunning" :size="17" aria-hidden="true" />
                <Play v-else :size="17" aria-hidden="true" />
              </button>
              <RouterLink
                class="repo-toolbar__btn"
                :class="{ 'is-active': activeTab === 'run' }"
                :to="repoRoute(repoId, 'run')"
                title="日志"
                aria-label="日志"
              >
                <ScrollText :size="17" aria-hidden="true" />
              </RouterLink>
            </div>

            <div v-if="!remoteOnly" class="repo-toolbar__group repo-toolbar__actions" role="group" aria-label="仓库操作">
              <RepoToolbarSettingsMenu
                :auto-sync="autoSyncEnabled"
                :disabled="actionRunning"
                @update:auto-sync="setAutoSync"
              />
              <button
                v-if="usingSystemGit"
                type="button"
                class="repo-toolbar__btn"
                title="恢复默认 token 推送"
                aria-label="恢复默认 token 推送"
                :disabled="actionRunning"
                @click="useDefaultTokenAuth"
              >
                <RotateCcw :size="17" aria-hidden="true" />
              </button>
              <div class="repo-toolbar__open-group">
                <button
                  type="button"
                  class="repo-toolbar__btn repo-toolbar__open-main"
                  :title="openTargetLabel"
                  :aria-label="openTargetLabel"
                  :disabled="actionRunning || !summary?.path"
                  @click="openSelectedTarget"
                >
                  <FolderOpen v-if="activeOpenTargetValue === 'folder'" :size="17" aria-hidden="true" />
                  <SquareTerminal v-else-if="activeOpenTargetValue === 'terminal'" :size="17" aria-hidden="true" />
                  <Code2 v-else :size="17" aria-hidden="true" />
                </button>
                <Dropdown
                  :model-value="activeOpenTargetValue"
                  :options="openTargetOptions"
                  placement="bottom"
                  button-class="repo-toolbar__btn repo-toolbar__open-target-toggle"
                  menu-width="132px"
                  menu-label="打开目标"
                  :disabled="actionRunning || !summary?.path"
                  @update:model-value="selectOpenTarget"
                />
              </div>
              <div class="repo-toolbar__pull-group">
                <button
                  type="button"
                  class="repo-toolbar__btn repo-toolbar__pull-main"
                  :class="{ 'repo-toolbar__btn--counted': behindCount }"
                  title="拉取"
                  aria-label="拉取"
                  :disabled="actionRunning || hasConflicts"
                  @click="runSelectedPullStrategy"
                >
                  <CloudDownload :size="17" aria-hidden="true" />
                  <span v-if="behindCount" class="repo-toolbar__badge">{{ behindCount }}</span>
                </button>
                <Dropdown
                  :model-value="activePullStrategyValue"
                  :options="pullStrategyOptions"
                  placement="bottom"
                  button-class="repo-toolbar__btn repo-toolbar__pull-strategy-toggle"
                  menu-width="144px"
                  menu-label="拉取策略"
                  :disabled="actionRunning || hasConflicts"
                  @update:model-value="selectPullStrategy"
                />
              </div>
              <button
                v-if="hasConflicts"
                type="button"
                class="repo-toolbar__btn repo-toolbar__btn--status"
                disabled
                title="冲突解决功能将重新设计"
                aria-label="有冲突"
              >
                <TriangleAlert :size="17" aria-hidden="true" />
              </button>
              <button
                v-else
                type="button"
                class="repo-toolbar__btn"
                :class="{
                  'repo-toolbar__btn--counted': aheadCount,
                  'repo-toolbar__btn--push-ready': aheadCount,
                }"
                title="推送"
                aria-label="推送"
                :disabled="actionRunning || !aheadCount"
                @click="push"
              >
                <CloudUpload :size="17" aria-hidden="true" />
                <span v-if="aheadCount" class="repo-toolbar__badge">{{ aheadCount }}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

    <div v-if="actionError || repoActionError || recentSyncError" class="repo-workbench__status">
      <p v-if="actionError" class="error-line">{{ actionError }}</p>
      <p v-else-if="repoActionError" class="error-line">{{ repoActionError }}</p>
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
        <RepoFilesPanel
          v-if="activeTab === 'files'"
          :repo-id="repoId"
          :repo-path="summary?.path ?? null"
          :changes="changes"
        />
        <RepoStashPanel
          v-else-if="activeTab === 'stash'"
          :repo-id="repoId"
          :remote-only="remoteOnly"
          :has-conflicts="hasConflicts"
        />
        <RepoProjectPanel
          v-else
          :repo-id="repoId"
          :repo-title="repoTitle"
          :repo-full-name="summary?.githubFullName"
          :repo-path="summary?.path"
          :repo-summary="summary"
          :active-git-tab="activeTab"
          :changes="changes"
          :preview-change="previewChange"
          :commit-message="commitMessage"
          :has-conflicts="hasConflicts"
          :can-commit="canCommit"
          :status-commits="statusCommits"
          :selected-commit-hash="selectedCommitHash"
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
          :launch-config="launchConfig"
          :launch-logs="launchLogs"
          :launch-error="launchError"
          :launch-terminal-visible="launchTerminalVisible"
          :action-running="actionRunning"
          :launch-running="launchRunning"
          @hide-terminal="launchTerminalVisible = false"
          :remote-only="remoteOnly"
          :using-system-git="usingSystemGit"
          :project-tab="activeProjectTab"
          :project-issue-number="activeProjectIssue"
          :project-pull-request-number="activeProjectPullRequest"
          :project-run-id="activeProjectRun"
          :project-refresh-token="projectRefreshToken"
          @update-commit-message="commitMessage = $event"
          @stage-unstaged-changes="stageUnstagedChanges"
          @unstage-staged-changes="unstageStagedChanges"
          @change-action="runChangeAction"
          @focus-change="focusChange"
          @commit="commitSelected"
          @open-commit="openCommit"
          @close-commit="closeCommit"
          @cherry-pick-commit="cherryPickCommit"
          @revert-commit="revertCommit"
          @reset-commit="resetCommit"
          @create-branch-from-commit="createBranchFromCommit"
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

.repo-header__tabs-wrap {
  display: grid;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.repo-header__sr-title {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.repo-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
}

.repo-toolbar__group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 40px;
  padding: 4px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.repo-toolbar__views {
  flex: 0 0 auto;
}

.repo-toolbar__launch {
  flex: 0 1 auto;
  max-width: min(100%, 380px);
}

.repo-toolbar__actions {
  flex: 0 0 auto;
  margin-left: auto;
}

.repo-toolbar__open-group,
.repo-toolbar__pull-group {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0;
  height: 32px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.repo-toolbar__btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  text-decoration: none;
}

.repo-toolbar__btn--counted {
  gap: 5px;
  width: auto;
  min-width: 32px;
  padding: 0 7px;
}

.repo-toolbar__branch-select {
  gap: 6px;
  width: auto;
  min-width: 32px;
  max-width: 160px;
  padding: 0 7px;
}

.repo-toolbar__command-select {
  justify-content: flex-start;
  gap: 6px;
  width: auto;
  min-width: 32px;
  max-width: 280px;
  padding: 0 7px;
}

.repo-toolbar__open-main,
.repo-toolbar__pull-main {
  width: 28px;
  min-width: 28px;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.repo-toolbar__pull-main.repo-toolbar__btn--counted {
  width: auto;
  min-width: 32px;
  padding: 0 5px;
}

.repo-toolbar__open-target-toggle.chat-chip,
.repo-toolbar__pull-strategy-toggle.chat-chip {
  width: 22px;
  min-width: 22px;
  max-width: 22px;
  justify-content: center;
  padding: 0;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.repo-toolbar__open-target-toggle .chat-chip__label,
.repo-toolbar__pull-strategy-toggle .chat-chip__label {
  display: none;
}

.repo-toolbar__open-group > .dd,
.repo-toolbar__pull-group > .dd {
  position: static;
}

.repo-toolbar__open-group .dd__menu,
.repo-toolbar__pull-group .dd__menu {
  right: 0;
  left: auto;
  min-width: 144px;
  max-width: min(144px, calc(100vw - 16px));
  translate: 0;
}

.repo-toolbar__open-group .dd__item,
.repo-toolbar__pull-group .dd__item {
  padding: 3px 9px;
}

.repo-toolbar__open-group .dd__item-label,
.repo-toolbar__pull-group .dd__item-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.repo-toolbar .chat-chip.repo-toolbar__btn {
  height: 32px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
}

.repo-toolbar__btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.repo-toolbar__btn.is-active {
  background: var(--accent);
  color: var(--accent-text);
}

.repo-toolbar__btn--push-ready {
  background: var(--accent);
  color: var(--accent-text);
}

.repo-toolbar__btn--push-ready:hover {
  background: var(--accent-strong);
  color: var(--accent-text);
}

.repo-toolbar__btn:disabled,
.repo-toolbar__btn[disabled] {
  cursor: default;
}

.repo-toolbar__btn--status {
  color: var(--warn);
}

.repo-toolbar .chat-chip.repo-toolbar__btn:hover:not(.is-disabled):not(:disabled),
.repo-toolbar .chat-chip.repo-toolbar__btn.is-open {
  background: var(--bg-hover);
  color: var(--text);
}

.repo-toolbar .chat-chip.repo-toolbar__btn.is-disabled {
  color: var(--text-faint);
  cursor: default;
}

.repo-toolbar__open-group:hover,
.repo-toolbar__open-group:focus-within,
.repo-toolbar__open-group:has(.repo-toolbar__open-target-toggle.is-open),
.repo-toolbar__pull-group:hover,
.repo-toolbar__pull-group:focus-within,
.repo-toolbar__pull-group:has(.repo-toolbar__pull-strategy-toggle.is-open) {
  background: var(--bg-hover);
  color: var(--text);
}

.repo-toolbar__open-group:hover .repo-toolbar__btn,
.repo-toolbar__open-group:focus-within .repo-toolbar__btn,
.repo-toolbar__open-group:has(.repo-toolbar__open-target-toggle.is-open) .repo-toolbar__btn,
.repo-toolbar__pull-group:hover .repo-toolbar__btn,
.repo-toolbar__pull-group:focus-within .repo-toolbar__btn,
.repo-toolbar__pull-group:has(.repo-toolbar__pull-strategy-toggle.is-open) .repo-toolbar__btn {
  color: inherit;
}

.repo-toolbar__open-group .repo-toolbar__btn:hover,
.repo-toolbar .repo-toolbar__open-group .chat-chip.repo-toolbar__btn:hover:not(.is-disabled):not(:disabled),
.repo-toolbar .repo-toolbar__open-group .chat-chip.repo-toolbar__btn.is-open,
.repo-toolbar__pull-group .repo-toolbar__btn:hover,
.repo-toolbar .repo-toolbar__pull-group .chat-chip.repo-toolbar__btn:hover:not(.is-disabled):not(:disabled),
.repo-toolbar .repo-toolbar__pull-group .chat-chip.repo-toolbar__btn.is-open {
  background: transparent;
}

.repo-toolbar .chat-chip.repo-toolbar__btn .chat-chip__label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.repo-toolbar__branch-select .chat-chip__label {
  max-width: 96px;
}

.repo-toolbar__command-select .chat-chip__label {
  max-width: 180px;
}

.repo-toolbar__launch .repo-toolbar__command-select {
  flex: 1 1 auto;
}

.repo-toolbar__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.repo-toolbar__badge--warn {
  background: color-mix(in srgb, var(--warn) 14%, transparent);
  color: var(--warn);
}

.repo-toolbar__btn.is-active .repo-toolbar__badge,
.repo-toolbar__btn--push-ready .repo-toolbar__badge:not(.repo-toolbar__badge--warn) {
  background: color-mix(in srgb, var(--accent-text) 18%, transparent);
  color: var(--accent-text);
}

.toolbar,
.section-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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

  .repo-toolbar {
    flex-wrap: wrap;
    width: 100%;
  }

  .repo-toolbar__group {
    height: auto;
    min-height: 40px;
  }

  .repo-toolbar__launch {
    max-width: 100%;
  }

  .repo-toolbar__actions {
    margin-left: 0;
  }

  .repo-toolbar__command-select {
    max-width: 100%;
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

}
</style>
