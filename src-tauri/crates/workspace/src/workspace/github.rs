use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use crate::runtime::WorkspaceContext as AppHandle;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::header::{ACCEPT, CONTENT_TYPE, LINK, USER_AGENT};
use reqwest::StatusCode;
use serde::Deserialize;

use crate::workspace::file_browser::{file_preview_mime, MAX_FILE_PREVIEW_BYTES};
use crate::workspace::operations::OperationKind;
use crate::workspace::readme::{image_mime_for_path, readme_image_sources};
use crate::workspace::repos::{commit_file_patches, run_repo_analysis_blocking};
use crate::workspace::settings::{
    clear_github_binding, load_settings, repo_path_by_id, switch_github_binding, STORE_FILE,
};
use crate::workspace::shared::{
    collect_local_contribution_counts, current_utc_day_index, github_contribution_days,
    github_contribution_meta, local_contribution_identities, normalize_local_contribution_repo_id,
    now_millis,
};
use crate::workspace::{run_core_operation, run_core_operation_as};
use lilia_github_contracts::workspace::{
    BranchSummary, CommitDetail, CommitFileChange, CommitSummary, GitHubAccountIssueItem,
    GitHubAccountProfile, GitHubActionNotification, GitHubAttachWorkflowArtifactAssetRequest,
    GitHubBindingMetadata, GitHubBindingStatus, GitHubContributionResult, GitHubCreateIssueRequest,
    GitHubCreatePullRequestRequest, GitHubCreateReleaseRequest, GitHubCreateRepoRequest,
    GitHubDevelopmentItem, GitHubDeviceFlowPollResult, GitHubDeviceFlowStart,
    GitHubDiscussionTimelineItem, GitHubIssue, GitHubIssueDiscussion, GitHubIssueFilterMetadata,
    GitHubIssueMilestone, GitHubIssueProjectItem, GitHubMergePullRequestRequest,
    GitHubOrganizationFeaturedSection, GitHubOrganizationFeaturedSource, GitHubOrganizationMember,
    GitHubOrganizationMembersSection, GitHubOrganizationOverview, GitHubOrganizationProfile,
    GitHubOrganizationProfileView, GitHubOrganizationRepositorySection,
    GitHubOrganizationSectionStatus, GitHubOwnerKind, GitHubProfileReadmeSection,
    GitHubProjectCache, GitHubProjectRepoCache, GitHubPullRequest, GitHubPullRequestCheck,
    GitHubPullRequestDiscussion, GitHubPullRequestReviewer, GitHubReadmeSectionStatus,
    GitHubRelease, GitHubReleaseAsset, GitHubRepoActionsPermissionsRequest, GitHubRepoLicense,
    GitHubRepoManagement, GitHubRepoOwner, GitHubRepoPage, GitHubRepoSettingsEndpointItem,
    GitHubRepoSettingsSection, GitHubRepoSummary, GitHubRepoTemplate,
    GitHubRepoWorkflowPermissionsRequest, GitHubRepositoryOwner, GitHubRepositoryPermissions,
    GitHubRepositoryScope, GitHubRepositorySubscription, GitHubRepositorySubscriptionMode,
    GitHubRulesetSummary, GitHubUpdateAccountProfileRequest, GitHubUpdateIssueRequest,
    GitHubUpdatePullRequestRequest, GitHubUpdateReleaseRequest, GitHubUpdateRepoSettingsRequest,
    GitHubWatchedRepoPage, GitHubWorkflowArtifact, GitHubWorkflowArtifactEntry,
    GitHubWorkflowDefinition, GitHubWorkflowJob, GitHubWorkflowJobLog, GitHubWorkflowJobStep,
    GitHubWorkflowRun, GitHubWorkflowRunDetail, RemoteRepoShortcut, RepoFilePreview,
    RepoFileTreeEntry,
};

pub(super) const GITHUB_CLIENT_ID: &str = "Ov23liJWTEjz4jgqx19u";
pub(super) const GITHUB_SCOPE: &str =
    "repo workflow user read:org delete_repo read:project notifications";
pub(super) const GITHUB_USER_SCOPE: &str = "user";
pub(super) const GITHUB_REPO_SCOPE: &str = "repo";
pub(super) const GITHUB_READ_ORG_SCOPE: &str = "read:org";
pub(super) const GITHUB_DELETE_REPO_SCOPE: &str = "delete_repo";
pub(super) const GITHUB_READ_PROJECT_SCOPE: &str = "read:project";
pub(super) const GITHUB_NOTIFICATIONS_SCOPE: &str = "notifications";
pub(super) const GITHUB_SERVICE: &str = "com.lilia.desktop.github";
pub(super) const GITHUB_ACCEPT: &str = "application/vnd.github+json";
pub(super) const GITHUB_OAUTH_ACCEPT: &str = "application/json";
pub(super) const GITHUB_USER_AGENT: &str = "LiliaGithub/0.1";
pub(super) const GITHUB_CONTRIBUTIONS_REPO_LIMIT: usize = 30;
pub(super) const GITHUB_CONTRIBUTION_DAYS: usize = 371;
pub(super) const GITHUB_PROJECT_CACHE_KEY: &str = "workspace.githubProjectCache";
pub(super) const GITHUB_ACTIONS_ARTIFACT_MAX_BYTES: u64 = 200 * 1024 * 1024;
#[cfg(test)]
pub(super) const GITHUB_RELEASE_ASSET_MAX_BYTES: u64 =
    lilia_github_github::GITHUB_RELEASE_ASSET_MAX_BYTES;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct DeviceCodeResponse {
    pub(super) device_code: String,
    pub(super) user_code: String,
    pub(super) verification_uri: String,
    pub(super) expires_in: i64,
    pub(super) interval: i64,
}

