import { readonly } from "vue";
import {
  deviceFlow,
  githubBinding,
  isAuthorized,
  isReady,
  overviewStats,
  repoById,
  state,
  workspaceRoot,
} from "./workspace/state";
import {
  initialize,
  chooseWorkspaceRoot,
} from "./workspace/lifecycle";
import {
  startAuthFlow,
  pollAuthFlow,
} from "./workspace/auth";
import {
  abortConflictOperation,
  acceptConflictFile,
  checkout,
  commit,
  hideRepo,
  listHiddenRepos,
  loadRepoDetail,
  markConflictFileResolved,
  mergePull,
  pull,
  push,
  refreshRepos,
  resolveConflictFile,
  stage,
  unstage,
  unhideRepo,
} from "./workspace/repositories";
import {
  loadLaunch,
  refreshLaunchLogs,
  refreshLaunchStatus,
  saveLaunchConfig,
  startLaunch,
  stopLaunch,
} from "./workspace/launch";
import {
  closeBulkPreview,
  executeBulk,
  previewBulk,
  pushAll,
} from "./workspace/bulk";
import {
  openPath,
  openUrl,
} from "./workspace/system";

export function useWorkspace() {
  return {
    state: readonly(state),
    deviceFlow: readonly(deviceFlow),
    workspaceRoot,
    githubBinding,
    isAuthorized,
    isReady,
    overviewStats,
    initialize,
    chooseWorkspaceRoot,
    refreshRepos,
    hideRepo,
    unhideRepo,
    listHiddenRepos,
    startAuthFlow,
    pollAuthFlow,
    loadRepoDetail,
    loadLaunch,
    saveLaunchConfig,
    refreshLaunchStatus,
    refreshLaunchLogs,
    startLaunch,
    stopLaunch,
    stage,
    unstage,
    commit,
    pull,
    mergePull,
    push,
    checkout,
    acceptConflictFile,
    resolveConflictFile,
    markConflictFileResolved,
    abortConflictOperation,
    previewBulk,
    executeBulk,
    pushAll,
    closeBulkPreview,
    repoById,
    openPath,
    openUrl,
  };
}
