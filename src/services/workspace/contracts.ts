import type {
  BranchSummary,
  BulkOperation,
  BulkSyncPreview,
  BulkSyncResult,
  CommitDetail,
  CommitSummary,
  ContributionIdentity,
  ContributionIdentityRecommendationResult,
  GitHubBindingStatus,
  GitHubActionNotification,
  GitHubAttachWorkflowArtifactAssetRequest,
  GitHubAccountIssueItem,
  GitHubContributionResult,
  GitHubCreateIssueRequest,
  GitHubCreatePullRequestRequest,
  GitHubCreateReleaseRequest,
  GitHubCreateRepoRequest,
  GitHubDeviceFlowPollResult,
  GitHubDeviceFlowStart,
  GitHubIssue,
  GitHubIssueDiscussion,
  GitHubIssueFilterMetadata,
  GitHubMergePullRequestRequest,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDiscussion,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubRepoManagement,
  GitHubRepoActionsPermissionsRequest,
  GitHubRepoOwner,
  GitHubRepoPage,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
  GitHubRepoSummary,
  GitHubUpdateIssueRequest,
  GitHubUpdatePullRequestRequest,
  GitHubUpdateReleaseRequest,
  GitHubUpdateRepoSettingsRequest,
  GitHubRepoWorkflowPermissionsRequest,
  GitHubWorkflowArtifactEntry,
  GitHubWorkflowJobLog,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  HiddenRepo,
  ProjectLaunchCandidate,
  ProjectLaunchConfig,
  ProjectLaunchHistoryEntry,
  ProjectLaunchLog,
  ProjectLaunchStatus,
  RemoteRepoShortcut,
  RepoChange,
  RepoConflictChoice,
  RepoConflictState,
  RepoDetail,
  RepoDetailPatch,
  RepoDetailPatchRequest,
  RepoFilePreview,
  RepoFileTreeEntry,
  RepoMergePullResult,
  RepoOperationResult,
  RepoPullLocalChangesMode,
  RepoRefreshSummaryOptions,
  RepoRemote,
  RepoResetMode,
  RepoStashDetail,
  RepoStashEntry,
  RepoSummary,
  RepoSyncPreference,
  SystemOpenTarget,
  WorkspaceSettings,
  WorkspaceRepoRefreshRequest,
  WorkspaceStartupCache,
  WorkspaceStartupContributions,
  WorkspaceTask,
  WorkspaceCreateLocalRepoRequest,
} from "./types";

type NoArgs = undefined;
type Maybe<T> = T | null;
type ForceRefreshArg = { forceRefresh: Maybe<boolean> };
type RepoArg = { repoId: string };
type RepoFullNameArg = { repoFullName: string };
type RepoFileArg = RepoArg & { path: string };
type CommitHashArg = { hash: string };

type CommandContract<TArgs, TResult> = {
  args: TArgs;
  result: TResult;
};