#[derive(Debug, Deserialize)]
pub(super) struct TokenResponse {
    pub(super) access_token: Option<String>,
    pub(super) scope: Option<String>,
    pub(super) error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubErrorResponse {
    pub(super) error: Option<String>,
    pub(super) error_description: Option<String>,
    pub(super) message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubUserResponse {
    pub(super) login: String,
    pub(super) avatar_url: Option<String>,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) email: Option<String>,
    #[serde(default)]
    pub(super) bio: Option<String>,
    #[serde(default)]
    pub(super) company: Option<String>,
    #[serde(default)]
    pub(super) location: Option<String>,
    #[serde(default)]
    pub(super) blog: Option<String>,
    #[serde(default)]
    pub(super) twitter_username: Option<String>,
    #[serde(default)]
    pub(super) hireable: Option<bool>,
}

impl From<GitHubUserResponse> for GitHubAccountProfile {
    fn from(user: GitHubUserResponse) -> Self {
        Self {
            login: user.login,
            avatar_url: user.avatar_url,
            name: user.name,
            email: user.email,
            bio: user.bio,
            company: user.company,
            location: user.location,
            blog: user.blog,
            twitter_username: user.twitter_username,
            hireable: user.hireable,
        }
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoOwnerResponse {
    pub(super) login: String,
    #[serde(rename = "type", default)]
    pub(super) account_type: Option<String>,
    #[serde(default)]
    pub(super) avatar_url: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct GitHubRepoPermissionsResponse {
    #[serde(default)]
    pub(super) pull: bool,
    #[serde(default)]
    pub(super) push: bool,
    #[serde(default)]
    pub(super) admin: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoTemplateResponse {
    pub(super) id: u64,
    pub(super) name: String,
    pub(super) full_name: String,
    pub(super) private: bool,
    #[serde(default)]
    pub(super) description: Option<String>,
    #[serde(default)]
    pub(super) is_template: bool,
    pub(super) owner: GitHubRepoOwnerResponse,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoLicenseResponse {
    pub(super) key: String,
    pub(super) name: String,
    pub(super) spdx_id: Option<String>,
    pub(super) url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoResponse {
    pub(super) id: u64,
    pub(super) name: String,
    pub(super) full_name: String,
    pub(super) private: bool,
    #[serde(default)]
    pub(super) visibility: Option<String>,
    #[serde(default)]
    pub(super) disabled: bool,
    #[serde(default)]
    pub(super) archived: bool,
    #[serde(default)]
    pub(super) fork: bool,
    #[serde(default)]
    pub(super) is_template: bool,
    pub(super) description: Option<String>,
    pub(super) default_branch: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) clone_url: String,
    pub(super) html_url: String,
    #[serde(default)]
    pub(super) language: Option<String>,
    #[serde(default)]
    pub(super) topics: Vec<String>,
    pub(super) owner: GitHubRepoOwnerResponse,
    #[serde(default)]
    pub(super) permissions: Option<GitHubRepoPermissionsResponse>,
    #[serde(default)]
    pub(super) homepage: Option<String>,
    #[serde(default)]
    pub(super) has_issues: bool,
    #[serde(default)]
    pub(super) has_wiki: bool,
    #[serde(default)]
    pub(super) has_projects: bool,
    #[serde(default)]
    pub(super) has_discussions: bool,
    #[serde(default)]
    pub(super) has_pull_requests: bool,
    #[serde(default)]
    pub(super) pull_request_creation_policy: Option<String>,
    #[serde(default)]
    pub(super) allow_merge_commit: bool,
    #[serde(default)]
    pub(super) allow_squash_merge: bool,
    #[serde(default)]
    pub(super) allow_rebase_merge: bool,
    #[serde(default)]
    pub(super) allow_auto_merge: bool,
    #[serde(default)]
    pub(super) delete_branch_on_merge: bool,
    #[serde(default)]
    pub(super) allow_update_branch: bool,
    #[serde(default)]
    pub(super) allow_forking: bool,
    #[serde(default)]
    pub(super) web_commit_signoff_required: bool,
    #[serde(default)]
    pub(super) squash_merge_commit_title: Option<String>,
    #[serde(default)]
    pub(super) squash_merge_commit_message: Option<String>,
    #[serde(default)]
    pub(super) merge_commit_title: Option<String>,
    #[serde(default)]
    pub(super) merge_commit_message: Option<String>,
    #[serde(default)]
    pub(super) security_and_analysis: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) stargazers_count: u64,
    #[serde(default)]
    pub(super) subscribers_count: u64,
    #[serde(default)]
    pub(super) forks_count: u64,
    #[serde(default)]
    pub(super) license: Option<GitHubRepoLicenseResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepositorySubscriptionResponse {
    #[serde(default)]
    pub(super) subscribed: bool,
    #[serde(default)]
    pub(super) ignored: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepoTopicsResponse {
    #[serde(default)]
    pub(super) names: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubContentListItem {
    pub(super) name: String,
    pub(super) path: String,
    #[serde(rename = "type")]
    pub(super) kind: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubContentFileResponse {
    pub(super) name: String,
    pub(super) path: String,
    pub(super) encoding: Option<String>,
    pub(super) content: Option<String>,
    #[serde(default)]
    pub(super) size: Option<u64>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrgResponse {
    pub(super) login: String,
    #[serde(default)]
    pub(super) avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrgMembershipResponse {
    pub(super) state: String,
    pub(super) organization: GitHubOrgResponse,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrganizationMemberResponse {
    pub(super) login: String,
    #[serde(default)]
    pub(super) avatar_url: Option<String>,
    pub(super) html_url: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrganizationProfileResponse {
    pub(super) login: String,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) avatar_url: Option<String>,
    #[serde(default)]
    pub(super) description: Option<String>,
    pub(super) html_url: String,
    #[serde(default)]
    pub(super) location: Option<String>,
    #[serde(default)]
    pub(super) blog: Option<String>,
    #[serde(default)]
    pub(super) email: Option<String>,
    #[serde(default)]
    pub(super) twitter_username: Option<String>,
    #[serde(default)]
    pub(super) followers: u64,
    #[serde(default)]
    pub(super) public_repos: u64,
    #[serde(default)]
    pub(super) total_private_repos: Option<u64>,
    #[serde(default)]
    pub(super) is_verified: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRepositoryVisibilityResponse {
    #[serde(default)]
    pub(super) private: bool,
    #[serde(default)]
    pub(super) visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubLabelResponse {
    pub(super) name: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubAssigneeResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueMilestoneResponse {
    pub(super) number: u64,
    pub(super) title: String,
    #[serde(default)]
    pub(super) state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueResponse {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    pub(super) body: Option<String>,
    pub(super) html_url: String,
    pub(super) updated_at: String,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) user: Option<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) milestone: Option<GitHubIssueMilestoneResponse>,
    #[serde(default)]
    pub(super) comments: u64,
    #[serde(default)]
    pub(super) labels: Vec<GitHubLabelResponse>,
    #[serde(default)]
    pub(super) assignees: Vec<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) pull_request: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) repository: Option<GitHubIssueRepositoryResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueRepositoryResponse {
    pub(super) full_name: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueSearchResponse {
    #[serde(default)]
    pub(super) items: Vec<GitHubIssueResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubNotificationRepositoryResponse {
    pub(super) full_name: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubNotificationSubjectResponse {
    pub(super) title: String,
    #[serde(default)]
    pub(super) url: Option<String>,
    #[serde(default)]
    pub(super) latest_comment_url: Option<String>,
    #[serde(rename = "type")]
    pub(super) kind: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubNotificationResponse {
    pub(super) id: String,
    pub(super) repository: GitHubNotificationRepositoryResponse,
    pub(super) subject: GitHubNotificationSubjectResponse,
    pub(super) reason: String,
    pub(super) updated_at: String,
    #[serde(default)]
    pub(super) unread: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueTimelineResponse {
    #[serde(default)]
    pub(super) id: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) node_id: Option<String>,
    #[serde(default)]
    pub(super) event: Option<String>,
    #[serde(default)]
    pub(super) actor: Option<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) user: Option<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) body: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) created_at: Option<String>,
    #[serde(default)]
    pub(super) updated_at: Option<String>,
    #[serde(default)]
    pub(super) source: Option<GitHubIssueTimelineSourceResponse>,
    #[serde(default)]
    pub(super) commit_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueTimelineSourceResponse {
    #[serde(default)]
    pub(super) issue: Option<GitHubIssueTimelineSourceIssueResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueTimelineSourceIssueResponse {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    pub(super) html_url: String,
    #[serde(default)]
    pub(super) pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubGraphQlResponse<T> {
    pub(super) data: Option<T>,
    #[serde(default)]
    pub(super) errors: Vec<GitHubGraphQlError>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubGraphQlError {
    pub(super) message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubOrganizationGraphQlData {
    pub(super) organization: Option<GitHubOrganizationGraphQlOrganization>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubOrganizationGraphQlOrganization {
    #[serde(default)]
    pub(super) item_showcase: Option<GitHubOrganizationGraphQlItemShowcase>,
    #[serde(default)]
    pub(super) popular_repositories: Option<GitHubOrganizationGraphQlRepositoryConnection>,
    #[serde(default)]
    pub(super) recent_repositories: Option<GitHubOrganizationGraphQlRepositoryConnection>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct GitHubOrganizationGraphQlItemShowcase {
    #[serde(default)]
    pub(super) items: GitHubOrganizationGraphQlRepositoryConnection,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct GitHubOrganizationGraphQlRepositoryConnection {
    #[serde(default)]
    pub(super) nodes: Vec<Option<GitHubOrganizationGraphQlRepository>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubOrganizationGraphQlRepository {
    #[serde(default)]
    pub(super) database_id: Option<u64>,
    pub(super) name: String,
    pub(super) name_with_owner: String,
    #[serde(default)]
    pub(super) is_private: bool,
    pub(super) visibility: String,
    #[serde(default)]
    pub(super) is_disabled: bool,
    #[serde(default)]
    pub(super) is_archived: bool,
    #[serde(default)]
    pub(super) is_fork: bool,
    #[serde(default)]
    pub(super) is_template: bool,
    #[serde(default)]
    pub(super) description: Option<String>,
    #[serde(default)]
    pub(super) default_branch_ref: Option<GitHubOrganizationGraphQlBranch>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) url: String,
    pub(super) owner: GitHubOrganizationGraphQlOwner,
    #[serde(default)]
    pub(super) primary_language: Option<GitHubOrganizationGraphQlLanguage>,
    #[serde(default)]
    pub(super) repository_topics: GitHubOrganizationGraphQlTopicConnection,
    #[serde(default)]
    pub(super) stargazer_count: u64,
    #[serde(default)]
    pub(super) fork_count: u64,
    #[serde(default)]
    pub(super) license_info: Option<GitHubOrganizationGraphQlLicense>,
    #[serde(default)]
    pub(super) viewer_permission: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrganizationGraphQlBranch {
    pub(super) name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubOrganizationGraphQlOwner {
    pub(super) login: String,
    #[serde(default)]
    pub(super) avatar_url: Option<String>,
    #[serde(rename = "__typename", default)]
    pub(super) type_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrganizationGraphQlLanguage {
    pub(super) name: String,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct GitHubOrganizationGraphQlTopicConnection {
    #[serde(default)]
    pub(super) nodes: Vec<Option<GitHubOrganizationGraphQlRepositoryTopic>>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrganizationGraphQlRepositoryTopic {
    pub(super) topic: GitHubOrganizationGraphQlTopic,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubOrganizationGraphQlTopic {
    pub(super) name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubOrganizationGraphQlLicense {
    #[serde(default)]
    pub(super) spdx_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GitHubIssueProjectsGraphQlData {
    pub(super) repository: Option<GitHubIssueProjectsRepository>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueProjectsRepository {
    pub(super) issues: GitHubIssueProjectsConnection,
    #[serde(rename = "pullRequests", default)]
    pub(super) pull_requests: GitHubIssueProjectsConnection,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct GitHubIssueProjectsConnection {
    #[serde(default)]
    pub(super) nodes: Vec<Option<GitHubIssueProjectsNode>>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubIssueProjectsNode {
    pub(super) number: u64,
    #[serde(rename = "projectItems")]
    pub(super) project_items: GitHubProjectItemsConnection,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubProjectItemsConnection {
    #[serde(default)]
    pub(super) nodes: Vec<Option<GitHubProjectItemNode>>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubProjectItemNode {
    pub(super) project: Option<GitHubProjectItemProject>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubProjectItemProject {
    pub(super) id: String,
    pub(super) title: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestUserResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestBranchRefResponse {
    #[serde(rename = "ref")]
    pub(super) branch: String,
    #[serde(default)]
    pub(super) sha: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestResponse {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    #[serde(default)]
    pub(super) draft: bool,
    #[serde(default)]
    pub(super) body: Option<String>,
    #[serde(default)]
    pub(super) labels: Vec<GitHubLabelResponse>,
    #[serde(default)]
    pub(super) assignees: Vec<GitHubAssigneeResponse>,
    #[serde(default)]
    pub(super) milestone: Option<GitHubIssueMilestoneResponse>,
    #[serde(default)]
    pub(super) comments: u64,
    pub(super) html_url: String,
    pub(super) updated_at: String,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) user: Option<GitHubPullRequestUserResponse>,
    pub(super) base: GitHubPullRequestBranchRefResponse,
    pub(super) head: GitHubPullRequestBranchRefResponse,
    #[serde(default)]
    pub(super) merged_at: Option<String>,
    #[serde(default)]
    pub(super) mergeable: Option<bool>,
    #[serde(default)]
    pub(super) mergeable_state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRequestedReviewersResponse {
    #[serde(default)]
    pub(super) users: Vec<GitHubPullRequestUserResponse>,
    #[serde(default)]
    pub(super) teams: Vec<GitHubTeamResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubTeamResponse {
    #[serde(default)]
    pub(super) slug: Option<String>,
    #[serde(default)]
    pub(super) name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestCheckRunsResponse {
    #[serde(default)]
    pub(super) check_runs: Vec<GitHubPullRequestCheckRunResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestReviewResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) user: Option<GitHubPullRequestUserResponse>,
    #[serde(default)]
    pub(super) body: Option<String>,
    pub(super) state: String,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) submitted_at: Option<String>,
    #[serde(default)]
    pub(super) commit_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestReviewCommentResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) user: Option<GitHubPullRequestUserResponse>,
    #[serde(default)]
    pub(super) body: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) path: Option<String>,
    #[serde(default)]
    pub(super) line: Option<u64>,
    #[serde(default)]
    pub(super) original_line: Option<u64>,
    #[serde(default)]
    pub(super) commit_id: Option<String>,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubPullRequestCheckRunResponse {
    pub(super) id: u64,
    pub(super) name: String,
    #[serde(default)]
    pub(super) status: Option<String>,
    #[serde(default)]
    pub(super) conclusion: Option<String>,
    #[serde(default)]
    pub(super) details_url: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) started_at: Option<String>,
    #[serde(default)]
    pub(super) completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowRunsResponse {
    #[serde(default)]
    pub(super) workflow_runs: Vec<GitHubWorkflowRunResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowActorResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowRunResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) display_title: Option<String>,
    #[serde(default)]
    pub(super) status: Option<String>,
    #[serde(default)]
    pub(super) conclusion: Option<String>,
    #[serde(default)]
    pub(super) head_branch: Option<String>,
    #[serde(default)]
    pub(super) event: Option<String>,
    pub(super) html_url: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    #[serde(default)]
    pub(super) actor: Option<GitHubWorkflowActorResponse>,
    #[serde(default)]
    pub(super) head_sha: Option<String>,
    #[serde(default)]
    pub(super) run_number: Option<u64>,
    #[serde(default)]
    pub(super) run_attempt: Option<u64>,
    #[serde(default)]
    pub(super) workflow_id: Option<u64>,
    #[serde(default)]
    pub(super) run_started_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowJobsResponse {
    #[serde(default)]
    pub(super) jobs: Vec<GitHubWorkflowJobResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowJobResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) status: Option<String>,
    #[serde(default)]
    pub(super) conclusion: Option<String>,
    #[serde(default)]
    pub(super) started_at: Option<String>,
    #[serde(default)]
    pub(super) completed_at: Option<String>,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) runner_name: Option<String>,
    #[serde(default)]
    pub(super) steps: Vec<GitHubWorkflowJobStepResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowJobStepResponse {
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) status: Option<String>,
    #[serde(default)]
    pub(super) conclusion: Option<String>,
    #[serde(default)]
    pub(super) number: Option<u64>,
    #[serde(default)]
    pub(super) started_at: Option<String>,
    #[serde(default)]
    pub(super) completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowArtifactsResponse {
    #[serde(default)]
    pub(super) artifacts: Vec<GitHubWorkflowArtifactResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubWorkflowArtifactResponse {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) size_in_bytes: Option<u64>,
    #[serde(default)]
    pub(super) expired: bool,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubReleaseUserResponse {
    pub(super) login: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubReleaseAssetResponse {
    pub(super) id: u64,
    pub(super) name: String,
    #[serde(default)]
    pub(super) label: Option<String>,
    #[serde(default)]
    pub(super) content_type: Option<String>,
    #[serde(default)]
    pub(super) size: u64,
    #[serde(default)]
    pub(super) download_count: u64,
    #[serde(default)]
    pub(super) state: Option<String>,
    pub(super) browser_download_url: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    #[serde(default)]
    pub(super) uploader: Option<GitHubReleaseUserResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubReleaseResponse {
    pub(super) id: u64,
    pub(super) tag_name: String,
    #[serde(default)]
    pub(super) target_commitish: Option<String>,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) body: Option<String>,
    #[serde(default)]
    pub(super) draft: bool,
    #[serde(default)]
    pub(super) prerelease: bool,
    #[serde(default)]
    pub(super) immutable: bool,
    #[serde(default)]
    pub(super) make_latest: Option<String>,
    pub(super) html_url: String,
    pub(super) upload_url: String,
    #[serde(default)]
    pub(super) tarball_url: Option<String>,
    #[serde(default)]
    pub(super) zipball_url: Option<String>,
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) published_at: Option<String>,
    #[serde(default)]
    pub(super) author: Option<GitHubReleaseUserResponse>,
    #[serde(default)]
    pub(super) assets: Vec<GitHubReleaseAssetResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitUserResponse {
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) email: Option<String>,
    #[serde(default)]
    pub(super) date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitPayloadResponse {
    #[serde(default)]
    pub(super) author: Option<GitHubCommitUserResponse>,
    #[serde(default)]
    pub(super) committer: Option<GitHubCommitUserResponse>,
    pub(super) message: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitParentResponse {
    pub(super) sha: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitFileResponse {
    pub(super) filename: String,
    pub(super) status: String,
    #[serde(default)]
    pub(super) previous_filename: Option<String>,
    #[serde(default)]
    pub(super) additions: i32,
    #[serde(default)]
    pub(super) deletions: i32,
    #[serde(default)]
    pub(super) patch: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubCommitResponse {
    pub(super) sha: String,
    pub(super) commit: GitHubCommitPayloadResponse,
    #[serde(default)]
    pub(super) html_url: Option<String>,
    #[serde(default)]
    pub(super) parents: Vec<GitHubCommitParentResponse>,
    #[serde(default)]
    pub(super) files: Vec<GitHubCommitFileResponse>,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubBranchResponse {
    pub(super) name: String,
    #[serde(default)]
    pub(super) protected: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct GitHubRulesetSummaryResponse {
    pub(super) id: u64,
    pub(super) name: String,
    #[serde(default)]
    pub(super) target: String,
    pub(super) enforcement: String,
    pub(super) source_type: String,
    pub(super) source: String,
    #[serde(default)]
    pub(super) created_at: Option<String>,
    #[serde(default)]
    pub(super) updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NormalizedGitHubRepo {
    pub(super) owner: String,
    pub(super) name: String,
    pub(super) full_name: String,
    pub(super) clone_url: String,
}

pub(super) fn client_id() -> Option<&'static str> {
    let trimmed = GITHUB_CLIENT_ID.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub(super) fn client_id_source() -> &'static str {
    if client_id().is_some() {
        "bundled"
    } else {
        "none"
    }
}

pub(super) fn binding_status(binding: Option<GitHubBindingMetadata>) -> GitHubBindingStatus {
    GitHubBindingStatus {
        state: if binding.is_some() {
            "bound".to_string()
        } else {
            "unbound".to_string()
        },
        client_id_configured: client_id().is_some(),
        client_id_source: client_id_source().to_string(),
        binding,
    }
}

pub(super) fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("构造 GitHub HTTP 客户端失败：{e}"))
}

pub(super) fn keyring_entry(login: &str) -> Result<Entry, String> {
    Entry::new(GITHUB_SERVICE, login).map_err(|e| format!("创建 GitHub 凭证项失败：{e}"))
}

pub(super) fn read_token(login: &str) -> Result<Option<String>, String> {
    let entry = keyring_entry(login)?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取 GitHub 凭证失败：{err}")),
    }
}

pub(super) fn write_token(login: &str, token: &str) -> Result<(), String> {
    keyring_entry(login)?
        .set_password(token)
        .map_err(|e| format!("保存 GitHub 凭证失败：{e}"))
}

pub(super) fn normalize_scope_list(scope: Option<&str>) -> Vec<String> {
    scope
        .unwrap_or("")
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .filter(|part| !part.trim().is_empty())
        .map(|part| part.trim().to_string())
        .collect()
}

pub(super) fn github_headers(builder: RequestBuilder, token: Option<&str>) -> RequestBuilder {
    let builder = builder
        .header(USER_AGENT, GITHUB_USER_AGENT)
        .header(ACCEPT, GITHUB_ACCEPT)
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = token {
        builder.bearer_auth(token)
    } else {
        builder
    }
}

pub(super) fn github_oauth_headers(builder: RequestBuilder) -> RequestBuilder {
    builder
        .header(USER_AGENT, GITHUB_USER_AGENT)
        .header(ACCEPT, GITHUB_OAUTH_ACCEPT)
}

pub(super) fn github_http_error(prefix: &str, response: Response) -> String {
    let status = response.status();
    let rate_limited = status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN
            && response
                .headers()
                .get("X-RateLimit-Remaining")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.trim() == "0"));
    let sso = response
        .headers()
        .get("X-GitHub-SSO")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().unwrap_or_default();
    github_http_error_from_parts(prefix, status, &body, sso.as_deref(), rate_limited)
}

fn github_http_error_from_text(prefix: &str, status: StatusCode, body: &str) -> String {
    github_http_error_from_parts(
        prefix,
        status,
        body,
        None,
        status == StatusCode::TOO_MANY_REQUESTS,
    )
}

fn github_http_error_from_parts(
    prefix: &str,
    status: StatusCode,
    body: &str,
    sso: Option<&str>,
    rate_limited: bool,
) -> String {
    let code = if rate_limited {
        Some("github_rate_limited")
    } else if status == StatusCode::UNAUTHORIZED {
        Some("github_authentication_required")
    } else if status == StatusCode::FORBIDDEN && sso.is_some() {
        Some("github_org_sso_required")
    } else if status == StatusCode::FORBIDDEN {
        Some("github_forbidden")
    } else if status == StatusCode::NOT_FOUND {
        Some("github_repository_not_accessible")
    } else {
        None
    };
    let trimmed = body.trim();
    let detail = if let Ok(error) = serde_json::from_str::<GitHubErrorResponse>(trimmed) {
        if let Some(detail) = error
            .error_description
            .or(error.message)
            .or(error.error)
            .filter(|value| !value.trim().is_empty())
        {
            detail
        } else {
            trimmed.chars().take(240).collect::<String>()
        }
    } else {
        trimmed.chars().take(240).collect::<String>()
    };
    let message = if detail.is_empty() {
        format!("{prefix}：HTTP {status}")
    } else {
        format!("{prefix}：HTTP {status}：{detail}")
    };
    if let Some(code) = code {
        format!("{code}：{message}")
    } else {
        message
    }
}

fn github_create_error_signal_text(body: &str) -> String {
    fn collect_strings(value: &serde_json::Value, strings: &mut Vec<String>) {
        match value {
            serde_json::Value::String(value) => strings.push(value.to_ascii_lowercase()),
            serde_json::Value::Array(values) => {
                for value in values {
                    collect_strings(value, strings);
                }
            }
            serde_json::Value::Object(values) => {
                for value in values.values() {
                    collect_strings(value, strings);
                }
            }
            _ => {}
        }
    }

    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return body.to_ascii_lowercase();
    };
    let mut strings = Vec::new();
    collect_strings(&value, &mut strings);
    strings.join(" ")
}

fn github_create_error_is_name_conflict(body: &str) -> bool {
    let signal = github_create_error_signal_text(body);
    if [
        "already exists",
        "already been taken",
        "name exists",
        "repository exists",
    ]
    .iter()
    .any(|pattern| signal.contains(pattern))
    {
        return true;
    }

    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("errors")
                .and_then(|errors| errors.as_array())
                .cloned()
        })
        .is_some_and(|errors| {
            errors.iter().any(|error| {
                let field_is_name = error
                    .get("field")
                    .and_then(|field| field.as_str())
                    .is_some_and(|field| field.eq_ignore_ascii_case("name"));
                let code_is_conflict = error
                    .get("code")
                    .and_then(|code| code.as_str())
                    .is_some_and(|code| {
                        matches!(
                            code.to_ascii_lowercase().as_str(),
                            "already_exists" | "already-exists" | "exists"
                        )
                    });
                field_is_name && code_is_conflict
            })
        })
}

fn github_create_error_is_policy_restricted(body: &str) -> bool {
    let signal = github_create_error_signal_text(body);
    [
        "organization policy",
        "repository creation is disabled",
        "repository creation has been disabled",
        "repository creation is restricted",
        "members are not allowed to create",
        "members cannot create",
        "outside collaborators cannot create",
        "visibility is restricted",
    ]
    .iter()
    .any(|pattern| signal.contains(pattern))
}

fn github_create_repo_error_from_parts(
    prefix: &str,
    status: StatusCode,
    body: &str,
    sso: Option<&str>,
    organization_owner: bool,
) -> String {
    let (code, guidance) = if status == StatusCode::UNAUTHORIZED {
        (
            "github_authentication_required",
            "GitHub 授权已失效，请重新授权后再创建仓库。",
        )
    } else if status == StatusCode::FORBIDDEN && sso.is_some() {
        (
            "github_org_sso_required",
            "组织启用了 SAML SSO，请先为当前 GitHub 授权启用组织访问后重试。",
        )
    } else if status == StatusCode::FORBIDDEN
        && organization_owner
        && !github_create_error_is_policy_restricted(body)
    {
        (
            "github_org_membership_forbidden",
            "当前账号不是可创建仓库的组织成员，或组织未向成员开放创建权限。请确认组织成员身份与仓库创建权限。",
        )
    } else if status == StatusCode::FORBIDDEN {
        (
            "github_repository_policy_restricted",
            "GitHub 或组织策略禁止创建该仓库。请检查仓库创建策略、可见性限制，或联系组织管理员。",
        )
    } else if status == StatusCode::NOT_FOUND {
        (
            "github_owner_not_found",
            "未找到目标 owner，或当前授权无法访问。请检查账号或组织名称与授权范围。",
        )
    } else if status == StatusCode::UNPROCESSABLE_ENTITY
        && github_create_error_is_name_conflict(body)
    {
        (
            "github_repository_name_conflict",
            "目标 owner 下已存在同名仓库，请更换仓库名后重试。",
        )
    } else if status == StatusCode::UNPROCESSABLE_ENTITY
        && github_create_error_is_policy_restricted(body)
    {
        (
            "github_repository_policy_restricted",
            "GitHub 或组织策略禁止创建该仓库。请检查仓库创建策略、可见性限制，或联系组织管理员。",
        )
    } else if status == StatusCode::UNPROCESSABLE_ENTITY {
        (
            "github_repository_invalid",
            "GitHub 拒绝了仓库参数。请检查仓库名、可见性、模板和初始化选项后重试。",
        )
    } else {
        (
            "github_repository_create_failed",
            "GitHub 暂时无法创建仓库，请稍后重试。",
        )
    };
    format!("{code}：{prefix}：HTTP {status}：{guidance}")
}

fn github_create_repo_error(prefix: &str, response: Response, organization_owner: bool) -> String {
    let status = response.status();
    let sso = response
        .headers()
        .get("X-GitHub-SSO")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().unwrap_or_default();
    github_create_repo_error_from_parts(prefix, status, &body, sso.as_deref(), organization_owner)
}

fn github_create_repo_from_response(
    prefix: &str,
    response: Response,
    organization_owner: bool,
) -> Result<GitHubRepoResponse, String> {
    if !response.status().is_success() {
        return Err(github_create_repo_error(
            prefix,
            response,
            organization_owner,
        ));
    }
    response
        .json::<GitHubRepoResponse>()
        .map_err(|error| format!("{prefix}：解析响应失败：{error}"))
}

pub(super) fn github_branch_protection_from_response(
    prefix: &str,
    response: Response,
) -> Result<Option<serde_json::Value>, String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("{prefix}：读取响应失败：{error}"))?;
    if status.is_success() {
        return serde_json::from_str(&body)
            .map(Some)
            .map_err(|error| format!("{prefix}：解析响应失败：{error}"));
    }
    if status == StatusCode::NOT_FOUND {
        let not_protected = serde_json::from_str::<GitHubErrorResponse>(&body)
            .ok()
            .and_then(|error| error.message)
            .is_some_and(|message| message.eq_ignore_ascii_case("Branch not protected"));
        if not_protected {
            return Ok(None);
        }
    }
    Err(github_http_error_from_text(prefix, status, &body))
}

pub(super) fn github_binding_expired_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::UNAUTHORIZED
}

pub(super) fn github_json<T: for<'de> Deserialize<'de>>(
    prefix: &str,
    response: Response,
) -> Result<T, String> {
    if !response.status().is_success() {
        return Err(github_http_error(prefix, response));
    }
    response
        .json::<T>()
        .map_err(|e| format!("{prefix}：解析响应失败：{e}"))
}

pub(super) fn github_graphql_errors_require_read_project(errors: &[GitHubGraphQlError]) -> bool {
    !errors.is_empty()
        && errors.iter().all(|error| {
            let message = error.message.as_str();
            message.contains(GITHUB_READ_PROJECT_SCOPE) && message.contains("scopes")
        })
}

pub(super) fn load_github_project_cache(app: &AppHandle) -> GitHubProjectCache {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(GITHUB_PROJECT_CACHE_KEY))
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub(super) fn save_github_project_cache(
    app: &AppHandle,
    cache: &GitHubProjectCache,
) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开 GitHub 项目缓存失败：{e}"))?;
    store.set(
        GITHUB_PROJECT_CACHE_KEY,
        serde_json::to_value(cache).map_err(|e| e.to_string())?,
    );
    store
        .save()
        .map_err(|e| format!("保存 GitHub 项目缓存失败：{e}"))
}

pub(super) fn github_project_cache_repo_key(repo_full_name: &str) -> Result<String, String> {
    Ok(normalize_github_repo_input(repo_full_name)?
        .full_name
        .to_ascii_lowercase())
}

pub(super) fn github_project_cache_enabled(force_refresh: Option<bool>) -> bool {
    !force_refresh.unwrap_or(false)
}

pub(super) fn update_github_project_repo_cache(
    app: &AppHandle,
    repo_full_name: &str,
    update: impl FnOnce(&mut GitHubProjectRepoCache),
) -> Result<(), String> {
    let key = github_project_cache_repo_key(repo_full_name)?;
    let mut cache = load_github_project_cache(app);
    let repo_cache = cache.repos.entry(key).or_default();
    update(repo_cache);
    save_github_project_cache(app, &cache)
}

pub(super) fn clear_github_project_repo_cache(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<(), String> {
    let key = github_project_cache_repo_key(repo_full_name)?;
    let mut cache = load_github_project_cache(app);
    cache.repos.remove(&key);
    save_github_project_cache(app, &cache)
}

pub(super) fn clear_github_project_issue_cache(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<(), String> {
    update_github_project_repo_cache(app, repo_full_name, |repo_cache| {
        repo_cache.issues.clear();
        repo_cache.issue_discussions.clear();
        repo_cache.issue_filter_metadata = None;
    })
}

pub(super) fn clear_github_project_pull_request_cache(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<(), String> {
    update_github_project_repo_cache(app, repo_full_name, |repo_cache| {
        repo_cache.pull_requests.clear();
        repo_cache.pull_request_discussions.clear();
        repo_cache.pull_request_checks.clear();
    })
}

pub(super) fn clear_github_project_release_cache(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<(), String> {
    update_github_project_repo_cache(app, repo_full_name, |repo_cache| {
        repo_cache.releases = None;
    })
}

pub(super) fn github_issue_cache_key(
    state: Option<&str>,
    per_page: Option<u32>,
    sort: Option<&str>,
    direction: Option<&str>,
    since: Option<&str>,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
    project: Option<&str>,
    query: Option<&str>,
) -> String {
    let issue_state = state.unwrap_or("open");
    let issue_per_page = per_page.unwrap_or(100).clamp(1, 100);
    let issue_sort = match sort {
        Some("updated") => "updated",
        Some("comments") => "comments",
        _ => "created",
    };
    let issue_direction = match direction {
        Some("asc") => "asc",
        _ => "desc",
    };
    let issue_since = since
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let issue_creator = creator
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let issue_assignee = assignee
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let mut issue_labels = labels
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    issue_labels.sort();
    let issue_milestone = milestone
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let issue_project = project
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let issue_query = query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    serde_json::json!({
        "state": issue_state,
        "perPage": issue_per_page,
        "sort": issue_sort,
        "direction": issue_direction,
        "since": issue_since,
        "creator": issue_creator,
        "assignee": issue_assignee,
        "labels": issue_labels,
        "milestone": issue_milestone,
        "project": issue_project,
        "query": issue_query,
    })
    .to_string()
}

pub(super) fn github_pull_request_cache_key(
    state: Option<&str>,
    per_page: Option<u32>,
    sort: Option<&str>,
    direction: Option<&str>,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
    project: Option<&str>,
    review: Option<&str>,
    query: Option<&str>,
) -> String {
    let pull_state = match state {
        Some("closed") => "closed",
        Some("merged") => "merged",
        Some("all") => "all",
        _ => "open",
    };
    let pull_per_page = per_page.unwrap_or(100).clamp(1, 100);
    let pull_sort = match sort {
        Some("created") => "created",
        Some("comments") => "comments",
        _ => "updated",
    };
    let pull_direction = match direction {
        Some("asc") => "asc",
        _ => "desc",
    };
    let pull_creator = creator
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let pull_assignee = assignee
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let mut pull_labels = labels
        .unwrap_or(&[])
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    pull_labels.sort();
    let pull_milestone = milestone
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let pull_project = project
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let pull_review = review
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let pull_query = query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    serde_json::json!({
        "state": pull_state,
        "perPage": pull_per_page,
        "sort": pull_sort,
        "direction": pull_direction,
        "creator": pull_creator,
        "assignee": pull_assignee,
        "labels": pull_labels,
        "milestone": pull_milestone,
        "project": pull_project,
        "review": pull_review,
        "query": pull_query,
    })
    .to_string()
}

pub(super) fn github_workflow_runs_cache_key(per_page: Option<u32>) -> String {
    per_page.unwrap_or(30).clamp(1, 100).to_string()
}

pub(super) fn github_commit_list_cache_key(per_page: Option<u32>, sha: Option<&str>) -> String {
    let commit_per_page = per_page.unwrap_or(100).clamp(1, 100);
    let commit_sha = sha
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    format!("{commit_per_page}|{commit_sha}")
}

pub(super) fn github_require_token(
    app: &AppHandle,
) -> Result<(GitHubBindingMetadata, String), String> {
    let settings = load_settings(app);
    let Some(binding) = settings.github_binding.clone() else {
        return Err("请先绑定 GitHub".to_string());
    };
    let Some(token) = read_token(&binding.login)? else {
        clear_github_binding(app)?;
        return Err("GitHub 绑定已失效，请重新绑定".to_string());
    };
    Ok((binding, token))
}

pub(super) fn github_binding_has_scope(binding: &GitHubBindingMetadata, scope: &str) -> bool {
    binding.scopes.iter().any(|item| item == scope)
}

pub(super) fn github_require_scope(
    binding: &GitHubBindingMetadata,
    scope: &str,
) -> Result<(), String> {
    lilia_github_github::github_require_scope(binding, scope)
}

pub(super) fn github_require_notifications_scope(
    binding: &GitHubBindingMetadata,
) -> Result<(), String> {
    github_require_scope(binding, GITHUB_NOTIFICATIONS_SCOPE)
        .map_err(|message| format!("github_notifications_scope_required：{message}"))
}

pub(super) fn github_send(
    app: &AppHandle,
    prefix: &str,
    builder: RequestBuilder,
) -> Result<Response, String> {
    let response = builder
        .send()
        .map_err(|e| format!("{prefix}：GitHub API 连接失败，请检查网络、代理或系统证书：{e}"))?;
    if github_binding_expired_status(response.status()) {
        clear_github_binding(app)?;
        return Err("GitHub 绑定已失效，请重新绑定".to_string());
    }
    Ok(response)
}

pub(super) fn github_repo_summary_from_response(repo: GitHubRepoResponse) -> GitHubRepoSummary {
    let owner_login = repo.owner.login.clone();
    let owner = GitHubRepositoryOwner {
        login: repo.owner.login,
        kind: github_owner_kind(repo.owner.account_type.as_deref()),
        avatar_url: repo.owner.avatar_url,
    };
    GitHubRepoSummary {
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        owner_login,
        private: repo.private,
        visibility: repo.visibility,
        disabled: repo.disabled,
        archived: repo.archived,
        description: repo.description,
        default_branch: repo.default_branch,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        clone_url: repo.clone_url,
        html_url: repo.html_url,
        fork: repo.fork,
        is_template: repo.is_template,
        language: repo.language,
        topics: repo.topics,
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count,
        license_spdx_id: repo.license.and_then(|license| license.spdx_id),
        owner: Some(owner),
        permissions: repo
            .permissions
            .map(|permissions| GitHubRepositoryPermissions {
                pull: permissions.pull,
                push: permissions.push,
                admin: permissions.admin,
            }),
    }
}

pub(super) fn github_repository_subscription_from_api(
    response: Option<GitHubRepositorySubscriptionResponse>,
) -> GitHubRepositorySubscription {
    let mode = match response {
        Some(response) if response.ignored => GitHubRepositorySubscriptionMode::Ignored,
        Some(response) if response.subscribed => GitHubRepositorySubscriptionMode::Watching,
        Some(_) | None => GitHubRepositorySubscriptionMode::Participating,
    };
    GitHubRepositorySubscription { mode }
}

pub(super) fn github_repository_subscription_payload(
    mode: GitHubRepositorySubscriptionMode,
) -> serde_json::Value {
    match mode {
        GitHubRepositorySubscriptionMode::Watching => {
            serde_json::json!({ "subscribed": true, "ignored": false })
        }
        GitHubRepositorySubscriptionMode::Ignored => {
            serde_json::json!({ "subscribed": false, "ignored": true })
        }
        GitHubRepositorySubscriptionMode::Participating => serde_json::Value::Null,
    }
}

fn github_owner_kind(account_type: Option<&str>) -> GitHubOwnerKind {
    if account_type.is_some_and(|kind| kind.eq_ignore_ascii_case("organization")) {
        GitHubOwnerKind::Organization
    } else {
        GitHubOwnerKind::User
    }
}

pub(super) fn github_repo_templates_from_page(
    repos: Vec<GitHubRepoTemplateResponse>,
    seen: &mut HashSet<String>,
) -> Vec<GitHubRepoTemplate> {
    repos
        .into_iter()
        .filter(|repo| repo.is_template)
        .filter(|repo| seen.insert(repo.full_name.clone()))
        .map(|repo| GitHubRepoTemplate {
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            owner_login: repo.owner.login,
            private: repo.private,
            description: repo.description,
        })
        .collect()
}

pub(super) fn normalize_remote_repo_shortcut(
    mut shortcut: RemoteRepoShortcut,
) -> Result<RemoteRepoShortcut, String> {
    let repo = normalize_github_repo_input(&shortcut.full_name)?;
    shortcut.full_name = repo.full_name;
    shortcut.account_login = normalize_optional_string(shortcut.account_login);
    shortcut.name =
        normalize_optional_string(Some(shortcut.name)).unwrap_or_else(|| repo.name.clone());
    shortcut.default_branch = normalize_optional_string(shortcut.default_branch);
    shortcut.html_url = normalize_optional_string(Some(shortcut.html_url))
        .unwrap_or_else(|| format!("https://github.com/{}", shortcut.full_name));
    shortcut.clone_url =
        normalize_optional_string(Some(shortcut.clone_url)).unwrap_or(repo.clone_url);
    shortcut.canonical_remote_url = Some(format!("https://github.com/{}.git", shortcut.full_name));
    shortcut.opened_at = now_millis();
    Ok(shortcut)
}

pub(super) fn remember_remote_repo_shortcut(
    shortcuts: &mut Vec<RemoteRepoShortcut>,
    shortcut: RemoteRepoShortcut,
) -> Result<(), String> {
    let mut shortcut = normalize_remote_repo_shortcut(shortcut)?;
    let target = normalize_github_repo_input(&shortcut.full_name)?.full_name;
    let target_account = shortcut.account_login.as_deref();
    shortcut.favorite = shortcut.favorite
        || shortcuts.iter().any(|item| {
            let same_account = match (item.account_login.as_deref(), target_account) {
                (Some(current), Some(target)) => current.eq_ignore_ascii_case(target),
                (None, None) => true,
                _ => false,
            };
            same_account
                && item.favorite
                && normalize_github_repo_input(&item.full_name)
                    .map(|repo| repo.full_name.eq_ignore_ascii_case(&target))
                    .unwrap_or(false)
        });
    shortcuts.retain(|item| {
        let same_account = match (item.account_login.as_deref(), target_account) {
            (Some(current), Some(target)) => current.eq_ignore_ascii_case(target),
            (None, None) => true,
            _ => false,
        };
        !same_account
            || normalize_github_repo_input(&item.full_name)
                .map(|repo| !repo.full_name.eq_ignore_ascii_case(&target))
                .unwrap_or(true)
    });
    shortcuts.push(shortcut);
    shortcuts.sort_by(|a, b| {
        b.opened_at
            .cmp(&a.opened_at)
            .then_with(|| a.full_name.cmp(&b.full_name))
    });
    Ok(())
}

pub(super) fn forget_remote_repo_shortcut(
    shortcuts: &mut Vec<RemoteRepoShortcut>,
    full_name: &str,
    account_login: &str,
) -> Result<(), String> {
    let repo = normalize_github_repo_input(full_name)?;
    let target = repo.full_name;
    shortcuts.retain(|item| {
        let same_account = item
            .account_login
            .as_deref()
            .is_some_and(|current| current.eq_ignore_ascii_case(account_login));
        !same_account
            || normalize_github_repo_input(&item.full_name)
                .map(|current| !current.full_name.eq_ignore_ascii_case(&target))
                .unwrap_or(true)
    });
    Ok(())
}

pub(super) fn github_repo_management_from_response(
    repo: GitHubRepoResponse,
    topics: Vec<String>,
) -> GitHubRepoManagement {
    GitHubRepoManagement {
        full_name: repo.full_name,
        name: repo.name,
        description: repo.description,
        homepage: repo.homepage,
        topics,
        private: repo.private,
        visibility: repo.visibility.unwrap_or_else(|| {
            if repo.private {
                "private".to_string()
            } else {
                "public".to_string()
            }
        }),
        default_branch: repo.default_branch.unwrap_or_default(),
        viewer_can_administer: None,
        archived: repo.archived,
        is_template: repo.is_template,
        has_issues: repo.has_issues,
        has_wiki: repo.has_wiki,
        has_projects: repo.has_projects,
        has_discussions: repo.has_discussions,
        has_pull_requests: repo.has_pull_requests,
        pull_request_creation_policy: repo.pull_request_creation_policy,
        allow_merge_commit: repo.allow_merge_commit,
        allow_squash_merge: repo.allow_squash_merge,
        allow_rebase_merge: repo.allow_rebase_merge,
        allow_auto_merge: repo.allow_auto_merge,
        delete_branch_on_merge: repo.delete_branch_on_merge,
        allow_update_branch: repo.allow_update_branch,
        allow_forking: repo.allow_forking,
        web_commit_signoff_required: repo.web_commit_signoff_required,
        squash_merge_commit_title: repo.squash_merge_commit_title,
        squash_merge_commit_message: repo.squash_merge_commit_message,
        merge_commit_title: repo.merge_commit_title,
        merge_commit_message: repo.merge_commit_message,
        security_and_analysis: repo.security_and_analysis,
        stargazers_count: repo.stargazers_count,
        watchers_count: repo.subscribers_count,
        forks_count: repo.forks_count,
        html_url: repo.html_url,
        license: repo.license.map(|license| GitHubRepoLicense {
            key: license.key,
            name: license.name,
            spdx_id: license.spdx_id,
            url: license.url,
        }),
    }
}

fn github_repo_management_from_value(
    prefix: &str,
    value: serde_json::Value,
    topics: Vec<String>,
) -> Result<GitHubRepoManagement, String> {
    let viewer_can_administer = value
        .get("permissions")
        .and_then(|permissions| permissions.get("admin"))
        .and_then(serde_json::Value::as_bool);
    let repo = serde_json::from_value::<GitHubRepoResponse>(value)
        .map_err(|error| format!("{prefix}：解析响应失败：{error}"))?;
    let mut management = github_repo_management_from_response(repo, topics);
    management.viewer_can_administer = viewer_can_administer;
    Ok(management)
}

pub(super) fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn github_repo_api_url(repo_full_name: &str) -> Result<String, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    Ok(format!(
        "https://api.github.com/repos/{}",
        github_api_repo_path(&repo.full_name)
    ))
}

pub(super) fn normalize_github_content_path(path: Option<&str>) -> Result<String, String> {
    let Some(path) = path else {
        return Ok(String::new());
    };
    let trimmed = path.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.contains('\\') {
        return Err("GitHub 文件路径必须使用 / 分隔".to_string());
    }
    let parts = trimmed.split('/').collect::<Vec<_>>();
    if parts
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err("GitHub 文件路径不能包含 . 或 ..".to_string());
    }
    Ok(parts.join("/"))
}

pub(super) fn normalize_github_ref_name(ref_name: Option<&str>) -> Option<String> {
    ref_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn github_repo_contents_api_url(
    repo_full_name: &str,
    path: Option<&str>,
) -> Result<String, String> {
    let path = normalize_github_content_path(path)?;
    let base = format!("{}/contents", github_repo_api_url(repo_full_name)?);
    if path.is_empty() {
        Ok(base)
    } else {
        Ok(format!("{base}/{}", github_api_repo_path(&path)))
    }
}

pub(super) fn sort_repo_file_tree_entries(entries: &mut [RepoFileTreeEntry]) {
    entries.sort_by(|left, right| {
        let left_kind = left.kind == "dir";
        let right_kind = right.kind == "dir";
        right_kind
            .cmp(&left_kind)
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.name.cmp(&right.name))
    });
}

pub(super) fn github_content_items_to_file_entries(
    items: Vec<GitHubContentListItem>,
) -> Vec<RepoFileTreeEntry> {
    let mut entries = items
        .into_iter()
        .filter_map(|item| {
            let kind = match item.kind.as_str() {
                "dir" => "dir",
                "file" | "symlink" => "file",
                _ => return None,
            };
            Some(RepoFileTreeEntry {
                path: item.path,
                name: item.name,
                kind: kind.to_string(),
                has_children: kind == "dir",
            })
        })
        .collect::<Vec<_>>();
    sort_repo_file_tree_entries(&mut entries);
    entries
}

pub(super) fn is_markdown_preview_path(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase()),
        Some(extension) if extension == "md" || extension == "markdown"
    )
}

pub(super) fn decode_github_preview_bytes(
    prefix: &str,
    file: &GitHubContentFileResponse,
) -> Result<Vec<u8>, String> {
    let encoding = file.encoding.as_deref().unwrap_or_default();
    if encoding.to_ascii_lowercase() != "base64" {
        return Err(format!("{prefix}：不支持的文件编码：{encoding}"));
    }
    let encoded = file
        .content
        .as_deref()
        .unwrap_or_default()
        .chars()
        .filter(|value| !value.is_whitespace())
        .collect::<String>();
    STANDARD
        .decode(encoded)
        .map_err(|e| format!("{prefix}：文件解码失败：{e}"))
}

pub(super) fn github_text_content_from_file(
    prefix: &str,
    file: GitHubContentFileResponse,
) -> Result<String, String> {
    let bytes = decode_github_preview_bytes(prefix, &file)?;
    String::from_utf8(bytes).map_err(|e| format!("{prefix}：文件不是 UTF-8 文本：{e}"))
}

pub(super) fn github_file_preview_from_content(
    prefix: &str,
    file: GitHubContentFileResponse,
) -> Result<RepoFilePreview, String> {
    let declared_size = file.size;
    let path = file.path.clone();
    let name = file.name.clone();
    let mime = file_preview_mime(Path::new(&path)).map(str::to_string);
    if declared_size.unwrap_or_default() > MAX_FILE_PREVIEW_BYTES {
        return Ok(RepoFilePreview {
            path,
            name,
            preview_kind: "tooLarge".to_string(),
            content: None,
            data_url: None,
            images: HashMap::new(),
            size: declared_size.unwrap_or_default(),
            mime_type: mime,
            truncated: false,
        });
    }

    let bytes = decode_github_preview_bytes(prefix, &file)?;
    let size = declared_size.unwrap_or(bytes.len() as u64);
    if is_markdown_preview_path(&path) {
        let content = String::from_utf8(bytes)
            .map_err(|e| format!("{prefix}：Markdown 文件不是 UTF-8 文本：{e}"))?;
        return Ok(RepoFilePreview {
            path,
            name,
            preview_kind: "markdown".to_string(),
            content: Some(content),
            data_url: None,
            images: HashMap::new(),
            size,
            mime_type: Some("text/markdown".to_string()),
            truncated: false,
        });
    }

    if let Some(image_mime) = image_mime_for_path(Path::new(&path)) {
        return Ok(RepoFilePreview {
            path,
            name,
            preview_kind: "image".to_string(),
            content: None,
            data_url: Some(format!(
                "data:{image_mime};base64,{}",
                STANDARD.encode(bytes)
            )),
            images: HashMap::new(),
            size,
            mime_type: Some(image_mime.to_string()),
            truncated: false,
        });
    }

    if let Ok(content) = String::from_utf8(bytes) {
        if !content.contains('\0') {
            return Ok(RepoFilePreview {
                path,
                name,
                preview_kind: "text".to_string(),
                content: Some(content),
                data_url: None,
                images: HashMap::new(),
                size,
                mime_type: mime.or_else(|| Some("text/plain".to_string())),
                truncated: false,
            });
        }
    }

    Ok(RepoFilePreview {
        path,
        name,
        preview_kind: "binary".to_string(),
        content: None,
        data_url: None,
        images: HashMap::new(),
        size,
        mime_type: mime,
        truncated: false,
    })
}

pub(super) fn github_repo_topics_api_url(repo_full_name: &str) -> Result<String, String> {
    Ok(format!("{}/topics", github_repo_api_url(repo_full_name)?))
}

pub(super) fn normalize_github_topics(topics: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for topic in topics {
        let topic = topic.trim().trim_start_matches('#').to_ascii_lowercase();
        if topic.is_empty() || normalized.iter().any(|item| item == &topic) {
            continue;
        }
        normalized.push(topic);
    }
    normalized
}

pub(super) fn github_fetch_pull_request_response(
    app: &AppHandle,
    repo_full_name: &str,
    pull_number: u64,
    token: &str,
    prefix: &str,
) -> Result<GitHubPullRequestResponse, String> {
    let client = build_client()?;
    let response = github_send(
        app,
        prefix,
        github_headers(
            client.get(format!(
                "{}/pulls/{pull_number}",
                github_repo_api_url(repo_full_name)?
            )),
            Some(token),
        ),
    )?;
    github_json::<GitHubPullRequestResponse>(prefix, response)
}

pub(super) fn github_fetch_issue_response(
    app: &AppHandle,
    repo_full_name: &str,
    issue_number: u64,
    token: &str,
    prefix: &str,
) -> Result<GitHubIssueResponse, String> {
    let client = build_client()?;
    let response = github_send(
        app,
        prefix,
        github_headers(
            client.get(format!(
                "{}/issues/{issue_number}",
                github_repo_api_url(repo_full_name)?
            )),
            Some(token),
        ),
    )?;
    github_json::<GitHubIssueResponse>(prefix, response)
}

pub(super) fn github_fetch_paginated<T>(
    app: &AppHandle,
    client: &Client,
    token: &str,
    url: String,
    prefix: &str,
) -> Result<Vec<T>, String>
where
    T: serde::de::DeserializeOwned,
{
    let mut page = 1_u32;
    let mut items = Vec::new();
    loop {
        let page_string = page.to_string();
        let response = github_send(
            app,
            prefix,
            github_headers(
                client
                    .get(&url)
                    .query(&[("per_page", "100"), ("page", page_string.as_str())]),
                Some(token),
            ),
        )?;
        let next_page = parse_next_page(
            response
                .headers()
                .get(LINK)
                .and_then(|value| value.to_str().ok()),
        );
        items.extend(github_json::<Vec<T>>(prefix, response)?);
        if let Some(next) = next_page {
            page = next;
        } else {
            break;
        }
    }
    Ok(items)
}

pub(super) fn github_update_repo_settings_payload(
    request: &GitHubUpdateRepoSettingsRequest,
) -> serde_json::Map<String, serde_json::Value> {
    let mut payload = serde_json::Map::new();
    if let Some(value) = normalize_optional_string(request.name.clone()) {
        payload.insert("name".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = request.description.clone() {
        payload.insert("description".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = request.homepage.clone() {
        payload.insert("homepage".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = request.private {
        payload.insert("private".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = normalize_optional_string(request.visibility.clone()) {
        payload.insert("visibility".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = normalize_optional_string(request.default_branch.clone()) {
        payload.insert(
            "default_branch".to_string(),
            serde_json::Value::String(value),
        );
    }
    if let Some(value) = request.archived {
        payload.insert("archived".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.is_template {
        payload.insert("is_template".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.has_issues {
        payload.insert("has_issues".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.has_wiki {
        payload.insert("has_wiki".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.has_projects {
        payload.insert("has_projects".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.has_discussions {
        payload.insert(
            "has_discussions".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.has_pull_requests {
        payload.insert(
            "has_pull_requests".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = normalize_optional_string(request.pull_request_creation_policy.clone()) {
        payload.insert(
            "pull_request_creation_policy".to_string(),
            serde_json::Value::String(value),
        );
    }
    if let Some(value) = request.allow_merge_commit {
        payload.insert(
            "allow_merge_commit".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_squash_merge {
        payload.insert(
            "allow_squash_merge".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_rebase_merge {
        payload.insert(
            "allow_rebase_merge".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_auto_merge {
        payload.insert(
            "allow_auto_merge".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.delete_branch_on_merge {
        payload.insert(
            "delete_branch_on_merge".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_update_branch {
        payload.insert(
            "allow_update_branch".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = request.allow_forking {
        payload.insert("allow_forking".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = request.web_commit_signoff_required {
        payload.insert(
            "web_commit_signoff_required".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    if let Some(value) = normalize_optional_string(request.squash_merge_commit_title.clone()) {
        payload.insert(
            "squash_merge_commit_title".to_string(),
            serde_json::Value::String(value),
        );
    }
    if let Some(value) = normalize_optional_string(request.squash_merge_commit_message.clone()) {
        payload.insert(
            "squash_merge_commit_message".to_string(),
            serde_json::Value::String(value),
        );
    }
    if let Some(value) = normalize_optional_string(request.merge_commit_title.clone()) {
        payload.insert(
            "merge_commit_title".to_string(),
            serde_json::Value::String(value),
        );
    }
    if let Some(value) = normalize_optional_string(request.merge_commit_message.clone()) {
        payload.insert(
            "merge_commit_message".to_string(),
            serde_json::Value::String(value),
        );
    }
    if let Some(value) = request.security_and_analysis.clone() {
        payload.insert("security_and_analysis".to_string(), value);
    }
    payload
}

pub(super) fn github_actions_permissions_payload(
    request: &GitHubRepoActionsPermissionsRequest,
) -> serde_json::Map<String, serde_json::Value> {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "enabled".to_string(),
        serde_json::Value::Bool(request.enabled),
    );
    if let Some(value) = normalize_optional_string(request.allowed_actions.clone()) {
        payload.insert(
            "allowed_actions".to_string(),
            serde_json::Value::String(value),
        );
    }
    if let Some(value) = request.sha_pinning_required {
        payload.insert(
            "sha_pinning_required".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    payload
}

pub(super) fn github_workflow_permissions_payload(
    request: &GitHubRepoWorkflowPermissionsRequest,
) -> serde_json::Map<String, serde_json::Value> {
    let mut payload = serde_json::Map::new();
    if let Some(value) =
        normalize_optional_string(Some(request.default_workflow_permissions.clone()))
    {
        payload.insert(
            "default_workflow_permissions".to_string(),
            serde_json::Value::String(value),
        );
    }
    if let Some(value) = request.can_approve_pull_request_reviews {
        payload.insert(
            "can_approve_pull_request_reviews".to_string(),
            serde_json::Value::Bool(value),
        );
    }
    payload
}

pub(super) fn github_issue_from_response(issue: GitHubIssueResponse) -> Option<GitHubIssue> {
    if issue.pull_request.is_some() {
        return None;
    }
    Some(github_issue_like_from_response(issue))
}

pub(super) fn github_account_issue_item_from_response(
    issue: GitHubIssueResponse,
) -> Option<GitHubAccountIssueItem> {
    let repo_full_name = issue.repository.as_ref()?.full_name.clone();
    let pull_request = issue.pull_request.is_some();
    Some(GitHubAccountIssueItem {
        repo_full_name,
        issue: github_issue_like_from_response(issue),
        pull_request,
    })
}

fn github_pull_request_issue_from_response(issue: GitHubIssueResponse) -> Option<GitHubIssue> {
    if issue.pull_request.is_none() {
        return None;
    }
    Some(github_issue_like_from_response(issue))
}

fn github_issue_like_from_response(issue: GitHubIssueResponse) -> GitHubIssue {
    GitHubIssue {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        body: issue.body,
        labels: issue.labels.into_iter().map(|label| label.name).collect(),
        assignees: issue
            .assignees
            .into_iter()
            .map(|assignee| assignee.login)
            .collect(),
        author: issue.user.map(|user| user.login),
        milestone: issue.milestone.map(|milestone| GitHubIssueMilestone {
            number: milestone.number,
            title: milestone.title,
            state: normalize_optional_string(milestone.state),
        }),
        comments: issue.comments,
        project_items: Vec::new(),
        development_items: Vec::new(),
        html_url: issue.html_url,
        updated_at: issue.updated_at,
        created_at: issue.created_at,
    }
}

pub(super) fn github_pull_request_from_response(
    pull_request: GitHubPullRequestResponse,
) -> GitHubPullRequest {
    GitHubPullRequest {
        number: pull_request.number,
        title: pull_request.title,
        state: pull_request.state,
        draft: pull_request.draft,
        body: pull_request.body,
        labels: pull_request
            .labels
            .into_iter()
            .map(|label| label.name)
            .collect(),
        assignees: pull_request
            .assignees
            .into_iter()
            .map(|assignee| assignee.login)
            .collect(),
        milestone: pull_request
            .milestone
            .map(|milestone| GitHubIssueMilestone {
                number: milestone.number,
                title: milestone.title,
                state: normalize_optional_string(milestone.state),
            }),
        comments: pull_request.comments,
        project_items: Vec::new(),
        reviewers: Vec::new(),
        development_items: Vec::new(),
        commit_count: None,
        html_url: pull_request.html_url,
        updated_at: pull_request.updated_at,
        created_at: pull_request.created_at,
        author: pull_request
            .user
            .map(|user| user.login)
            .unwrap_or_else(|| "unknown".to_string()),
        base_branch: pull_request.base.branch,
        head_branch: pull_request.head.branch,
        merged: pull_request.merged_at.is_some(),
        mergeable: pull_request.mergeable,
        mergeable_state: normalize_optional_string(pull_request.mergeable_state),
    }
}

fn github_pull_request_with_issue_metadata(
    mut pull_request: GitHubPullRequest,
    issue: GitHubIssue,
) -> GitHubPullRequest {
    pull_request.labels = issue.labels;
    pull_request.assignees = issue.assignees;
    pull_request.milestone = issue.milestone;
    pull_request.comments = issue.comments;
    pull_request.project_items = issue.project_items;
    pull_request
}

pub(super) fn github_pull_request_check_from_response(
    check: GitHubPullRequestCheckRunResponse,
) -> GitHubPullRequestCheck {
    GitHubPullRequestCheck {
        id: check.id,
        name: check.name,
        status: normalize_optional_string(check.status).unwrap_or_else(|| "queued".to_string()),
        conclusion: normalize_optional_string(check.conclusion),
        details_url: normalize_optional_string(check.details_url.clone()),
        html_url: normalize_optional_string(check.html_url).or(check.details_url),
        started_at: normalize_optional_string(check.started_at),
        completed_at: normalize_optional_string(check.completed_at),
    }
}

fn github_json_id(value: Option<serde_json::Value>, fallback: &str) -> String {
    match value {
        Some(serde_json::Value::Number(number)) => number.to_string(),
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => value,
        _ => fallback.to_string(),
    }
}

fn github_timeline_item_from_issue(issue: &GitHubIssue) -> GitHubDiscussionTimelineItem {
    GitHubDiscussionTimelineItem {
        id: format!("issue-{}-body", issue.number),
        database_id: None,
        kind: "body".to_string(),
        actor: issue.author.clone(),
        body: issue.body.clone(),
        url: Some(issue.html_url.clone()),
        event: None,
        state: None,
        title: None,
        path: None,
        line: None,
        original_line: None,
        commit_id: None,
        created_at: issue.created_at.clone(),
        updated_at: Some(issue.updated_at.clone()),
    }
}

fn github_timeline_item_from_pull_request(
    pull_request: &GitHubPullRequest,
) -> GitHubDiscussionTimelineItem {
    GitHubDiscussionTimelineItem {
        id: format!("pull-{}-body", pull_request.number),
        database_id: None,
        kind: "body".to_string(),
        actor: Some(pull_request.author.clone()),
        body: pull_request.body.clone(),
        url: Some(pull_request.html_url.clone()),
        event: None,
        state: None,
        title: None,
        path: None,
        line: None,
        original_line: None,
        commit_id: None,
        created_at: pull_request.created_at.clone(),
        updated_at: Some(pull_request.updated_at.clone()),
    }
}

pub(super) fn github_timeline_item_from_response(
    item: GitHubIssueTimelineResponse,
) -> GitHubDiscussionTimelineItem {
    let is_comment = item
        .body
        .as_ref()
        .is_some_and(|body| !body.trim().is_empty());
    let event = normalize_optional_string(item.event);
    let database_id = item.id.as_ref().and_then(|value| value.as_u64());
    let id = item
        .node_id
        .clone()
        .unwrap_or_else(|| github_json_id(item.id.clone(), event.as_deref().unwrap_or("timeline")));
    let actor = item.actor.or(item.user).map(|user| user.login);
    let created_at = item
        .created_at
        .clone()
        .or_else(|| item.updated_at.clone())
        .unwrap_or_default();
    GitHubDiscussionTimelineItem {
        id,
        database_id,
        kind: if is_comment { "comment" } else { "event" }.to_string(),
        actor,
        body: normalize_optional_string(item.body),
        url: normalize_optional_string(item.html_url),
        event: event.clone(),
        state: None,
        title: event.map(|value| github_timeline_event_title(&value)),
        path: None,
        line: None,
        original_line: None,
        commit_id: None,
        created_at,
        updated_at: normalize_optional_string(item.updated_at),
    }
}

pub(super) fn github_review_timeline_item_from_response(
    review: GitHubPullRequestReviewResponse,
) -> GitHubDiscussionTimelineItem {
    let created_at = review.submitted_at.clone().unwrap_or_default();
    GitHubDiscussionTimelineItem {
        id: format!("review-{}", review.id),
        database_id: Some(review.id),
        kind: "review".to_string(),
        actor: review.user.map(|user| user.login),
        body: normalize_optional_string(review.body),
        url: normalize_optional_string(review.html_url),
        event: None,
        state: Some(review.state),
        title: None,
        path: None,
        line: None,
        original_line: None,
        commit_id: normalize_optional_string(review.commit_id),
        created_at,
        updated_at: review.submitted_at,
    }
}

pub(super) fn github_review_comment_timeline_item_from_response(
    comment: GitHubPullRequestReviewCommentResponse,
) -> GitHubDiscussionTimelineItem {
    GitHubDiscussionTimelineItem {
        id: format!("review-comment-{}", comment.id),
        database_id: Some(comment.id),
        kind: "reviewComment".to_string(),
        actor: comment.user.map(|user| user.login),
        body: normalize_optional_string(comment.body),
        url: normalize_optional_string(comment.html_url),
        event: None,
        state: None,
        title: None,
        path: normalize_optional_string(comment.path),
        line: comment.line,
        original_line: comment.original_line,
        commit_id: normalize_optional_string(comment.commit_id),
        created_at: comment.created_at,
        updated_at: normalize_optional_string(comment.updated_at),
    }
}

fn github_timeline_event_title(event: &str) -> String {
    let title = match event {
        "closed" => "关闭了讨论",
        "reopened" => "重新打开讨论",
        "merged" => "合并了 Pull Request",
        "labeled" => "添加了标签",
        "unlabeled" => "移除了标签",
        "assigned" => "分配了负责人",
        "unassigned" => "移除了负责人",
        "milestoned" => "设置了里程碑",
        "demilestoned" => "移除了里程碑",
        "renamed" => "修改了标题",
        "review_requested" => "请求了 Review",
        "review_request_removed" => "移除了 Review 请求",
        "ready_for_review" => "标记为 ready for review",
        "converted_to_draft" => "转换为草稿",
        "referenced" => "引用了该讨论",
        "cross-referenced" => "交叉引用了该讨论",
        "commented" => "发表了评论",
        value => return value.replace('_', " ").replace('-', " "),
    };
    title.to_string()
}

pub(super) fn sort_github_discussion_timeline(items: &mut [GitHubDiscussionTimelineItem]) {
    items.sort_by(|left, right| {
        let left_time = parse_github_datetime(&left.created_at).unwrap_or(0);
        let right_time = parse_github_datetime(&right.created_at).unwrap_or(0);
        left_time
            .cmp(&right_time)
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn github_repo_full_name_from_html_url(html_url: &str) -> Option<String> {
    let path = html_url
        .trim()
        .strip_prefix("https://github.com/")
        .or_else(|| html_url.trim().strip_prefix("http://github.com/"))?;
    let mut parts = path.split('/').filter(|part| !part.trim().is_empty());
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn commit_subject(message: &str) -> String {
    message.lines().next().unwrap_or("").trim().to_string()
}

fn push_unique_development_item(
    items: &mut Vec<GitHubDevelopmentItem>,
    seen: &mut HashSet<String>,
    item: GitHubDevelopmentItem,
) {
    if seen.insert(item.id.clone()) {
        items.push(item);
    }
}

fn github_issue_source_development_item(
    issue: &GitHubIssueTimelineSourceIssueResponse,
) -> GitHubDevelopmentItem {
    let kind = if issue.pull_request.is_some() {
        "pullRequest"
    } else {
        "issue"
    };
    let repository_full_name = github_repo_full_name_from_html_url(&issue.html_url);
    let prefix = if kind == "pullRequest" { "PR" } else { "Issue" };
    GitHubDevelopmentItem {
        id: format!(
            "{kind}:{}:{}",
            repository_full_name
                .clone()
                .unwrap_or_else(|| "unknown".to_string())
                .to_ascii_lowercase(),
            issue.number
        ),
        kind: kind.to_string(),
        label: format!("{prefix} #{} {}", issue.number, issue.title),
        url: Some(issue.html_url.clone()),
        number: Some(issue.number),
        state: Some(issue.state.clone()),
        repository_full_name,
        ref_name: None,
        sha: None,
    }
}

fn github_commit_event_development_item(
    repo_full_name: &str,
    commit_id: &str,
) -> Option<GitHubDevelopmentItem> {
    let sha = normalize_optional_string(Some(commit_id.to_string()))?;
    let short = short_sha(&sha);
    Some(GitHubDevelopmentItem {
        id: format!("commit:{}:{sha}", repo_full_name.to_ascii_lowercase()),
        kind: "commit".to_string(),
        label: format!("Commit {short}"),
        url: Some(format!("https://github.com/{repo_full_name}/commit/{sha}")),
        number: None,
        state: None,
        repository_full_name: Some(repo_full_name.to_string()),
        ref_name: None,
        sha: Some(sha),
    })
}

fn github_commit_development_item(
    repo_full_name: &str,
    commit: &GitHubCommitResponse,
) -> Option<GitHubDevelopmentItem> {
    let sha = normalize_optional_string(Some(commit.sha.clone()))?;
    let subject = commit_subject(&commit.commit.message);
    let short = short_sha(&sha);
    Some(GitHubDevelopmentItem {
        id: format!("commit:{}:{sha}", repo_full_name.to_ascii_lowercase()),
        kind: "commit".to_string(),
        label: if subject.is_empty() {
            format!("Commit {short}")
        } else {
            format!("{short} {subject}")
        },
        url: commit
            .html_url
            .clone()
            .or_else(|| Some(format!("https://github.com/{repo_full_name}/commit/{sha}"))),
        number: None,
        state: None,
        repository_full_name: Some(repo_full_name.to_string()),
        ref_name: None,
        sha: Some(sha),
    })
}

pub(super) fn github_development_items_from_timeline(
    repo_full_name: &str,
    timeline: &[GitHubIssueTimelineResponse],
) -> Vec<GitHubDevelopmentItem> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for item in timeline {
        match item.event.as_deref() {
            Some("cross-referenced") => {
                if let Some(source_issue) = item
                    .source
                    .as_ref()
                    .and_then(|source| source.issue.as_ref())
                {
                    push_unique_development_item(
                        &mut items,
                        &mut seen,
                        github_issue_source_development_item(source_issue),
                    );
                }
            }
            Some("referenced") | Some("closed") | Some("merged") | Some("committed") => {
                if let Some(commit_item) = item
                    .commit_id
                    .as_deref()
                    .and_then(|sha| github_commit_event_development_item(repo_full_name, sha))
                {
                    push_unique_development_item(&mut items, &mut seen, commit_item);
                }
            }
            _ => {}
        }
    }
    items
}

fn push_pull_request_reviewer(
    reviewers: &mut Vec<GitHubPullRequestReviewer>,
    login: String,
    kind: &str,
    state: &str,
) {
    let login = login.trim().to_string();
    if login.is_empty() {
        return;
    }
    if let Some(existing) = reviewers
        .iter_mut()
        .find(|reviewer| reviewer.login == login && reviewer.kind == kind)
    {
        if existing.state == "requested" || state != "requested" {
            existing.state = state.to_string();
        }
        return;
    }
    reviewers.push(GitHubPullRequestReviewer {
        login,
        kind: kind.to_string(),
        state: state.to_string(),
    });
}

pub(super) fn github_pull_request_reviewers_from_requested(
    requested: GitHubRequestedReviewersResponse,
) -> Vec<GitHubPullRequestReviewer> {
    let mut reviewers = Vec::new();
    for user in requested.users {
        push_pull_request_reviewer(&mut reviewers, user.login, "user", "requested");
    }
    for team in requested.teams {
        if let Some(login) = normalize_optional_string(team.slug.or(team.name)) {
            push_pull_request_reviewer(&mut reviewers, login, "team", "requested");
        }
    }
    reviewers
}

pub(super) fn add_pull_request_reviewers_from_reviews(
    reviewers: &mut Vec<GitHubPullRequestReviewer>,
    reviews: &[GitHubPullRequestReviewResponse],
) {
    for review in reviews {
        if let Some(user) = review.user.as_ref() {
            push_pull_request_reviewer(reviewers, user.login.clone(), "user", &review.state);
        }
    }
}

fn fetch_github_pull_request_requested_reviewers(
    app: &AppHandle,
    client: &Client,
    token: &str,
    repo_url: &str,
    pull_number: u64,
) -> Result<Vec<GitHubPullRequestReviewer>, String> {
    let response = github_send(
        app,
        "读取 GitHub Pull Request Reviewers 失败",
        github_headers(
            client.get(format!(
                "{repo_url}/pulls/{pull_number}/requested_reviewers"
            )),
            Some(token),
        ),
    )?;
    let requested = github_json::<GitHubRequestedReviewersResponse>(
        "读取 GitHub Pull Request Reviewers 失败",
        response,
    )?;
    Ok(github_pull_request_reviewers_from_requested(requested))
}

fn github_pull_request_commit_development_items(
    repo_full_name: &str,
    commits: &[GitHubCommitResponse],
) -> Vec<GitHubDevelopmentItem> {
    commits
        .iter()
        .rev()
        .take(3)
        .filter_map(|commit| github_commit_development_item(repo_full_name, commit))
        .collect()
}

pub(super) fn github_issue_labels_param(labels: Option<Vec<String>>) -> Option<String> {
    let labels = labels?
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .collect::<Vec<_>>();
    if labels.is_empty() {
        None
    } else {
        Some(labels.join(","))
    }
}

pub(super) fn github_issue_milestone_param(value: Option<serde_json::Value>) -> Option<String> {
    match value? {
        serde_json::Value::Number(number) => number.as_u64().map(|value| value.to_string()),
        serde_json::Value::String(value) => normalize_optional_string(Some(value)),
        _ => None,
    }
}

fn github_search_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn github_search_qualifier(name: &str, value: &str) -> String {
    if value.chars().any(char::is_whitespace) {
        format!("{name}:\"{}\"", github_search_escape(value))
    } else {
        format!("{name}:{value}")
    }
}

pub(super) fn github_pull_request_search_required(
    state: &str,
    sort: &str,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
    project: Option<&str>,
    review: Option<&str>,
    query: Option<&str>,
) -> bool {
    let has_value = |value: Option<&str>| value.is_some_and(|value| !value.trim().is_empty());
    matches!(state, "closed" | "merged")
        || sort == "comments"
        || [creator, assignee, milestone, project, review, query]
            .into_iter()
            .any(has_value)
        || labels
            .unwrap_or(&[])
            .iter()
            .any(|label| !label.trim().is_empty())
}

fn github_issue_search_query(
    repo_full_name: &str,
    state: &str,
    text: &str,
    since: Option<&str>,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
) -> String {
    let mut parts = vec![
        github_search_qualifier("repo", repo_full_name),
        "is:issue".to_string(),
    ];
    let text = text.trim();
    if !text.is_empty() {
        parts.push(text.to_string());
    }
    if state == "open" || state == "closed" {
        parts.push(github_search_qualifier("state", state));
    }
    if let Some(value) = since.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(format!("updated:>={value}"));
    }
    if let Some(value) = creator.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(github_search_qualifier("author", value));
    }
    if let Some(value) = assignee.map(str::trim).filter(|value| !value.is_empty()) {
        if value == "none" {
            parts.push("no:assignee".to_string());
        } else {
            parts.push(github_search_qualifier("assignee", value));
        }
    }
    for label in labels
        .unwrap_or(&[])
        .iter()
        .map(|label| label.trim())
        .filter(|label| !label.is_empty())
    {
        parts.push(github_search_qualifier("label", label));
    }
    if let Some(value) = milestone.map(str::trim).filter(|value| !value.is_empty()) {
        if value == "none" {
            parts.push("no:milestone".to_string());
        } else {
            parts.push(github_search_qualifier("milestone", value));
        }
    }
    parts.join(" ")
}

pub(super) fn github_pull_request_search_query(
    repo_full_name: &str,
    state: &str,
    text: &str,
    creator: Option<&str>,
    assignee: Option<&str>,
    labels: Option<&[String]>,
    milestone: Option<&str>,
    review: Option<&str>,
) -> String {
    let mut parts = vec![
        github_search_qualifier("repo", repo_full_name),
        "is:pr".to_string(),
    ];
    let text = text.trim();
    if !text.is_empty() {
        parts.push(text.to_string());
    }
    match state {
        "merged" => parts.push("is:merged".to_string()),
        "closed" => {
            parts.push(github_search_qualifier("state", "closed"));
            parts.push("-is:merged".to_string());
        }
        "all" => {}
        _ => parts.push(github_search_qualifier("state", "open")),
    }
    if let Some(value) = creator.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(github_search_qualifier("author", value));
    }
    if let Some(value) = assignee.map(str::trim).filter(|value| !value.is_empty()) {
        if value == "none" {
            parts.push("no:assignee".to_string());
        } else {
            parts.push(github_search_qualifier("assignee", value));
        }
    }
    for label in labels
        .unwrap_or(&[])
        .iter()
        .map(|label| label.trim())
        .filter(|label| !label.is_empty())
    {
        parts.push(github_search_qualifier("label", label));
    }
    if let Some(value) = milestone.map(str::trim).filter(|value| !value.is_empty()) {
        if value == "none" {
            parts.push("no:milestone".to_string());
        } else {
            parts.push(github_search_qualifier("milestone", value));
        }
    }
    if let Some(value) = review.map(str::trim).filter(|value| !value.is_empty()) {
        parts.push(github_search_qualifier("review", value));
    }
    parts.join(" ")
}

pub(super) fn github_issue_project_items_from_graphql(
    data: GitHubIssueProjectsGraphQlData,
) -> std::collections::HashMap<u64, Vec<GitHubIssueProjectItem>> {
    let mut map = std::collections::HashMap::new();
    let Some(repository) = data.repository else {
        return map;
    };
    for issue in repository
        .issues
        .nodes
        .into_iter()
        .chain(repository.pull_requests.nodes.into_iter())
        .flatten()
    {
        let projects = issue
            .project_items
            .nodes
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let project = item.project?;
                Some(GitHubIssueProjectItem {
                    id: project.id,
                    title: project.title,
                })
            })
            .collect::<Vec<_>>();
        map.insert(issue.number, projects);
    }
    map
}

pub(super) fn fetch_github_issue_project_items(
    app: &AppHandle,
    repo_full_name: &str,
    binding: &GitHubBindingMetadata,
    token: &str,
) -> Result<std::collections::HashMap<u64, Vec<GitHubIssueProjectItem>>, String> {
    if !github_binding_has_scope(binding, GITHUB_READ_PROJECT_SCOPE) {
        return Ok(std::collections::HashMap::new());
    }
    let repo = normalize_github_repo_input(repo_full_name)?;
    let client = build_client()?;
    let query = r#"
      query RepoIssueProjects($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          issues(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              number
              projectItems(first: 20) {
                nodes {
                  id
                  project {
                    id
                    title
                  }
                }
              }
            }
          }
          pullRequests(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              number
              projectItems(first: 20) {
                nodes {
                  id
                  project {
                    id
                    title
                  }
                }
              }
            }
          }
        }
      }
    "#;
    let response = github_send(
        app,
        "读取 GitHub Issue Projects 失败",
        github_headers(
            client
                .post("https://api.github.com/graphql")
                .json(&serde_json::json!({
                    "query": query,
                    "variables": {
                        "owner": repo.owner,
                        "name": repo.name,
                    },
                })),
            Some(token),
        ),
    )?;
    let result = github_json::<GitHubGraphQlResponse<GitHubIssueProjectsGraphQlData>>(
        "读取 GitHub Issue Projects 失败",
        response,
    )?;
    if !result.errors.is_empty() {
        if github_graphql_errors_require_read_project(&result.errors) {
            return Ok(std::collections::HashMap::new());
        }
        let detail = result
            .errors
            .into_iter()
            .map(|error| error.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("读取 GitHub Issue Projects 失败：{detail}"));
    }
    let data = result
        .data
        .ok_or_else(|| "读取 GitHub Issue Projects 失败：GraphQL 响应缺少 data".to_string())?;
    Ok(github_issue_project_items_from_graphql(data))
}

pub(super) fn enrich_github_issues_with_projects(
    app: &AppHandle,
    repo_full_name: &str,
    binding: &GitHubBindingMetadata,
    token: &str,
    issues: &mut [GitHubIssue],
) -> Result<(), String> {
    if issues.is_empty() {
        return Ok(());
    }
    let project_items = fetch_github_issue_project_items(app, repo_full_name, binding, token)?;
    for issue in issues {
        issue.project_items = project_items
            .get(&issue.number)
            .cloned()
            .unwrap_or_default();
    }
    Ok(())
}

pub(super) fn github_issue_filter_metadata_from_issues(
    issues: &[GitHubIssue],
) -> GitHubIssueFilterMetadata {
    let mut authors = issues
        .iter()
        .filter_map(|issue| issue.author.clone())
        .filter(|author| !author.trim().is_empty())
        .collect::<Vec<_>>();
    authors.sort();
    authors.dedup();

    let mut labels = issues
        .iter()
        .flat_map(|issue| issue.labels.clone())
        .filter(|label| !label.trim().is_empty())
        .collect::<Vec<_>>();
    labels.sort();
    labels.dedup();

    let mut assignees = issues
        .iter()
        .flat_map(|issue| issue.assignees.clone())
        .filter(|assignee| !assignee.trim().is_empty())
        .collect::<Vec<_>>();
    assignees.sort();
    assignees.dedup();

    let mut milestone_map = std::collections::HashMap::<u64, GitHubIssueMilestone>::new();
    let mut project_map = std::collections::HashMap::<String, GitHubIssueProjectItem>::new();
    for issue in issues {
        if let Some(milestone) = &issue.milestone {
            milestone_map.insert(milestone.number, milestone.clone());
        }
        for project in &issue.project_items {
            project_map.insert(project.id.clone(), project.clone());
        }
    }
    let mut milestones = milestone_map.into_values().collect::<Vec<_>>();
    milestones.sort_by(|left, right| left.title.cmp(&right.title));
    let mut projects = project_map.into_values().collect::<Vec<_>>();
    projects.sort_by(|left, right| left.title.cmp(&right.title));

    GitHubIssueFilterMetadata {
        authors,
        labels,
        assignees,
        milestones,
        projects,
    }
}

fn merge_unique_sorted_strings(left: Vec<String>, right: Vec<String>) -> Vec<String> {
    let mut values = left
        .into_iter()
        .chain(right)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

pub(super) fn github_workflow_run_from_response(
    run: GitHubWorkflowRunResponse,
) -> GitHubWorkflowRun {
    let name = normalize_optional_string(run.name).unwrap_or_else(|| "Workflow".to_string());
    let display_title =
        normalize_optional_string(run.display_title.clone()).unwrap_or_else(|| name.clone());
    GitHubWorkflowRun {
        id: run.id,
        name,
        display_title,
        status: normalize_optional_string(run.status).unwrap_or_else(|| "unknown".to_string()),
        conclusion: normalize_optional_string(run.conclusion),
        branch: normalize_optional_string(run.head_branch).unwrap_or_else(|| "unknown".to_string()),
        event: normalize_optional_string(run.event).unwrap_or_else(|| "unknown".to_string()),
        html_url: run.html_url,
        created_at: run.created_at,
        updated_at: run.updated_at,
        actor: run.actor.map(|actor| actor.login),
        head_sha: normalize_optional_string(run.head_sha),
        run_number: run.run_number,
        run_attempt: run.run_attempt,
        workflow_id: run.workflow_id,
        run_started_at: normalize_optional_string(run.run_started_at),
    }
}

fn github_action_notification_from_response(
    notification: GitHubNotificationResponse,
) -> Option<GitHubActionNotification> {
    let reason = notification.reason.trim().to_string();
    let subject_type = notification.subject.kind.trim().to_string();
    let is_action_notification =
        reason == "ci_activity" || subject_type.to_ascii_lowercase().contains("workflow");
    if !is_action_notification {
        return None;
    }
    Some(GitHubActionNotification {
        id: notification.id,
        repo_full_name: notification.repository.full_name,
        title: notification.subject.title,
        reason,
        subject_type,
        subject_url: normalize_optional_string(notification.subject.url),
        latest_comment_url: normalize_optional_string(notification.subject.latest_comment_url),
        updated_at: notification.updated_at,
        unread: notification.unread,
    })
}

pub(super) fn github_workflow_job_from_response(
    job: GitHubWorkflowJobResponse,
) -> GitHubWorkflowJob {
    GitHubWorkflowJob {
        id: job.id,
        name: normalize_optional_string(job.name).unwrap_or_else(|| "Job".to_string()),
        status: normalize_optional_string(job.status).unwrap_or_else(|| "unknown".to_string()),
        conclusion: normalize_optional_string(job.conclusion),
        started_at: normalize_optional_string(job.started_at),
        completed_at: normalize_optional_string(job.completed_at),
        html_url: normalize_optional_string(job.html_url),
        runner_name: normalize_optional_string(job.runner_name),
        steps: job
            .steps
            .into_iter()
            .enumerate()
            .map(|(index, step)| GitHubWorkflowJobStep {
                name: normalize_optional_string(step.name)
                    .unwrap_or_else(|| format!("Step {}", index + 1)),
                status: normalize_optional_string(step.status)
                    .unwrap_or_else(|| "unknown".to_string()),
                conclusion: normalize_optional_string(step.conclusion),
                number: step.number.unwrap_or((index + 1) as u64),
                started_at: normalize_optional_string(step.started_at),
                completed_at: normalize_optional_string(step.completed_at),
            })
            .collect(),
    }
}

pub(super) fn github_workflow_artifact_from_response(
    artifact: GitHubWorkflowArtifactResponse,
) -> GitHubWorkflowArtifact {
    GitHubWorkflowArtifact {
        id: artifact.id,
        name: normalize_optional_string(artifact.name).unwrap_or_else(|| "artifact".to_string()),
        size_in_bytes: artifact.size_in_bytes.unwrap_or_default(),
        expired: artifact.expired,
        created_at: artifact.created_at,
        expires_at: normalize_optional_string(artifact.expires_at),
    }
}

pub(super) fn github_release_asset_from_response(
    asset: GitHubReleaseAssetResponse,
) -> GitHubReleaseAsset {
    GitHubReleaseAsset {
        id: asset.id,
        name: asset.name,
        label: normalize_optional_string(asset.label),
        content_type: normalize_optional_string(asset.content_type)
            .unwrap_or_else(|| "application/octet-stream".to_string()),
        size: asset.size,
        download_count: asset.download_count,
        state: normalize_optional_string(asset.state).unwrap_or_else(|| "uploaded".to_string()),
        browser_download_url: asset.browser_download_url,
        created_at: asset.created_at,
        updated_at: asset.updated_at,
        uploader: asset.uploader.map(|uploader| uploader.login),
    }
}

pub(super) fn github_release_from_response(release: GitHubReleaseResponse) -> GitHubRelease {
    GitHubRelease {
        id: release.id,
        tag_name: release.tag_name,
        target_commitish: normalize_optional_string(release.target_commitish)
            .unwrap_or_else(|| "main".to_string()),
        name: normalize_optional_string(release.name),
        body: normalize_optional_string(release.body),
        draft: release.draft,
        prerelease: release.prerelease,
        immutable: release.immutable,
        make_latest: normalize_optional_string(release.make_latest),
        html_url: release.html_url,
        upload_url: release.upload_url,
        tarball_url: normalize_optional_string(release.tarball_url),
        zipball_url: normalize_optional_string(release.zipball_url),
        created_at: release.created_at,
        published_at: normalize_optional_string(release.published_at),
        author: release.author.map(|author| author.login),
        assets: release
            .assets
            .into_iter()
            .map(github_release_asset_from_response)
            .collect(),
    }
}

pub(super) fn github_release_upload_base_url(upload_url: &str) -> Result<String, String> {
    let normalized = upload_url
        .split('{')
        .next()
        .unwrap_or(upload_url)
        .trim()
        .to_string();
    if normalized.is_empty() {
        return Err("Release upload URL 为空".to_string());
    }
    Ok(normalized)
}

pub(super) fn github_release_asset_name(file_path: &str) -> Result<String, String> {
    let path = Path::new(file_path);
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return Err("Release asset 文件名不能为空".to_string());
    };
    let name = name.trim();
    if name.is_empty() {
        return Err("Release asset 文件名不能为空".to_string());
    }
    Ok(name.to_string())
}

pub(super) fn github_release_validate_asset_file_size(size: u64) -> Result<(), String> {
    lilia_github_github::github_release_validate_asset_file_size(size)
}

pub(super) fn github_release_asset_bytes(file_path: &str) -> Result<Vec<u8>, String> {
    let metadata =
        fs::metadata(file_path).map_err(|e| format!("读取 Release asset 文件失败：{e}"))?;
    if !metadata.is_file() {
        return Err("Release asset 必须是文件".to_string());
    }
    github_release_validate_asset_file_size(metadata.len())?;
    fs::read(file_path).map_err(|e| format!("读取 Release asset 文件失败：{e}"))
}

fn insert_optional_release_string(
    payload: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<String>,
) {
    if let Some(value) = normalize_optional_string(value) {
        payload.insert(key.to_string(), serde_json::Value::String(value));
    }
}

fn insert_optional_release_bool(
    payload: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<bool>,
) {
    if let Some(value) = value {
        payload.insert(key.to_string(), serde_json::Value::Bool(value));
    }
}

pub(super) fn github_workflow_definition_from_file(
    workflow: GitHubWorkflowResponse,
    ref_name: String,
    file: GitHubContentFileResponse,
) -> Result<Option<GitHubWorkflowDefinition>, String> {
    let Some(path) = normalize_optional_string(workflow.path) else {
        return Ok(None);
    };
    let content = github_text_content_from_file("读取 GitHub Actions workflow 文件失败", file)?;
    Ok(Some(GitHubWorkflowDefinition {
        id: workflow.id,
        path,
        ref_name,
        content,
    }))
}

pub(super) fn github_workflow_definition_for_run(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    repo_api_url: &str,
    repo_full_name: &str,
    token: &str,
    run: &GitHubWorkflowRun,
) -> Result<Option<GitHubWorkflowDefinition>, String> {
    let Some(workflow_id) = run.workflow_id else {
        return Ok(None);
    };
    let Some(ref_name) = normalize_github_ref_name(run.head_sha.as_deref()) else {
        return Ok(None);
    };
    let workflow_response = github_send(
        app,
        "读取 GitHub Actions workflow 失败",
        github_headers(
            client.get(format!("{repo_api_url}/actions/workflows/{workflow_id}")),
            Some(token),
        ),
    )?;
    let workflow = github_json::<GitHubWorkflowResponse>(
        "读取 GitHub Actions workflow 失败",
        workflow_response,
    )?;
    let Some(path) = normalize_optional_string(workflow.path.clone()) else {
        return Ok(None);
    };
    let file_response = github_send(
        app,
        "读取 GitHub Actions workflow 文件失败",
        github_headers(
            client
                .get(github_repo_contents_api_url(repo_full_name, Some(&path))?)
                .query(&[("ref", ref_name.as_str())]),
            Some(token),
        ),
    )?;
    let file = github_json::<GitHubContentFileResponse>(
        "读取 GitHub Actions workflow 文件失败",
        file_response,
    )?;
    github_workflow_definition_from_file(workflow, ref_name, file)
}

pub(super) fn github_artifact_cache_path(repo_full_name: &str, artifact_id: u64) -> PathBuf {
    let safe_repo = repo_full_name
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.') {
                value
            } else {
                '_'
            }
        })
        .collect::<String>();
    std::env::temp_dir()
        .join("lilia-github-actions")
        .join(safe_repo)
        .join(format!("{artifact_id}.zip"))
}

pub(super) fn github_artifact_entry_path(path: &Path) -> Result<String, String> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let normalized = normalized.trim_matches('/').to_string();
    if normalized.is_empty() {
        return Err("artifact 文件路径不能为空".to_string());
    }
    Ok(normalized)
}

pub(super) fn github_artifact_requested_file_path(path: &str) -> Result<String, String> {
    let requested_path = path.trim().replace('\\', "/").trim_matches('/').to_string();
    if requested_path.is_empty()
        || Path::new(&requested_path).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("artifact 文件路径无效".to_string());
    }
    Ok(requested_path)
}

pub(super) fn github_artifact_entry_from_zip_file<R: Read>(
    file: &zip::read::ZipFile<'_, R>,
) -> Result<Option<GitHubWorkflowArtifactEntry>, String> {
    let Some(path) = file.enclosed_name() else {
        return Ok(None);
    };
    let path = github_artifact_entry_path(&path)?;
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&path)
        .to_string();
    Ok(Some(GitHubWorkflowArtifactEntry {
        path,
        name,
        kind: if file.is_dir() { "dir" } else { "file" }.to_string(),
        size: file.size(),
    }))
}

pub(super) fn github_artifact_preview_from_bytes(
    path: String,
    size: u64,
    bytes: Vec<u8>,
) -> RepoFilePreview {
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&path)
        .to_string();
    let preview_path = Path::new(&path);
    let mime = file_preview_mime(preview_path).map(str::to_string);
    if size > MAX_FILE_PREVIEW_BYTES {
        return RepoFilePreview {
            path,
            name,
            preview_kind: "tooLarge".to_string(),
            content: None,
            data_url: None,
            images: HashMap::new(),
            size,
            mime_type: mime,
            truncated: false,
        };
    }
    if is_markdown_preview_path(&path) {
        if let Ok(content) = String::from_utf8(bytes) {
            return RepoFilePreview {
                path,
                name,
                preview_kind: "markdown".to_string(),
                content: Some(content),
                data_url: None,
                images: HashMap::new(),
                size,
                mime_type: Some("text/markdown".to_string()),
                truncated: false,
            };
        }
        return RepoFilePreview {
            path,
            name,
            preview_kind: "binary".to_string(),
            content: None,
            data_url: None,
            images: HashMap::new(),
            size,
            mime_type: Some("text/markdown".to_string()),
            truncated: false,
        };
    }
    if let Some(image_mime) = image_mime_for_path(preview_path) {
        return RepoFilePreview {
            path,
            name,
            preview_kind: "image".to_string(),
            content: None,
            data_url: Some(format!(
                "data:{image_mime};base64,{}",
                STANDARD.encode(bytes)
            )),
            images: HashMap::new(),
            size,
            mime_type: Some(image_mime.to_string()),
            truncated: false,
        };
    }
    if let Ok(content) = String::from_utf8(bytes) {
        if !content.contains('\0') {
            return RepoFilePreview {
                path,
                name,
                preview_kind: "text".to_string(),
                content: Some(content),
                data_url: None,
                images: HashMap::new(),
                size,
                mime_type: mime.or_else(|| Some("text/plain".to_string())),
                truncated: false,
            };
        }
    }
    RepoFilePreview {
        path,
        name,
        preview_kind: "binary".to_string(),
        content: None,
        data_url: None,
        images: HashMap::new(),
        size,
        mime_type: mime,
        truncated: false,
    }
}

pub(super) fn github_artifact_file_bytes_from_zip(
    cache_path: &Path,
    requested_path: &str,
) -> Result<(String, Vec<u8>), String> {
    let requested_path = github_artifact_requested_file_path(requested_path)?;
    let bytes = fs::read(cache_path)
        .map_err(|e| format!("读取 artifact 缓存失败：{}（{e}）", cache_path.display()))?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("读取 artifact ZIP 失败：{e}"))?;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("读取 artifact ZIP 条目失败：{e}"))?;
        let Some(enclosed_name) = file.enclosed_name() else {
            continue;
        };
        let entry_path = github_artifact_entry_path(&enclosed_name)?;
        if entry_path != requested_path {
            continue;
        }
        if file.is_dir() {
            return Err("不能上传 artifact 目录".to_string());
        }
        let size = file.size();
        github_release_validate_asset_file_size(size)?;
        let mut file_bytes = Vec::with_capacity(size as usize);
        file.read_to_end(&mut file_bytes)
            .map_err(|e| format!("读取 artifact 文件失败：{e}"))?;
        if file_bytes.is_empty() {
            return Err("Release asset 文件不能为空".to_string());
        }
        return Ok((entry_path, file_bytes));
    }
    Err("artifact 文件不存在".to_string())
}

pub(super) fn github_commit_summary_from_response(commit: GitHubCommitResponse) -> CommitSummary {
    let author = commit.commit.author.as_ref();
    let subject = commit
        .commit
        .message
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    CommitSummary {
        short_hash: short_github_hash(&commit.sha),
        hash: commit.sha,
        author: author
            .and_then(|item| normalize_optional_string(item.name.clone()))
            .unwrap_or_else(|| "unknown".to_string()),
        author_email: author.and_then(|item| normalize_optional_string(item.email.clone())),
        timestamp: author
            .and_then(|item| item.date.as_deref())
            .and_then(parse_github_datetime)
            .unwrap_or_default(),
        subject,
        parents: commit
            .parents
            .into_iter()
            .map(|parent| parent.sha)
            .collect(),
        refs: Vec::new(),
    }
}

pub(super) fn github_commit_detail_from_response(commit: GitHubCommitResponse) -> CommitDetail {
    let author = commit.commit.author.as_ref();
    let committer = commit.commit.committer.as_ref();
    let mut message_lines = commit.commit.message.lines();
    let subject = message_lines.next().unwrap_or("").trim().to_string();
    let body = message_lines
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    let timestamp = author
        .and_then(|item| item.date.as_deref())
        .and_then(parse_github_datetime)
        .unwrap_or_default();
    CommitDetail {
        short_hash: short_github_hash(&commit.sha),
        hash: commit.sha,
        author: author
            .and_then(|item| normalize_optional_string(item.name.clone()))
            .unwrap_or_else(|| "unknown".to_string()),
        author_email: author.and_then(|item| normalize_optional_string(item.email.clone())),
        committer: committer
            .and_then(|item| normalize_optional_string(item.name.clone()))
            .unwrap_or_else(|| "unknown".to_string()),
        committer_email: committer.and_then(|item| normalize_optional_string(item.email.clone())),
        timestamp,
        subject,
        body,
        parents: commit
            .parents
            .into_iter()
            .map(|parent| parent.sha)
            .collect(),
        refs: Vec::new(),
        files: github_commit_file_changes(commit.files),
    }
}

pub(super) fn github_commit_file_changes(
    files: Vec<GitHubCommitFileResponse>,
) -> Vec<CommitFileChange> {
    let patch_output = files
        .iter()
        .filter_map(github_commit_file_patch_block)
        .collect::<Vec<_>>()
        .join("\n");
    let patches = commit_file_patches(&patch_output);
    files
        .into_iter()
        .map(|file| {
            let path = file.filename;
            let parsed = patches.get(&path);
            CommitFileChange {
                path,
                old_path: file.previous_filename,
                status: github_commit_file_status(&file.status).to_string(),
                additions: file.additions,
                deletions: file.deletions,
                patch: parsed.map(|patch| patch.patch.clone()).unwrap_or_default(),
                hunks: parsed.map(|patch| patch.hunks.clone()).unwrap_or_default(),
            }
        })
        .collect()
}

pub(super) fn github_commit_file_patch_block(file: &GitHubCommitFileResponse) -> Option<String> {
    let patch = file.patch.as_ref()?.trim_end();
    if patch.is_empty() {
        return None;
    }
    let old_path = file.previous_filename.as_deref().unwrap_or(&file.filename);
    let old_header = if file.status == "added" {
        "/dev/null".to_string()
    } else {
        format!("a/{old_path}")
    };
    let new_header = if file.status == "removed" {
        "/dev/null".to_string()
    } else {
        format!("b/{new_path}", new_path = file.filename)
    };
    Some(format!(
        "diff --git a/{old_path} b/{new_path}\n--- {old_header}\n+++ {new_header}\n{patch}",
        new_path = file.filename,
    ))
}

pub(super) fn github_commit_file_status(status: &str) -> &str {
    match status {
        "added" => "added",
        "removed" => "deleted",
        "renamed" => "renamed",
        "copied" => "copied",
        _ => "modified",
    }
}

pub(super) fn short_github_hash(hash: &str) -> String {
    hash.chars().take(7).collect()
}

pub(super) fn parse_github_datetime(value: &str) -> Option<i64> {
    let trimmed = value.trim().trim_end_matches('Z');
    let (date, time) = trimmed.split_once('T')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = date_parts.next()?.parse::<i32>().ok()?;
    let day = date_parts.next()?.parse::<i32>().ok()?;
    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<i64>().ok()?;
    let minute = time_parts.next()?.parse::<i64>().ok()?;
    let second = time_parts.next()?.split('.').next()?.parse::<i64>().ok()?;
    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

pub(super) fn days_from_civil(year: i32, month: i32, day: i32) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = year - i32::from(month <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146_097 + doe - 719_468) as i64)
}

pub(super) fn github_branch_from_response(branch: GitHubBranchResponse) -> BranchSummary {
    BranchSummary {
        name: branch.name,
        remote: true,
        current: false,
        upstream: None,
        ahead: 0,
        behind: 0,
        protected: branch.protected,
        tip_timestamp: None,
        checked_out_worktree_paths: Vec::new(),
    }
}

pub(super) fn github_ruleset_summary_from_response(
    repo_full_name: &str,
    ruleset: GitHubRulesetSummaryResponse,
) -> GitHubRulesetSummary {
    let repository_owned = ruleset.source_type.eq_ignore_ascii_case("Repository")
        && ruleset.source.eq_ignore_ascii_case(repo_full_name);
    GitHubRulesetSummary {
        id: ruleset.id,
        name: ruleset.name,
        target: if ruleset.target.is_empty() {
            "branch".to_string()
        } else {
            ruleset.target
        },
        enforcement: ruleset.enforcement,
        source_type: ruleset.source_type,
        source: ruleset.source,
        repository_owned,
        created_at: ruleset.created_at,
        updated_at: ruleset.updated_at,
    }
}

pub(super) fn github_auth_header(token: &str) -> String {
    lilia_github_github::github_auth_header(token)
}

pub(super) fn normalize_github_repo_input(input: &str) -> Result<NormalizedGitHubRepo, String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("仓库输入不能为空".to_string());
    }

    let path = if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://github.com/") {
        rest
    } else {
        trimmed
    };
    let path = path.trim_end_matches(".git");
    let parts = path
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();

    if parts.len() != 2 {
        return Err("请输入 owner/repo 或 https://github.com/owner/repo.git".to_string());
    }

    let owner = parts[0].trim();
    let name = parts[1].trim();
    if owner.is_empty() || name.is_empty() {
        return Err("请输入 owner/repo 或 https://github.com/owner/repo.git".to_string());
    }

    Ok(NormalizedGitHubRepo {
        owner: owner.to_string(),
        name: name.to_string(),
        full_name: format!("{owner}/{name}"),
        clone_url: format!("https://github.com/{owner}/{name}.git"),
    })
}

pub(super) fn parse_next_page(link: Option<&str>) -> Option<u32> {
    let link = link?;
    for part in link.split(',') {
        if !part.contains("rel=\"next\"") {
            continue;
        }
        let page_part = part.split('?').nth(1)?;
        let query = page_part.split('>').next()?;
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=')?;
            if key == "page" {
                if let Ok(page) = value.parse::<u32>() {
                    return Some(page);
                }
            }
        }
    }
    None
}

pub(super) fn github_api_repo_path(repo_full_name: &str) -> String {
    repo_full_name
        .split('/')
        .map(url_encode_path_segment)
        .collect::<Vec<_>>()
        .join("/")
}

pub(super) fn url_encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

pub(super) fn token_for_binding(app: &AppHandle) -> Result<Option<String>, String> {
    let settings = load_settings(app);
    let Some(binding) = settings.github_binding else {
        return Ok(None);
    };
    read_token(&binding.login)
}

pub fn github_get_binding_status(app: AppHandle) -> Result<GitHubBindingStatus, String> {
    let settings = load_settings(&app);
    if let Some(binding) = settings.github_binding.clone() {
        if read_token(&binding.login)?.is_some() {
            return Ok(binding_status(Some(binding)));
        }
        clear_github_binding(&app)?;
    }
    Ok(binding_status(None))
}

pub async fn github_get_account_profile(app: AppHandle) -> Result<GitHubAccountProfile, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 个人资料",
        move || {
            let (_, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub 个人资料失败",
                github_headers(client.get("https://api.github.com/user"), Some(&token)),
            )?;
            github_json::<GitHubUserResponse>("读取 GitHub 个人资料失败", response).map(Into::into)
        },
    )
    .await
}

pub async fn github_get_account_readme(
    app: AppHandle,
) -> Result<GitHubProfileReadmeSection, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 个人 README",
        move || {
            let (binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let source_repo = format!("{0}/{0}", binding.login);
            Ok(github_readme_section(
                &app,
                &client,
                &token,
                vec![GitHubReadmeSource {
                    source_repo,
                    location: GitHubReadmeLocation::RepositoryReadme,
                    require_public: true,
                }],
                "暂时无法读取个人 README",
            ))
        },
    )
    .await
}

fn github_update_account_profile_payload(
    request: &GitHubUpdateAccountProfileRequest,
) -> serde_json::Value {
    let mut payload = serde_json::Map::from_iter([
        (
            "name".to_string(),
            serde_json::json!(request.name.as_deref().unwrap_or_default()),
        ),
        (
            "email".to_string(),
            serde_json::json!(request.email.as_deref().unwrap_or_default()),
        ),
        (
            "bio".to_string(),
            serde_json::json!(request.bio.as_deref().unwrap_or_default()),
        ),
        (
            "company".to_string(),
            serde_json::json!(request.company.as_deref().unwrap_or_default()),
        ),
        (
            "location".to_string(),
            serde_json::json!(request.location.as_deref().unwrap_or_default()),
        ),
        (
            "blog".to_string(),
            serde_json::json!(request.blog.as_deref().unwrap_or_default()),
        ),
        (
            "twitter_username".to_string(),
            serde_json::json!(request.twitter_username.as_deref()),
        ),
    ]);
    if let Some(hireable) = request.hireable {
        payload.insert("hireable".to_string(), serde_json::json!(hireable));
    }
    serde_json::Value::Object(payload)
}

pub async fn github_update_account_profile(
    app: AppHandle,
    request: GitHubUpdateAccountProfileRequest,
) -> Result<GitHubAccountProfile, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub 个人资料",
        move || {
            let (binding, token) = github_require_token(&app)?;
            github_require_scope(&binding, GITHUB_USER_SCOPE)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "更新 GitHub 个人资料失败",
                github_headers(client.patch("https://api.github.com/user"), Some(&token))
                    .json(&github_update_account_profile_payload(&request)),
            )?;
            github_json::<GitHubUserResponse>("更新 GitHub 个人资料失败", response).map(Into::into)
        },
    )
    .await
}

pub async fn github_start_device_flow(app: AppHandle) -> Result<GitHubDeviceFlowStart, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "启动 GitHub 设备授权",
        move || {
            let Some(client_id) = client_id() else {
                return Err("GitHub Client ID 未配置".to_string());
            };
            let client = build_client()?;
            let response =
                github_oauth_headers(client.post("https://github.com/login/device/code"))
                    .form(&[("client_id", client_id), ("scope", GITHUB_SCOPE)])
                    .send()
                    .map_err(|e| format!("启动 GitHub 设备授权失败：{e}"))?;
            if !response.status().is_success() {
                return Err(github_http_error("启动 GitHub 设备授权失败", response));
            }
            let body = response
                .json::<DeviceCodeResponse>()
                .map_err(|e| format!("解析 GitHub 设备授权响应失败：{e}"))?;
            Ok(GitHubDeviceFlowStart {
                device_code: body.device_code,
                user_code: body.user_code,
                verification_uri: body.verification_uri,
                expires_at: now_millis() + body.expires_in * 1000,
                interval_seconds: body.interval,
            })
        },
    )
    .await
}

pub async fn github_poll_device_flow(
    app: AppHandle,
    device_code: String,
    interval_seconds: Option<i64>,
) -> Result<GitHubDeviceFlowPollResult, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "轮询 GitHub 授权",
        move || {
            let Some(client_id) = client_id() else {
                return Err("GitHub Client ID 未配置".to_string());
            };
            let client = build_client()?;
            let response =
                github_oauth_headers(client.post("https://github.com/login/oauth/access_token"))
                    .form(&[
                        ("client_id", client_id),
                        ("device_code", device_code.trim()),
                        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                    ])
                    .send()
                    .map_err(|e| format!("轮询 GitHub 授权失败：{e}"))?;
            if !response.status().is_success() {
                return Err(github_http_error("轮询 GitHub 授权失败", response));
            }
            let body = response
                .json::<TokenResponse>()
                .map_err(|e| format!("解析 GitHub 授权结果失败：{e}"))?;
            if let Some(token) = body.access_token {
                let user_response =
                    github_headers(client.get("https://api.github.com/user"), Some(&token))
                        .send()
                        .map_err(|e| format!("读取 GitHub 账号信息失败：{e}"))?;
                if !user_response.status().is_success() {
                    return Err(format!(
                        "读取 GitHub 账号信息失败：HTTP {}",
                        user_response.status()
                    ));
                }
                let user = user_response
                    .json::<GitHubUserResponse>()
                    .map_err(|e| format!("解析 GitHub 账号信息失败：{e}"))?;
                write_token(&user.login, &token)?;
                let binding = GitHubBindingMetadata {
                    login: user.login,
                    avatar_url: user.avatar_url,
                    bound_at: now_millis(),
                    scopes: normalize_scope_list(body.scope.as_deref()),
                    client_id_source: client_id_source().to_string(),
                };
                switch_github_binding(&app, binding.clone())?;
                return Ok(GitHubDeviceFlowPollResult {
                    status: "authorized".to_string(),
                    interval_seconds: interval_seconds.unwrap_or(5),
                    binding_status: Some(binding_status(Some(binding))),
                    error: None,
                });
            }

            match body.error.as_deref() {
                Some("authorization_pending") | Some("slow_down") => {
                    Ok(GitHubDeviceFlowPollResult {
                        status: "pending".to_string(),
                        interval_seconds: interval_seconds.unwrap_or(5)
                            + if body.error.as_deref() == Some("slow_down") {
                                5
                            } else {
                                0
                            },
                        binding_status: None,
                        error: None,
                    })
                }
                Some("expired_token") => Ok(GitHubDeviceFlowPollResult {
                    status: "expired".to_string(),
                    interval_seconds: interval_seconds.unwrap_or(5),
                    binding_status: None,
                    error: body.error,
                }),
                _ => Ok(GitHubDeviceFlowPollResult {
                    status: "pending".to_string(),
                    interval_seconds: interval_seconds.unwrap_or(5),
                    binding_status: None,
                    error: body.error,
                }),
            }
        },
    )
    .await
}

pub fn github_unbind(app: AppHandle) -> Result<(), String> {
    clear_github_binding(&app).map(|_| ())
}

fn github_fetch_repo_response_page(
    app: &AppHandle,
    client: &Client,
    token: &str,
    affiliation: &str,
    page: u32,
) -> Result<(Vec<GitHubRepoResponse>, Option<u32>), String> {
    let page_string = page.max(1).to_string();
    let response = github_send(
        app,
        "读取 GitHub 仓库失败",
        github_headers(
            client.get("https://api.github.com/user/repos").query(&[
                ("affiliation", affiliation),
                ("visibility", "all"),
                ("sort", "full_name"),
                ("per_page", "100"),
                ("page", page_string.as_str()),
            ]),
            Some(token),
        ),
    )?;
    let next_page = parse_next_page(
        response
            .headers()
            .get(LINK)
            .and_then(|value| value.to_str().ok()),
    );
    let repos = github_json::<Vec<GitHubRepoResponse>>("读取 GitHub 仓库失败", response)?;
    Ok((repos, next_page))
}

fn github_organization_api_url(owner_login: &str) -> Result<String, String> {
    let login = owner_login.trim();
    if login.is_empty()
        || login.len() > 100
        || !login
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("github_repository_scope_invalid：组织 login 无效".to_string());
    }
    Ok(format!("https://api.github.com/orgs/{login}"))
}

fn github_organization_repos_endpoint(owner_login: &str) -> Result<String, String> {
    Ok(format!(
        "{}/repos",
        github_organization_api_url(owner_login)?
    ))
}

pub(super) fn github_organization_profile_from_response(
    profile: GitHubOrganizationProfileResponse,
) -> GitHubOrganizationProfile {
    GitHubOrganizationProfile {
        login: profile.login,
        name: normalize_optional_string(profile.name),
        avatar_url: normalize_optional_string(profile.avatar_url),
        description: normalize_optional_string(profile.description),
        html_url: profile.html_url,
        location: normalize_optional_string(profile.location),
        website_url: normalize_optional_string(profile.blog),
        email: normalize_optional_string(profile.email),
        twitter_username: normalize_optional_string(profile.twitter_username),
        followers: profile.followers,
        public_repo_count: profile.public_repos,
        total_repo_count: profile
            .total_private_repos
            .map(|private_count| profile.public_repos.saturating_add(private_count)),
        is_verified: profile.is_verified,
    }
}

pub async fn github_get_organization_profile(
    app: AppHandle,
    login: String,
) -> Result<GitHubOrganizationProfile, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 组织资料",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub 组织资料失败",
                github_headers(
                    client.get(github_organization_api_url(&login)?),
                    Some(&token),
                ),
            )?;
            let profile = github_json::<GitHubOrganizationProfileResponse>(
                "读取 GitHub 组织资料失败",
                response,
            )?;
            Ok(github_organization_profile_from_response(profile))
        },
    )
    .await
}

fn github_organization_member_view_available(
    app: &AppHandle,
    client: &Client,
    token: &str,
    login: &str,
) -> bool {
    let endpoint = match github_organization_api_url(login) {
        Ok(endpoint) => endpoint.replacen("/orgs/", "/user/memberships/orgs/", 1),
        Err(_) => return false,
    };
    let response = match github_send(
        app,
        "确认 GitHub 组织成员身份失败",
        github_headers(client.get(endpoint), Some(token)),
    ) {
        Ok(response) => response,
        Err(_) => return false,
    };
    if !response.status().is_success() {
        return false;
    }
    response
        .json::<GitHubOrgMembershipResponse>()
        .ok()
        .is_some_and(|membership| membership.state.eq_ignore_ascii_case("active"))
}

pub(super) fn github_organization_graphql_query(
    view: GitHubOrganizationProfileView,
) -> &'static str {
    const PUBLIC_QUERY: &str = r#"
      query OrganizationOverview($login: String!) {
        organization(login: $login) {
          popularRepositories: repositories(first: 6, privacy: PUBLIC, orderBy: {field: STARGAZERS, direction: DESC}) {
            nodes { ...organizationRepository }
          }
          recentRepositories: repositories(first: 10, privacy: PUBLIC, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes { ...organizationRepository }
          }
        }
      }
      fragment organizationRepository on Repository {
        databaseId name nameWithOwner visibility isPrivate isDisabled isArchived isFork isTemplate
        description createdAt updatedAt url viewerPermission
        defaultBranchRef { name }
        owner { __typename login avatarUrl }
        primaryLanguage { name }
        repositoryTopics(first: 10) { nodes { topic { name } } }
        stargazerCount forkCount licenseInfo { spdxId }
      }
    "#;
    const MEMBER_QUERY: &str = r#"
      query OrganizationOverview($login: String!) {
        organization(login: $login) {
          itemShowcase { items(first: 6) { nodes { ...organizationRepository } } }
          popularRepositories: repositories(first: 6, orderBy: {field: STARGAZERS, direction: DESC}) {
            nodes { ...organizationRepository }
          }
          recentRepositories: repositories(first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes { ...organizationRepository }
          }
        }
      }
      fragment organizationRepository on Repository {
        databaseId name nameWithOwner visibility isPrivate isDisabled isArchived isFork isTemplate
        description createdAt updatedAt url viewerPermission
        defaultBranchRef { name }
        owner { __typename login avatarUrl }
        primaryLanguage { name }
        repositoryTopics(first: 10) { nodes { topic { name } } }
        stargazerCount forkCount licenseInfo { spdxId }
      }
    "#;
    match view {
        GitHubOrganizationProfileView::Public => PUBLIC_QUERY,
        GitHubOrganizationProfileView::Member => MEMBER_QUERY,
    }
}

fn github_organization_graphql(
    app: &AppHandle,
    client: &Client,
    token: &str,
    login: &str,
    view: GitHubOrganizationProfileView,
) -> Result<GitHubOrganizationGraphQlOrganization, String> {
    let response = github_send(
        app,
        "读取 GitHub 组织概览失败",
        github_headers(
            client
                .post("https://api.github.com/graphql")
                .json(&serde_json::json!({
                    "query": github_organization_graphql_query(view),
                    "variables": { "login": login },
                })),
            Some(token),
        ),
    )?;
    let result = github_json::<GitHubGraphQlResponse<GitHubOrganizationGraphQlData>>(
        "读取 GitHub 组织概览失败",
        response,
    )?;
    let organization = result.data.and_then(|data| data.organization);
    if let Some(organization) = organization {
        return Ok(organization);
    }
    Err("读取 GitHub 组织概览失败".to_string())
}

fn github_organization_repository_permissions(
    permission: Option<&str>,
) -> Option<GitHubRepositoryPermissions> {
    permission.map(|permission| {
        let permission = permission.to_ascii_uppercase();
        GitHubRepositoryPermissions {
            pull: matches!(
                permission.as_str(),
                "READ" | "TRIAGE" | "WRITE" | "MAINTAIN" | "ADMIN"
            ),
            push: matches!(permission.as_str(), "WRITE" | "MAINTAIN" | "ADMIN"),
            admin: permission == "ADMIN",
        }
    })
}

fn github_organization_repository_from_graphql(
    repo: GitHubOrganizationGraphQlRepository,
) -> Option<GitHubRepoSummary> {
    let id = repo.database_id?;
    let owner_login = repo.owner.login.clone();
    let owner = GitHubRepositoryOwner {
        login: repo.owner.login,
        kind: github_owner_kind(repo.owner.type_name.as_deref()),
        avatar_url: repo.owner.avatar_url,
    };
    let permissions = github_organization_repository_permissions(repo.viewer_permission.as_deref());
    Some(GitHubRepoSummary {
        id,
        name: repo.name,
        full_name: repo.name_with_owner.clone(),
        owner_login,
        private: repo.is_private,
        visibility: Some(repo.visibility.to_ascii_lowercase()),
        disabled: repo.is_disabled,
        archived: repo.is_archived,
        description: repo.description,
        default_branch: repo.default_branch_ref.map(|branch| branch.name),
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        clone_url: format!("https://github.com/{}.git", repo.name_with_owner),
        html_url: repo.url,
        fork: repo.is_fork,
        is_template: repo.is_template,
        language: repo.primary_language.map(|language| language.name),
        topics: repo
            .repository_topics
            .nodes
            .into_iter()
            .flatten()
            .map(|topic| topic.topic.name)
            .collect(),
        stargazers_count: repo.stargazer_count,
        forks_count: repo.fork_count,
        license_spdx_id: repo.license_info.and_then(|license| license.spdx_id),
        owner: Some(owner),
        permissions,
    })
}

pub(super) fn github_organization_graphql_repositories(
    connection: GitHubOrganizationGraphQlRepositoryConnection,
    view: GitHubOrganizationProfileView,
) -> Vec<GitHubRepoSummary> {
    connection
        .nodes
        .into_iter()
        .flatten()
        .filter(|repo| {
            view == GitHubOrganizationProfileView::Member
                || repo.visibility.eq_ignore_ascii_case("PUBLIC")
        })
        .filter_map(github_organization_repository_from_graphql)
        .collect()
}

const GITHUB_README_IMAGE_LIMIT: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum GitHubReadmeLocation {
    RepositoryReadme,
    Contents(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitHubReadmeSource {
    source_repo: String,
    location: GitHubReadmeLocation,
    require_public: bool,
}

pub(super) fn github_readme_endpoint(
    source_repo: &str,
    location: &GitHubReadmeLocation,
) -> Result<String, String> {
    match location {
        GitHubReadmeLocation::RepositoryReadme => {
            Ok(format!("{}/readme", github_repo_api_url(source_repo)?))
        }
        GitHubReadmeLocation::Contents(path) => {
            github_repo_contents_api_url(source_repo, Some(path))
        }
    }
}

pub(super) fn github_readme_image_path(readme_path: &str, source: &str) -> Option<String> {
    let source = source.split(['?', '#']).next()?.trim().replace('\\', "/");
    let mut parts = if source.starts_with('/') {
        Vec::new()
    } else {
        readme_path
            .split('/')
            .collect::<Vec<_>>()
            .into_iter()
            .take(readme_path.split('/').count().saturating_sub(1))
            .map(str::to_string)
            .collect()
    };
    for part in source.trim_start_matches('/').split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            value => parts.push(value.to_string()),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

pub(super) fn github_readme_image_paths(readme_path: &str, content: &str) -> Vec<(String, String)> {
    readme_image_sources(content)
        .into_iter()
        .take(GITHUB_README_IMAGE_LIMIT)
        .filter_map(|source| {
            github_readme_image_path(readme_path, &source).map(|path| (source, path))
        })
        .collect()
}

fn github_source_repo_is_public(
    app: &AppHandle,
    client: &Client,
    token: &str,
    source_repo: &str,
) -> Result<bool, String> {
    let response = github_send(
        app,
        "确认 GitHub README 可见性失败",
        github_headers(client.get(github_repo_api_url(source_repo)?), Some(token)),
    )?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(false);
    }
    let repository = github_json::<GitHubRepositoryVisibilityResponse>(
        "确认 GitHub README 可见性失败",
        response,
    )?;
    Ok(github_repository_visibility_is_public(&repository))
}

pub(super) fn github_repository_visibility_is_public(
    repository: &GitHubRepositoryVisibilityResponse,
) -> bool {
    !repository.private
        && repository
            .visibility
            .as_deref()
            .is_some_and(|visibility| visibility.eq_ignore_ascii_case("PUBLIC"))
}

fn github_readme_image_data_url(
    app: &AppHandle,
    client: &Client,
    token: &str,
    source_repo: &str,
    path: &str,
) -> Option<String> {
    let endpoint = github_repo_contents_api_url(source_repo, Some(path)).ok()?;
    let response = github_send(
        app,
        "读取 GitHub README 图片失败",
        github_headers(client.get(endpoint), Some(token)),
    )
    .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let file = response.json::<GitHubContentFileResponse>().ok()?;
    github_file_preview_from_content("读取 GitHub README 图片失败", file)
        .ok()?
        .data_url
}

fn github_readme_unavailable(error: &str) -> GitHubProfileReadmeSection {
    GitHubProfileReadmeSection {
        status: GitHubReadmeSectionStatus::Unavailable,
        preview: None,
        source_repo: None,
        html_url: None,
        error: Some(error.to_string()),
    }
}

fn github_readme_section(
    app: &AppHandle,
    client: &Client,
    token: &str,
    sources: Vec<GitHubReadmeSource>,
    unavailable_message: &str,
) -> GitHubProfileReadmeSection {
    for source in sources {
        if source.require_public {
            match github_source_repo_is_public(app, client, token, &source.source_repo) {
                Ok(true) => {}
                Ok(false) => continue,
                Err(_) => return github_readme_unavailable(unavailable_message),
            }
        }
        let endpoint = match github_readme_endpoint(&source.source_repo, &source.location) {
            Ok(endpoint) => endpoint,
            Err(_) => return github_readme_unavailable(unavailable_message),
        };
        let response = match github_send(
            app,
            "读取 GitHub README 失败",
            github_headers(client.get(endpoint), Some(token)),
        ) {
            Ok(response) => response,
            Err(_) => return github_readme_unavailable(unavailable_message),
        };
        if response.status() == StatusCode::NOT_FOUND {
            continue;
        }
        if !response.status().is_success() {
            return github_readme_unavailable(unavailable_message);
        }
        let file = match response.json::<GitHubContentFileResponse>() {
            Ok(file) => file,
            Err(_) => return github_readme_unavailable(unavailable_message),
        };
        let html_url = file.html_url.clone();
        let readme_path = file.path.clone();
        let mut preview = match github_file_preview_from_content("读取 GitHub README 失败", file)
        {
            Ok(preview) => preview,
            Err(_) => return github_readme_unavailable(unavailable_message),
        };
        if let Some(content) = preview.content.as_deref() {
            preview.images = github_readme_image_paths(&readme_path, content)
                .into_iter()
                .filter_map(|(image_source, relative)| {
                    let data_url = github_readme_image_data_url(
                        app,
                        client,
                        token,
                        &source.source_repo,
                        &relative,
                    )?;
                    Some((image_source, data_url))
                })
                .collect();
        }
        return GitHubProfileReadmeSection {
            status: GitHubReadmeSectionStatus::Ready,
            preview: Some(preview),
            source_repo: Some(source.source_repo),
            html_url,
            error: None,
        };
    }
    GitHubProfileReadmeSection {
        status: GitHubReadmeSectionStatus::Empty,
        preview: None,
        source_repo: None,
        html_url: None,
        error: None,
    }
}

fn github_organization_readme(
    app: &AppHandle,
    client: &Client,
    token: &str,
    login: &str,
    view: GitHubOrganizationProfileView,
) -> GitHubProfileReadmeSection {
    let source_repositories = match view {
        GitHubOrganizationProfileView::Public => vec![(format!("{login}/.github"), true)],
        GitHubOrganizationProfileView::Member => vec![
            (format!("{login}/.github-private"), false),
            (format!("{login}/.github"), false),
        ],
    };
    github_readme_section(
        app,
        client,
        token,
        source_repositories
            .into_iter()
            .map(|(source_repo, require_public)| GitHubReadmeSource {
                source_repo,
                location: GitHubReadmeLocation::Contents("profile/README.md".to_string()),
                require_public,
            })
            .collect(),
        "暂时无法读取组织 README",
    )
}

fn github_organization_members(
    app: &AppHandle,
    client: &Client,
    token: &str,
    login: &str,
    view: GitHubOrganizationProfileView,
) -> GitHubOrganizationMembersSection {
    let suffix = match view {
        GitHubOrganizationProfileView::Public => "public_members",
        GitHubOrganizationProfileView::Member => "members",
    };
    let endpoint = match github_organization_api_url(login) {
        Ok(endpoint) => format!("{endpoint}/{suffix}"),
        Err(_) => {
            return GitHubOrganizationMembersSection {
                status: GitHubOrganizationSectionStatus::Unavailable,
                items: Vec::new(),
                total_count: 0,
                error: Some("暂时无法读取组织成员".to_string()),
            }
        }
    };
    let response = match github_send(
        app,
        "读取 GitHub 组织成员失败",
        github_headers(
            client
                .get(endpoint)
                .query(&[("per_page", "100"), ("page", "1")]),
            Some(token),
        ),
    ) {
        Ok(response) => response,
        Err(_) => {
            return GitHubOrganizationMembersSection {
                status: GitHubOrganizationSectionStatus::Unavailable,
                items: Vec::new(),
                total_count: 0,
                error: Some("暂时无法读取组织成员".to_string()),
            }
        }
    };
    if !response.status().is_success() {
        return GitHubOrganizationMembersSection {
            status: GitHubOrganizationSectionStatus::Unavailable,
            items: Vec::new(),
            total_count: 0,
            error: Some("暂时无法读取组织成员".to_string()),
        };
    }
    let members = match response.json::<Vec<GitHubOrganizationMemberResponse>>() {
        Ok(members) => members,
        Err(_) => {
            return GitHubOrganizationMembersSection {
                status: GitHubOrganizationSectionStatus::Unavailable,
                items: Vec::new(),
                total_count: 0,
                error: Some("暂时无法读取组织成员".to_string()),
            }
        }
    };
    let total_count = members.len() as u64;
    let items = members
        .into_iter()
        .take(12)
        .map(|member| GitHubOrganizationMember {
            login: member.login,
            name: None,
            avatar_url: member.avatar_url,
            html_url: member.html_url,
        })
        .collect::<Vec<_>>();
    GitHubOrganizationMembersSection {
        status: if items.is_empty() {
            GitHubOrganizationSectionStatus::Empty
        } else {
            GitHubOrganizationSectionStatus::Ready
        },
        items,
        total_count,
        error: None,
    }
}

pub async fn github_get_organization_overview(
    app: AppHandle,
    login: String,
    view: GitHubOrganizationProfileView,
) -> Result<GitHubOrganizationOverview, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 组织概览",
        move || {
            github_organization_api_url(&login)?;
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let member_view_available =
                github_organization_member_view_available(&app, &client, &token, &login);
            let effective_view =
                if view == GitHubOrganizationProfileView::Member && member_view_available {
                    GitHubOrganizationProfileView::Member
                } else {
                    GitHubOrganizationProfileView::Public
                };
            let readme = github_organization_readme(&app, &client, &token, &login, effective_view);
            let members =
                github_organization_members(&app, &client, &token, &login, effective_view);
            let (featured, recent) =
                match github_organization_graphql(&app, &client, &token, &login, effective_view) {
                    Ok(organization) => {
                        let pinned = if effective_view == GitHubOrganizationProfileView::Member {
                            organization
                                .item_showcase
                                .map(|showcase| {
                                    github_organization_graphql_repositories(
                                        showcase.items,
                                        effective_view,
                                    )
                                })
                                .filter(|items| !items.is_empty())
                        } else {
                            None
                        };
                        let popular = organization.popular_repositories.map(|repositories| {
                            github_organization_graphql_repositories(repositories, effective_view)
                        });
                        let recent_items = organization.recent_repositories.map(|repositories| {
                            github_organization_graphql_repositories(repositories, effective_view)
                        });
                        let featured = if let Some(items) = pinned {
                            GitHubOrganizationFeaturedSection {
                                status: GitHubOrganizationSectionStatus::Ready,
                                source: Some(GitHubOrganizationFeaturedSource::Pinned),
                                items: items.into_iter().take(6).collect(),
                                error: None,
                            }
                        } else if let Some(items) = popular {
                            GitHubOrganizationFeaturedSection {
                                status: if items.is_empty() {
                                    GitHubOrganizationSectionStatus::Empty
                                } else {
                                    GitHubOrganizationSectionStatus::Ready
                                },
                                source: (!items.is_empty())
                                    .then_some(GitHubOrganizationFeaturedSource::Popular),
                                items: items.into_iter().take(6).collect(),
                                error: None,
                            }
                        } else {
                            GitHubOrganizationFeaturedSection {
                                status: GitHubOrganizationSectionStatus::Unavailable,
                                source: None,
                                items: Vec::new(),
                                error: Some("暂时无法读取精选仓库".to_string()),
                            }
                        };
                        let recent = if let Some(items) = recent_items {
                            GitHubOrganizationRepositorySection {
                                status: if items.is_empty() {
                                    GitHubOrganizationSectionStatus::Empty
                                } else {
                                    GitHubOrganizationSectionStatus::Ready
                                },
                                items: items.into_iter().take(10).collect(),
                                error: None,
                            }
                        } else {
                            GitHubOrganizationRepositorySection {
                                status: GitHubOrganizationSectionStatus::Unavailable,
                                items: Vec::new(),
                                error: Some("暂时无法读取近期仓库".to_string()),
                            }
                        };
                        (featured, recent)
                    }
                    Err(_) => (
                        GitHubOrganizationFeaturedSection {
                            status: GitHubOrganizationSectionStatus::Unavailable,
                            source: None,
                            items: Vec::new(),
                            error: Some("暂时无法读取精选仓库".to_string()),
                        },
                        GitHubOrganizationRepositorySection {
                            status: GitHubOrganizationSectionStatus::Unavailable,
                            items: Vec::new(),
                            error: Some("暂时无法读取近期仓库".to_string()),
                        },
                    ),
                };
            Ok(GitHubOrganizationOverview {
                effective_view,
                member_view_available,
                readme,
                featured,
                recent,
                members,
            })
        },
    )
    .await
}

fn github_fetch_organization_repo_page(
    app: &AppHandle,
    client: &Client,
    token: &str,
    owner_login: &str,
    page: u32,
) -> Result<(Vec<GitHubRepoResponse>, Option<u32>), String> {
    let page_string = page.max(1).to_string();
    let endpoint = github_organization_repos_endpoint(owner_login)?;
    let response = github_send(
        app,
        "读取 GitHub 组织仓库失败",
        github_headers(
            client.get(endpoint).query(&[
                ("type", "all"),
                ("sort", "full_name"),
                ("direction", "asc"),
                ("per_page", "100"),
                ("page", page_string.as_str()),
            ]),
            Some(token),
        ),
    )?;
    let next_page = parse_next_page(
        response
            .headers()
            .get(LINK)
            .and_then(|value| value.to_str().ok()),
    );
    let repos = github_json::<Vec<GitHubRepoResponse>>("读取 GitHub 组织仓库失败", response)?;
    Ok((repos, next_page))
}

fn github_fetch_all_accessible_repo_responses(
    app: &AppHandle,
    client: &Client,
    token: &str,
) -> Result<Vec<GitHubRepoResponse>, String> {
    let mut page = 1;
    let mut repos = Vec::new();
    loop {
        let (items, next_page) = github_fetch_repo_response_page(
            app,
            client,
            token,
            "owner,collaborator,organization_member",
            page,
        )?;
        repos.extend(items);
        let Some(next_page) = next_page else {
            break;
        };
        page = next_page;
    }
    Ok(repos)
}

pub async fn github_list_repos(
    app: AppHandle,
    scope: Option<GitHubRepositoryScope>,
    page: Option<u32>,
) -> Result<GitHubRepoPage, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 仓库",
        move || {
            let page = page.unwrap_or(1).max(1);
            let scope = scope.unwrap_or_default();
            let (binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let (repos, next_page) = match &scope {
                GitHubRepositoryScope::All => github_fetch_repo_response_page(
                    &app,
                    &client,
                    &token,
                    "owner,collaborator,organization_member",
                    page,
                )?,
                GitHubRepositoryScope::Personal { login } => {
                    if !login.eq_ignore_ascii_case(&binding.login) {
                        return Err(
                            "github_repository_scope_invalid：个人仓库范围必须是当前认证账号"
                                .to_string(),
                        );
                    }
                    github_fetch_repo_response_page(&app, &client, &token, "owner", page)?
                }
                GitHubRepositoryScope::Organization { login } => {
                    github_fetch_organization_repo_page(&app, &client, &token, login, page)?
                }
            };

            Ok(GitHubRepoPage {
                items: repos
                    .into_iter()
                    .map(github_repo_summary_from_response)
                    .collect(),
                next_page,
                scope,
            })
        },
    )
    .await
}

fn github_repository_subscription_url(repo_full_name: &str) -> Result<String, String> {
    Ok(format!(
        "{}/subscription",
        github_repo_api_url(repo_full_name)?
    ))
}

pub async fn github_list_watched_repos(
    app: AppHandle,
    page: Option<u32>,
) -> Result<GitHubWatchedRepoPage, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取关注仓库",
        move || {
            let page = page.unwrap_or(1).max(1);
            let (binding, token) = github_require_token(&app)?;
            github_require_notifications_scope(&binding)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取关注仓库失败",
                github_headers(
                    client
                        .get("https://api.github.com/user/subscriptions")
                        .query(&[("per_page", 100_u32), ("page", page)]),
                    Some(&token),
                ),
            )?;
            let next_page = parse_next_page(
                response
                    .headers()
                    .get(LINK)
                    .and_then(|value| value.to_str().ok()),
            );
            let repos = github_json::<Vec<GitHubRepoResponse>>("读取关注仓库失败", response)?;
            Ok(GitHubWatchedRepoPage {
                items: repos
                    .into_iter()
                    .map(github_repo_summary_from_response)
                    .collect(),
                next_page,
            })
        },
    )
    .await
}

fn github_get_repo_subscription_sync(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<GitHubRepositorySubscription, String> {
    let (binding, token) = github_require_token(app)?;
    github_require_notifications_scope(&binding)?;
    let client = build_client()?;
    let response = github_send(
        app,
        "读取仓库通知订阅失败",
        github_headers(
            client.get(github_repository_subscription_url(repo_full_name)?),
            Some(&token),
        ),
    )?;

    if response.status() == StatusCode::NOT_FOUND {
        let access_response = github_send(
            app,
            "确认 GitHub 仓库访问权限失败",
            github_headers(
                client.get(github_repo_api_url(repo_full_name)?),
                Some(&token),
            ),
        )?;
        if !access_response.status().is_success() {
            return Err(github_http_error(
                "确认 GitHub 仓库访问权限失败",
                access_response,
            ));
        }
        return Ok(github_repository_subscription_from_api(None));
    }

    let response =
        github_json::<GitHubRepositorySubscriptionResponse>("读取仓库通知订阅失败", response)?;
    Ok(github_repository_subscription_from_api(Some(response)))
}

pub async fn github_get_repo_subscription(
    app: AppHandle,
    repo_full_name: String,
) -> Result<GitHubRepositorySubscription, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取仓库通知订阅",
        move || github_get_repo_subscription_sync(&app, &repo_full_name),
    )
    .await
}

pub async fn github_update_repo_subscription(
    app: AppHandle,
    repo_full_name: String,
    mode: GitHubRepositorySubscriptionMode,
) -> Result<GitHubRepositorySubscription, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新仓库通知订阅",
        move || {
            let (binding, token) = github_require_token(&app)?;
            github_require_notifications_scope(&binding)?;
            let client = build_client()?;
            let url = github_repository_subscription_url(&repo_full_name)?;
            if mode == GitHubRepositorySubscriptionMode::Participating {
                let response = github_send(
                    &app,
                    "更新仓库通知订阅失败",
                    github_headers(client.delete(url), Some(&token)),
                )?;
                if !response.status().is_success() {
                    return Err(github_http_error("更新仓库通知订阅失败", response));
                }
                return Ok(GitHubRepositorySubscription { mode });
            }

            let response = github_send(
                &app,
                "更新仓库通知订阅失败",
                github_headers(
                    client
                        .put(url)
                        .json(&github_repository_subscription_payload(mode)),
                    Some(&token),
                ),
            )?;
            let response = github_json::<GitHubRepositorySubscriptionResponse>(
                "更新仓库通知订阅失败",
                response,
            )?;
            Ok(github_repository_subscription_from_api(Some(response)))
        },
    )
    .await
}

#[derive(Debug, Default)]
struct GitHubMembershipResult {
    memberships: Vec<GitHubOrgMembershipResponse>,
    complete: bool,
    restriction: Option<String>,
    recovery_url: Option<String>,
}

fn github_sso_recovery_url(header: Option<&str>) -> Option<String> {
    header?
        .split([';', ','])
        .map(str::trim)
        .find_map(|part| part.strip_prefix("url="))
        .map(str::trim)
        .filter(|url| url.starts_with("https://github.com/"))
        .map(str::to_string)
}

fn github_membership_restriction(sso_header: Option<&str>) -> &'static str {
    if sso_header.is_some_and(|value| {
        value
            .split([';', ','])
            .any(|part| part.trim().eq_ignore_ascii_case("required"))
    }) {
        "sso_required"
    } else {
        "forbidden"
    }
}

fn github_fetch_active_memberships(
    app: &AppHandle,
    client: &Client,
    token: &str,
) -> Result<GitHubMembershipResult, String> {
    let mut page = 1_u32;
    let mut memberships = Vec::new();
    loop {
        let page_string = page.to_string();
        let response = github_send(
            app,
            "读取 GitHub 组织成员关系失败",
            github_headers(
                client
                    .get("https://api.github.com/user/memberships/orgs")
                    .query(&[
                        ("state", "active"),
                        ("per_page", "100"),
                        ("page", page_string.as_str()),
                    ]),
                Some(token),
            ),
        )?;
        if response.status() == StatusCode::FORBIDDEN {
            let sso_header = response
                .headers()
                .get("x-github-sso")
                .and_then(|value| value.to_str().ok());
            return Ok(GitHubMembershipResult {
                memberships,
                complete: false,
                restriction: Some(github_membership_restriction(sso_header).to_string()),
                recovery_url: github_sso_recovery_url(sso_header),
            });
        }
        let next_page = parse_next_page(
            response
                .headers()
                .get(LINK)
                .and_then(|value| value.to_str().ok()),
        );
        memberships.extend(github_json::<Vec<GitHubOrgMembershipResponse>>(
            "读取 GitHub 组织成员关系失败",
            response,
        )?);
        let Some(next_page) = next_page else {
            break;
        };
        page = next_page;
    }
    Ok(GitHubMembershipResult {
        memberships,
        complete: true,
        restriction: None,
        recovery_url: None,
    })
}

fn merge_github_repo_owner(
    owners: &mut HashMap<String, GitHubRepoOwner>,
    owner: GitHubRepositoryOwner,
    membership_visible: bool,
    repository_access_visible: bool,
) {
    let key = owner.login.to_ascii_lowercase();
    let item = owners.entry(key).or_insert_with(|| GitHubRepoOwner {
        login: owner.login.clone(),
        kind: owner.kind,
        avatar_url: owner.avatar_url.clone(),
        membership_visible: false,
        membership_complete: false,
        membership_restriction: None,
        membership_recovery_url: None,
        repository_access_visible: false,
        source: String::new(),
    });
    if item.avatar_url.is_none() {
        item.avatar_url = owner.avatar_url;
    }
    item.membership_visible |= membership_visible;
    item.repository_access_visible |= repository_access_visible;
    item.source = match (item.membership_visible, item.repository_access_visible) {
        (true, true) => "both",
        (true, false) => "membership",
        (false, true) => "repository_access",
        (false, false) => "repository_access",
    }
    .to_string();
}

pub async fn github_list_repo_owners(app: AppHandle) -> Result<Vec<GitHubRepoOwner>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 仓库 owner",
        move || {
            let (binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let repos = github_fetch_all_accessible_repo_responses(&app, &client, &token)?;
            let mut organizations = HashMap::new();
            for repo in repos {
                let owner = GitHubRepositoryOwner {
                    login: repo.owner.login,
                    kind: github_owner_kind(repo.owner.account_type.as_deref()),
                    avatar_url: repo.owner.avatar_url,
                };
                if owner.kind == GitHubOwnerKind::Organization {
                    merge_github_repo_owner(&mut organizations, owner, false, true);
                }
            }
            let mut membership_result = GitHubMembershipResult {
                restriction: Some("scope_missing".to_string()),
                ..GitHubMembershipResult::default()
            };
            if github_binding_has_scope(&binding, GITHUB_READ_ORG_SCOPE) {
                membership_result = github_fetch_active_memberships(&app, &client, &token)?;
                for membership in &membership_result.memberships {
                    if !membership.state.eq_ignore_ascii_case("active") {
                        continue;
                    }
                    merge_github_repo_owner(
                        &mut organizations,
                        GitHubRepositoryOwner {
                            login: membership.organization.login.clone(),
                            kind: GitHubOwnerKind::Organization,
                            avatar_url: membership.organization.avatar_url.clone(),
                        },
                        true,
                        false,
                    );
                }
            }
            let mut organizations = organizations.into_values().collect::<Vec<_>>();
            for owner in &mut organizations {
                owner.membership_complete = membership_result.complete;
                owner.membership_restriction = membership_result.restriction.clone();
                owner.membership_recovery_url = membership_result.recovery_url.clone();
            }
            organizations.sort_by(|left, right| {
                left.login
                    .to_ascii_lowercase()
                    .cmp(&right.login.to_ascii_lowercase())
            });
            let mut owners = vec![GitHubRepoOwner {
                login: binding.login,
                kind: GitHubOwnerKind::User,
                avatar_url: binding.avatar_url,
                membership_visible: true,
                membership_complete: membership_result.complete,
                membership_restriction: membership_result.restriction,
                membership_recovery_url: membership_result.recovery_url,
                repository_access_visible: true,
                source: "authenticated_user".to_string(),
            }];
            owners.extend(organizations);
            Ok(owners)
        },
    )
    .await
}

#[cfg(test)]
mod repository_scope_tests {
    use super::*;
    use serde_json::json;

    fn repo(owner: &str, owner_kind: &str, id: u64) -> GitHubRepoResponse {
        serde_json::from_value(json!({
            "id": id,
            "name": format!("repo-{id}"),
            "full_name": format!("{owner}/repo-{id}"),
            "private": false,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "clone_url": format!("https://github.com/{owner}/repo-{id}.git"),
            "html_url": format!("https://github.com/{owner}/repo-{id}"),
            "owner": {
                "login": owner,
                "type": owner_kind,
                "avatar_url": "https://avatars.example/owner.png"
            },
            "permissions": { "pull": true, "push": id % 2 == 0, "admin": false }
        }))
        .expect("repository response")
    }

    #[test]
    fn organization_scope_uses_direct_paginated_endpoint() {
        assert_eq!(
            github_organization_repos_endpoint("Example-Org").expect("valid owner"),
            "https://api.github.com/orgs/Example-Org/repos"
        );
    }

    #[test]
    fn organization_scope_rejects_unsafe_owner_path_segments() {
        assert!(github_organization_repos_endpoint("").is_err());
        assert!(github_organization_repos_endpoint("example/../other").is_err());
        assert!(github_organization_repos_endpoint("example?page=2").is_err());
    }

    #[test]
    fn repository_mapping_preserves_owner_kind_avatar_and_permissions() {
        let summary = github_repo_summary_from_response(repo("example-org", "Organization", 2));
        let owner = summary.owner.expect("owner");
        let permissions = summary.permissions.expect("permissions");

        assert_eq!(owner.kind, GitHubOwnerKind::Organization);
        assert_eq!(owner.login, "example-org");
        assert!(owner.avatar_url.is_some());
        assert!(permissions.pull);
        assert!(permissions.push);
        assert!(!permissions.admin);
    }

    #[test]
    fn repository_subscription_mapping_covers_watching_participating_ignored_and_verified_404() {
        let response = |subscribed, ignored| GitHubRepositorySubscriptionResponse {
            subscribed,
            ignored,
        };

        assert_eq!(
            github_repository_subscription_from_api(Some(response(true, false))).mode,
            GitHubRepositorySubscriptionMode::Watching
        );
        assert_eq!(
            github_repository_subscription_from_api(Some(response(false, false))).mode,
            GitHubRepositorySubscriptionMode::Participating
        );
        assert_eq!(
            github_repository_subscription_from_api(Some(response(true, true))).mode,
            GitHubRepositorySubscriptionMode::Ignored
        );
        assert_eq!(
            github_repository_subscription_from_api(None).mode,
            GitHubRepositorySubscriptionMode::Participating
        );
    }

    #[test]
    fn repository_subscription_write_payload_matches_github_api() {
        assert_eq!(
            github_repository_subscription_payload(GitHubRepositorySubscriptionMode::Watching),
            json!({ "subscribed": true, "ignored": false })
        );
        assert_eq!(
            github_repository_subscription_payload(GitHubRepositorySubscriptionMode::Ignored),
            json!({ "subscribed": false, "ignored": true })
        );
        assert!(github_repository_subscription_payload(
            GitHubRepositorySubscriptionMode::Participating
        )
        .is_null());
    }

    #[test]
    fn repository_subscription_requires_notifications_scope() {
        let mut binding = GitHubBindingMetadata {
            login: "lilia-user".to_string(),
            avatar_url: None,
            bound_at: 1,
            scopes: vec!["repo".to_string()],
            client_id_source: "test".to_string(),
        };
        assert!(github_require_notifications_scope(&binding)
            .expect_err("notifications scope should be required")
            .starts_with("github_notifications_scope_required："));

        binding.scopes.push(GITHUB_NOTIFICATIONS_SCOPE.to_string());
        assert!(github_require_notifications_scope(&binding).is_ok());
    }

    #[test]
    fn watched_repository_pagination_uses_next_link() {
        assert_eq!(
            parse_next_page(Some(
                r#"<https://api.github.com/user/subscriptions?per_page=100&page=2>; rel="next", <https://api.github.com/user/subscriptions?per_page=100&page=3>; rel="last""#,
            )),
            Some(2)
        );
    }

    #[test]
    fn owner_sources_merge_membership_and_repository_access() {
        let mut owners = HashMap::new();
        let owner = GitHubRepositoryOwner {
            login: "Example-Org".to_string(),
            kind: GitHubOwnerKind::Organization,
            avatar_url: None,
        };
        merge_github_repo_owner(&mut owners, owner.clone(), false, true);
        merge_github_repo_owner(&mut owners, owner, true, false);

        let merged = owners.get("example-org").expect("merged owner");
        assert!(merged.membership_visible);
        assert!(merged.repository_access_visible);
        assert_eq!(merged.source, "both");
    }

    #[test]
    fn sso_recovery_url_accepts_only_github_https_urls() {
        assert_eq!(
            github_sso_recovery_url(Some("required; url=https://github.com/orgs/example/sso")),
            Some("https://github.com/orgs/example/sso".to_string())
        );
        assert_eq!(
            github_sso_recovery_url(Some("required; url=https://example.test/phishing")),
            None
        );
        assert_eq!(github_sso_recovery_url(Some("required")), None);
        assert_eq!(
            github_membership_restriction(Some(
                "required; url=https://github.com/orgs/example/sso"
            )),
            "sso_required"
        );
        assert_eq!(
            github_membership_restriction(Some("partial-results; organizations=example")),
            "forbidden"
        );
        assert_eq!(github_membership_restriction(None), "forbidden");
    }

    #[test]
    fn oauth_scope_requests_complete_access_once() {
        assert_eq!(
            normalize_scope_list(Some(GITHUB_SCOPE)),
            vec![
                GITHUB_REPO_SCOPE.to_string(),
                "workflow".to_string(),
                GITHUB_USER_SCOPE.to_string(),
                GITHUB_READ_ORG_SCOPE.to_string(),
                GITHUB_DELETE_REPO_SCOPE.to_string(),
                GITHUB_READ_PROJECT_SCOPE.to_string(),
                GITHUB_NOTIFICATIONS_SCOPE.to_string(),
            ]
        );
    }

    #[test]
    fn account_profile_payload_uses_github_names_and_string_clears() {
        let payload = github_update_account_profile_payload(&GitHubUpdateAccountProfileRequest {
            name: None,
            email: Some("public@example.com".to_string()),
            bio: None,
            company: None,
            location: None,
            blog: None,
            twitter_username: None,
            hireable: None,
        });
        assert_eq!(payload["name"], "");
        assert_eq!(payload["email"], "public@example.com");
        assert_eq!(payload["bio"], "");
        assert!(payload.get("twitter_username").unwrap().is_null());
        assert!(payload.get("twitterUsername").is_none());
        assert!(payload.get("hireable").is_none());
    }

    #[test]
    fn github_user_response_maps_all_public_profile_fields() {
        let response: GitHubUserResponse = serde_json::from_value(json!({
            "login": "octocat",
            "avatar_url": "https://avatars.example/octocat.png",
            "name": "The Octocat",
            "email": "octocat@example.com",
            "bio": "GitHub mascot",
            "company": "@github",
            "location": "San Francisco",
            "blog": "https://github.blog",
            "twitter_username": "github",
            "hireable": true
        }))
        .unwrap();
        let profile = GitHubAccountProfile::from(response);
        assert_eq!(profile.login, "octocat");
        assert_eq!(profile.twitter_username.as_deref(), Some("github"));
        assert_eq!(profile.hireable, Some(true));
    }

    #[test]
    fn github_errors_distinguish_authentication_sso_and_forbidden() {
        let body = r#"{"message":"Resource protected"}"#;
        assert!(github_http_error_from_parts(
            "读取失败",
            StatusCode::UNAUTHORIZED,
            body,
            None,
            false
        )
        .starts_with("github_authentication_required："));
        assert!(github_http_error_from_parts(
            "读取失败",
            StatusCode::FORBIDDEN,
            body,
            Some("required; url=https://github.com/orgs/example/sso"),
            false,
        )
        .starts_with("github_org_sso_required："));
        assert!(
            github_http_error_from_parts("读取失败", StatusCode::FORBIDDEN, body, None, false)
                .starts_with("github_forbidden：")
        );
        assert!(
            github_http_error_from_parts("读取失败", StatusCode::FORBIDDEN, body, None, true,)
                .starts_with("github_rate_limited：")
        );
    }

    #[test]
    fn create_repo_errors_distinguish_sso_membership_and_policy() {
        let sso = github_create_repo_error_from_parts(
            "创建失败",
            StatusCode::FORBIDDEN,
            r#"{"message":"Resource protected by organization SAML enforcement"}"#,
            Some("required; url=https://github.com/orgs/example/sso"),
            true,
        );
        assert!(sso.starts_with("github_org_sso_required："));

        let membership = github_create_repo_error_from_parts(
            "创建失败",
            StatusCode::FORBIDDEN,
            r#"{"message":"Forbidden"}"#,
            None,
            true,
        );
        assert!(membership.starts_with("github_org_membership_forbidden："));

        let policy = github_create_repo_error_from_parts(
            "创建失败",
            StatusCode::FORBIDDEN,
            r#"{"message":"Members are not allowed to create repositories"}"#,
            None,
            true,
        );
        assert!(policy.starts_with("github_repository_policy_restricted："));
    }

    #[test]
    fn create_repo_errors_distinguish_owner_name_conflict_policy_and_invalid_input() {
        let owner = github_create_repo_error_from_parts(
            "创建失败",
            StatusCode::NOT_FOUND,
            r#"{"message":"Not Found"}"#,
            None,
            true,
        );
        assert!(owner.starts_with("github_owner_not_found："));

        let conflict = github_create_repo_error_from_parts(
            "创建失败",
            StatusCode::UNPROCESSABLE_ENTITY,
            r#"{"message":"Repository creation failed","errors":[{"resource":"Repository","field":"name","code":"custom","message":"name already exists on this account"}]}"#,
            None,
            true,
        );
        assert!(conflict.starts_with("github_repository_name_conflict："));

        let policy = github_create_repo_error_from_parts(
            "创建失败",
            StatusCode::UNPROCESSABLE_ENTITY,
            r#"{"message":"Repository creation is disabled by organization policy"}"#,
            None,
            true,
        );
        assert!(policy.starts_with("github_repository_policy_restricted："));

        let invalid = github_create_repo_error_from_parts(
            "创建失败",
            StatusCode::UNPROCESSABLE_ENTITY,
            r#"{"message":"Validation Failed","errors":[{"resource":"Repository","field":"name","code":"invalid"}]}"#,
            None,
            false,
        );
        assert!(invalid.starts_with("github_repository_invalid："));
    }

    #[test]
    fn create_repo_errors_never_echo_response_secrets() {
        let secret = "ghp_super-secret-token";
        let error = github_create_repo_error_from_parts(
            "创建失败",
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!(r#"{{"message":"Validation failed: {secret}"}}"#),
            None,
            false,
        );

        assert!(!error.contains(secret));
        assert!(error.contains("请检查仓库名"));
    }
}

pub async fn github_list_repo_templates(app: AppHandle) -> Result<Vec<GitHubRepoTemplate>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 模板仓库",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let mut page = 1_u32;
            let mut templates = Vec::new();
            let mut seen = HashSet::new();
            loop {
                let page_string = page.to_string();
                let response = github_send(
                    &app,
                    "读取 GitHub 模板仓库失败",
                    github_headers(
                        client.get("https://api.github.com/user/repos").query(&[
                            ("affiliation", "owner,organization_member"),
                            ("visibility", "all"),
                            ("sort", "full_name"),
                            ("per_page", "100"),
                            ("page", page_string.as_str()),
                        ]),
                        Some(&token),
                    ),
                )?;
                let next_page = parse_next_page(
                    response
                        .headers()
                        .get(LINK)
                        .and_then(|value| value.to_str().ok()),
                );
                let repos = github_json::<Vec<GitHubRepoTemplateResponse>>(
                    "读取 GitHub 模板仓库失败",
                    response,
                )?;
                templates.extend(github_repo_templates_from_page(repos, &mut seen));
                let Some(next_page) = next_page else {
                    break;
                };
                page = next_page;
            }
            Ok(templates)
        },
    )
    .await
}

pub async fn github_create_repo(
    app: AppHandle,
    request: GitHubCreateRepoRequest,
) -> Result<GitHubRepoSummary, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "创建 GitHub 仓库",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let owner = request.owner.trim();
            let name = request.name.trim();
            if owner.is_empty() || name.is_empty() {
                return Err("owner 和仓库名不能为空".to_string());
            }
            let organization_owner = matches!(request.owner_kind.as_str(), "org" | "organization");
            let template = normalize_optional_string(request.template_full_name.clone())
                .map(|value| normalize_github_repo_input(&value))
                .transpose()?;
            if let Some(template) = template {
                let mut payload = serde_json::json!({
                    "owner": owner,
                    "name": name,
                    "private": request.private,
                    "include_all_branches": request.include_all_branches,
                });
                if let Some(map) = payload.as_object_mut() {
                    if let Some(value) = normalize_optional_string(request.description) {
                        map.insert("description".to_string(), serde_json::Value::String(value));
                    }
                }
                let client = build_client()?;
                let url = format!(
                    "https://api.github.com/repos/{}/{}/generate",
                    url_encode_path_segment(&template.owner),
                    url_encode_path_segment(&template.name)
                );
                let response = github_send(
                    &app,
                    "从模板创建 GitHub 仓库失败",
                    github_headers(client.post(url).json(&payload), Some(&token)),
                )?;
                let repo = github_create_repo_from_response(
                    "从模板创建 GitHub 仓库失败",
                    response,
                    organization_owner,
                )?;
                return Ok(github_repo_summary_from_response(repo));
            }
            let mut payload = serde_json::json!({
                "name": name,
                "private": request.private,
                "auto_init": request.auto_init,
                "has_issues": request.has_issues,
                "has_wiki": request.has_wiki,
            });
            if let Some(map) = payload.as_object_mut() {
                if let Some(value) = normalize_optional_string(request.description) {
                    map.insert("description".to_string(), serde_json::Value::String(value));
                }
                if let Some(value) = normalize_optional_string(request.gitignore_template) {
                    map.insert(
                        "gitignore_template".to_string(),
                        serde_json::Value::String(value),
                    );
                }
                if let Some(value) = normalize_optional_string(request.license_template) {
                    map.insert(
                        "license_template".to_string(),
                        serde_json::Value::String(value),
                    );
                }
            }
            let client = build_client()?;
            let url = if organization_owner {
                format!(
                    "https://api.github.com/orgs/{}/repos",
                    url_encode_path_segment(owner)
                )
            } else {
                "https://api.github.com/user/repos".to_string()
            };
            let response = github_send(
                &app,
                "创建 GitHub 仓库失败",
                github_headers(client.post(url).json(&payload), Some(&token)),
            )?;
            let repo = github_create_repo_from_response(
                "创建 GitHub 仓库失败",
                response,
                organization_owner,
            )?;
            Ok(github_repo_summary_from_response(repo))
        },
    )
    .await
}

fn fetch_github_repo_management(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<GitHubRepoManagement, String> {
    let (_binding, token) = github_require_token(app)?;
    let client = build_client()?;
    let repo_url = github_repo_api_url(repo_full_name)?;
    let response = github_send(
        app,
        "读取 GitHub 仓库设置失败",
        github_headers(client.get(&repo_url), Some(&token)),
    )?;
    let repo = github_json::<serde_json::Value>("读取 GitHub 仓库设置失败", response)?;
    let topics_response = github_send(
        app,
        "读取 GitHub 仓库 topics 失败",
        github_headers(
            client.get(github_repo_topics_api_url(repo_full_name)?),
            Some(&token),
        ),
    )?;
    let topics =
        github_json::<GitHubRepoTopicsResponse>("读取 GitHub 仓库 topics 失败", topics_response)?;
    github_repo_management_from_value("读取 GitHub 仓库设置失败", repo, topics.names)
}

pub async fn github_get_repo_management(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<GitHubRepoManagement, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 仓库设置",
        move || {
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| repo_cache.management.clone())
                {
                    return Ok(cached);
                }
            }
            let next = fetch_github_repo_management(&app, &repo_full_name)?;
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache.management = Some(next.clone());
            })?;
            Ok(next)
        },
    )
    .await
}

pub async fn github_update_repo_settings(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubUpdateRepoSettingsRequest,
) -> Result<GitHubRepoManagement, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub 仓库设置",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let payload = github_update_repo_settings_payload(&request);
            let client = build_client()?;
            let repo_url = github_repo_api_url(&repo_full_name)?;
            let repo = if payload.is_empty() {
                let response = github_send(
                    &app,
                    "读取 GitHub 仓库设置失败",
                    github_headers(client.get(&repo_url), Some(&token)),
                )?;
                github_json::<serde_json::Value>("读取 GitHub 仓库设置失败", response)?
            } else {
                let response = github_send(
                    &app,
                    "更新 GitHub 仓库设置失败",
                    github_headers(client.patch(&repo_url).json(&payload), Some(&token)),
                )?;
                github_json::<serde_json::Value>("更新 GitHub 仓库设置失败", response)?
            };
            let topics = if let Some(topics) = request.topics {
                let response = github_send(
                    &app,
                    "更新 GitHub 仓库 topics 失败",
                    github_headers(
                        client
                            .put(github_repo_topics_api_url(&repo_full_name)?)
                            .json(&serde_json::json!({ "names": normalize_github_topics(topics) })),
                        Some(&token),
                    ),
                )?;
                github_json::<GitHubRepoTopicsResponse>("更新 GitHub 仓库 topics 失败", response)?
                    .names
            } else {
                let response = github_send(
                    &app,
                    "读取 GitHub 仓库 topics 失败",
                    github_headers(
                        client.get(github_repo_topics_api_url(&repo_full_name)?),
                        Some(&token),
                    ),
                )?;
                github_json::<GitHubRepoTopicsResponse>("读取 GitHub 仓库 topics 失败", response)?
                    .names
            };
            let management =
                github_repo_management_from_value("读取 GitHub 仓库设置失败", repo, topics)?;
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache.management = Some(management.clone());
            })?;
            Ok(management)
        },
    )
    .await
}

fn github_repo_settings_path_url(repo_full_name: &str, path: &str) -> Result<String, String> {
    let base = github_repo_api_url(repo_full_name)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(base);
    }
    Ok(format!("{base}/{}", trimmed.trim_start_matches('/')))
}

fn github_json_value(prefix: &str, response: Response) -> Result<serde_json::Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(github_http_error(prefix, response));
    }
    if status == StatusCode::NO_CONTENT {
        return Ok(serde_json::json!({ "status": "ok" }));
    }
    response
        .json::<serde_json::Value>()
        .map_err(|e| format!("{prefix}：解析响应失败：{e}"))
}

fn github_repo_settings_get_item(
    app: &AppHandle,
    client: &Client,
    token: &str,
    repo_full_name: &str,
    key: &str,
    label: &str,
    path: &str,
    mutable: bool,
    dangerous: bool,
) -> GitHubRepoSettingsEndpointItem {
    if let Some(reason) = path.strip_prefix("unavailable:") {
        return GitHubRepoSettingsEndpointItem {
            key: key.to_string(),
            label: label.to_string(),
            method: "GET".to_string(),
            path: path.to_string(),
            value: None,
            error: Some(reason.to_string()),
            mutable: false,
            dangerous: false,
        };
    }
    let value = github_repo_settings_path_url(repo_full_name, path).and_then(|url| {
        let response = github_send(
            app,
            &format!("读取 {label} 失败"),
            github_headers(client.get(url), Some(token)),
        )?;
        github_json_value(&format!("读取 {label} 失败"), response)
    });
    match value {
        Ok(value) => GitHubRepoSettingsEndpointItem {
            key: key.to_string(),
            label: label.to_string(),
            method: "GET".to_string(),
            path: path.to_string(),
            value: Some(value),
            error: None,
            mutable,
            dangerous,
        },
        Err(error) => GitHubRepoSettingsEndpointItem {
            key: key.to_string(),
            label: label.to_string(),
            method: "GET".to_string(),
            path: path.to_string(),
            value: None,
            error: Some(error),
            mutable,
            dangerous,
        },
    }
}

fn github_repo_settings_section_title(section: &str) -> Result<&'static str, String> {
    match section {
        "collaborators" => Ok("协作者"),
        "moderation" => Ok("互动限制"),
        "security" => Ok("高级安全"),
        "branches" => Ok("分支"),
        "tags" => Ok("标签"),
        "rules" => Ok("规则"),
        "actions" => Ok("Actions"),
        "copilot" => Ok("Copilot"),
        "environments" => Ok("环境"),
        "codespaces" => Ok("Codespaces"),
        "pages" => Ok("Pages"),
        "webhooks" => Ok("Webhooks"),
        "deployKeys" => Ok("部署密钥"),
        "secretsVariables" => Ok("密钥与变量"),
        "githubApps" => Ok("GitHub Apps"),
        "emailNotifications" => Ok("邮件通知"),
        _ => Err(format!("未知 GitHub 设置分区：{section}")),
    }
}

fn github_repo_settings_section_items(
    section: &str,
) -> Result<Vec<(&'static str, &'static str, &'static str, bool, bool)>, String> {
    match section {
        "collaborators" => Ok(vec![
            ("collaborators", "协作者", "collaborators?per_page=100", true, true),
            ("teams", "仓库团队", "teams?per_page=100", false, false),
        ]),
        "moderation" => Ok(vec![
            ("interactionLimits", "互动限制", "interaction-limits", true, false),
        ]),
        "security" => Ok(vec![
            ("repository", "仓库安全与分析", "", true, false),
            ("vulnerabilityAlerts", "漏洞警报", "vulnerability-alerts", true, false),
            ("dependabotSecurityUpdates", "Dependabot 安全更新", "automated-security-fixes", true, false),
            ("privateVulnerabilityReporting", "私有漏洞报告", "private-vulnerability-reporting", true, false),
            ("immutableReleases", "不可变 Release", "immutable-releases", true, false),
        ]),
        "branches" => Ok(vec![
            ("branches", "分支", "branches?per_page=100", false, false),
        ]),
        "tags" => Ok(vec![
            ("tags", "标签", "tags?per_page=100", false, false),
        ]),
        "rules" => Ok(vec![
            ("rulesets", "仓库规则集", "rulesets", true, true),
        ]),
        "actions" => Ok(vec![
            ("permissions", "Actions permissions", "actions/permissions", true, false),
            ("workflowPermissions", "工作流默认权限", "actions/permissions/workflow", true, false),
            ("workflows", "工作流", "actions/workflows?per_page=100", true, false),
        ]),
        "copilot" => Ok(vec![(
            "copilot",
            "Copilot repository settings",
            "unavailable:GitHub REST API does not expose a general repository-owned Copilot settings endpoint for this app.",
            false,
            false,
        )]),
        "environments" => Ok(vec![
            ("environments", "环境", "environments", true, true),
        ]),
        "codespaces" => Ok(vec![
            ("codespaces", "仓库 Codespaces", "codespaces?per_page=100", false, false),
            ("codespacesSecrets", "Codespaces 仓库密钥", "codespaces/secrets", true, true),
        ]),
        "pages" => Ok(vec![
            ("pages", "GitHub Pages 站点", "pages", true, false),
            ("pagesBuilds", "GitHub Pages 构建", "pages/builds?per_page=20", true, false),
        ]),
        "webhooks" => Ok(vec![
            ("webhooks", "Webhooks", "hooks", true, true),
        ]),
        "deployKeys" => Ok(vec![
            ("deployKeys", "部署密钥", "keys?per_page=100", true, true),
        ]),
        "secretsVariables" => Ok(vec![
            ("actionsVariables", "Actions 仓库变量", "actions/variables", true, false),
            ("actionsSecrets", "Actions 仓库密钥", "actions/secrets", true, true),
        ]),
        "githubApps" => Ok(vec![
            ("installations", "仓库 GitHub App 安装", "installations", false, false),
        ]),
        "emailNotifications" => Ok(vec![
            ("subscription", "仓库通知订阅", "subscription", true, false),
        ]),
        _ => Err(format!("未知 GitHub 设置分区：{section}")),
    }
}

fn github_get_repo_settings_section_sync(
    app: &AppHandle,
    repo_full_name: &str,
    section: &str,
) -> Result<GitHubRepoSettingsSection, String> {
    let (_binding, token) = github_require_token(app)?;
    let client = build_client()?;
    let title = github_repo_settings_section_title(section)?;
    let items = github_repo_settings_section_items(section)?
        .into_iter()
        .map(|(key, label, path, mutable, dangerous)| {
            github_repo_settings_get_item(
                app,
                &client,
                &token,
                repo_full_name,
                key,
                label,
                path,
                mutable,
                dangerous,
            )
        })
        .collect();
    Ok(GitHubRepoSettingsSection {
        key: section.to_string(),
        title: title.to_string(),
        fetched_at: now_millis(),
        items,
    })
}

pub async fn github_get_repo_settings_section(
    app: AppHandle,
    repo_full_name: String,
    section: String,
    _force_refresh: Option<bool>,
) -> Result<GitHubRepoSettingsSection, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 仓库设置分区",
        move || github_get_repo_settings_section_sync(&app, &repo_full_name, &section),
    )
    .await
}

pub async fn github_update_repo_actions_permissions(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubRepoActionsPermissionsRequest,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub Actions 权限",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "更新 GitHub Actions 权限失败",
                github_headers(
                    client
                        .put(format!(
                            "{}/actions/permissions",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&github_actions_permissions_payload(&request)),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error("更新 GitHub Actions 权限失败", response));
            }
            Ok(())
        },
    )
    .await
}

pub async fn github_update_repo_workflow_permissions(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubRepoWorkflowPermissionsRequest,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub 工作流权限",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "更新 GitHub 工作流权限失败",
                github_headers(
                    client
                        .put(format!(
                            "{}/actions/permissions/workflow",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&github_workflow_permissions_payload(&request)),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error("更新 GitHub 工作流权限失败", response));
            }
            Ok(())
        },
    )
    .await
}

pub async fn github_delete_repo(app: AppHandle, repo_full_name: String) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "删除 GitHub 仓库",
        move || {
            let (binding, token) = github_require_token(&app)?;
            github_require_scope(&binding, GITHUB_DELETE_REPO_SCOPE)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "删除 GitHub 仓库失败",
                github_headers(
                    client.delete(github_repo_api_url(&repo_full_name)?),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error("删除 GitHub 仓库失败", response));
            }
            clear_github_project_repo_cache(&app, &repo_full_name)?;
            Ok(())
        },
    )
    .await
}

