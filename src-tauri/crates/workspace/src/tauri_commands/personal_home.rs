use lilia_github_contracts::personal_home::PersonalHomeNotification;
use lilia_github_contracts::workspace::{GitHubAccountIssueItem, WorkspaceSettings};

delegate_command!(async personal_home; fn github_list_assigned_work(app: AppHandle, per_page: Option<u32>, _force_refresh: Option<bool>,) -> Result<Vec<GitHubAccountIssueItem>, String>);
delegate_command!(async personal_home; fn github_list_personal_notifications(app: AppHandle, per_page: Option<u32>, _force_refresh: Option<bool>,) -> Result<Vec<PersonalHomeNotification>, String>);
delegate_command!(personal_home; fn workspace_record_recent_local_repo(app: AppHandle, repo_id: String,) -> Result<WorkspaceSettings, String>);
