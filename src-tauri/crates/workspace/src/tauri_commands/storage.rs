use lilia_github_contracts::workspace::RepoStorageStats;

delegate_command!(async storage; fn repo_get_storage_stats(app: AppHandle, repo_id: String) -> Result<RepoStorageStats, String>);
