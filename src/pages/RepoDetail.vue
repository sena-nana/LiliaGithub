<script setup lang="ts">
import { computed, ref, watch } from "vue";
import RepoDetailToolbar from "../components/repo/RepoDetailToolbar.vue";
import { useRepoDetailController } from "../composables/useRepoDetailController";
import { createCachedAsyncComponent } from "../utils/asyncComponent";

const repoProjectPanelModule = createCachedAsyncComponent(() => import("../components/repo/RepoProjectPanel.vue"));
const repoStashPanelModule = createCachedAsyncComponent(() => import("../components/repo/RepoStashPanel.vue"));
const repoConflictDialogModule = createCachedAsyncComponent(() => import("../components/repo/RepoConflictDialog.vue"));
const repoRemoteSyncDialogModule = createCachedAsyncComponent(() => import("../components/repo/RepoRemoteSyncDialog.vue"));
const repoSyncResultDialogModule = createCachedAsyncComponent(() => import("../components/repo/RepoSyncResultDialog.vue"));
const RepoProjectPanel = repoProjectPanelModule.component;
const RepoStashPanel = repoStashPanelModule.component;
const RepoConflictDialog = repoConflictDialogModule.component;
const RepoRemoteSyncDialog = repoRemoteSyncDialogModule.component;
const RepoSyncResultDialog = repoSyncResultDialogModule.component;
type RefreshablePageHandle = { refreshCurrentPage: () => Promise<void> };

const {
  activeTab,
  commitMessage,
  actionError,
  repoDetailLoading,
  repoDetailError,
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
  selectOpenTarget,
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
  openSelectedTarget,
  commitMetaTitle,
} = useRepoDetailController();

const repoProjectPanel = ref<RefreshablePageHandle | null>(null);
const repoStashPanel = ref<RefreshablePageHandle | null>(null);
const refreshingCurrentPage = ref(false);
let currentPageRefreshGeneration = 0;

watch(() => [repoId.value, activeTab.value, activeProjectTab.value] as const, () => {
  currentPageRefreshGeneration += 1;
  refreshingCurrentPage.value = false;
});

const currentPageRefreshAvailable = computed(() => {
  if (!repoId.value) return false;
  const capabilities = repoContext.value.capabilities;
  if (activeTab.value === "stash") return capabilities.stash.available && Boolean(repoStashPanel.value);
  if (!repoProjectPanel.value) return false;
  if (activeTab.value === "files") return capabilities.files.available;
  if (activeTab.value === "changes") return capabilities.changes.available;
  if (activeTab.value === "history") return capabilities.history.available;
  if (activeTab.value === "run") return capabilities.launch.available;
  if (activeProjectTab.value === "issues") return capabilities.issues.available;
  if (activeProjectTab.value === "pulls") return capabilities.pulls.available;
  if (activeProjectTab.value === "discussions") return capabilities.discussions.available;
  if (activeProjectTab.value === "actions") return capabilities.actions.available;
  if (activeProjectTab.value === "release") return capabilities.issues.available;
  if (activeProjectTab.value === "settings") {
    return capabilities.settings.available || capabilities.deleteLocal.available;
  }
  return Boolean(summary.value);
});

