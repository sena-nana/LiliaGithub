use lilia_github_contracts::workspace::*;

delegate_command!(async file_browser; fn repo_list_files(app: AppHandle, repo_id: String, parent_path: Option<String>,) -> Result<Vec<RepoFileTreeEntry>, String>);
delegate_command!(async file_browser; fn repo_get_file_preview(app: AppHandle, repo_id: String, path: String,) -> Result<RepoFilePreview, String>);