pub async fn github_list_branches(
    app: AppHandle,
    repo_full_name: String,
) -> Result<Vec<BranchSummary>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 分支",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let repo_url = github_repo_api_url(&repo_full_name)?;
            let response = github_send(
                &app,
                "读取 GitHub 分支失败",
                github_headers(
                    client
                        .get(format!("{repo_url}/branches"))
                        .query(&[("per_page", "100")]),
                    Some(&token),
                ),
            )?;
            let branches =
                github_json::<Vec<GitHubBranchResponse>>("读取 GitHub 分支失败", response)?;
            Ok(branches
                .into_iter()
                .map(github_branch_from_response)
                .collect())
        },
    )
    .await
}

pub(super) fn github_branch_protection_api_url(
    repo_full_name: &str,
    branch_name: &str,
) -> Result<String, String> {
    let branch = branch_name.trim();
    if branch.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    Ok(format!(
        "{}/branches/{}/protection",
        github_repo_api_url(repo_full_name)?,
        url_encode_path_segment(branch)
    ))
}

pub async fn github_get_branch_protection(
    app: AppHandle,
    repo_full_name: String,
    branch_name: String,
) -> Result<Option<serde_json::Value>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 分支保护",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub 分支保护失败",
                github_headers(
                    client.get(github_branch_protection_api_url(
                        &repo_full_name,
                        &branch_name,
                    )?),
                    Some(&token),
                ),
            )?;
            github_branch_protection_from_response("读取 GitHub 分支保护失败", response)
        },
    )
    .await
}

