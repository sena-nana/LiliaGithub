use lilia_github_contracts::workspace::*;

delegate_command!(async bulk; fn bulk_sync_preview(app: AppHandle, operation: BulkSyncOperation, repo_ids: Vec<String>, local_changes_mode: Option<RepoPullLocalChangesMode>,) -> Result<BulkSyncPreview, String>);
delegate_command!(async bulk; fn bulk_sync_execute(app: AppHandle, operation: BulkSyncOperation, repo_ids: Vec<String>, local_changes_mode: Option<RepoPullLocalChangesMode>, trigger: Option<BulkSyncTrigger>,) -> Result<Vec<BulkSyncResult>, String>);
