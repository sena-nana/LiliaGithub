use super::*;

pub(super) const STORE_FILE: &str = "lilia-github.json";
pub(super) const SETTINGS_KEY: &str = "workspace.settings";
pub(super) fn load_settings(app: &AppHandle) -> WorkspaceSettings {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(SETTINGS_KEY))
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub(super) fn save_settings(app: &AppHandle, settings: &WorkspaceSettings) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开配置存储失败：{e}"))?;
    store.set(
        SETTINGS_KEY,
        serde_json::to_value(settings).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| format!("保存配置失败：{e}"))
}

pub(super) fn sort_dedup(values: &mut Vec<String>) {
    values.sort();
    values.dedup();
}

pub(super) fn add_managed_repo_id(settings: &mut WorkspaceSettings, repo_id: String) {
    if !settings.managed_repo_ids.iter().any(|id| id == &repo_id) {
        settings.managed_repo_ids.push(repo_id);
        sort_dedup(&mut settings.managed_repo_ids);
    }
}

fn repo_group_name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn next_repo_group_id(settings: &WorkspaceSettings) -> String {
    let mut seed = now_millis();
    loop {
        let id = format!("repo-group-{seed}");
        if !settings.repo_groups.iter().any(|group| group.id == id) {
            return id;
        }
        seed += 1;
    }
}

pub(super) fn create_repo_group(
    settings: &mut WorkspaceSettings,
    name: &str,
) -> Result<WorkspaceRepoGroup, String> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err("分组名称不能为空".to_string());
    }
    let name_key = repo_group_name_key(normalized);
    if settings
        .repo_groups
        .iter()
        .any(|group| repo_group_name_key(&group.name) == name_key)
    {
        return Err("已存在同名仓库分组".to_string());
    }
    let group = WorkspaceRepoGroup {
        id: next_repo_group_id(settings),
        name: normalized.to_string(),
        repo_ids: Vec::new(),
    };
    settings.repo_groups.push(group.clone());
    Ok(group)
}

pub(super) fn rename_repo_group(
    settings: &mut WorkspaceSettings,
    group_id: &str,
    name: &str,
) -> Result<(), String> {
    let normalized_group_id = group_id.trim();
    let normalized_name = name.trim();
    if normalized_group_id.is_empty() {
        return Err("分组 ID 不能为空".to_string());
    }
    if normalized_name.is_empty() {
        return Err("分组名称不能为空".to_string());
    }
    if !settings
        .repo_groups
        .iter()
        .any(|group| group.id == normalized_group_id)
    {
        return Err("未找到仓库分组".to_string());
    }
    let name_key = repo_group_name_key(normalized_name);
    if settings.repo_groups.iter().any(|group| {
        group.id != normalized_group_id && repo_group_name_key(&group.name) == name_key
    }) {
        return Err("已存在同名仓库分组".to_string());
    }
    if let Some(group) = settings
        .repo_groups
        .iter_mut()
        .find(|group| group.id == normalized_group_id)
    {
        group.name = normalized_name.to_string();
    }
    Ok(())
}

pub(super) fn delete_repo_group(
    settings: &mut WorkspaceSettings,
    group_id: &str,
) -> Result<(), String> {
    let normalized = group_id.trim();
    if normalized.is_empty() {
        return Err("分组 ID 不能为空".to_string());
    }
    let before = settings.repo_groups.len();
    settings.repo_groups.retain(|group| group.id != normalized);
    if settings.repo_groups.len() == before {
        return Err("未找到仓库分组".to_string());
    }
    Ok(())
}

pub(super) fn move_repo_to_group(
    settings: &mut WorkspaceSettings,
    repo_id: &str,
    group_id: Option<&str>,
) -> Result<(), String> {
    let normalized_repo_id = repo_id.trim();
    if normalized_repo_id.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    let normalized_group_id = group_id.and_then(|id| {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    if let Some(target_group_id) = normalized_group_id {
        if !settings
            .repo_groups
            .iter()
            .any(|group| group.id == target_group_id)
        {
            return Err("未找到仓库分组".to_string());
        }
    }
    for group in &mut settings.repo_groups {
        group.repo_ids.retain(|id| id != normalized_repo_id);
        if normalized_group_id == Some(group.id.as_str()) {
            group.repo_ids.push(normalized_repo_id.to_string());
            sort_dedup(&mut group.repo_ids);
        }
    }
    Ok(())
}

pub(super) fn remove_system_git_repo_id(
    settings: &mut WorkspaceSettings,
    repo_id: &str,
) -> Result<(), String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    settings.system_git_repo_ids.retain(|id| id != normalized);
    Ok(())
}

pub(super) fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = load_settings(app);
    let Some(root) = settings.workspace_root else {
        return Err("请先选择工作区文件夹".to_string());
    };
    let path = PathBuf::from(root);
    if !path.exists() || !path.is_dir() {
        return Err(format!("工作区不存在或不是文件夹：{}", path.display()));
    }
    Ok(path)
}