pub async fn github_update_branch_protection(
    app: AppHandle,
    repo_full_name: String,
    branch_name: String,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub 分支保护",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "更新 GitHub 分支保护失败",
                github_headers(
                    client
                        .put(github_branch_protection_api_url(
                            &repo_full_name,
                            &branch_name,
                        )?)
                        .json(&request),
                    Some(&token),
                ),
            )?;
            github_json("更新 GitHub 分支保护失败", response)
        },
    )
    .await
}

fn github_ruleset_api_url(repo_full_name: &str, ruleset_id: Option<u64>) -> Result<String, String> {
    let base = format!("{}/rulesets", github_repo_api_url(repo_full_name)?);
    Ok(ruleset_id.map_or(base.clone(), |id| format!("{base}/{id}")))
}

fn fetch_github_ruleset(
    app: &AppHandle,
    client: &Client,
    token: &str,
    repo_full_name: &str,
    ruleset_id: u64,
) -> Result<serde_json::Value, String> {
    let response = github_send(
        app,
        "读取 GitHub 规则集失败",
        github_headers(
            client.get(github_ruleset_api_url(repo_full_name, Some(ruleset_id))?),
            Some(token),
        ),
    )?;
    github_json("读取 GitHub 规则集失败", response)
}

pub async fn github_list_repo_rulesets(
    app: AppHandle,
    repo_full_name: String,
) -> Result<Vec<GitHubRulesetSummary>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 规则集",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub 规则集失败",
                github_headers(
                    client
                        .get(github_ruleset_api_url(&repo_full_name, None)?)
                        .query(&[
                            ("includes_parents", "true"),
                            ("targets", "branch"),
                            ("per_page", "100"),
                        ]),
                    Some(&token),
                ),
            )?;
            let rulesets = github_json::<Vec<GitHubRulesetSummaryResponse>>(
                "读取 GitHub 规则集失败",
                response,
            )?;
            Ok(rulesets
                .into_iter()
                .map(|ruleset| github_ruleset_summary_from_response(&repo_full_name, ruleset))
                .collect())
        },
    )
    .await
}

