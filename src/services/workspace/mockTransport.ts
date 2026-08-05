import { createCachedAsyncModule } from "../../utils/asyncModule";
import { createWorkspaceHandlerTransport, type WorkspaceCommandHandlers, type WorkspaceTransport } from "./transport";
import {
  LILIA_CODE_TASK_HANDOFF_PROTOCOL,
  LILIA_CODE_TASK_HANDOFF_VERSION,
  type LiliaCodeTaskHandoffStatus,
} from "../liliaCodeHandoff/types";
import { WorkspaceCommandError } from "./errors";

type WorkspaceFallbackModule = typeof import("./fallback");

const workspaceFallbackLoader = createCachedAsyncModule(() => import("./fallback"));
const codeReviewFallbackLoader = createCachedAsyncModule(() => import("../codeReview/fallback"));
const homeAttentionFallbackLoader = createCachedAsyncModule(() => import("../homeAttention/fallback"));
const discussionsFallbackLoader = createCachedAsyncModule(() => import("./discussions/fallback"));

export function loadWorkspaceFallbackModule(): Promise<WorkspaceFallbackModule> {
  return workspaceFallbackLoader.load();
}

const workspaceFallbackModule = loadWorkspaceFallbackModule;
const codeReviewFallbackModule = () => codeReviewFallbackLoader.load();
const homeAttentionFallbackModule = () => homeAttentionFallbackLoader.load();
const discussionsFallbackModule = () => discussionsFallbackLoader.load();

function unavailableSystemAction(command: string): never {
  throw new WorkspaceCommandError({
    code: "workspace_action_unavailable",
    category: "unknown",
    message: "此操作需要桌面运行环境。",
    retryable: false,
    details: { command, runtime: "mock" },
  });
}

function mockLiliaCodeTaskHandoff(handoffId: string): LiliaCodeTaskHandoffStatus {
  const accepted = import.meta.env?.DEV === true
    && import.meta.env?.VITE_LILIA_GITHUB_AGENT_DEBUG_MOCK_WORKSPACE === "1";
  return {
    protocol: LILIA_CODE_TASK_HANDOFF_PROTOCOL,
    version: LILIA_CODE_TASK_HANDOFF_VERSION,
    handoffId,
    status: accepted ? "accepted" : "pending",
    taskId: accepted ? `agent-debug-${handoffId}` : null,
    resultRoute: accepted ? `liliacode://tasks/agent-debug-${handoffId}` : null,
    updatedAt: new Date().toISOString(),
  };
}