pub(super) fn repo_path_by_id(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let root = workspace_root(app)?;
    let target = root.join(id.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !target.exists() || !is_git_repo(&target) {
        return Err(format!("未找到 Git 仓库：{id}"));
    }
    Ok(target)
}

pub(super) fn remove_managed_repo_path(
    root: &Path,
    path: &Path,
    worktree: &ResolvedRepoWorktree,
) -> Result<(), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("读取工作区路径失败：{e}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("读取仓库路径失败：{e}"))?;
    if canonical_path == canonical_root || !canonical_path.starts_with(&canonical_root) {
        return Err("只能删除当前工作区内的仓库目录".to_string());
    }
    if worktree.summary.role == "linked" {
        let command_path = worktree
            .main_worktree_path
            .as_deref()
            .unwrap_or(canonical_path.as_path());
        git_command(
            command_path,
            &[
                "worktree",
                "remove",
                "--force",
                canonical_path.to_string_lossy().as_ref(),
            ],
            None,
        )
        .map_err(|e| format!("删除工作树失败：{e}"))?;
    } else {
        fs::remove_dir_all(&canonical_path).map_err(|e| format!("删除本地仓库失败：{e}"))?;
    }
    Ok(())
}

pub(super) fn prune_deleted_repo_settings(settings: &mut WorkspaceSettings, repo_id: &str) {
    settings.managed_repo_ids.retain(|id| id != repo_id);
    settings.hidden_repo_ids.retain(|id| id != repo_id);
    settings.system_git_repo_ids.retain(|id| id != repo_id);
    for group in &mut settings.repo_groups {
        group.repo_ids.retain(|id| id != repo_id);
    }
    settings.project_launch_configs.remove(repo_id);
    remove_local_contribution_cache(settings, repo_id);
}

#[tauri::command]
pub fn workspace_get_settings(app: AppHandle) -> WorkspaceSettings {
    load_settings(&app)
}

#[tauri::command]
pub fn workspace_set_root(
    app: AppHandle,
    workspace_root: String,
) -> Result<WorkspaceSettings, String> {
    let root = PathBuf::from(workspace_root.trim());
    if !root.exists() || !root.is_dir() {
        return Err(format!("工作区不存在或不是文件夹：{}", root.display()));
    }
    let mut settings = load_settings(&app);
    settings.workspace_root = Some(root.to_string_lossy().to_string());
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_pick_root(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择 Git 工作区")
        .blocking_pick_folder();
    Ok(picked.map(|path| path.to_string()))
}

#[tauri::command]
pub fn workspace_pick_repo(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择 Git 仓库")
        .blocking_pick_folder();
    Ok(picked.map(|path| path.to_string()))
}

#[tauri::command]
pub fn workspace_hide_repo(app: AppHandle, repo_id: String) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    repo_path_by_id(&app, normalized)?;
    let mut settings = load_settings(&app);
    if !settings.hidden_repo_ids.iter().any(|id| id == normalized) {
        settings.hidden_repo_ids.push(normalized.to_string());
        settings.hidden_repo_ids.sort();
    }
    remove_local_contribution_cache(&mut settings, normalized);
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_create_repo_group(
    app: AppHandle,
    name: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    create_repo_group(&mut settings, &name)?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_rename_repo_group(
    app: AppHandle,
    group_id: String,
    name: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    rename_repo_group(&mut settings, &group_id, &name)?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_delete_repo_group(
    app: AppHandle,
    group_id: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    delete_repo_group(&mut settings, &group_id)?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_move_repo_to_group(
    app: AppHandle,
    repo_id: String,
    group_id: Option<String>,
) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    repo_path_by_id(&app, normalized)?;
    let mut settings = load_settings(&app);
    move_repo_to_group(&mut settings, normalized, group_id.as_deref())?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn workspace_delete_local_repo(
    app: AppHandle,
    repo_id: String,
) -> Result<WorkspaceSettings, String> {
    run_blocking("删除本地仓库", move || {
        let normalized = repo_id.trim();
        if normalized.is_empty() {
            return Err("仓库 ID 不能为空".to_string());
        }
        let root = workspace_root(&app)?;
        let path = repo_path_by_id(&app, normalized)?;
        let worktree = resolve_repo_worktree(&root, &path);
        remove_managed_repo_path(&root, &path, &worktree)?;
        let mut settings = load_settings(&app);
        prune_deleted_repo_settings(&mut settings, normalized);
        save_settings(&app, &settings)?;
        Ok(settings)
    })
    .await
}

#[tauri::command]
pub fn workspace_remember_remote_repo(
    app: AppHandle,
    repo: RemoteRepoShortcut,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    remember_remote_repo_shortcut(&mut settings.remote_repo_shortcuts, repo)?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_forget_remote_repo(
    app: AppHandle,
    full_name: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    forget_remote_repo_shortcut(&mut settings.remote_repo_shortcuts, &full_name)?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_unhide_repo(app: AppHandle, repo_id: String) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    let mut settings = load_settings(&app);
    settings.hidden_repo_ids.retain(|id| id != normalized);
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn repo_use_default_token_auth(
    app: AppHandle,
    repo_id: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    remove_system_git_repo_id(&mut settings, &repo_id)?;
    save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn workspace_list_hidden_repos(app: AppHandle) -> Vec<HiddenRepo> {
    let settings = load_settings(&app);
    let root = workspace_root(&app).ok();
    settings
        .hidden_repo_ids
        .into_iter()
        .map(|id| {
            let name = root
                .as_ref()
                .map(|root| root.join(id.replace('/', std::path::MAIN_SEPARATOR_STR)))
                .and_then(|path| {
                    path.file_name()
                        .and_then(|value| value.to_str())
                        .map(|value| value.to_string())
                })
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| id.clone());
            HiddenRepo { id, name }
        })
        .collect()
}