pub async fn github_get_repo_ruleset(
    app: AppHandle,
    repo_full_name: String,
    ruleset_id: u64,
) -> Result<serde_json::Value, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 规则集",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            fetch_github_ruleset(&app, &client, &token, &repo_full_name, ruleset_id)
        },
    )
    .await
}

pub async fn github_update_repo_ruleset(
    app: AppHandle,
    repo_full_name: String,
    ruleset_id: u64,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub 规则集",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let current = fetch_github_ruleset(&app, &client, &token, &repo_full_name, ruleset_id)?;
            let source_type = current
                .get("source_type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let source = current
                .get("source")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if !source_type.eq_ignore_ascii_case("Repository")
                || !source.eq_ignore_ascii_case(&repo_full_name)
            {
                return Err("继承的组织或企业规则集只能查看，不能在仓库中编辑".to_string());
            }
            let response = github_send(
                &app,
                "更新 GitHub 规则集失败",
                github_headers(
                    client
                        .put(github_ruleset_api_url(&repo_full_name, Some(ruleset_id))?)
                        .json(&request),
                    Some(&token),
                ),
            )?;
            github_json("更新 GitHub 规则集失败", response)
        },
    )
    .await
}

pub async fn github_delete_branch(
    app: AppHandle,
    repo_full_name: String,
    branch_name: String,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "删除 GitHub 分支",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let branch = branch_name.trim();
            if branch.is_empty() {
                return Err("分支名不能为空".to_string());
            }
            let client = build_client()?;
            let response = github_send(
                &app,
                "删除 GitHub 分支失败",
                github_headers(
                    client.delete(format!(
                        "{}/git/refs/heads/{}",
                        github_repo_api_url(&repo_full_name)?,
                        url_encode_path_segment(branch)
                    )),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error("删除 GitHub 分支失败", response));
            }
            Ok(())
        },
    )
    .await
}