export interface WorkspaceCommandContracts {
  workspace_get_settings: CommandContract<NoArgs, WorkspaceSettings>;
  workspace_read_startup_cache: CommandContract<NoArgs, Maybe<WorkspaceStartupCache>>;
  workspace_clear_startup_cache: CommandContract<NoArgs, void>;
  workspace_write_startup_contributions: CommandContract<
    { contributions: WorkspaceStartupContributions },
    WorkspaceStartupCache
  >;
  workspace_set_root: CommandContract<{ workspaceRoot: string }, WorkspaceSettings>;
  workspace_set_contribution_identities: CommandContract<
    { identities: ContributionIdentity[] },
    WorkspaceSettings
  >;
  workspace_scan_contribution_identities: CommandContract<NoArgs, ContributionIdentityRecommendationResult>;
  repo_set_preference: CommandContract<{ repoId: string; key: keyof RepoSyncPreference; value: boolean }, WorkspaceSettings>;
  repo_set_auto_sync: CommandContract<{ repoId: string; autoSync: boolean }, WorkspaceSettings>;
  workspace_pick_root: CommandContract<NoArgs, Maybe<string>>;
  workspace_pick_repo: CommandContract<NoArgs, Maybe<string>>;
  workspace_pick_files: CommandContract<NoArgs, string[]>;
  workspace_refresh_repos: CommandContract<NoArgs, RepoSummary[]>;
  workspace_list_managed_repos: CommandContract<NoArgs, RepoSummary[]>;
  workspace_scan_repos: CommandContract<NoArgs, RepoSummary[]>;
  workspace_discover_repos: CommandContract<NoArgs, RepoSummary[]>;
  workspace_add_repo: CommandContract<{ repoPath: string }, RepoSummary>;
  workspace_create_local_repo: CommandContract<{ request: WorkspaceCreateLocalRepoRequest }, RepoSummary>;
  workspace_clone_repo: CommandContract<{ remoteUrl: string; directoryName: Maybe<string> }, RepoSummary>;
  workspace_hide_repo: CommandContract<RepoArg, WorkspaceSettings>;
  workspace_create_repo_group: CommandContract<{ name: string }, WorkspaceSettings>;
  workspace_rename_repo_group: CommandContract<{ groupId: string; name: string }, WorkspaceSettings>;
  workspace_delete_repo_group: CommandContract<{ groupId: string }, WorkspaceSettings>;
  workspace_move_repo_to_group: CommandContract<{ repoId: string; groupId: Maybe<string> }, WorkspaceSettings>;
  workspace_delete_local_repo: CommandContract<RepoArg, WorkspaceSettings>;
  workspace_remember_remote_repo: CommandContract<{ repo: RemoteRepoShortcut }, WorkspaceSettings>;
  workspace_forget_remote_repo: CommandContract<{ fullName: string }, WorkspaceSettings>;
  workspace_unhide_repo: CommandContract<RepoArg, WorkspaceSettings>;
  workspace_list_hidden_repos: CommandContract<NoArgs, HiddenRepo[]>;
  workspace_list_tasks: CommandContract<NoArgs, WorkspaceTask[]>;
  workspace_cancel_task: CommandContract<{ taskId: string }, void>;
  workspace_set_active_repo: CommandContract<{ repoId: Maybe<string> }, void>;
  workspace_set_refresh_paused: CommandContract<{ paused: boolean }, void>;
  workspace_enqueue_repo_refresh: CommandContract<{ request: WorkspaceRepoRefreshRequest }, string>;