async function refreshCurrentPage() {
  if (refreshingCurrentPage.value || !currentPageRefreshAvailable.value) return;
  const generation = ++currentPageRefreshGeneration;
  const tab = activeTab.value;
  const projectTab = activeProjectTab.value;
  refreshingCurrentPage.value = true;
  try {
    if (tab === "stash") {
      await repoStashPanel.value?.refreshCurrentPage();
      return;
    }
    if (tab === "run") {
      await refreshLaunchPage();
      return;
    }
    if (tab === "changes") {
      await refreshGitInfo();
      return;
    }
    if (tab === "history") {
      await refreshGitInfo();
      await repoProjectPanel.value?.refreshCurrentPage();
      return;
    }
    if (tab === "files" || projectTab === "readme") await refreshGitInfo();
    await repoProjectPanel.value?.refreshCurrentPage();
  } finally {
    if (generation === currentPageRefreshGeneration) refreshingCurrentPage.value = false;
  }
}
</script>
<template>
  <section class="repo-workbench">
    <div class="repo-workbench__top">
      <RepoDetailToolbar
        :active-tab="activeTab"
        :repo-id="repoId"
        :repo-title="repoTitle"
        :repo-context="repoContext"
        :changes-count="changes.length"
        :toolbar-tabs="toolbarTabs"
        :branch-items="branchItems"
        :branch-action-running="branchActionRunning"
        :active-branch-name="activeBranchName"
        :action-running="actionRunning"
        :push-running="pushRunning"
        :launch-running="launchRunning"
        :launch-command-options="launchCommandOptions"
        :active-launch-value="activeLaunchValue"
        :repo-setting-values="repoSettingValues"
        :active-open-target-value="activeOpenTargetValue"
        :active-pull-strategy-value="activePullStrategyValue"
        :open-target-options="openTargetOptions"
        :pull-strategy-options="pullStrategyOptions"
        :open-target-label="openTargetLabel"
        :summary-path="summary?.path"
        :has-conflicts="hasConflicts"
        :has-conflict-files="conflicts.files.length > 0"
        :needs-publish="needsPublish"
        :ahead-count="aheadCount"
        :behind-count="behindCount"
        :remotes-needing-pull="remotesNeedingPull"
        :remotes-needing-push="remotesNeedingPush"
        :pull-remote-count="pullRemoteCount"
        :push-remote-names="pushRemoteNames"
        :remote-sync-unavailable-reason="remoteSyncUnavailableReason"
        :launch-command="launchConfig?.command"
        :refreshing-current-page="refreshingCurrentPage"
        :current-page-refresh-available="currentPageRefreshAvailable"
        @refresh-current-page="refreshCurrentPage"
        @checkout="checkout"
        @update-current-branch="updateCurrentBranch"
        @create-branch="createBranchFromRef($event.name, $event.fromRef, $event.checkoutAfter)"
        @rename-branch="renameBranchTo($event.oldName, $event.newName)"
        @merge-branch="mergeBranch"
        @delete-branch="deleteBranch"
        @refresh-branches="refreshGitInfo"
        @request-branches="requestGitHubBranches"
        @push-with-upstream="pushCurrentBranchWithUpstream"
        @set-upstream="setCurrentBranchUpstream"
        @select-launch-candidate="selectLaunchCandidateByValue"
        @run-launch-command="runLaunchCommand"
        @stop-launch="stopLaunch"
        @update-setting="setRepoSetting"
        @use-default-token-auth="useDefaultTokenAuth"
        @open-selected-target="openSelectedTarget"
        @select-open-target="selectOpenTarget"
        @run-selected-pull-strategy="runSelectedPullStrategy"
        @select-pull-strategy="selectPullStrategy"
        @push="push"
        @open-remote-sync-settings="openRemoteSyncSettings"
        @open-conflicts="openConflictDialog"
      />
    </div>

    <div class="repo-workbench__body">
      <main class="workbench-main workbench-main--project">
        <RepoStashPanel
          v-if="activeTab === 'stash'"
          ref="repoStashPanel"
          :repo-id="repoId"
          :repo-context="repoContext"
          :has-conflicts="hasConflicts"
        />
        <RepoProjectPanel
          v-else
          ref="repoProjectPanel"
          :repo-id="repoId"
          :repo-title="repoTitle"
          :repo-full-name="summary?.githubFullName"
          :repo-path="summary?.path"
          :repo-summary="summary"
          :active-git-tab="activeTab"
          :changes="changes"
          :discarding-change-paths="discardingChangePaths"
          :preview-change="previewChange"
          :commit-message="commitMessage"
          :has-conflicts="hasConflicts"
          :can-commit="canCommit"
          :needs-publish="needsPublish"
          :status-commits="statusCommits"
          :selected-commit-hash="selectedCommitHash"
          :repo-detail-loading="repoDetailLoading"
          :repo-detail-error="repoDetailError"
          :can-load-files="canLoadFiles"
          :file-repo-ref="activeFileRepoRef"
          :files-unavailable-message="filesUnavailableMessage"
          :file-target-path="activeFilePath"
          :file-target-hash="activeFileHash"
          :commit-meta-title="commitMetaTitle"
          :launch-config="launchConfig"
          :launch-logs="launchLogs"
          :launch-error="launchError"
          :action-error="actionError"
          :repo-sync-issue="repoSyncIssue"
          :launch-terminal-visible="launchTerminalVisible"
          :action-running="actionRunning"
          :launch-running="launchRunning"
          @retry-sync="push"
          @hide-terminal="launchTerminalVisible = false"
          :repo-context="repoContext"
          :project-tab="activeProjectTab"
          :project-issue-number="activeProjectIssue"
          :project-pull-request-number="activeProjectPullRequest"
          :project-discussion-number="activeProjectDiscussion"
          :project-run-id="activeProjectRun"
          :project-job-id="activeProjectJob"
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
        />
      </main>
    </div>

    <RepoRemoteSyncDialog
      v-if="remoteSyncDialogOpen"
      :open="remoteSyncDialogOpen"
      :config="remoteSyncConfig"
      :loading="remoteSyncConfigLoading"
      :saving="remoteSyncConfigSaving"
      :error="remoteSyncConfigError"
      @close="closeRemoteSyncSettings"
      @retry="loadRemoteSyncConfig()"
      @save="saveRemoteSyncPolicy"
    />
    <RepoSyncResultDialog
      v-if="syncOperationResult"
      :result="syncOperationResult"
      :retrying="pushRunning"
      @close="closeSyncResultDialog"
      @retry-push="retryFailedRemotePush"
      @resolve-conflicts="openConflictDialogFromSyncResult"
    />
    <RepoConflictDialog
      v-if="conflictDialogOpen"
      :open="conflictDialogOpen"
      :conflicts="conflicts"
      :action-running="actionRunning"
      :error="actionError"
      @close="closeConflictDialog"
      @resolve-file="resolveConflictFile"
      @accept-file="acceptConflictFile"
      @mark-resolved="markConflictResolved"
      @continue="continueConflictOperation"
      @abort="abortConflictOperation"
    />
  </section>