const workspaceMockHandlers = {
  workspace_get_bootstrap: async (_commandArgs) => {
    return (await workspaceFallbackModule()).getWorkspaceBootstrap();
  },
  workspace_get_settings: async (_commandArgs) => {
    return (await workspaceFallbackModule()).getWorkspaceSettings();
  },
  workspace_read_startup_cache: async (_commandArgs) => {
    return (await workspaceFallbackModule()).readStartupCache();
  },
  workspace_clear_startup_cache: async (_commandArgs) => {
    return (await workspaceFallbackModule()).clearStartupCache();
  },
  workspace_write_startup_contributions: async (commandArgs) => {
    const contributions = commandArgs.contributions;
    return (await workspaceFallbackModule()).writeStartupContributions(contributions);
  },
  workspace_create: async (commandArgs) => {
    const name = commandArgs.name;
    const rootPath = commandArgs.rootPath;
    return (await workspaceFallbackModule()).createWorkspace(name, rootPath);
  },
  workspace_rename: async (commandArgs) => {
    const workspaceId = commandArgs.workspaceId;
    const name = commandArgs.name;
    return (await workspaceFallbackModule()).renameWorkspace(workspaceId, name);
  },
  workspace_delete: async (commandArgs) => {
    const workspaceId = commandArgs.workspaceId;
    return (await workspaceFallbackModule()).deleteWorkspace(workspaceId);
  },
  workspace_switch: async (commandArgs) => {
    const workspaceId = commandArgs.workspaceId;
    return (await workspaceFallbackModule()).switchWorkspace(workspaceId);
  },
  workspace_add_root: async (commandArgs) => {
    const workspaceId = commandArgs.workspaceId;
    const rootPath = commandArgs.rootPath;
    return (await workspaceFallbackModule()).addWorkspaceRoot(workspaceId, rootPath);
  },
  workspace_remove_root: async (commandArgs) => {
    const workspaceId = commandArgs.workspaceId;
    const rootId = commandArgs.rootId;
    return (await workspaceFallbackModule()).removeWorkspaceRoot(workspaceId, rootId);
  },
  workspace_set_primary_root: async (commandArgs) => {
    const workspaceId = commandArgs.workspaceId;
    const rootId = commandArgs.rootId;
    return (await workspaceFallbackModule()).setPrimaryWorkspaceRoot(workspaceId, rootId);
  },
  workspace_update_view_preferences: async (commandArgs) => {
    const preferences = commandArgs.preferences;
    return (await workspaceFallbackModule()).updateWorkspaceViewPreferences(preferences);
  },
  workspace_update_recent_context: async (commandArgs) => {
    const workspaceId = commandArgs.workspaceId;
    const context = commandArgs.context;
    return (await workspaceFallbackModule()).updateWorkspaceRecentContext(workspaceId, context);
  },
  workspace_update_account_preferences: async (commandArgs) => {
    const preferences = commandArgs.preferences;
    return (await workspaceFallbackModule()).updateAccountPreferences(preferences);
  },
  workspace_set_contribution_identities: async (commandArgs) => {
    const identities = commandArgs.identities;
    return (await workspaceFallbackModule()).setContributionIdentities(identities);
  },
  workspace_scan_contribution_identities: async (_commandArgs) => {
    return (await workspaceFallbackModule()).scanContributionIdentities();
  },
  repo_set_preference: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const key = commandArgs.key;
    const value = commandArgs.value;
    return (await workspaceFallbackModule()).setRepoSetting(repoId, key, value);
  },
  repo_set_auto_sync: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const autoSync = commandArgs.autoSync;
    return (await workspaceFallbackModule()).setRepoAutoSync(repoId, autoSync);
  },
  workspace_pick_root: async (_commandArgs) => {
    return (await workspaceFallbackModule()).pickWorkspaceRoot();
  },
  workspace_pick_repo: async (_commandArgs) => {
    return (await workspaceFallbackModule()).pickRepo();
  },
  workspace_pick_files: async (_commandArgs) => {
    return (await workspaceFallbackModule()).pickFiles();
  },
  workspace_refresh_repos: async (_commandArgs) => {
    return (await workspaceFallbackModule()).refreshRepos();
  },
  workspace_list_managed_repos: async (_commandArgs) => {
    return (await workspaceFallbackModule()).listManagedRepos();
  },
  workspace_scan_repos: async (_commandArgs) => {
    return (await workspaceFallbackModule()).discoverRepos();
  },
  workspace_discover_repos: async (_commandArgs) => {
    return (await workspaceFallbackModule()).discoverRepos();
  },
  workspace_add_repo: async (commandArgs) => {
    const repoPath = commandArgs.repoPath;
    return (await workspaceFallbackModule()).addRepo(repoPath);
  },
  workspace_create_local_repo: async (commandArgs) => {
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).createLocalRepo(request);
  },
  workspace_clone_repo: async (commandArgs) => {
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).cloneRepo(request);
  },
  workspace_hide_repo: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).hideRepo(repoId);
  },
  workspace_reconcile_organization_repo_groups: async (commandArgs) => {
    const organizationLogins = commandArgs.organizationLogins;
    return (await workspaceFallbackModule()).reconcileOrganizationRepoGroups(organizationLogins);
  },
  workspace_create_repo_group: async (commandArgs) => {
    const name = commandArgs.name;
    return (await workspaceFallbackModule()).createRepoGroup(name);
  },
  workspace_rename_repo_group: async (commandArgs) => {
    const groupId = commandArgs.groupId;
    const name = commandArgs.name;
    return (await workspaceFallbackModule()).renameRepoGroup(groupId, name);
  },
  workspace_delete_repo_group: async (commandArgs) => {
    const groupId = commandArgs.groupId;
    return (await workspaceFallbackModule()).deleteRepoGroup(groupId);
  },
  workspace_move_repo_to_group: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const groupId = commandArgs.groupId;
    const pathMode = commandArgs.pathMode;
    return (await workspaceFallbackModule()).moveRepoToGroup(repoId, groupId, pathMode);
  },
  workspace_relocate_local_repo: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const targetPath = commandArgs.targetPath;
    return (await workspaceFallbackModule()).relocateLocalRepo(repoId, targetPath);
  },
  workspace_set_local_repo_favorite: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const favorite = commandArgs.favorite;
    return (await workspaceFallbackModule()).setLocalRepoFavorite(repoId, favorite);
  },
  workspace_delete_local_repo: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).deleteLocalRepo(repoId);
  },
  workspace_remember_remote_repo: async (commandArgs) => {
    const repo = commandArgs.repo;
    return (await workspaceFallbackModule()).rememberRemoteRepo(repo);
  },
  workspace_set_remote_repo_favorite: async (commandArgs) => {
    const repo = commandArgs.repo;
    const favorite = commandArgs.favorite;
    return (await workspaceFallbackModule()).setRemoteRepoFavorite(repo, favorite);
  },
  workspace_forget_remote_repo: async (commandArgs) => {
    const fullName = commandArgs.fullName;
    return (await workspaceFallbackModule()).forgetRemoteRepo(fullName);
  },
  workspace_unhide_repo: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).unhideRepo(repoId);
  },
  workspace_list_hidden_repos: async (_commandArgs) => {
    return (await workspaceFallbackModule()).listHiddenRepos();
  },
  workspace_list_tasks: async (_commandArgs) => {
    return (await workspaceFallbackModule()).listWorkspaceTasks();
  },
  workspace_cancel_task: async (commandArgs) => {
    const taskId = commandArgs.taskId;
    return (await workspaceFallbackModule()).cancelWorkspaceTask(taskId);
  },
  workspace_set_active_repo: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).setActiveWorkspaceRepo(repoId);
  },
  workspace_record_recent_local_repo: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).recordRecentLocalRepo(repoId);
  },
  workspace_set_refresh_paused: async (commandArgs) => {
    const paused = commandArgs.paused;
    return (await workspaceFallbackModule()).setWorkspaceRefreshPaused(paused);
  },
  workspace_enqueue_repo_refresh: async (commandArgs) => {
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).enqueueRepoRefresh(request);
  },
  github_get_binding_status: async (_commandArgs) => {
    return (await workspaceFallbackModule()).getGitHubBindingStatus();
  },
  github_start_device_flow: async (_commandArgs) => {
    return (await workspaceFallbackModule()).startGitHubDeviceFlow();
  },
  github_poll_device_flow: async (commandArgs) => {
    const deviceCode = commandArgs.deviceCode;
    const intervalSeconds = commandArgs.intervalSeconds;
    return (await workspaceFallbackModule()).pollGitHubDeviceFlow(deviceCode, intervalSeconds);
  },
  github_unbind: async (_commandArgs) => {
    return (await workspaceFallbackModule()).unbindGitHub();
  },
  github_get_account_profile: async (_commandArgs) => {
    return (await workspaceFallbackModule()).getGitHubAccountProfile();
  },
  github_get_account_readme: async (_commandArgs) => {
    return (await workspaceFallbackModule()).getGitHubAccountReadme();
  },
  github_update_account_profile: async (commandArgs) => {
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubAccountProfile(request);
  },
  github_get_organization_profile: async (commandArgs) => {
    const login = commandArgs.login;
    return (await workspaceFallbackModule()).getGitHubOrganizationProfile(login);
  },
  github_get_organization_overview: async (commandArgs) => {
    const login = commandArgs.login;
    const view = commandArgs.view;
    return (await workspaceFallbackModule()).getGitHubOrganizationOverview(login, view);
  },
  github_list_repos: async (commandArgs) => {
    const scope = commandArgs.scope;
    const pageNo = commandArgs.page;
    return (await workspaceFallbackModule()).listGitHubRepos(scope, pageNo);
  },
  github_list_watched_repos: async (commandArgs) => {
    const pageNo = commandArgs.page;
    return (await workspaceFallbackModule()).listGitHubWatchedRepos(pageNo);
  },
  github_get_repo_subscription: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    return (await workspaceFallbackModule()).getGitHubRepositorySubscription(repoFullName);
  },
  github_update_repo_subscription: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const mode = commandArgs.mode;
    return (await workspaceFallbackModule()).updateGitHubRepositorySubscription(repoFullName, mode);
  },
  github_list_account_issues: async (commandArgs) => {
    const args = commandArgs;
    return (await workspaceFallbackModule()).listGitHubAccountIssues(args);
  },
  github_list_home_attention: async (commandArgs) => {
    const fallback = await workspaceFallbackModule();
    return (await homeAttentionFallbackModule()).listHomeAttentionFallback(
      {
        listGitHubPullRequests: fallback.listGitHubPullRequests,
        listGitHubWorkflowRuns: fallback.listGitHubWorkflowRuns,
      },
      commandArgs.repoFullNames,
      { forceRefresh: commandArgs.forceRefresh ?? undefined },
    );
  },
  github_list_action_notifications: async (commandArgs) => {
    const perPage = commandArgs.perPage;
    return (await workspaceFallbackModule()).listGitHubActionNotifications(perPage);
  },
  github_list_repo_contribution: async (commandArgs) => {
    const repoScope = commandArgs.repoFullName;
    return (await workspaceFallbackModule()).listRepoContribution(repoScope);
  },
  github_list_repo_owners: async (_commandArgs) => {
    return (await workspaceFallbackModule()).listGitHubRepoOwners();
  },
  github_list_repo_templates: async (_commandArgs) => {
    return (await workspaceFallbackModule()).listGitHubRepoTemplates();
  },
  github_list_repo_licenses: async (_commandArgs) => {
    return (await workspaceFallbackModule()).listGitHubRepoLicenses();
  },
  github_create_repo: async (commandArgs) => {
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).createGitHubRepo(request);
  },
  github_get_repo_management: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    return (await workspaceFallbackModule()).getGitHubRepoManagement(repoFullName);
  },
  github_update_repo_settings: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubRepoSettings(repoFullName, request);
  },
  github_get_repo_settings_section: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const section = commandArgs.section;
    return (await workspaceFallbackModule()).getGitHubRepoSettingsSection(repoFullName, section);
  },
  github_update_repo_actions_permissions: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubRepoActionsPermissions(repoFullName, request);
  },
  github_update_repo_workflow_permissions: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubRepoWorkflowPermissions(repoFullName, request);
  },
  github_delete_repo: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    return (await workspaceFallbackModule()).deleteGitHubRepo(repoFullName);
  },
  github_list_branches: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    return (await workspaceFallbackModule()).listGitHubBranches(repoFullName);
  },
  github_get_branch_protection: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const branchName = commandArgs.branchName;
    return (await workspaceFallbackModule()).getGitHubBranchProtection(repoFullName, branchName);
  },
  github_update_branch_protection: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const branchName = commandArgs.branchName;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubBranchProtection(repoFullName, branchName, request);
  },
  github_list_repo_rulesets: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    return (await workspaceFallbackModule()).listGitHubRepoRulesets(repoFullName);
  },
  github_get_repo_ruleset: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const rulesetId = commandArgs.rulesetId;
    return (await workspaceFallbackModule()).getGitHubRepoRuleset(repoFullName, rulesetId);
  },
  github_update_repo_ruleset: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const rulesetId = commandArgs.rulesetId;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubRepoRuleset(repoFullName, rulesetId, request);
  },
  github_delete_branch: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const branchName = commandArgs.branchName;
    return (await workspaceFallbackModule()).deleteGitHubBranch(repoFullName, branchName);
  },
  github_list_pull_requests: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const options = commandArgs;
    return (await workspaceFallbackModule()).listGitHubPullRequests(repoFullName, options);
  },
  github_get_pull_request: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const pullNumber = commandArgs.pullNumber;
    return (await workspaceFallbackModule()).getGitHubPullRequest(repoFullName, pullNumber);
  },
  github_get_pull_request_discussion: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const pullNumber = commandArgs.pullNumber;
    return (await workspaceFallbackModule()).getGitHubPullRequestDiscussion(repoFullName, pullNumber);
  },
  github_create_pull_request: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).createGitHubPullRequest(repoFullName, request);
  },
  github_update_pull_request: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const pullNumber = commandArgs.pullNumber;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubPullRequest(repoFullName, pullNumber, request);
  },
  github_merge_pull_request: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const pullNumber = commandArgs.pullNumber;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).mergeGitHubPullRequest(repoFullName, pullNumber, request);
  },
  github_list_pull_request_checks: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const pullNumber = commandArgs.pullNumber;
    return (await workspaceFallbackModule()).listGitHubPullRequestChecks(repoFullName, pullNumber);
  },
  github_get_pull_request_code_review: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const pullNumber = commandArgs.pullNumber;
    return (await codeReviewFallbackModule()).getPullRequestCodeReviewFallback(repoFullName, pullNumber);
  },
  github_create_pull_request_line_comment: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const pullNumber = commandArgs.pullNumber;
    const request = commandArgs.request;
    return (await codeReviewFallbackModule()).createPullRequestLineCommentFallback(repoFullName, pullNumber, request);
  },
  github_reply_pull_request_review_thread: async (commandArgs) => {
    return (await codeReviewFallbackModule()).replyPullRequestReviewThreadFallback(
      commandArgs.repoFullName,
      commandArgs.request,
    );
  },
  github_submit_pull_request_code_review: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const pullNumber = commandArgs.pullNumber;
    const request = commandArgs.request;
    return (await codeReviewFallbackModule()).submitPullRequestCodeReviewFallback(repoFullName, pullNumber, request);
  },
  github_list_repo_files: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const parentPath = commandArgs.parentPath;
    const refName = commandArgs.refName;
    return (await workspaceFallbackModule()).listGitHubRepoFiles(repoFullName, parentPath, refName);
  },
  github_get_repo_file_preview: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const normalizedPath = commandArgs.path;
    const refName = commandArgs.refName;
    return (await workspaceFallbackModule()).getGitHubRepoFilePreview(repoFullName, normalizedPath, refName);
  },
  github_list_issues: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const options = commandArgs;
    return (await workspaceFallbackModule()).listGitHubIssues(repoFullName, options);
  },
  github_get_issue_discussion: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const issueNumber = commandArgs.issueNumber;
    return (await workspaceFallbackModule()).getGitHubIssueDiscussion(repoFullName, issueNumber);
  },
  github_get_issue_filter_metadata: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    return (await workspaceFallbackModule()).getGitHubIssueFilterMetadata(repoFullName);
  },
  github_list_issue_labels: async (commandArgs) => {
    return (await workspaceFallbackModule()).listGitHubIssueLabels(commandArgs.repoFullName);
  },
  github_list_issue_assignees: async (commandArgs) => {
    return (await workspaceFallbackModule()).listGitHubIssueAssignees(commandArgs.repoFullName);
  },
  github_create_issue: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).createGitHubIssue(repoFullName, request);
  },
  github_update_issue: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const issueNumber = commandArgs.issueNumber;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubIssue(repoFullName, issueNumber, request);
  },
  github_create_issue_comment: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const issueNumber = commandArgs.issueNumber;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).createGitHubIssueCommentFallback(repoFullName, issueNumber, request);
  },
  github_update_issue_comment: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const commentId = commandArgs.commentId;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubIssueCommentFallback(repoFullName, commentId, request);
  },
  github_delete_issue_comment: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const commentId = commandArgs.commentId;
    return (await workspaceFallbackModule()).deleteGitHubIssueCommentFallback(repoFullName, commentId);
  },
  github_add_issue_comment_reaction: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const commentId = commandArgs.commentId;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).addGitHubIssueCommentReactionFallback(repoFullName, commentId, request);
  },
  github_get_discussion_metadata: async (_commandArgs) => {
    return (await discussionsFallbackModule()).getDiscussionMetadataFallback();
  },
  github_list_discussions: async (commandArgs) => {
    const state = commandArgs.state === "open" || commandArgs.state === "closed" || commandArgs.state === "all"
      ? commandArgs.state
      : undefined;
    const sort = commandArgs.sort === "created" || commandArgs.sort === "updated"
      ? commandArgs.sort
      : undefined;
    const direction = commandArgs.direction === "asc" || commandArgs.direction === "desc"
      ? commandArgs.direction
      : undefined;
    return (await discussionsFallbackModule()).listDiscussionsFallback({
      first: commandArgs.first ?? undefined,
      after: commandArgs.after ?? undefined,
      categoryId: commandArgs.categoryId ?? undefined,
      answered: commandArgs.answered ?? undefined,
      state,
      sort,
      direction,
    });
  },
  github_get_discussion: async (commandArgs) => {
    const discussionNumber = commandArgs.discussionNumber;
    return (await discussionsFallbackModule()).getDiscussionFallback(discussionNumber);
  },
  github_list_discussion_comments: async (commandArgs) => {
    return (await discussionsFallbackModule()).listDiscussionCommentsFallback(
      commandArgs.discussionNumber,
      { first: commandArgs.first ?? undefined, after: commandArgs.after ?? undefined },
    );
  },
  github_list_discussion_comment_replies: async (commandArgs) => {
    return (await discussionsFallbackModule()).listDiscussionCommentRepliesFallback(
      commandArgs.commentId,
      { first: commandArgs.first ?? undefined, after: commandArgs.after ?? undefined },
    );
  },
  github_create_discussion: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const request = commandArgs.request;
    return (await discussionsFallbackModule()).createDiscussionFallback(repoFullName, request);
  },
  github_create_discussion_comment: async (commandArgs) => {
    const request = commandArgs.request;
    return (await discussionsFallbackModule()).createDiscussionCommentFallback(request);
  },
  github_update_discussion_comment: async (commandArgs) => {
    const request = commandArgs.request;
    return (await discussionsFallbackModule()).updateDiscussionCommentFallback(request);
  },
  github_delete_discussion_comment: async (commandArgs) => {
    const commentId = commandArgs.commentId;
    return (await discussionsFallbackModule()).deleteDiscussionCommentFallback(commentId);
  },
  github_update_discussion_reaction: async (commandArgs) => {
    const request = commandArgs.request;
    return (await discussionsFallbackModule()).updateDiscussionReactionFallback(request);
  },
  github_update_discussion_state: async (commandArgs) => {
    const request = commandArgs.request;
    return (await discussionsFallbackModule()).updateDiscussionStateFallback(request);
  },
  github_update_discussion_answer: async (commandArgs) => {
    const request = commandArgs.request;
    return (await discussionsFallbackModule()).updateDiscussionAnswerFallback(request);
  },
  github_list_workflow_runs: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const perPage = commandArgs.perPage;
    return (await workspaceFallbackModule()).listGitHubWorkflowRuns(repoFullName, perPage);
  },
  github_get_workflow_run_detail: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const runId = commandArgs.runId;
    return (await workspaceFallbackModule()).getGitHubWorkflowRunDetail(repoFullName, runId);
  },
  github_get_workflow_job_log: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const jobId = commandArgs.jobId;
    return (await workspaceFallbackModule()).getGitHubWorkflowJobLog(repoFullName, jobId);
  },
  github_cancel_workflow_run: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const runId = commandArgs.runId;
    return (await workspaceFallbackModule()).cancelGitHubWorkflowRun(repoFullName, runId);
  },
  github_rerun_failed_workflow_run: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const runId = commandArgs.runId;
    return (await workspaceFallbackModule()).rerunFailedGitHubWorkflowRun(repoFullName, runId);
  },
  github_rerun_workflow_job: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const jobId = commandArgs.jobId;
    return (await workspaceFallbackModule()).rerunGitHubWorkflowJob(repoFullName, jobId);
  },
  github_list_workflow_artifact_files: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const artifactId = commandArgs.artifactId;
    return (await workspaceFallbackModule()).listGitHubWorkflowArtifactFiles(repoFullName, artifactId);
  },
  github_get_workflow_artifact_file_preview: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const artifactId = commandArgs.artifactId;
    const path = commandArgs.path;
    return (await workspaceFallbackModule()).getGitHubWorkflowArtifactFilePreview(repoFullName, artifactId, path);
  },
  github_list_repo_commits: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const options = commandArgs;
    return (await workspaceFallbackModule()).listGitHubRepoCommits(repoFullName, options);
  },
  github_get_repo_commit_detail: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const normalizedHash = commandArgs.hash;
    return (await workspaceFallbackModule()).getGitHubRepoCommitDetail(repoFullName, normalizedHash);
  },
  github_list_releases: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    return (await workspaceFallbackModule()).listGitHubReleases(repoFullName);
  },
  github_get_release_by_tag: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const normalizedTag = commandArgs.tagName;
    return (await workspaceFallbackModule()).getGitHubReleaseByTag(repoFullName, normalizedTag);
  },
  github_create_release: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).createGitHubRelease(repoFullName, request);
  },
  github_update_release: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const releaseId = commandArgs.releaseId;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).updateGitHubRelease(repoFullName, releaseId, request);
  },
  github_delete_release: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const releaseId = commandArgs.releaseId;
    return (await workspaceFallbackModule()).deleteGitHubRelease(repoFullName, releaseId);
  },
  github_upload_release_asset: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const releaseId = commandArgs.releaseId;
    const filePath = commandArgs.filePath;
    const label = commandArgs.label;
    return (await workspaceFallbackModule()).uploadGitHubReleaseAsset(repoFullName, releaseId, filePath, label);
  },
  github_attach_workflow_artifact_asset: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).attachGitHubWorkflowArtifactAsset(repoFullName, request);
  },
  github_delete_release_asset: async (commandArgs) => {
    const repoFullName = commandArgs.repoFullName;
    const releaseId = commandArgs.releaseId;
    const assetId = commandArgs.assetId;
    return (await workspaceFallbackModule()).deleteGitHubReleaseAsset(repoFullName, releaseId, assetId);
  },
  repo_get_summary: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).getRepoSummary(repoId);
  },
  repo_get_storage_stats: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).getRepoStorageStats(repoId);
  },
  repo_refresh_summary: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const options = commandArgs.options;
    return (await workspaceFallbackModule()).refreshRepoSummary(repoId, options);
  },
  repo_refresh_language_stats: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).refreshRepoLanguageStats(repoId);
  },
  repo_list_files: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const parentPath = commandArgs.parentPath;
    return (await workspaceFallbackModule()).listRepoFiles(repoId, parentPath);
  },
  repo_get_file_preview: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const path = commandArgs.path;
    return (await workspaceFallbackModule()).getRepoFilePreview(repoId, path);
  },
  repo_delete_file: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const path = commandArgs.path;
    return (await workspaceFallbackModule()).deleteRepoFile(repoId, path);
  },
  repo_get_changes: async (commandArgs) => {
    return (await workspaceFallbackModule()).getRepoDetail(commandArgs.repoId).then((detail) => detail.changes);
  },
  repo_get_history: async (commandArgs) => {
    return (await workspaceFallbackModule()).getRepoDetail(commandArgs.repoId).then((detail) => detail.commits);
  },
  repo_get_commit_detail: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const hash = commandArgs.hash;
    return (await workspaceFallbackModule()).getRepoCommitDetail(repoId, hash);
  },
  repo_get_branches: async (commandArgs) => {
    return (await workspaceFallbackModule()).getRepoDetail(commandArgs.repoId).then((detail) => detail.branches);
  },
  repo_get_conflicts: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).getRepoConflicts(repoId);
  },
  repo_get_detail: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).getRepoDetail(repoId);
  },
  repo_get_remote_sync_config: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).getRepoRemoteSyncConfig(repoId);
  },
  repo_set_remote_sync_policy: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const policy = commandArgs.policy;
    return (await workspaceFallbackModule()).setRepoRemoteSyncPolicy(repoId, policy);
  },
  repo_refresh_detail_patch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const request = commandArgs.request;
    return (await workspaceFallbackModule()).refreshRepoDetailPatch(repoId, request);
  },
  repo_get_launch_config: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).getRepoLaunchConfig(repoId);
  },
  repo_list_launch_candidates: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).listRepoLaunchCandidates(repoId);
  },
  repo_save_launch_config: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const command = commandArgs.command;
    const cwd = commandArgs.cwd;
    return (await workspaceFallbackModule()).saveRepoLaunchConfig(repoId, command, cwd);
  },
  repo_get_launch_status: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).getRepoLaunchStatus(repoId);
  },
  repo_get_launch_logs: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const since = commandArgs.since;
    return (await workspaceFallbackModule()).getRepoLaunchLogs(repoId, since);
  },
  repo_list_launch_history: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).listRepoLaunchHistory(repoId);
  },
  repo_start_launch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).startRepoLaunch(repoId);
  },
  repo_stop_launch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).stopRepoLaunch(repoId);
  },
  repo_stage_files: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const files = commandArgs.files;
    return (await workspaceFallbackModule()).stageFiles(repoId, files);
  },
  repo_unstage_files: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const files = commandArgs.files;
    return (await workspaceFallbackModule()).unstageFiles(repoId, files);
  },
  repo_discard_files: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const files = commandArgs.files;
    return (await workspaceFallbackModule()).discardFiles(repoId, files);
  },
  repo_add_files_to_gitignore: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const files = commandArgs.files;
    return (await workspaceFallbackModule()).addFilesToGitignore(repoId, files);
  },
  repo_commit: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const files = commandArgs.files;
    const message = commandArgs.message;
    const pushAfter = commandArgs.pushAfter;
    return (await workspaceFallbackModule()).commitRepo(repoId, files, message, pushAfter);
  },
  repo_pull: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const localChangesMode = commandArgs.localChangesMode;
    return (await workspaceFallbackModule()).pullRepo(repoId, localChangesMode ?? undefined);
  },
  repo_merge_pull: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const localChangesMode = commandArgs.localChangesMode;
    return (await workspaceFallbackModule()).mergePullRepo(repoId, localChangesMode ?? undefined);
  },
  repo_fetch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).fetchRepo(repoId);
  },
  repo_start_rebase: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const ontoRef = commandArgs.ontoRef;
    const localChangesMode = commandArgs.localChangesMode;
    return (await workspaceFallbackModule()).startRebaseRepo(repoId, ontoRef, localChangesMode ?? undefined);
  },
  repo_push: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const remoteNames = commandArgs.remoteNames;
    return (await workspaceFallbackModule()).pushRepo(repoId, remoteNames);
  },
  repo_push_new_branch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const remoteNames = commandArgs.remoteNames;
    const branchName = commandArgs.branchName;
    return (await workspaceFallbackModule()).pushNewBranchRepo(repoId, remoteNames, branchName);
  },
  repo_push_with_system_git: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const remoteNames = commandArgs.remoteNames;
    return (await workspaceFallbackModule()).pushRepoWithSystemGit(repoId, remoteNames);
  },
  repo_use_default_token_auth: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).useDefaultTokenAuthForRepo(repoId);
  },
  repo_checkout_branch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const branch = commandArgs.branch;
    return (await workspaceFallbackModule()).checkoutBranch(repoId, branch);
  },
  repo_create_branch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const name = commandArgs.name;
    const fromRef = commandArgs.fromRef;
    const checkoutAfter = commandArgs.checkoutAfter;
    return (await workspaceFallbackModule()).createBranch(repoId, name, fromRef, checkoutAfter);
  },
  repo_rename_branch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const oldName = commandArgs.oldName;
    const newName = commandArgs.newName;
    return (await workspaceFallbackModule()).renameBranch(repoId, oldName, newName);
  },
  repo_merge_branch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const branch = commandArgs.branch;
    return (await workspaceFallbackModule()).mergeBranch(repoId, branch);
  },
  repo_delete_branch: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const branch = commandArgs.branch;
    return (await workspaceFallbackModule()).deleteBranch(repoId, branch);
  },
  repo_set_upstream: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const branch = commandArgs.branch;
    const upstream = commandArgs.upstream;
    return (await workspaceFallbackModule()).setBranchUpstream(repoId, branch, upstream);
  },
  repo_list_stashes: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).listRepoStashes(repoId);
  },
  repo_get_stash_detail: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const stashId = commandArgs.stashId;
    return (await workspaceFallbackModule()).getRepoStashDetail(repoId, stashId);
  },
  repo_stash_save: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const message = commandArgs.message;
    return (await workspaceFallbackModule()).saveRepoStash(repoId, message);
  },
  repo_stash_apply: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const stashId = commandArgs.stashId;
    return (await workspaceFallbackModule()).applyRepoStash(repoId, stashId);
  },
  repo_stash_pop: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const stashId = commandArgs.stashId;
    return (await workspaceFallbackModule()).popRepoStash(repoId, stashId);
  },
  repo_stash_drop: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const stashId = commandArgs.stashId;
    return (await workspaceFallbackModule()).dropRepoStash(repoId, stashId);
  },
  repo_list_remotes: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).listRepoRemotes(repoId);
  },
  repo_cherry_pick_commit: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const hash = commandArgs.hash;
    return (await workspaceFallbackModule()).cherryPickRepoCommit(repoId, hash);
  },
  repo_revert_commit: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const hash = commandArgs.hash;
    return (await workspaceFallbackModule()).revertRepoCommit(repoId, hash);
  },
  repo_reset_to_commit: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const hash = commandArgs.hash;
    const mode = commandArgs.mode;
    return (await workspaceFallbackModule()).resetRepoToCommit(repoId, hash, mode);
  },
  repo_accept_conflict_file: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const path = commandArgs.path;
    const side = commandArgs.side;
    const stage = commandArgs.stage;
    return (await workspaceFallbackModule()).acceptConflictFile(repoId, path, side, stage);
  },
  repo_resolve_conflict_file: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const path = commandArgs.path;
    const choices = commandArgs.choices;
    const stage = commandArgs.stage;
    return (await workspaceFallbackModule()).resolveConflictFile(repoId, path, choices, stage);
  },
  repo_mark_file_resolved: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    const path = commandArgs.path;
    return (await workspaceFallbackModule()).markFileResolved(repoId, path);
  },
  repo_abort_conflict_operation: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).abortConflictOperation(repoId);
  },
  repo_continue_conflict_operation: async (commandArgs) => {
    const repoId = commandArgs.repoId;
    return (await workspaceFallbackModule()).continueConflictOperation(repoId);
  },
  bulk_sync_preview: async (commandArgs) => {
    const operation = commandArgs.operation;
    const repoIds = commandArgs.repoIds;
    const localChangesMode = commandArgs.localChangesMode;
    return (await workspaceFallbackModule()).bulkSyncPreview(operation, repoIds, localChangesMode ?? undefined);
  },
  bulk_sync_execute: async (commandArgs) => {
    const operation = commandArgs.operation;
    const repoIds = commandArgs.repoIds;
    const localChangesMode = commandArgs.localChangesMode;
    const trigger = commandArgs.trigger;
    return (await workspaceFallbackModule()).bulkSyncExecute(
      operation,
      repoIds,
      localChangesMode ?? undefined,
      trigger ?? undefined,
    );
  },
  system_open_path: async (_commandArgs) => {
    return unavailableSystemAction("system_open_path");
  },
  system_open_path_target: async (_commandArgs) => {
    return unavailableSystemAction("system_open_path_target");
  },
  system_open_url: async (_commandArgs) => {
    return unavailableSystemAction("system_open_url");
  },
  lilia_code_create_task_handoff: async (commandArgs) => {
    return mockLiliaCodeTaskHandoff(commandArgs.handoff.id);
  },
  lilia_code_get_task_handoff_status: async (commandArgs) => {
    return mockLiliaCodeTaskHandoff(commandArgs.handoffId);
  },
  lilia_code_open_task_handoff_result: async (_commandArgs) => {
    return unavailableSystemAction("lilia_code_open_task_handoff_result");
  },
} satisfies WorkspaceCommandHandlers;

export function createWorkspaceMockTransport(): WorkspaceTransport {
  return createWorkspaceHandlerTransport(workspaceMockHandlers);
}