  github_get_binding_status: CommandContract<NoArgs, GitHubBindingStatus>;
  github_start_device_flow: CommandContract<NoArgs, GitHubDeviceFlowStart>;
  github_poll_device_flow: CommandContract<
    { deviceCode: string; intervalSeconds: Maybe<number> },
    GitHubDeviceFlowPollResult
  >;
  github_unbind: CommandContract<NoArgs, void>;
  github_list_repos: CommandContract<{ page: Maybe<number> }, GitHubRepoPage>;
  github_list_account_issues: CommandContract<{
    state: Maybe<string>;
    perPage: Maybe<number>;
    sort: Maybe<string>;
    direction: Maybe<string>;
    forceRefresh: Maybe<boolean>;
  }, GitHubAccountIssueItem[]>;
  github_list_action_notifications: CommandContract<{
    perPage: Maybe<number>;
    forceRefresh: Maybe<boolean>;
  }, GitHubActionNotification[]>;
  github_list_repo_contribution: CommandContract<{ repoFullName: string }, GitHubContributionResult>;
  github_list_repo_owners: CommandContract<NoArgs, GitHubRepoOwner[]>;
  github_create_repo: CommandContract<{ request: GitHubCreateRepoRequest }, GitHubRepoSummary>;
  github_get_repo_management: CommandContract<RepoFullNameArg & ForceRefreshArg, GitHubRepoManagement>;
  github_update_repo_settings: CommandContract<
    RepoFullNameArg & { request: GitHubUpdateRepoSettingsRequest },
    GitHubRepoManagement
  >;
  github_get_repo_settings_section: CommandContract<
    RepoFullNameArg & { section: GitHubRepoSettingsSectionKey; forceRefresh: Maybe<boolean> },
    GitHubRepoSettingsSection
  >;
  github_update_repo_actions_permissions: CommandContract<
    RepoFullNameArg & { request: GitHubRepoActionsPermissionsRequest },
    void
  >;
  github_update_repo_workflow_permissions: CommandContract<
    RepoFullNameArg & { request: GitHubRepoWorkflowPermissionsRequest },
    void
  >;
  github_delete_repo: CommandContract<RepoFullNameArg, void>;
  github_list_branches: CommandContract<RepoFullNameArg, BranchSummary[]>;
  github_delete_branch: CommandContract<RepoFullNameArg & { branchName: string }, void>;
  github_list_pull_requests: CommandContract<
    RepoFullNameArg & {
      state: Maybe<string>;
      perPage: Maybe<number>;
      sort: Maybe<string>;
      direction: Maybe<string>;
      creator: Maybe<string>;
      assignee: Maybe<string>;
      labels: Maybe<string[]>;
      milestone: Maybe<string | number>;
      project: Maybe<string>;
      review: Maybe<string>;
      query: Maybe<string>;
      forceRefresh: Maybe<boolean>;
    },
    GitHubPullRequest[]
  >;
  github_get_pull_request: CommandContract<RepoFullNameArg & { pullNumber: number }, GitHubPullRequest>;
  github_get_pull_request_discussion: CommandContract<
    RepoFullNameArg & { pullNumber: number; forceRefresh: Maybe<boolean> },
    GitHubPullRequestDiscussion
  >;
  github_create_pull_request: CommandContract<
    RepoFullNameArg & { request: GitHubCreatePullRequestRequest },
    GitHubPullRequest
  >;
  github_update_pull_request: CommandContract<
    RepoFullNameArg & { pullNumber: number; request: GitHubUpdatePullRequestRequest },
    GitHubPullRequest
  >;
  github_merge_pull_request: CommandContract<
    RepoFullNameArg & { pullNumber: number; request: GitHubMergePullRequestRequest },
    GitHubPullRequest
  >;
  github_list_pull_request_checks: CommandContract<
    RepoFullNameArg & { pullNumber: number; forceRefresh: Maybe<boolean> },
    GitHubPullRequestCheck[]
  >;
  github_list_repo_files: CommandContract<
    RepoFullNameArg & { parentPath: Maybe<string>; refName: Maybe<string>; forceRefresh: Maybe<boolean> },
    RepoFileTreeEntry[]
  >;
  github_get_repo_file_preview: CommandContract<
    RepoFullNameArg & { path: string; refName: Maybe<string>; forceRefresh: Maybe<boolean> },
    RepoFilePreview
  >;
  github_list_issues: CommandContract<
    RepoFullNameArg & {
      state: Maybe<string>;
      perPage: Maybe<number>;
      sort: Maybe<string>;
      direction: Maybe<string>;
      since: Maybe<string>;
      creator: Maybe<string>;
      assignee: Maybe<string>;
      labels: Maybe<string[]>;
      milestone: Maybe<string | number>;
      project: Maybe<string>;
      query: Maybe<string>;
      forceRefresh: Maybe<boolean>;
    },
    GitHubIssue[]
  >;
  github_get_issue_discussion: CommandContract<
    RepoFullNameArg & { issueNumber: number; forceRefresh: Maybe<boolean> },
    GitHubIssueDiscussion
  >;
  github_get_issue_filter_metadata: CommandContract<RepoFullNameArg & ForceRefreshArg, GitHubIssueFilterMetadata>;
  github_list_issue_labels: CommandContract<RepoFullNameArg & ForceRefreshArg, string[]>;
  github_list_issue_assignees: CommandContract<RepoFullNameArg & ForceRefreshArg, string[]>;
  github_create_issue: CommandContract<RepoFullNameArg & { request: GitHubCreateIssueRequest }, GitHubIssue>;
  github_update_issue: CommandContract<
    RepoFullNameArg & { issueNumber: number; request: GitHubUpdateIssueRequest },
    GitHubIssue
  >;
  github_list_workflow_runs: CommandContract<
    RepoFullNameArg & { perPage: Maybe<number>; forceRefresh: Maybe<boolean> },
    GitHubWorkflowRun[]
  >;
  github_get_workflow_run_detail: CommandContract<
    RepoFullNameArg & { runId: number; forceRefresh: Maybe<boolean> },
    GitHubWorkflowRunDetail
  >;
  github_get_workflow_job_log: CommandContract<
    RepoFullNameArg & { jobId: number; forceRefresh: Maybe<boolean> },
    GitHubWorkflowJobLog
  >;
  github_list_workflow_artifact_files: CommandContract<
    RepoFullNameArg & { artifactId: number },
    GitHubWorkflowArtifactEntry[]
  >;
  github_get_workflow_artifact_file_preview: CommandContract<
    RepoFullNameArg & { artifactId: number; path: string },
    RepoFilePreview
  >;
  github_list_repo_commits: CommandContract<
    RepoFullNameArg & { perPage: Maybe<number>; sha: Maybe<string>; forceRefresh: Maybe<boolean> },
    CommitSummary[]
  >;
  github_get_repo_commit_detail: CommandContract<RepoFullNameArg & CommitHashArg & ForceRefreshArg, CommitDetail>;
  github_list_releases: CommandContract<RepoFullNameArg & ForceRefreshArg, GitHubRelease[]>;
  github_create_release: CommandContract<RepoFullNameArg & { request: GitHubCreateReleaseRequest }, GitHubRelease>;
  github_update_release: CommandContract<
    RepoFullNameArg & { releaseId: number; request: GitHubUpdateReleaseRequest },
    GitHubRelease
  >;
  github_delete_release: CommandContract<RepoFullNameArg & { releaseId: number }, void>;
  github_upload_release_asset: CommandContract<
    RepoFullNameArg & { releaseId: number; filePath: string; label: Maybe<string> },
    GitHubReleaseAsset
  >;
  github_attach_workflow_artifact_asset: CommandContract<
    RepoFullNameArg & { request: GitHubAttachWorkflowArtifactAssetRequest },
    GitHubReleaseAsset
  >;
  github_delete_release_asset: CommandContract<RepoFullNameArg & { releaseId: number; assetId: number }, void>;