pub async fn github_list_pull_requests(
    app: AppHandle,
    repo_full_name: String,
    state: Option<String>,
    per_page: Option<u32>,
    sort: Option<String>,
    direction: Option<String>,
    creator: Option<String>,
    assignee: Option<String>,
    labels: Option<Vec<String>>,
    milestone: Option<serde_json::Value>,
    project: Option<String>,
    review: Option<String>,
    query: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubPullRequest>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Pull Requests",
        move || {
            let milestone_key = github_issue_milestone_param(milestone.clone());
            let search_query = normalize_optional_string(query.clone());
            let pull_key = github_pull_request_cache_key(
                state.as_deref(),
                per_page,
                sort.as_deref(),
                direction.as_deref(),
                creator.as_deref(),
                assignee.as_deref(),
                labels.as_deref(),
                milestone_key.as_deref(),
                project.as_deref(),
                review.as_deref(),
                search_query.as_deref(),
            );
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| repo_cache.pull_requests.get(&pull_key).cloned())
                {
                    return Ok(cached);
                }
            }
            let (binding, token) = github_require_token(&app)?;
            let pull_state = match state.as_deref() {
                Some("closed") => "closed",
                Some("merged") => "merged",
                Some("all") => "all",
                _ => "open",
            };
            let pull_per_page = per_page.unwrap_or(100).clamp(1, 100).to_string();
            let pull_sort = match sort.as_deref() {
                Some("created") => "created",
                Some("comments") => "comments",
                _ => "updated",
            };
            let pull_direction = match direction.as_deref() {
                Some("asc") => "asc",
                _ => "desc",
            };
            let pull_creator = normalize_optional_string(creator);
            let pull_assignee = normalize_optional_string(assignee);
            let pull_review = normalize_optional_string(review);
            let pull_project = normalize_optional_string(project);
            let client = build_client()?;
            if !github_pull_request_search_required(
                pull_state,
                pull_sort,
                pull_creator.as_deref(),
                pull_assignee.as_deref(),
                labels.as_deref(),
                milestone_key.as_deref(),
                pull_project.as_deref(),
                pull_review.as_deref(),
                search_query.as_deref(),
            ) {
                let repo_url = github_repo_api_url(&repo_full_name)?;
                let response = github_send(
                    &app,
                    "读取 GitHub Pull Requests 失败",
                    github_headers(
                        client.get(format!("{repo_url}/pulls")).query(&[
                            ("state", pull_state),
                            ("per_page", pull_per_page.as_str()),
                            ("sort", pull_sort),
                            ("direction", pull_direction),
                        ]),
                        Some(&token),
                    ),
                )?;
                if !response.status().is_success() {
                    return Err(github_http_error(
                        "读取 GitHub Pull Requests 失败",
                        response,
                    ));
                }
                let pulls = github_json::<Vec<GitHubPullRequestResponse>>(
                    "读取 GitHub Pull Requests 失败",
                    response,
                )?
                .into_iter()
                .map(github_pull_request_from_response)
                .collect::<Vec<_>>();
                update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                    repo_cache.pull_requests.insert(pull_key, pulls.clone());
                })?;
                return Ok(pulls);
            }
            let search_q = github_pull_request_search_query(
                &repo_full_name,
                pull_state,
                search_query.as_deref().unwrap_or(""),
                pull_creator.as_deref(),
                pull_assignee.as_deref(),
                labels.as_deref(),
                milestone_key.as_deref(),
                pull_review.as_deref(),
            );
            let search_params = vec![
                ("q", search_q),
                ("per_page", pull_per_page),
                ("sort", pull_sort.to_string()),
                ("order", pull_direction.to_string()),
            ];
            let response = github_send(
                &app,
                "读取 GitHub Pull Requests 失败",
                github_headers(
                    client
                        .get("https://api.github.com/search/issues")
                        .query(&search_params),
                    Some(&token),
                ),
            )?;
            let mut issues = github_json::<GitHubIssueSearchResponse>(
                "读取 GitHub Pull Requests 失败",
                response,
            )?
            .items
            .into_iter()
            .filter_map(github_pull_request_issue_from_response)
            .collect::<Vec<_>>();
            enrich_github_issues_with_projects(
                &app,
                &repo_full_name,
                &binding,
                &token,
                &mut issues,
            )?;
            if let Some(project_filter) = pull_project {
                issues.retain(|issue| {
                    issue
                        .project_items
                        .iter()
                        .any(|item| item.id == project_filter || item.title == project_filter)
                });
            }
            let mut pulls = Vec::with_capacity(issues.len());
            for issue in issues {
                let pull_request = github_fetch_pull_request_response(
                    &app,
                    &repo_full_name,
                    issue.number,
                    &token,
                    "读取 GitHub Pull Request 失败",
                )?;
                pulls.push(github_pull_request_with_issue_metadata(
                    github_pull_request_from_response(pull_request),
                    issue,
                ));
            }
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache.pull_requests.insert(pull_key, pulls.clone());
            })?;
            Ok(pulls)
        },
    )
    .await
}