</template>

<style>
.repo-workbench {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.repo-workbench__top {
  display: grid;
  gap: 14px;
  min-height: 0;
  padding: 20px 24px 0;
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

.repo-toolbar__launch:has(.repo-toolbar__command-picker:focus-within, .repo-toolbar__command-picker.is-open) {
  background: var(--bg-hover);
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

.repo-toolbar__sync-label {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}

.repo-toolbar__btn:has(.repo-toolbar__sync-label) {
  gap: 5px;
  width: auto;
  min-width: 32px;
  padding: 0 7px;
}

.repo-toolbar__pull-main:has(.repo-toolbar__sync-label) {
  border-radius: var(--radius-sm);
}

.repo-toolbar__branch-select {
  gap: 6px;
  width: auto;
  min-width: 32px;
  max-width: 160px;
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

.repo-toolbar__open-target-toggle.dd__button,
.repo-toolbar__pull-strategy-toggle.dd__button {
  width: 22px;
  min-width: 22px;
  max-width: 22px;
  justify-content: center;
  padding: 0;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.repo-toolbar .dd__button.repo-toolbar__btn {
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

.repo-toolbar__btn--status:hover:not(:disabled) {
  background: var(--warn-soft);
  color: var(--warn);
}

.repo-toolbar .dd__button.repo-toolbar__btn:hover:not(.is-disabled):not(:disabled),
.repo-toolbar .dd__button.repo-toolbar__btn.is-open {
  background: var(--bg-hover);
  color: var(--text);
}

.repo-toolbar .dd__button.repo-toolbar__btn.is-disabled {
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
.repo-toolbar .repo-toolbar__open-group .dd__button.repo-toolbar__btn:hover:not(.is-disabled):not(:disabled),
.repo-toolbar .repo-toolbar__open-group .dd__button.repo-toolbar__btn.is-open,
.repo-toolbar__pull-group .repo-toolbar__btn:hover,
.repo-toolbar .repo-toolbar__pull-group .dd__button.repo-toolbar__btn:hover:not(.is-disabled):not(:disabled),
.repo-toolbar .repo-toolbar__pull-group .dd__button.repo-toolbar__btn.is-open {
  background: transparent;
}

.repo-toolbar .dd__button.repo-toolbar__btn .dd__button-label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.repo-toolbar__command-picker {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 7px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.repo-toolbar__command-picker:hover,
.repo-toolbar__command-picker:focus-within,
.repo-toolbar__command-picker.is-open {
  background: var(--bg-hover);
  color: var(--text);
}

.repo-toolbar__command-picker.is-disabled {
  color: var(--text-faint);
}

.repo-toolbar__command-input {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.repo-toolbar__command-input::placeholder {
  color: var(--text-faint);
}

.repo-toolbar__command-input:disabled {
  cursor: default;
}

.repo-toolbar__command-menu {
  position: absolute;
  z-index: var(--z-dropdown, 1900);
  top: calc(100% + 6px);
  left: 0;
  width: min(280px, calc(100vw - 24px));
  max-height: 280px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  box-shadow: var(--shadow-lg);
}

.repo-toolbar__command-option {
  display: grid;
  width: 100%;
  gap: 2px;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
}

.repo-toolbar__command-option:hover,
.repo-toolbar__command-option.is-active {
  background: var(--bg-hover);
}

.repo-toolbar__command-option-label,
.repo-toolbar__command-option-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-toolbar__command-option-label {
  font-size: 12px;
  font-weight: 600;
}

.repo-toolbar__command-option-hint,
.repo-toolbar__command-empty {
  color: var(--text-muted);
  font-size: 11px;
}

.repo-toolbar__command-empty {
  margin: 0;
  padding: 8px;
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

.repo-workbench__empty {
  display: grid;
  place-items: center;
  min-height: 100%;
  padding: 24px;
  text-align: center;
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

  .repo-toolbar__command-picker {
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
