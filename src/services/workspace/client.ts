import { invoke } from "@tauri-apps/api/core";
import * as fallback from "./fallback";
import type {
  BulkOperation,
  BulkSyncPreview,
  BulkSyncResult,
  CommitDetail,
  GitHubBindingStatus,
  GitHubDeviceFlowPollResult,
  GitHubDeviceFlowStart,
  HiddenRepo,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RepoConflictChoice,
  RepoConflictState,
  RepoDetail,
  RepoMergePullResult,
  RepoSummary,
  WorkspaceSettings,
} from "./types";

const isTest = typeof import.meta !== "undefined" && import.meta.env?.MODE === "test";

function canInvoke() {
  return !isTest && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(command: string, args: Record<string, unknown> | undefined, fallbackCall: () => Promise<T>): Promise<T> {
  if (canInvoke()) {
    return invoke<T>(command, args);
  }
  return fallbackCall();
}

export function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return call("workspace_get_settings", undefined, fallback.getWorkspaceSettings);
}

export function setWorkspaceRoot(workspaceRoot: string): Promise<WorkspaceSettings> {
  return call("workspace_set_root", { workspaceRoot }, () => fallback.setWorkspaceRoot(workspaceRoot));
}

export function pickWorkspaceRoot(): Promise<string | null> {
  return call("workspace_pick_root", undefined, fallback.pickWorkspaceRoot);
}

export function scanRepos(): Promise<RepoSummary[]> {
  return call("workspace_scan_repos", undefined, fallback.scanRepos);
}

export function cloneRepo(remoteUrl: string, directoryName?: string | null): Promise<RepoSummary> {
  return call("workspace_clone_repo", { remoteUrl, directoryName: directoryName ?? null }, () =>
    fallback.cloneRepo(remoteUrl, directoryName),
  );
}

export function getRepoSummary(repoId: string): Promise<RepoSummary> {
  return call("repo_get_summary", { repoId }, () => fallback.getRepoSummary(repoId));
}

export function hideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_hide_repo", { repoId }, () => fallback.hideRepo(repoId));
}

export function unhideRepo(repoId: string): Promise<WorkspaceSettings> {
  return call("workspace_unhide_repo", { repoId }, () => fallback.unhideRepo(repoId));
}

export function listHiddenRepos(): Promise<HiddenRepo[]> {
  return call("workspace_list_hidden_repos", undefined, fallback.listHiddenRepos);
}

export function getGitHubBindingStatus(): Promise<GitHubBindingStatus> {
  return call("github_get_binding_status", undefined, fallback.getGitHubBindingStatus);
}

export function startGitHubDeviceFlow(): Promise<GitHubDeviceFlowStart> {
  return call("github_start_device_flow", undefined, fallback.startGitHubDeviceFlow);
}

export function pollGitHubDeviceFlow(
  deviceCode: string,
  intervalSeconds?: number | null,
): Promise<GitHubDeviceFlowPollResult> {
  return call("github_poll_device_flow", { deviceCode, intervalSeconds: intervalSeconds ?? null }, () =>
    fallback.pollGitHubDeviceFlow(deviceCode, intervalSeconds),
  );
}

export function getRepoDetail(repoId: string): Promise<RepoDetail> {
  return call("repo_get_detail", { repoId }, () => fallback.getRepoDetail(repoId));
}

export function getRepoCommitDetail(repoId: string, hash: string): Promise<CommitDetail> {
  return call("repo_get_commit_detail", { repoId, hash }, () => fallback.getRepoCommitDetail(repoId, hash));
}

export function getRepoLaunchConfig(repoId: string): Promise<ProjectLaunchConfig | null> {
  return call("repo_get_launch_config", { repoId }, () => fallback.getRepoLaunchConfig(repoId));
}

export function saveRepoLaunchConfig(
  repoId: string,
  command: string,
  cwd?: string | null,
): Promise<ProjectLaunchConfig> {
  return call("repo_save_launch_config", { repoId, command, cwd: cwd ?? null }, () =>
    fallback.saveRepoLaunchConfig(repoId, command, cwd),
  );
}