pub async fn github_get_pull_request(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
) -> Result<GitHubPullRequest, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Pull Request",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let pull_request = github_fetch_pull_request_response(
                &app,
                &repo_full_name,
                pull_number,
                &token,
                "读取 GitHub Pull Request 失败",
            )?;
            Ok(github_pull_request_from_response(pull_request))
        },
    )
    .await
}

pub async fn github_get_pull_request_discussion(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    force_refresh: Option<bool>,
) -> Result<GitHubPullRequestDiscussion, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Pull Request 讨论",
        move || {
            if pull_number == 0 {
                return Err("Pull Request 编号不合法".to_string());
            }
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            let discussion_key = pull_number.to_string();
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| {
                        repo_cache
                            .pull_request_discussions
                            .get(&discussion_key)
                            .cloned()
                    })
                {
                    return Ok(cached);
                }
            }
            let (_binding, token) = github_require_token(&app)?;
            let pull_request_response = github_fetch_pull_request_response(
                &app,
                &repo_full_name,
                pull_number,
                &token,
                "读取 GitHub Pull Request 失败",
            )?;
            let pull_request_issue = github_fetch_issue_response(
                &app,
                &repo_full_name,
                pull_number,
                &token,
                "读取 GitHub Pull Request 元数据失败",
            )?;
            let issue_metadata = github_pull_request_issue_from_response(pull_request_issue);
            let mut pull_request = github_pull_request_from_response(pull_request_response);
            if let Some(issue) = issue_metadata {
                pull_request = github_pull_request_with_issue_metadata(pull_request, issue);
            }
            let client = build_client()?;
            let repo_url = github_repo_api_url(&repo_full_name)?;
            let mut timeline = vec![github_timeline_item_from_pull_request(&pull_request)];
            let timeline_events = github_fetch_paginated::<GitHubIssueTimelineResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/issues/{pull_number}/timeline"),
                "读取 GitHub Pull Request 时间线失败",
            )?;
            let mut development_items =
                github_development_items_from_timeline(&repo_full_name, &timeline_events);
            timeline.extend(
                timeline_events
                    .into_iter()
                    .map(github_timeline_item_from_response),
            );

            let review_responses = github_fetch_paginated::<GitHubPullRequestReviewResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/pulls/{pull_number}/reviews"),
                "读取 GitHub Pull Request Reviews 失败",
            )?;
            let mut reviewers = fetch_github_pull_request_requested_reviewers(
                &app,
                &client,
                &token,
                &repo_url,
                pull_number,
            )?;
            add_pull_request_reviewers_from_reviews(&mut reviewers, &review_responses);
            timeline.extend(
                review_responses
                    .into_iter()
                    .map(github_review_timeline_item_from_response),
            );

            let review_comments = github_fetch_paginated::<GitHubPullRequestReviewCommentResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/pulls/{pull_number}/comments"),
                "读取 GitHub Pull Request Review Comments 失败",
            )?;
            timeline.extend(
                review_comments
                    .into_iter()
                    .map(github_review_comment_timeline_item_from_response),
            );

            let commits = github_fetch_paginated::<GitHubCommitResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/pulls/{pull_number}/commits"),
                "读取 GitHub Pull Request Commits 失败",
            )?;
            development_items.extend(github_pull_request_commit_development_items(
                &repo_full_name,
                &commits,
            ));
            let mut development_seen = HashSet::new();
            development_items.retain(|item| development_seen.insert(item.id.clone()));
            pull_request.reviewers = reviewers;
            pull_request.development_items = development_items;
            pull_request.commit_count = Some(commits.len() as u64);
            let mut seen = HashSet::new();
            timeline.retain(|item| seen.insert(format!("{}:{}", item.kind, item.id)));
            sort_github_discussion_timeline(&mut timeline);
            let discussion = GitHubPullRequestDiscussion {
                pull_request,
                timeline,
            };
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache
                    .pull_request_discussions
                    .insert(discussion_key, discussion.clone());
            })?;
            Ok(discussion)
        },
    )
    .await
}

pub async fn github_create_pull_request(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubCreatePullRequestRequest,
) -> Result<GitHubPullRequest, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "创建 GitHub Pull Request",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let title = request.title.trim();
            let head = request.head.trim();
            let base = request.base.trim();
            if title.is_empty() || head.is_empty() || base.is_empty() {
                return Err("Pull Request 标题、head 和 base 不能为空".to_string());
            }
            let mut payload = serde_json::json!({
                "title": title,
                "head": head,
                "base": base,
                "draft": request.draft,
            });
            if let Some(map) = payload.as_object_mut() {
                if let Some(value) = normalize_optional_string(request.body) {
                    map.insert("body".to_string(), serde_json::Value::String(value));
                }
            }
            let client = build_client()?;
            let response = github_send(
                &app,
                "创建 GitHub Pull Request 失败",
                github_headers(
                    client
                        .post(format!("{}/pulls", github_repo_api_url(&repo_full_name)?))
                        .json(&payload),
                    Some(&token),
                ),
            )?;
            let pull_request = github_json::<GitHubPullRequestResponse>(
                "创建 GitHub Pull Request 失败",
                response,
            )?;
            let pull = github_pull_request_from_response(pull_request);
            clear_github_project_pull_request_cache(&app, &repo_full_name)?;
            Ok(pull)
        },
    )
    .await
}

pub async fn github_update_pull_request(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    request: GitHubUpdatePullRequestRequest,
) -> Result<GitHubPullRequest, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub Pull Request",
        move || {
            if pull_number == 0 {
                return Err("Pull Request 编号不合法".to_string());
            }
            let (_binding, token) = github_require_token(&app)?;
            let mut payload = serde_json::Map::new();
            if let Some(value) = normalize_optional_string(request.title) {
                payload.insert("title".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = request.body {
                payload.insert("body".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = request.state {
                let trimmed = value.trim().to_string();
                if trimmed != "open" && trimmed != "closed" {
                    return Err("Pull Request 状态只能是 open 或 closed".to_string());
                }
                payload.insert("state".to_string(), serde_json::Value::String(trimmed));
            }
            if let Some(value) = normalize_optional_string(request.base) {
                payload.insert("base".to_string(), serde_json::Value::String(value));
            }
            let mut issue_payload = serde_json::Map::new();
            if let Some(value) = request.labels {
                issue_payload.insert("labels".to_string(), serde_json::json!(value));
            }
            if let Some(value) = request.assignees {
                issue_payload.insert("assignees".to_string(), serde_json::json!(value));
            }
            if let Some(value) = request.milestone {
                issue_payload.insert("milestone".to_string(), serde_json::json!(value));
            }
            let client = build_client()?;
            let repo_api_url = github_repo_api_url(&repo_full_name)?;
            if !payload.is_empty() {
                let response = github_send(
                    &app,
                    "更新 GitHub Pull Request 失败",
                    github_headers(
                        client
                            .patch(format!("{repo_api_url}/pulls/{pull_number}"))
                            .json(&payload),
                        Some(&token),
                    ),
                )?;
                if !response.status().is_success() {
                    return Err(github_http_error("更新 GitHub Pull Request 失败", response));
                }
            }
            if !issue_payload.is_empty() {
                let response = github_send(
                    &app,
                    "更新 Pull Request 元数据失败",
                    github_headers(
                        client
                            .patch(format!("{repo_api_url}/issues/{pull_number}"))
                            .json(&issue_payload),
                        Some(&token),
                    ),
                )?;
                if !response.status().is_success() {
                    return Err(github_http_error("更新 Pull Request 元数据失败", response));
                }
            }
            let pull_request = github_fetch_pull_request_response(
                &app,
                &repo_full_name,
                pull_number,
                &token,
                "读取更新后的 Pull Request 失败",
            )?;
            let pull = github_pull_request_from_response(pull_request);
            clear_github_project_pull_request_cache(&app, &repo_full_name)?;
            Ok(pull)
        },
    )
    .await
}

pub async fn github_merge_pull_request(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    request: GitHubMergePullRequestRequest,
) -> Result<GitHubPullRequest, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "合并 GitHub Pull Request",
        move || {
            if pull_number == 0 {
                return Err("Pull Request 编号不合法".to_string());
            }
            let (_binding, token) = github_require_token(&app)?;
            let mut payload = serde_json::Map::new();
            if let Some(value) = normalize_optional_string(request.method) {
                payload.insert("merge_method".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = normalize_optional_string(request.commit_title) {
                payload.insert("commit_title".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = normalize_optional_string(request.commit_message) {
                payload.insert(
                    "commit_message".to_string(),
                    serde_json::Value::String(value),
                );
            }
            if let Some(value) = normalize_optional_string(request.sha) {
                payload.insert("sha".to_string(), serde_json::Value::String(value));
            }
            let client = build_client()?;
            let response = github_send(
                &app,
                "合并 GitHub Pull Request 失败",
                github_headers(
                    client
                        .put(format!(
                            "{}/pulls/{pull_number}/merge",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&payload),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error("合并 GitHub Pull Request 失败", response));
            }
            let pull_request = github_fetch_pull_request_response(
                &app,
                &repo_full_name,
                pull_number,
                &token,
                "读取合并后的 Pull Request 失败",
            )?;
            let pull = github_pull_request_from_response(pull_request);
            clear_github_project_pull_request_cache(&app, &repo_full_name)?;
            Ok(pull)
        },
    )
    .await
}

pub async fn github_list_pull_request_checks(
    app: AppHandle,
    repo_full_name: String,
    pull_number: u64,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubPullRequestCheck>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Pull Request Checks",
        move || {
            if pull_number == 0 {
                return Err("Pull Request 编号不合法".to_string());
            }
            let checks_key = pull_number.to_string();
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| repo_cache.pull_request_checks.get(&checks_key).cloned())
                {
                    return Ok(cached);
                }
            }
            let (_binding, token) = github_require_token(&app)?;
            let pull_request = github_fetch_pull_request_response(
                &app,
                &repo_full_name,
                pull_number,
                &token,
                "读取 GitHub Pull Request Checks 失败",
            )?;
            let head_sha = pull_request
                .head
                .sha
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Pull Request 缺少 head sha".to_string())?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub Pull Request Checks 失败",
                github_headers(
                    client
                        .get(format!(
                            "{}/commits/{}/check-runs",
                            github_repo_api_url(&repo_full_name)?,
                            url_encode_path_segment(&head_sha)
                        ))
                        .query(&[("per_page", "100")]),
                    Some(&token),
                ),
            )?;
            let checks = github_json::<GitHubPullRequestCheckRunsResponse>(
                "读取 GitHub Pull Request Checks 失败",
                response,
            )?;
            let checks = checks
                .check_runs
                .into_iter()
                .map(github_pull_request_check_from_response)
                .collect::<Vec<_>>();
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache
                    .pull_request_checks
                    .insert(checks_key, checks.clone());
            })?;
            Ok(checks)
        },
    )
    .await
}

pub async fn github_list_issues(
    app: AppHandle,
    repo_full_name: String,
    state: Option<String>,
    per_page: Option<u32>,
    sort: Option<String>,
    direction: Option<String>,
    since: Option<String>,
    creator: Option<String>,
    assignee: Option<String>,
    labels: Option<Vec<String>>,
    milestone: Option<serde_json::Value>,
    project: Option<String>,
    query: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubIssue>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Issue",
        move || {
            let milestone_key = github_issue_milestone_param(milestone.clone());
            let search_query = normalize_optional_string(query.clone());
            let issue_key = github_issue_cache_key(
                state.as_deref(),
                per_page,
                sort.as_deref(),
                direction.as_deref(),
                since.as_deref(),
                creator.as_deref(),
                assignee.as_deref(),
                labels.as_deref(),
                milestone_key.as_deref(),
                project.as_deref(),
                search_query.as_deref(),
            );
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| repo_cache.issues.get(&issue_key).cloned())
                {
                    return Ok(cached);
                }
            }
            let (binding, token) = github_require_token(&app)?;
            let issue_state = state.unwrap_or_else(|| "open".to_string());
            let issue_per_page = per_page.unwrap_or(100).clamp(1, 100).to_string();
            let issue_sort = match sort.as_deref() {
                Some("updated") => "updated",
                Some("comments") => "comments",
                _ => "created",
            };
            let issue_direction = match direction.as_deref() {
                Some("asc") => "asc",
                _ => "desc",
            };
            let issue_since = normalize_optional_string(since);
            let issue_creator = normalize_optional_string(creator);
            let issue_assignee = normalize_optional_string(assignee);
            let issue_labels = github_issue_labels_param(labels.clone());
            let issue_milestone = milestone_key.clone();
            let mut rest_query = vec![
                ("state", issue_state.clone()),
                ("per_page", issue_per_page.clone()),
                ("sort", issue_sort.to_string()),
                ("direction", issue_direction.to_string()),
            ];
            if let Some(issue_since) = issue_since.clone() {
                rest_query.push(("since", issue_since));
            }
            if let Some(issue_creator) = issue_creator.clone() {
                rest_query.push(("creator", issue_creator));
            }
            if let Some(issue_assignee) = issue_assignee.clone() {
                rest_query.push(("assignee", issue_assignee));
            }
            if let Some(issue_labels) = issue_labels.clone() {
                rest_query.push(("labels", issue_labels));
            }
            if let Some(issue_milestone) = issue_milestone.clone() {
                rest_query.push(("milestone", issue_milestone));
            }
            let client = build_client()?;
            let issues = if let Some(search_text) = search_query {
                let search_sort = match issue_sort {
                    "updated" => "updated",
                    "comments" => "comments",
                    _ => "created",
                };
                let search_q = github_issue_search_query(
                    &repo_full_name,
                    &issue_state,
                    &search_text,
                    issue_since.as_deref(),
                    issue_creator.as_deref(),
                    issue_assignee.as_deref(),
                    labels.as_deref(),
                    milestone_key.as_deref(),
                );
                let search_params = vec![
                    ("q", search_q),
                    ("per_page", issue_per_page),
                    ("sort", search_sort.to_string()),
                    ("order", issue_direction.to_string()),
                ];
                let response = github_send(
                    &app,
                    "搜索 GitHub Issue 失败",
                    github_headers(
                        client
                            .get("https://api.github.com/search/issues")
                            .query(&search_params),
                        Some(&token),
                    ),
                )?;
                github_json::<GitHubIssueSearchResponse>("搜索 GitHub Issue 失败", response)?.items
            } else {
                let response = github_send(
                    &app,
                    "读取 GitHub Issue 失败",
                    github_headers(
                        client
                            .get(format!("{}/issues", github_repo_api_url(&repo_full_name)?))
                            .query(&rest_query),
                        Some(&token),
                    ),
                )?;
                github_json::<Vec<GitHubIssueResponse>>("读取 GitHub Issue 失败", response)?
            };
            let mut issues = issues
                .into_iter()
                .filter_map(github_issue_from_response)
                .collect::<Vec<_>>();
            enrich_github_issues_with_projects(
                &app,
                &repo_full_name,
                &binding,
                &token,
                &mut issues,
            )?;
            if let Some(project_filter) = normalize_optional_string(project) {
                issues.retain(|issue| {
                    issue
                        .project_items
                        .iter()
                        .any(|item| item.id == project_filter || item.title == project_filter)
                });
            }
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache.issues.insert(issue_key, issues.clone());
            })?;
            Ok(issues)
        },
    )
    .await
}

pub async fn github_get_issue_discussion(
    app: AppHandle,
    repo_full_name: String,
    issue_number: u64,
    force_refresh: Option<bool>,
) -> Result<GitHubIssueDiscussion, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Issue 讨论",
        move || {
            if issue_number == 0 {
                return Err("Issue 编号不合法".to_string());
            }
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            let discussion_key = issue_number.to_string();
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| {
                        repo_cache.issue_discussions.get(&discussion_key).cloned()
                    })
                {
                    return Ok(cached);
                }
            }
            let (_binding, token) = github_require_token(&app)?;
            let issue_response = github_fetch_issue_response(
                &app,
                &repo_full_name,
                issue_number,
                &token,
                "读取 GitHub Issue 失败",
            )?;
            let mut issue = github_issue_from_response(issue_response)
                .ok_or_else(|| format!("#{issue_number} 是 Pull Request，不是 Issue"))?;
            let client = build_client()?;
            let repo_url = github_repo_api_url(&repo_full_name)?;
            let mut timeline = vec![github_timeline_item_from_issue(&issue)];
            let timeline_events = github_fetch_paginated::<GitHubIssueTimelineResponse>(
                &app,
                &client,
                &token,
                format!("{repo_url}/issues/{issue_number}/timeline"),
                "读取 GitHub Issue 时间线失败",
            )?;
            issue.development_items =
                github_development_items_from_timeline(&repo_full_name, &timeline_events);
            timeline.extend(
                timeline_events
                    .into_iter()
                    .map(github_timeline_item_from_response),
            );
            let mut seen = HashSet::new();
            timeline.retain(|item| seen.insert(format!("{}:{}", item.kind, item.id)));
            sort_github_discussion_timeline(&mut timeline);
            let discussion = GitHubIssueDiscussion { issue, timeline };
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache
                    .issue_discussions
                    .insert(discussion_key, discussion.clone());
            })?;
            Ok(discussion)
        },
    )
    .await
}

pub async fn github_get_issue_filter_metadata(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<GitHubIssueFilterMetadata, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Issue 筛选项",
        move || {
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                let cache = load_github_project_cache(&app);
                if let Some(repo_cache) = cache.repos.get(&cache_key) {
                    if let Some(cached) = repo_cache.issue_filter_metadata.clone() {
                        if !cached.labels.is_empty() || repo_cache.issue_labels.is_some() {
                            return Ok(cached);
                        }
                    }
                }
            }
            let (binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let query = vec![
                ("state", "all".to_string()),
                ("per_page", "100".to_string()),
                ("sort", "updated".to_string()),
                ("direction", "desc".to_string()),
            ];
            let response = github_send(
                &app,
                "读取 GitHub Issue 筛选项失败",
                github_headers(
                    client
                        .get(format!("{}/issues", github_repo_api_url(&repo_full_name)?))
                        .query(&query),
                    Some(&token),
                ),
            )?;
            let issues =
                github_json::<Vec<GitHubIssueResponse>>("读取 GitHub Issue 筛选项失败", response)?;
            let mut issues = issues
                .into_iter()
                .filter_map(github_issue_from_response)
                .collect::<Vec<_>>();
            enrich_github_issues_with_projects(
                &app,
                &repo_full_name,
                &binding,
                &token,
                &mut issues,
            )?;
            let mut metadata = github_issue_filter_metadata_from_issues(&issues);
            let repo_labels = list_github_issue_labels_inner(&app, &repo_full_name, force_refresh)?;
            metadata.labels = merge_unique_sorted_strings(metadata.labels, repo_labels);
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache.issue_filter_metadata = Some(metadata.clone());
            })?;
            Ok(metadata)
        },
    )
    .await
}

fn list_github_issue_values(
    app: &AppHandle,
    repo_full_name: &str,
    force_refresh: Option<bool>,
    cache_read: impl Fn(&GitHubProjectRepoCache) -> Option<Vec<String>>,
    cache_write: impl Fn(&mut GitHubProjectRepoCache, Vec<String>),
    endpoint: &str,
    error_label: &'static str,
    parse_values: impl Fn(Response) -> Result<Vec<String>, String>,
) -> Result<Vec<String>, String> {
    let cache_key = github_project_cache_repo_key(repo_full_name)?;
    if github_project_cache_enabled(force_refresh) {
        if let Some(cached) = load_github_project_cache(app)
            .repos
            .get(&cache_key)
            .and_then(cache_read)
        {
            return Ok(cached);
        }
    }
    let (_binding, token) = github_require_token(app)?;
    let client = build_client()?;
    let response = github_send(
        app,
        error_label,
        github_headers(
            client
                .get(format!(
                    "{}/{}",
                    github_repo_api_url(repo_full_name)?,
                    endpoint
                ))
                .query(&[("per_page", "100")]),
            Some(&token),
        ),
    )?;
    let values = parse_values(response)?;
    update_github_project_repo_cache(app, repo_full_name, |repo_cache| {
        cache_write(repo_cache, values.clone());
    })?;
    Ok(values)
}

fn list_github_issue_labels_inner(
    app: &AppHandle,
    repo_full_name: &str,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    list_github_issue_values(
        app,
        repo_full_name,
        force_refresh,
        |repo_cache| repo_cache.issue_labels.clone(),
        |repo_cache, labels| repo_cache.issue_labels = Some(labels),
        "labels",
        "读取 GitHub Issue Labels 失败",
        |response| {
            Ok(
                github_json::<Vec<GitHubLabelResponse>>("读取 GitHub Issue Labels 失败", response)?
                    .into_iter()
                    .map(|label| label.name)
                    .filter(|label| !label.trim().is_empty())
                    .collect(),
            )
        },
    )
}

fn list_github_issue_assignees_inner(
    app: &AppHandle,
    repo_full_name: &str,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    list_github_issue_values(
        app,
        repo_full_name,
        force_refresh,
        |repo_cache| repo_cache.issue_assignees.clone(),
        |repo_cache, assignees| repo_cache.issue_assignees = Some(assignees),
        "assignees",
        "读取 GitHub Issue Assignees 失败",
        |response| {
            Ok(github_json::<Vec<GitHubAssigneeResponse>>(
                "读取 GitHub Issue Assignees 失败",
                response,
            )?
            .into_iter()
            .map(|assignee| assignee.login)
            .filter(|assignee| !assignee.trim().is_empty())
            .collect())
        },
    )
}

pub async fn github_list_issue_labels(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Issue Labels",
        move || list_github_issue_labels_inner(&app, &repo_full_name, force_refresh),
    )
    .await
}

pub async fn github_list_issue_assignees(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<Vec<String>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Issue Assignees",
        move || list_github_issue_assignees_inner(&app, &repo_full_name, force_refresh),
    )
    .await
}

pub async fn github_create_issue(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubCreateIssueRequest,
) -> Result<GitHubIssue, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "创建 GitHub Issue",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let title = request.title.trim();
            if title.is_empty() {
                return Err("Issue 标题不能为空".to_string());
            }
            let mut payload = serde_json::json!({
                "title": title,
                "labels": request.labels,
                "assignees": request.assignees,
            });
            if let Some(map) = payload.as_object_mut() {
                if let Some(value) = normalize_optional_string(request.body) {
                    map.insert("body".to_string(), serde_json::Value::String(value));
                }
            }
            let client = build_client()?;
            let response = github_send(
                &app,
                "创建 GitHub Issue 失败",
                github_headers(
                    client
                        .post(format!("{}/issues", github_repo_api_url(&repo_full_name)?))
                        .json(&payload),
                    Some(&token),
                ),
            )?;
            let issue = github_json::<GitHubIssueResponse>("创建 GitHub Issue 失败", response)?;
            let issue = github_issue_from_response(issue)
                .ok_or_else(|| "GitHub 返回了 Pull Request 记录".to_string())?;
            clear_github_project_issue_cache(&app, &repo_full_name)?;
            Ok(issue)
        },
    )
    .await
}

pub async fn github_update_issue(
    app: AppHandle,
    repo_full_name: String,
    issue_number: u64,
    request: GitHubUpdateIssueRequest,
) -> Result<GitHubIssue, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub Issue",
        move || {
            if issue_number == 0 {
                return Err("Issue 编号不合法".to_string());
            }
            let (_binding, token) = github_require_token(&app)?;
            let mut payload = serde_json::Map::new();
            if let Some(value) = normalize_optional_string(request.title) {
                payload.insert("title".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = request.body {
                payload.insert("body".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = request.state {
                if value != "open" && value != "closed" {
                    return Err("Issue 状态只能是 open 或 closed".to_string());
                }
                payload.insert("state".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = normalize_optional_string(request.state_reason) {
                if value != "completed" && value != "not_planned" {
                    return Err("Issue 关闭原因只能是 completed 或 not_planned".to_string());
                }
                payload.insert("state_reason".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = request.labels {
                payload.insert("labels".to_string(), serde_json::json!(value));
            }
            if let Some(value) = request.assignees {
                payload.insert("assignees".to_string(), serde_json::json!(value));
            }
            if let Some(value) = request.milestone {
                payload.insert("milestone".to_string(), serde_json::json!(value));
            }
            let client = build_client()?;
            let response = github_send(
                &app,
                "更新 GitHub Issue 失败",
                github_headers(
                    client
                        .patch(format!(
                            "{}/issues/{issue_number}",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&payload),
                    Some(&token),
                ),
            )?;
            let issue = github_json::<GitHubIssueResponse>("更新 GitHub Issue 失败", response)?;
            let issue = github_issue_from_response(issue)
                .ok_or_else(|| "GitHub 返回了 Pull Request 记录".to_string())?;
            clear_github_project_issue_cache(&app, &repo_full_name)?;
            Ok(issue)
        },
    )
    .await
}

pub async fn github_list_workflow_runs(
    app: AppHandle,
    repo_full_name: String,
    per_page: Option<u32>,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubWorkflowRun>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Actions",
        move || {
            let runs_key = github_workflow_runs_cache_key(per_page);
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| repo_cache.workflow_runs.get(&runs_key).cloned())
                {
                    return Ok(cached);
                }
            }
            let (_binding, token) = github_require_token(&app)?;
            let runs_per_page = per_page.unwrap_or(30).clamp(1, 100).to_string();
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub Actions 失败",
                github_headers(
                    client
                        .get(format!(
                            "{}/actions/runs",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .query(&[("per_page", runs_per_page)]),
                    Some(&token),
                ),
            )?;
            let runs =
                github_json::<GitHubWorkflowRunsResponse>("读取 GitHub Actions 失败", response)?;
            let runs = runs
                .workflow_runs
                .into_iter()
                .map(github_workflow_run_from_response)
                .collect::<Vec<_>>();
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache.workflow_runs.insert(runs_key, runs.clone());
            })?;
            Ok(runs)
        },
    )
    .await
}

pub async fn github_get_workflow_run_detail(
    app: AppHandle,
    repo_full_name: String,
    run_id: u64,
    _force_refresh: Option<bool>,
) -> Result<GitHubWorkflowRunDetail, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Actions 详情",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let repo_api_url = github_repo_api_url(&repo_full_name)?;
            let run_response = github_send(
                &app,
                "读取 GitHub Actions 详情失败",
                github_headers(
                    client.get(format!("{repo_api_url}/actions/runs/{run_id}")),
                    Some(&token),
                ),
            )?;
            let run = github_workflow_run_from_response(github_json::<GitHubWorkflowRunResponse>(
                "读取 GitHub Actions 详情失败",
                run_response,
            )?);
            let jobs_response = github_send(
                &app,
                "读取 GitHub Actions jobs 失败",
                github_headers(
                    client
                        .get(format!("{repo_api_url}/actions/runs/{run_id}/jobs"))
                        .query(&[("per_page", "100")]),
                    Some(&token),
                ),
            )?;
            let jobs = github_json::<GitHubWorkflowJobsResponse>(
                "读取 GitHub Actions jobs 失败",
                jobs_response,
            )?
            .jobs
            .into_iter()
            .map(github_workflow_job_from_response)
            .collect::<Vec<_>>();
            let artifacts_response = github_send(
                &app,
                "读取 GitHub Actions artifacts 失败",
                github_headers(
                    client
                        .get(format!("{repo_api_url}/actions/runs/{run_id}/artifacts"))
                        .query(&[("per_page", "100")]),
                    Some(&token),
                ),
            )?;
            let artifacts = github_json::<GitHubWorkflowArtifactsResponse>(
                "读取 GitHub Actions artifacts 失败",
                artifacts_response,
            )?
            .artifacts
            .into_iter()
            .map(github_workflow_artifact_from_response)
            .collect::<Vec<_>>();
            let workflow = github_workflow_definition_for_run(
                &app,
                &client,
                &repo_api_url,
                &repo_full_name,
                &token,
                &run,
            )
            .ok()
            .flatten();
            Ok(GitHubWorkflowRunDetail {
                run,
                jobs,
                artifacts,
                workflow,
            })
        },
    )
    .await
}

