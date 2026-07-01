use lilia_github_contracts::workspace::*;

delegate_command!(launch; fn repo_get_launch_config(app: AppHandle, repo_id: String,) -> Result<Option<ProjectLaunchConfig>, String>);
delegate_command!(launch; fn repo_list_launch_candidates(app: AppHandle, repo_id: String,) -> Result<Vec<ProjectLaunchCandidate>, String>);
delegate_command!(launch; fn repo_save_launch_config(app: AppHandle, repo_id: String, command: String, cwd: Option<String>,) -> Result<ProjectLaunchConfig, String>);
delegate_command!(launch; fn repo_get_launch_status(_app: AppHandle, repo_id: String,) -> Result<ProjectLaunchStatus, String>);
delegate_command!(launch; fn repo_get_launch_logs(repo_id: String, since: Option<u64>,) -> Result<Vec<ProjectLaunchLog>, String>);
delegate_command!(launch; fn repo_list_launch_history(app: AppHandle, repo_id: String,) -> Result<Vec<ProjectLaunchHistoryEntry>, String>);
delegate_command!(launch; fn repo_start_launch(app: AppHandle, repo_id: String) -> Result<ProjectLaunchStatus, String>);
delegate_command!(launch; fn repo_stop_launch(app: AppHandle, repo_id: String) -> Result<ProjectLaunchStatus, String>);
