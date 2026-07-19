use lilia_github_contracts::home_attention::GitHubHomeAttentionResult;

delegate_command!(async home_attention; fn github_list_home_attention(app: AppHandle, repo_full_names: Vec<String>, force_refresh: Option<bool>,) -> Result<GitHubHomeAttentionResult, String>);