  repo_get_summary: CommandContract<RepoArg, RepoSummary>;
  repo_clear_local_cache: CommandContract<RepoArg & { repoFullName: Maybe<string> }, void>;
  repo_refresh_summary: CommandContract<RepoArg & { options: RepoRefreshSummaryOptions }, RepoSummary>;
  repo_refresh_language_stats: CommandContract<RepoArg, RepoSummary>;
  repo_list_files: CommandContract<RepoArg & { parentPath: Maybe<string> }, RepoFileTreeEntry[]>;
  repo_get_file_preview: CommandContract<RepoFileArg, RepoFilePreview>;
  repo_delete_file: CommandContract<RepoFileArg, RepoSummary>;
  repo_get_changes: CommandContract<RepoArg, RepoChange[]>;
  repo_get_history: CommandContract<RepoArg, CommitSummary[]>;
  repo_get_commit_detail: CommandContract<RepoArg & CommitHashArg, CommitDetail>;
  repo_get_branches: CommandContract<RepoArg, BranchSummary[]>;
  repo_get_conflicts: CommandContract<RepoArg, RepoConflictState>;
  repo_get_detail: CommandContract<RepoArg, RepoDetail>;
  repo_refresh_detail_patch: CommandContract<RepoArg & { request: RepoDetailPatchRequest }, RepoDetailPatch>;
  repo_get_launch_config: CommandContract<RepoArg, Maybe<ProjectLaunchConfig>>;
  repo_list_launch_candidates: CommandContract<RepoArg, ProjectLaunchCandidate[]>;
  repo_save_launch_config: CommandContract<
    RepoArg & { command: string; cwd: Maybe<string> },
    ProjectLaunchConfig
  >;
  repo_get_launch_status: CommandContract<RepoArg, ProjectLaunchStatus>;
  repo_get_launch_logs: CommandContract<RepoArg & { since: Maybe<number> }, ProjectLaunchLog[]>;
  repo_list_launch_history: CommandContract<RepoArg, ProjectLaunchHistoryEntry[]>;
  repo_start_launch: CommandContract<RepoArg, ProjectLaunchStatus>;
  repo_stop_launch: CommandContract<RepoArg, ProjectLaunchStatus>;
  repo_stage_files: CommandContract<RepoArg & { files: string[] }, void>;
  repo_unstage_files: CommandContract<RepoArg & { files: string[] }, void>;
  repo_discard_files: CommandContract<RepoArg & { files: string[] }, RepoSummary>;
  repo_add_files_to_gitignore: CommandContract<RepoArg & { files: string[] }, RepoSummary>;
  repo_commit: CommandContract<
    RepoArg & { files: string[]; message: string; pushAfter: boolean },
    RepoSummary
  >;
  repo_pull: CommandContract<RepoArg & { localChangesMode: Maybe<RepoPullLocalChangesMode> }, RepoSummary>;
  repo_merge_pull: CommandContract<RepoArg & { localChangesMode: Maybe<RepoPullLocalChangesMode> }, RepoMergePullResult>;
  repo_fetch: CommandContract<RepoArg, RepoSummary>;
  repo_start_rebase: CommandContract<RepoArg & { ontoRef: Maybe<string>; localChangesMode: Maybe<RepoPullLocalChangesMode> }, RepoOperationResult>;
  repo_push: CommandContract<RepoArg, RepoSummary>;
  repo_push_new_branch: CommandContract<
    RepoArg & { remoteName: Maybe<string>; branchName: Maybe<string> },
    RepoSummary
  >;
  repo_push_with_system_git: CommandContract<RepoArg, RepoSummary>;
  repo_use_default_token_auth: CommandContract<RepoArg, WorkspaceSettings>;
  repo_checkout_branch: CommandContract<RepoArg & { branch: string }, RepoSummary>;
  repo_create_branch: CommandContract<
    RepoArg & { name: string; fromRef: string; checkoutAfter: boolean },
    RepoSummary
  >;
  repo_rename_branch: CommandContract<RepoArg & { oldName: string; newName: string }, RepoSummary>;
  repo_merge_branch: CommandContract<RepoArg & { branch: string }, RepoMergePullResult>;
  repo_delete_branch: CommandContract<RepoArg & { branch: string }, RepoSummary>;
  repo_set_upstream: CommandContract<RepoArg & { branch: string; upstream: string }, RepoSummary>;
  repo_list_stashes: CommandContract<RepoArg, RepoStashEntry[]>;
  repo_get_stash_detail: CommandContract<RepoArg & { stashId: string }, RepoStashDetail>;
  repo_stash_save: CommandContract<RepoArg & { message: Maybe<string> }, RepoSummary>;
  repo_stash_apply: CommandContract<RepoArg & { stashId: string }, RepoOperationResult>;
  repo_stash_pop: CommandContract<RepoArg & { stashId: string }, RepoOperationResult>;
  repo_stash_drop: CommandContract<RepoArg & { stashId: string }, RepoStashEntry[]>;
  repo_list_remotes: CommandContract<RepoArg, RepoRemote[]>;
  repo_cherry_pick_commit: CommandContract<RepoArg & CommitHashArg, RepoOperationResult>;
  repo_revert_commit: CommandContract<RepoArg & CommitHashArg, RepoOperationResult>;
  repo_reset_to_commit: CommandContract<RepoArg & CommitHashArg & { mode: RepoResetMode }, RepoSummary>;
  repo_accept_conflict_file: CommandContract<
    RepoFileArg & { side: "ours" | "theirs"; stage: boolean },
    RepoSummary
  >;
  repo_resolve_conflict_file: CommandContract<
    RepoFileArg & { choices: RepoConflictChoice[]; stage: boolean },
    RepoSummary
  >;
  repo_mark_file_resolved: CommandContract<RepoFileArg, RepoSummary>;
  repo_abort_conflict_operation: CommandContract<RepoArg, RepoSummary>;
  repo_continue_conflict_operation: CommandContract<RepoArg, RepoSummary>;

  bulk_sync_preview: CommandContract<{ operation: BulkOperation; repos: RepoSummary[]; localChangesMode: Maybe<RepoPullLocalChangesMode> }, BulkSyncPreview>;
  bulk_sync_execute: CommandContract<{ operation: BulkOperation; repoIds: string[]; localChangesMode: Maybe<RepoPullLocalChangesMode> }, BulkSyncResult[]>;
  system_open_path: CommandContract<{ path: string }, void>;
  system_open_path_target: CommandContract<{ path: string; target: SystemOpenTarget }, void>;
  system_open_url: CommandContract<{ url: string }, void>;
}

export type WorkspaceCommandName = keyof WorkspaceCommandContracts;
export type WorkspaceCommandArgs<TCommand extends WorkspaceCommandName> =
  WorkspaceCommandContracts[TCommand]["args"];
export type WorkspaceCommandResult<TCommand extends WorkspaceCommandName> =
  WorkspaceCommandContracts[TCommand]["result"];