pub async fn github_get_workflow_job_log(
    app: AppHandle,
    repo_full_name: String,
    job_id: u64,
    _force_refresh: Option<bool>,
) -> Result<GitHubWorkflowJobLog, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Actions 日志",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .map_err(|e| format!("构造 GitHub HTTP 客户端失败：{e}"))?;
            let response = github_send(
                &app,
                "读取 GitHub Actions 日志失败",
                github_headers(
                    client.get(format!(
                        "{}/actions/jobs/{job_id}/logs",
                        github_repo_api_url(&repo_full_name)?
                    )),
                    Some(&token),
                ),
            )?;
            let content = response
                .text()
                .map_err(|e| format!("读取 GitHub Actions 日志失败：读取响应失败：{e}"))?;
            Ok(GitHubWorkflowJobLog { job_id, content })
        },
    )
    .await
}

fn github_post_workflow_action(
    app: &AppHandle,
    repo_full_name: &str,
    path: &str,
    error_context: &str,
) -> Result<(), String> {
    let (binding, token) = github_require_token(app)?;
    github_require_scope(&binding, GITHUB_REPO_SCOPE)?;
    let client = build_client()?;
    let response = github_send(
        app,
        error_context,
        github_headers(
            client.post(format!("{}/{}", github_repo_api_url(repo_full_name)?, path)),
            Some(&token),
        ),
    )?;
    if !response.status().is_success() {
        return Err(github_http_error(error_context, response));
    }
    clear_github_project_repo_cache(app, repo_full_name)?;
    Ok(())
}

pub async fn github_rerun_failed_workflow_run(
    app: AppHandle,
    repo_full_name: String,
    run_id: u64,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "重跑 GitHub Actions 失败任务",
        move || {
            github_post_workflow_action(
                &app,
                &repo_full_name,
                &format!("actions/runs/{run_id}/rerun-failed-jobs"),
                "重跑 GitHub Actions 失败",
            )
        },
    )
    .await
}

pub async fn github_cancel_workflow_run(
    app: AppHandle,
    repo_full_name: String,
    run_id: u64,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "取消 GitHub Actions 运行",
        move || {
            github_post_workflow_action(
                &app,
                &repo_full_name,
                &format!("actions/runs/{run_id}/cancel"),
                "取消 GitHub Actions 运行失败",
            )
        },
    )
    .await
}

pub async fn github_rerun_workflow_job(
    app: AppHandle,
    repo_full_name: String,
    job_id: u64,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "重跑 GitHub Actions job",
        move || {
            github_post_workflow_action(
                &app,
                &repo_full_name,
                &format!("actions/jobs/{job_id}/rerun"),
                "重跑 GitHub Actions 失败",
            )
        },
    )
    .await
}

fn ensure_github_artifact_zip(
    app: &AppHandle,
    repo_full_name: &str,
    artifact_id: u64,
) -> Result<PathBuf, String> {
    with_github_artifact_guard(repo_full_name, artifact_id, || {
        ensure_github_artifact_zip_guarded(app, repo_full_name, artifact_id)
    })
}

fn ensure_github_artifact_zip_guarded(
    app: &AppHandle,
    repo_full_name: &str,
    artifact_id: u64,
) -> Result<PathBuf, String> {
    let path = github_artifact_cache_path(repo_full_name, artifact_id);
    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.len() <= GITHUB_ACTIONS_ARTIFACT_MAX_BYTES {
            return Ok(path);
        }
        let _ = fs::remove_file(&path);
    }
    let (_binding, token) = github_require_token(app)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("构造 GitHub HTTP 客户端失败：{e}"))?;
    let response = github_send(
        app,
        "下载 GitHub Actions artifact 失败",
        github_headers(
            client.get(format!(
                "{}/actions/artifacts/{artifact_id}/zip",
                github_repo_api_url(repo_full_name)?
            )),
            Some(&token),
        ),
    )?;
    if response
        .content_length()
        .is_some_and(|size| size > GITHUB_ACTIONS_ARTIFACT_MAX_BYTES)
    {
        return Err("artifact 超过 200 MB，已跳过内置预览".to_string());
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("下载 GitHub Actions artifact 失败：读取响应失败：{e}"))?;
    if bytes.len() as u64 > GITHUB_ACTIONS_ARTIFACT_MAX_BYTES {
        return Err("artifact 超过 200 MB，已跳过内置预览".to_string());
    }
    let Some(parent) = path.parent() else {
        return Err("artifact 缓存路径无效".to_string());
    };
    fs::create_dir_all(parent)
        .map_err(|e| format!("创建 artifact 缓存目录失败：{}（{e}）", parent.display()))?;
    fs::write(&path, bytes)
        .map_err(|e| format!("保存 artifact 缓存失败：{}（{e}）", path.display()))?;
    Ok(path)
}

type GitHubArtifactKey = (String, u64);

fn github_artifact_guards() -> &'static Mutex<HashMap<GitHubArtifactKey, Weak<Mutex<()>>>> {
    static GUARDS: OnceLock<Mutex<HashMap<GitHubArtifactKey, Weak<Mutex<()>>>>> = OnceLock::new();
    GUARDS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn github_artifact_guard(repo_full_name: &str, artifact_id: u64) -> Arc<Mutex<()>> {
    let key = (repo_full_name.to_ascii_lowercase(), artifact_id);
    let mut guards = github_artifact_guards()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    guards.retain(|_, guard| guard.strong_count() > 0);
    if let Some(guard) = guards.get(&key).and_then(Weak::upgrade) {
        return guard;
    }
    let guard = Arc::new(Mutex::new(()));
    guards.insert(key, Arc::downgrade(&guard));
    guard
}

fn with_github_artifact_guard<T>(
    repo_full_name: &str,
    artifact_id: u64,
    run: impl FnOnce() -> T,
) -> T {
    let guard = github_artifact_guard(repo_full_name, artifact_id);
    let _held = guard.lock().unwrap_or_else(|error| error.into_inner());
    run()
}

#[cfg(test)]
mod artifact_lock_tests {
    use super::with_github_artifact_guard;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn identical_artifact_resource_downloads_once_after_locked_recheck() {
        let cached = Arc::new(AtomicBool::new(false));
        let downloads = Arc::new(AtomicUsize::new(0));
        let workers = (0..8)
            .map(|_| {
                let cached = Arc::clone(&cached);
                let downloads = Arc::clone(&downloads);
                std::thread::spawn(move || {
                    with_github_artifact_guard("Owner/Repo", 42, || {
                        if !cached.swap(true, Ordering::SeqCst) {
                            downloads.fetch_add(1, Ordering::SeqCst);
                        }
                    });
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(downloads.load(Ordering::SeqCst), 1);
    }
}

pub async fn github_list_workflow_artifact_files(
    app: AppHandle,
    repo_full_name: String,
    artifact_id: u64,
) -> Result<Vec<GitHubWorkflowArtifactEntry>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubTransfer,
        "读取 GitHub Actions artifact",
        move || {
            let path = ensure_github_artifact_zip(&app, &repo_full_name, artifact_id)?;
            let bytes = fs::read(&path)
                .map_err(|e| format!("读取 artifact 缓存失败：{}（{e}）", path.display()))?;
            let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
                .map_err(|e| format!("读取 artifact ZIP 失败：{e}"))?;
            let mut entries = Vec::new();
            for index in 0..archive.len() {
                let file = archive
                    .by_index(index)
                    .map_err(|e| format!("读取 artifact ZIP 条目失败：{e}"))?;
                if let Some(entry) = github_artifact_entry_from_zip_file(&file)? {
                    entries.push(entry);
                }
            }
            entries.sort_by(|left, right| {
                (right.kind == "dir")
                    .cmp(&(left.kind == "dir"))
                    .then_with(|| {
                        left.path
                            .to_ascii_lowercase()
                            .cmp(&right.path.to_ascii_lowercase())
                    })
                    .then_with(|| left.path.cmp(&right.path))
            });
            Ok(entries)
        },
    )
    .await
}

pub async fn github_get_workflow_artifact_file_preview(
    app: AppHandle,
    repo_full_name: String,
    artifact_id: u64,
    path: String,
) -> Result<RepoFilePreview, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubTransfer,
        "预览 GitHub Actions artifact 文件",
        move || {
            let requested_path = github_artifact_requested_file_path(&path)?;
            let cache_path = ensure_github_artifact_zip(&app, &repo_full_name, artifact_id)?;
            let bytes = fs::read(&cache_path)
                .map_err(|e| format!("读取 artifact 缓存失败：{}（{e}）", cache_path.display()))?;
            let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
                .map_err(|e| format!("读取 artifact ZIP 失败：{e}"))?;
            for index in 0..archive.len() {
                let mut file = archive
                    .by_index(index)
                    .map_err(|e| format!("读取 artifact ZIP 条目失败：{e}"))?;
                let Some(enclosed_name) = file.enclosed_name() else {
                    continue;
                };
                let entry_path = github_artifact_entry_path(&enclosed_name)?;
                if entry_path != requested_path {
                    continue;
                }
                if file.is_dir() {
                    return Err("不能预览 artifact 目录".to_string());
                }
                let size = file.size();
                if size > MAX_FILE_PREVIEW_BYTES {
                    return Ok(github_artifact_preview_from_bytes(
                        entry_path,
                        size,
                        Vec::new(),
                    ));
                }
                let mut file_bytes = Vec::with_capacity(size as usize);
                file.read_to_end(&mut file_bytes)
                    .map_err(|e| format!("读取 artifact 文件失败：{e}"))?;
                return Ok(github_artifact_preview_from_bytes(
                    entry_path, size, file_bytes,
                ));
            }
            Err("artifact 文件不存在".to_string())
        },
    )
    .await
}

pub async fn github_list_repo_commits(
    app: AppHandle,
    repo_full_name: String,
    per_page: Option<u32>,
    sha: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Vec<CommitSummary>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 提交历史",
        move || {
            let sha = sha
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let commits_key = github_commit_list_cache_key(per_page, sha.as_deref());
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| repo_cache.commits.get(&commits_key).cloned())
                {
                    return Ok(cached);
                }
            }
            let (_binding, token) = github_require_token(&app)?;
            let commits_per_page = per_page.unwrap_or(100).clamp(1, 100).to_string();
            let client = build_client()?;
            let mut request = client
                .get(format!("{}/commits", github_repo_api_url(&repo_full_name)?))
                .query(&[("per_page", commits_per_page.as_str())]);
            if let Some(sha) = sha.as_deref() {
                request = request.query(&[("sha", sha)]);
            }
            let response = github_send(
                &app,
                "读取 GitHub 提交历史失败",
                github_headers(request, Some(&token)),
            )?;
            let commits =
                github_json::<Vec<GitHubCommitResponse>>("读取 GitHub 提交历史失败", response)?
                    .into_iter()
                    .map(github_commit_summary_from_response)
                    .collect::<Vec<_>>();
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache.commits.insert(commits_key, commits.clone());
            })?;
            Ok(commits)
        },
    )
    .await
}

pub async fn github_get_repo_commit_detail(
    app: AppHandle,
    repo_full_name: String,
    hash: String,
    force_refresh: Option<bool>,
) -> Result<CommitDetail, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 提交详情",
        move || {
            let hash = hash.trim().to_string();
            if hash.is_empty() {
                return Err("提交 hash 不能为空".to_string());
            }
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| {
                        repo_cache.commit_details.get(&hash).cloned().or_else(|| {
                            repo_cache
                                .commit_details
                                .values()
                                .find(|detail| detail.hash == hash || detail.short_hash == hash)
                                .cloned()
                        })
                    })
                {
                    return Ok(cached);
                }
            }
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub 提交详情失败",
                github_headers(
                    client.get(format!(
                        "{}/commits/{}",
                        github_repo_api_url(&repo_full_name)?,
                        hash
                    )),
                    Some(&token),
                ),
            )?;
            let detail = github_commit_detail_from_response(github_json::<GitHubCommitResponse>(
                "读取 GitHub 提交详情失败",
                response,
            )?);
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache
                    .commit_details
                    .insert(detail.hash.clone(), detail.clone());
                repo_cache
                    .commit_details
                    .insert(detail.short_hash.clone(), detail.clone());
            })?;
            Ok(detail)
        },
    )
    .await
}

pub async fn github_list_releases(
    app: AppHandle,
    repo_full_name: String,
    force_refresh: Option<bool>,
) -> Result<Vec<GitHubRelease>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Releases",
        move || {
            let cache_key = github_project_cache_repo_key(&repo_full_name)?;
            if github_project_cache_enabled(force_refresh) {
                if let Some(cached) = load_github_project_cache(&app)
                    .repos
                    .get(&cache_key)
                    .and_then(|repo_cache| repo_cache.releases.clone())
                {
                    return Ok(cached);
                }
            }
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub Releases 失败",
                github_headers(
                    client
                        .get(format!(
                            "{}/releases",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .query(&[("per_page", "100")]),
                    Some(&token),
                ),
            )?;
            let releases =
                github_json::<Vec<GitHubReleaseResponse>>("读取 GitHub Releases 失败", response)?
                    .into_iter()
                    .map(github_release_from_response)
                    .collect::<Vec<_>>();
            update_github_project_repo_cache(&app, &repo_full_name, |repo_cache| {
                repo_cache.releases = Some(releases.clone());
            })?;
            Ok(releases)
        },
    )
    .await
}

pub async fn github_get_release_by_tag(
    app: AppHandle,
    repo_full_name: String,
    tag_name: String,
) -> Result<GitHubRelease, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Release",
        move || {
            let normalized_tag = tag_name.trim();
            if normalized_tag.is_empty() {
                return Err("Release tag 不能为空".to_string());
            }
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub Release 失败",
                github_headers(
                    client.get(format!(
                        "{}/releases/tags/{}",
                        github_repo_api_url(&repo_full_name)?,
                        url_encode_path_segment(normalized_tag),
                    )),
                    Some(&token),
                ),
            )?;
            Ok(github_release_from_response(github_json::<
                GitHubReleaseResponse,
            >(
                "读取 GitHub Release 失败",
                response,
            )?))
        },
    )
    .await
}

pub async fn github_create_release(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubCreateReleaseRequest,
) -> Result<GitHubRelease, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "创建 GitHub Release",
        move || {
            let tag_name = request.tag_name.trim().to_string();
            if tag_name.is_empty() {
                return Err("Release tag 不能为空".to_string());
            }
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let mut payload = serde_json::Map::new();
            payload.insert("tag_name".to_string(), serde_json::Value::String(tag_name));
            payload.insert(
                "draft".to_string(),
                serde_json::Value::Bool(request.draft.unwrap_or(false)),
            );
            payload.insert(
                "prerelease".to_string(),
                serde_json::Value::Bool(request.prerelease.unwrap_or(false)),
            );
            payload.insert(
                "generate_release_notes".to_string(),
                serde_json::Value::Bool(request.generate_release_notes.unwrap_or(false)),
            );
            insert_optional_release_string(
                &mut payload,
                "target_commitish",
                request.target_commitish,
            );
            insert_optional_release_string(&mut payload, "name", request.name);
            insert_optional_release_string(&mut payload, "body", request.body);
            insert_optional_release_string(&mut payload, "make_latest", request.make_latest);
            let response = github_send(
                &app,
                "创建 GitHub Release 失败",
                github_headers(
                    client
                        .post(format!(
                            "{}/releases",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&payload),
                    Some(&token),
                ),
            )?;
            let release = github_release_from_response(github_json::<GitHubReleaseResponse>(
                "创建 GitHub Release 失败",
                response,
            )?);
            clear_github_project_release_cache(&app, &repo_full_name)?;
            Ok(release)
        },
    )
    .await
}

pub async fn github_update_release(
    app: AppHandle,
    repo_full_name: String,
    release_id: u64,
    request: GitHubUpdateReleaseRequest,
) -> Result<GitHubRelease, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "更新 GitHub Release",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let mut payload = serde_json::Map::new();
            insert_optional_release_string(&mut payload, "tag_name", request.tag_name);
            insert_optional_release_string(
                &mut payload,
                "target_commitish",
                request.target_commitish,
            );
            insert_optional_release_string(&mut payload, "name", request.name);
            insert_optional_release_string(&mut payload, "body", request.body);
            insert_optional_release_bool(&mut payload, "draft", request.draft);
            insert_optional_release_bool(&mut payload, "prerelease", request.prerelease);
            insert_optional_release_string(&mut payload, "make_latest", request.make_latest);
            let response = github_send(
                &app,
                "更新 GitHub Release 失败",
                github_headers(
                    client
                        .patch(format!(
                            "{}/releases/{release_id}",
                            github_repo_api_url(&repo_full_name)?
                        ))
                        .json(&payload),
                    Some(&token),
                ),
            )?;
            let release = github_release_from_response(github_json::<GitHubReleaseResponse>(
                "更新 GitHub Release 失败",
                response,
            )?);
            clear_github_project_release_cache(&app, &repo_full_name)?;
            Ok(release)
        },
    )
    .await
}

pub async fn github_delete_release(
    app: AppHandle,
    repo_full_name: String,
    release_id: u64,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "删除 GitHub Release",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "删除 GitHub Release 失败",
                github_headers(
                    client.delete(format!(
                        "{}/releases/{release_id}",
                        github_repo_api_url(&repo_full_name)?
                    )),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error("删除 GitHub Release 失败", response));
            }
            clear_github_project_release_cache(&app, &repo_full_name)?;
            Ok(())
        },
    )
    .await
}

fn github_release_for_asset_upload(
    app: &AppHandle,
    client: &Client,
    repo_full_name: &str,
    release_id: u64,
    token: &str,
) -> Result<GitHubRelease, String> {
    let response = github_send(
        app,
        "读取 GitHub Release 失败",
        github_headers(
            client.get(format!(
                "{}/releases/{release_id}",
                github_repo_api_url(repo_full_name)?
            )),
            Some(token),
        ),
    )?;
    Ok(github_release_from_response(github_json::<
        GitHubReleaseResponse,
    >(
        "读取 GitHub Release 失败",
        response,
    )?))
}

pub(super) fn github_validate_release_for_artifact_asset(
    release: &GitHubRelease,
    expected_tag_name: &str,
    asset_name: &str,
) -> Result<(), String> {
    let expected_tag_name = expected_tag_name.trim();
    if expected_tag_name.is_empty() {
        return Err("Release tag 不能为空".to_string());
    }
    if release.tag_name != expected_tag_name {
        return Err(format!(
            "Release tag 不匹配：artifact 期望 {expected_tag_name}，当前 draft release 是 {}",
            release.tag_name
        ));
    }
    if !release.draft {
        return Err("只能把 Actions artifact 附加到 draft release".to_string());
    }
    if release.assets.iter().any(|asset| asset.name == asset_name) {
        return Err("Release asset 已存在，请先删除旧文件后再上传".to_string());
    }
    Ok(())
}

fn github_validate_artifact_for_run(
    app: &AppHandle,
    client: &Client,
    repo_full_name: &str,
    token: &str,
    run_id: u64,
    artifact_id: u64,
    artifact_name: Option<String>,
) -> Result<(), String> {
    let response = github_send(
        app,
        "读取 GitHub Actions artifacts 失败",
        github_headers(
            client
                .get(format!(
                    "{}/actions/runs/{run_id}/artifacts",
                    github_repo_api_url(repo_full_name)?
                ))
                .query(&[("per_page", "100")]),
            Some(token),
        ),
    )?;
    let artifacts = github_json::<GitHubWorkflowArtifactsResponse>(
        "读取 GitHub Actions artifacts 失败",
        response,
    )?;
    let Some(artifact) = artifacts
        .artifacts
        .into_iter()
        .find(|artifact| artifact.id == artifact_id)
    else {
        return Err("artifact 不属于当前 Actions run".to_string());
    };
    if artifact.expired {
        return Err("artifact 已过期，不能附加到 Release".to_string());
    }
    if let Some(expected_name) = normalize_optional_string(artifact_name) {
        let actual_name = normalize_optional_string(artifact.name).unwrap_or_default();
        if actual_name != expected_name {
            return Err(format!(
                "artifact 名称不匹配：期望 {expected_name}，当前是 {actual_name}"
            ));
        }
    }
    Ok(())
}

fn github_upload_release_asset_bytes(
    app: &AppHandle,
    client: &Client,
    repo_full_name: &str,
    token: &str,
    release: &GitHubRelease,
    asset_name: &str,
    bytes: Vec<u8>,
    label: Option<String>,
) -> Result<GitHubReleaseAsset, String> {
    let upload_url = github_release_upload_base_url(&release.upload_url)?;
    let mut request = client
        .post(upload_url)
        .query(&[("name", asset_name)])
        .header(CONTENT_TYPE, "application/octet-stream")
        .body(bytes);
    if let Some(label) = normalize_optional_string(label) {
        request = request.query(&[("label", label.as_str())]);
    }
    let response = github_send(
        app,
        "上传 GitHub Release asset 失败",
        github_headers(request, Some(token)),
    )?;
    let asset = github_release_asset_from_response(github_json::<GitHubReleaseAssetResponse>(
        "上传 GitHub Release asset 失败",
        response,
    )?);
    clear_github_project_release_cache(app, repo_full_name)?;
    Ok(asset)
}

pub async fn github_upload_release_asset(
    app: AppHandle,
    repo_full_name: String,
    release_id: u64,
    file_path: String,
    label: Option<String>,
) -> Result<GitHubReleaseAsset, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubTransfer,
        "上传 GitHub Release asset",
        move || {
            let asset_name = github_release_asset_name(&file_path)?;
            let bytes = github_release_asset_bytes(&file_path)?;
            if bytes.is_empty() {
                return Err("Release asset 文件不能为空".to_string());
            }
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let release = github_release_for_asset_upload(
                &app,
                &client,
                &repo_full_name,
                release_id,
                &token,
            )?;
            if release.assets.iter().any(|asset| asset.name == asset_name) {
                return Err("Release asset 已存在，请先删除旧文件后再上传".to_string());
            }
            github_upload_release_asset_bytes(
                &app,
                &client,
                &repo_full_name,
                &token,
                &release,
                &asset_name,
                bytes,
                label,
            )
        },
    )
    .await
}

pub async fn github_attach_workflow_artifact_asset(
    app: AppHandle,
    repo_full_name: String,
    request: GitHubAttachWorkflowArtifactAssetRequest,
) -> Result<GitHubReleaseAsset, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubTransfer,
        "附加 GitHub Actions artifact 到 Release",
        move || {
            let cache_path =
                ensure_github_artifact_zip(&app, &repo_full_name, request.artifact_id)?;
            let (artifact_path, bytes) =
                github_artifact_file_bytes_from_zip(&cache_path, &request.artifact_path)?;
            let asset_name = github_release_asset_name(&artifact_path)?;
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            github_validate_artifact_for_run(
                &app,
                &client,
                &repo_full_name,
                &token,
                request.run_id,
                request.artifact_id,
                request.artifact_name,
            )?;
            let release = github_release_for_asset_upload(
                &app,
                &client,
                &repo_full_name,
                request.release_id,
                &token,
            )?;
            github_validate_release_for_artifact_asset(
                &release,
                &request.expected_tag_name,
                &asset_name,
            )?;
            github_upload_release_asset_bytes(
                &app,
                &client,
                &repo_full_name,
                &token,
                &release,
                &asset_name,
                bytes,
                request.label,
            )
        },
    )
    .await
}

pub async fn github_delete_release_asset(
    app: AppHandle,
    repo_full_name: String,
    release_id: u64,
    asset_id: u64,
) -> Result<(), String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubWrite,
        "删除 GitHub Release asset",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let response = github_send(
                &app,
                "删除 GitHub Release asset 失败",
                github_headers(
                    client.delete(format!(
                        "{}/releases/assets/{asset_id}",
                        github_repo_api_url(&repo_full_name)?
                    )),
                    Some(&token),
                ),
            )?;
            if !response.status().is_success() {
                return Err(github_http_error(
                    "删除 GitHub Release asset 失败",
                    response,
                ));
            }
            let _ = release_id;
            clear_github_project_release_cache(&app, &repo_full_name)?;
            Ok(())
        },
    )
    .await
}

pub async fn github_list_repo_files(
    app: AppHandle,
    repo_full_name: String,
    parent_path: Option<String>,
    ref_name: Option<String>,
    _force_refresh: Option<bool>,
) -> Result<Vec<RepoFileTreeEntry>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 文件树",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let mut request = client.get(github_repo_contents_api_url(
                &repo_full_name,
                parent_path.as_deref(),
            )?);
            if let Some(ref_name) = normalize_github_ref_name(ref_name.as_deref()) {
                request = request.query(&[("ref", ref_name)]);
            }
            let response = github_send(
                &app,
                "读取 GitHub 文件树失败",
                github_headers(request, Some(&token)),
            )?;
            if response.status() == StatusCode::NOT_FOUND {
                return Ok(Vec::new());
            }
            let items =
                github_json::<Vec<GitHubContentListItem>>("读取 GitHub 文件树失败", response)?;
            Ok(github_content_items_to_file_entries(items))
        },
    )
    .await
}

pub async fn github_get_repo_file_preview(
    app: AppHandle,
    repo_full_name: String,
    path: String,
    ref_name: Option<String>,
    _force_refresh: Option<bool>,
) -> Result<RepoFilePreview, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 文件预览",
        move || {
            let path = normalize_github_content_path(Some(&path))?;
            if path.is_empty() {
                return Err("GitHub 文件路径不能为空".to_string());
            }
            let (_binding, token) = github_require_token(&app)?;
            let client = build_client()?;
            let mut request =
                client.get(github_repo_contents_api_url(&repo_full_name, Some(&path))?);
            if let Some(ref_name) = normalize_github_ref_name(ref_name.as_deref()) {
                request = request.query(&[("ref", ref_name)]);
            }
            let response = github_send(
                &app,
                "读取 GitHub 文件预览失败",
                github_headers(request, Some(&token)),
            )?;
            let file =
                github_json::<GitHubContentFileResponse>("读取 GitHub 文件预览失败", response)?;
            github_file_preview_from_content("读取 GitHub 文件预览失败", file)
        },
    )
    .await
}

pub async fn github_list_account_issues(
    app: AppHandle,
    state: Option<String>,
    per_page: Option<u32>,
    sort: Option<String>,
    direction: Option<String>,
    _force_refresh: Option<bool>,
) -> Result<Vec<GitHubAccountIssueItem>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub 待处理 Issue",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let issue_state = state.unwrap_or_else(|| "open".to_string());
            let issue_per_page = per_page.unwrap_or(100).clamp(1, 100).to_string();
            let issue_sort = match sort.as_deref() {
                Some("created") => "created",
                Some("comments") => "comments",
                _ => "updated",
            };
            let issue_direction = match direction.as_deref() {
                Some("asc") => "asc",
                _ => "desc",
            };
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub 待处理 Issue 失败",
                github_headers(
                    client.get("https://api.github.com/issues").query(&[
                        ("filter", "all"),
                        ("state", issue_state.as_str()),
                        ("per_page", issue_per_page.as_str()),
                        ("sort", issue_sort),
                        ("direction", issue_direction),
                    ]),
                    Some(&token),
                ),
            )?;
            let items =
                github_json::<Vec<GitHubIssueResponse>>("读取 GitHub 待处理 Issue 失败", response)?;
            Ok(items
                .into_iter()
                .filter_map(github_account_issue_item_from_response)
                .collect())
        },
    )
    .await
}

pub async fn github_list_action_notifications(
    app: AppHandle,
    per_page: Option<u32>,
    _force_refresh: Option<bool>,
) -> Result<Vec<GitHubActionNotification>, String> {
    run_core_operation(
        app.clone(),
        OperationKind::GitHubRead,
        "读取 GitHub Actions 通知",
        move || {
            let (_binding, token) = github_require_token(&app)?;
            let notification_per_page = per_page.unwrap_or(50).clamp(1, 100).to_string();
            let client = build_client()?;
            let response = github_send(
                &app,
                "读取 GitHub Actions 通知失败",
                github_headers(
                    client.get("https://api.github.com/notifications").query(&[
                        ("all", "false"),
                        ("participating", "false"),
                        ("per_page", notification_per_page.as_str()),
                    ]),
                    Some(&token),
                ),
            )?;
            let notifications = github_json::<Vec<GitHubNotificationResponse>>(
                "读取 GitHub Actions 通知失败",
                response,
            )?;
            Ok(notifications
                .into_iter()
                .filter_map(github_action_notification_from_response)
                .collect())
        },
    )
    .await
}

pub async fn github_list_repo_contribution(
    app: AppHandle,
    repo_full_name: String,
) -> Result<GitHubContributionResult, String> {
    let Some(repo_id) = normalize_local_contribution_repo_id(&repo_full_name) else {
        return run_core_operation_as(
            app,
            OperationKind::WorkspaceAnalysis,
            Some("contributions"),
            "读取本地提交贡献",
            move || {
                let end_day_index = current_utc_day_index();
                return Ok(github_contribution_result(
                    &HashMap::new(),
                    end_day_index,
                    0,
                    0,
                    0,
                ));
            },
        )
        .await;
    };
    run_repo_analysis_blocking(
        app.clone(),
        repo_id.clone(),
        "contributions",
        "读取本地提交贡献",
        move || {
            let end_day_index = current_utc_day_index();
            let start_day_index = end_day_index - GITHUB_CONTRIBUTION_DAYS as i64 + 1;
            let path = repo_path_by_id(&app, &repo_id)?;
            let settings = load_settings(&app);
            let identities = local_contribution_identities(&path, &settings);
            if identities.is_empty() {
                return Ok(github_contribution_result(
                    &HashMap::new(),
                    end_day_index,
                    0,
                    1,
                    1,
                ));
            }
            let mut counts = HashMap::new();
            collect_local_contribution_counts(
                &path,
                start_day_index,
                end_day_index,
                &identities,
                &mut counts,
            )?;
            Ok(github_contribution_result(&counts, end_day_index, 1, 1, 0))
        },
    )
    .await
}

pub(super) fn github_contribution_result(
    counts: &HashMap<String, usize>,
    end_day_index: i64,
    repo_count: usize,
    requested_repo_count: usize,
    skipped_repo_count: usize,
) -> GitHubContributionResult {
    GitHubContributionResult {
        days: github_contribution_days(counts, end_day_index),
        meta: github_contribution_meta(repo_count, requested_repo_count, skipped_repo_count),
    }
}
