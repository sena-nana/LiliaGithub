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