export function getRepoLaunchStatus(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_get_launch_status", { repoId }, () => fallback.getRepoLaunchStatus(repoId));
}

export function getRepoLaunchLogs(repoId: string, since?: number | null): Promise<ProjectLaunchLog[]> {
  return call("repo_get_launch_logs", { repoId, since: since ?? null }, () => fallback.getRepoLaunchLogs(repoId, since));
}

export function startRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_start_launch", { repoId }, () => fallback.startRepoLaunch(repoId));
}

export function stopRepoLaunch(repoId: string): Promise<ProjectLaunchStatus> {
  return call("repo_stop_launch", { repoId }, () => fallback.stopRepoLaunch(repoId));
}

export function stageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_stage_files", { repoId, files }, () => fallback.stageFiles(repoId, files));
}

export function unstageFiles(repoId: string, files: string[]): Promise<void> {
  return call("repo_unstage_files", { repoId, files }, () => fallback.unstageFiles(repoId, files));
}

export function commitRepo(
  repoId: string,
  files: string[],
  message: string,
  pushAfter: boolean,
): Promise<RepoSummary> {
  return call("repo_commit", { repoId, files, message, pushAfter }, () =>
    fallback.commitRepo(repoId, files, message, pushAfter),
  );
}

export function pullRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_pull", { repoId }, () => fallback.pullRepo(repoId));
}

export function mergePullRepo(repoId: string): Promise<RepoMergePullResult> {
  return call("repo_merge_pull", { repoId }, () => fallback.mergePullRepo(repoId));
}

export function pushRepo(repoId: string): Promise<RepoSummary> {
  return call("repo_push", { repoId }, () => fallback.pushRepo(repoId));
}

export function checkoutBranch(repoId: string, branch: string): Promise<RepoSummary> {
  return call("repo_checkout_branch", { repoId, branch }, () => fallback.checkoutBranch(repoId, branch));
}

export function getRepoConflicts(repoId: string): Promise<RepoConflictState> {
  return call("repo_get_conflicts", { repoId }, () => fallback.getRepoConflicts(repoId));
}

export function acceptConflictFile(
  repoId: string,
  path: string,
  side: "ours" | "theirs",
  stage = true,
): Promise<RepoSummary> {
  return call("repo_accept_conflict_file", { repoId, path, side, stage }, () =>
    fallback.acceptConflictFile(repoId, path, side, stage),
  );
}

export function resolveConflictFile(
  repoId: string,
  path: string,
  choices: RepoConflictChoice[],
  stage = true,
): Promise<RepoSummary> {
  return call("repo_resolve_conflict_file", { repoId, path, choices, stage }, () =>
    fallback.resolveConflictFile(repoId, path, choices, stage),
  );
}

export function markFileResolved(repoId: string, path: string): Promise<RepoSummary> {
  return call("repo_mark_file_resolved", { repoId, path }, () => fallback.markFileResolved(repoId, path));
}

export function abortConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_abort_conflict_operation", { repoId }, () => fallback.abortConflictOperation(repoId));
}

export function continueConflictOperation(repoId: string): Promise<RepoSummary> {
  return call("repo_continue_conflict_operation", { repoId }, () => fallback.continueConflictOperation(repoId));
}

export function bulkSyncPreview(operation: BulkOperation, repos: RepoSummary[]): Promise<BulkSyncPreview> {
  return call("bulk_sync_preview", { operation, repos }, () => fallback.bulkSyncPreview(operation, repos));
}

export function bulkSyncExecute(operation: BulkOperation, repoIds: string[]): Promise<BulkSyncResult[]> {
  return call("bulk_sync_execute", { operation, repoIds }, () => fallback.bulkSyncExecute(operation, repoIds));
}

export function openPath(path: string): Promise<void> {
  return call("system_open_path", { path }, () => fallback.openPath(path));
}

export function openUrl(url: string): Promise<void> {
  return call("system_open_url", { url }, () => fallback.openUrl(url));
}
