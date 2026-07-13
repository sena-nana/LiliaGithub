use lilia_github_contracts::workspace::*;

delegate_command!(async bulk; fn bulk_sync_preview(_app: AppHandle, operation: String, repos: Vec<RepoSummary>, local_changes_mode: Option<RepoPullLocalChangesMode>,) -> Result<BulkSyncPreview, String>);
delegate_command!(async bulk; fn bulk_sync_execute(app: AppHandle, operation: String, repo_ids: Vec<String>, local_changes_mode: Option<RepoPullLocalChangesMode>, trigger: Option<String>,) -> Result<Vec<BulkSyncResult>, String>);
