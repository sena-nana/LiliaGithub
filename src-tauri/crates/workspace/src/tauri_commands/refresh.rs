use lilia_github_contracts::workspace::*;

delegate_command!(refresh; fn workspace_set_active_repo(app: AppHandle, repo_id: Option<String>) -> Result<(), String>);
delegate_command!(refresh; fn workspace_set_refresh_paused(paused: bool) -> Result<(), String>);
delegate_command!(refresh; fn workspace_enqueue_repo_refresh(app: AppHandle, request: RepoRefreshRequest) -> Result<String, String>);
