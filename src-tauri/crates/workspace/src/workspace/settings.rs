use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    forget_remote_repo_shortcut, normalize_github_repo_input, remember_remote_repo_shortcut,
    GITHUB_CONTRIBUTION_DAYS,
};
use crate::workspace::operations::{run_operation, OperationKind, OperationSpec, VisibleOperation};
use crate::workspace::repo_guard::{repo_resource_id, with_repo_guards, RepoAccess};
use crate::workspace::repos::{
    canonical_repo_path, git_command, git_command_lossy, git_common_dir, is_git_repo,
    managed_repo_paths, repo_id, resolve_remote_sync_config, resolve_repo_worktree,
    run_repo_visible_blocking, ResolvedRepoWorktree,
};
use crate::workspace::shared::{
    contribution_identity_key, contribution_identity_matches, current_utc_day_index,
    format_day_index, local_contribution_identities, now_millis, remove_local_contribution_cache,
    repo_git_identity,
};
use lilia_github_contracts::workspace::{
    AccountPreferences, CachedContributionResult, CachedRepoSummary, ContributionIdentity,
    ContributionIdentityRecommendation, ContributionIdentityRecommendationConfidence,
    ContributionIdentityRecommendationRepo, ContributionIdentityRecommendationResult,
    ContributionIdentityRecommendationSource, HiddenRepo, RemoteRepoShortcut, RepoRemoteSyncConfig,
    RepoRemoteSyncPolicy, RepoSummary, RepoSyncPreference, WorkspaceRepoGroup, WorkspaceSettings,
    WorkspaceStartupCache, WorkspaceStartupContributions,
};
use mutsuki_runtime_contracts::{DispatchLane, ResourceAccessMode};

pub(super) const STORE_FILE: &str = "lilia-github.json";
pub(super) const SETTINGS_KEY: &str = "workspace.settings";
pub(super) const STARTUP_CACHE_KEY: &str = "workspace.startupCache.v1";
#[cfg(target_os = "windows")]
const NTFS_REQUIRED: &str = "工作区必须位于 NTFS 文件系统";
const SETTINGS_VERSION: u32 = 2;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSettingsDocument {
    version: u32,
    #[serde(default)]
    binding: Option<lilia_github_contracts::workspace::GitHubBindingMetadata>,
    #[serde(default)]
    anonymous: WorkspaceSettings,
    #[serde(default)]
    profiles: HashMap<String, WorkspaceSettings>,
}

impl Default for WorkspaceSettingsDocument {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            binding: None,
            anonymous: WorkspaceSettings::default(),
            profiles: HashMap::new(),
        }
    }
}

fn startup_cache_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn settings_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn normalized_login(login: &str) -> Option<String> {
    let login = login.trim();
    (!login.is_empty()).then(|| login.to_ascii_lowercase())
}

fn profile_from_settings(mut settings: WorkspaceSettings) -> WorkspaceSettings {
    settings.github_binding = None;
    settings
}

fn migrate_legacy_settings(mut legacy: WorkspaceSettings) -> WorkspaceSettingsDocument {
    if legacy.account_preferences.default_workspace_root.is_none() {
        legacy.account_preferences.default_workspace_root = legacy.workspace_root.clone();
    }
    let binding = legacy.github_binding.clone();
    let profile = profile_from_settings(legacy);
    let mut document = WorkspaceSettingsDocument {
        binding: binding.clone(),
        ..WorkspaceSettingsDocument::default()
    };
    if let Some(key) = binding
        .as_ref()
        .and_then(|binding| normalized_login(&binding.login))
    {
        document.profiles.insert(key, profile);
    } else {
        document.anonymous = profile;
    }
    document
}

fn read_settings_document(app: &AppHandle) -> (WorkspaceSettingsDocument, bool) {
    let Some(value) = app
        .store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(SETTINGS_KEY))
    else {
        return (WorkspaceSettingsDocument::default(), false);
    };
    if value.get("version").is_some() {
        if let Ok(mut document) = serde_json::from_value::<WorkspaceSettingsDocument>(value.clone())
        {
            document.version = SETTINGS_VERSION;
            return (document, false);
        }
    }
    serde_json::from_value::<WorkspaceSettings>(value)
        .map(|legacy| (migrate_legacy_settings(legacy), true))
        .unwrap_or_else(|_| (WorkspaceSettingsDocument::default(), false))
}

fn write_settings_document(
    app: &AppHandle,
    document: &WorkspaceSettingsDocument,
) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开配置存储失败：{e}"))?;
    store.set(
        SETTINGS_KEY,
        serde_json::to_value(document).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| format!("保存配置失败：{e}"))
}

fn settings_from_document(document: &WorkspaceSettingsDocument) -> WorkspaceSettings {
    let mut settings = document
        .binding
        .as_ref()
        .and_then(|binding| normalized_login(&binding.login))
        .and_then(|key| document.profiles.get(&key).cloned())
        .unwrap_or_else(|| {
            if document.binding.is_some() {
                WorkspaceSettings::default()
            } else {
                document.anonymous.clone()
            }
        });
    settings.github_binding = document.binding.clone();
    settings
}

pub(super) fn load_settings(app: &AppHandle) -> WorkspaceSettings {
    let (document, migrated) = read_settings_document(app);
    if migrated {
        let _ = write_settings_document(app, &document);
    }
    settings_from_document(&document)
}

fn current_github_account_login(settings: &WorkspaceSettings) -> Option<String> {
    settings
        .github_binding
        .as_ref()
        .map(|binding| binding.login.trim().to_string())
        .filter(|login| !login.is_empty())
}

pub(super) fn migrate_remote_repo_shortcuts(settings: &mut WorkspaceSettings) -> bool {
    let Some(account_login) = current_github_account_login(settings) else {
        return false;
    };
    let mut changed = false;
    for shortcut in &mut settings.remote_repo_shortcuts {
        let normalized_account = shortcut
            .account_login
            .as_deref()
            .map(str::trim)
            .filter(|login| !login.is_empty());
        if normalized_account.is_none() {
            shortcut.account_login = Some(account_login.clone());
            changed = true;
        } else if shortcut.account_login.as_deref() != normalized_account {
            shortcut.account_login = normalized_account.map(str::to_string);
            changed = true;
        }
        if let Ok(repo) = normalize_github_repo_input(&shortcut.full_name) {
            let canonical_remote_url = format!("https://github.com/{}.git", repo.full_name);
            if shortcut.canonical_remote_url.as_deref() != Some(canonical_remote_url.as_str()) {
                shortcut.canonical_remote_url = Some(canonical_remote_url);
                changed = true;
            }
        }
    }
    changed
}

pub(super) fn visible_workspace_settings(mut settings: WorkspaceSettings) -> WorkspaceSettings {
    migrate_remote_repo_shortcuts(&mut settings);
    if settings.workspace_root.as_deref().is_some_and(|root| {
        let path = Path::new(root);
        !path.is_dir() || ensure_ntfs_path(path).is_err()
    }) {
        settings.workspace_root = None;
    }
    let Some(account_login) = current_github_account_login(&settings) else {
        settings.remote_repo_shortcuts.clear();
        return settings;
    };
    settings.remote_repo_shortcuts.retain(|shortcut| {
        shortcut
            .account_login
            .as_deref()
            .is_some_and(|login| login.eq_ignore_ascii_case(&account_login))
    });
    settings
}

pub(super) fn save_settings(app: &AppHandle, settings: &WorkspaceSettings) -> Result<(), String> {
    let mut settings = settings.clone();
    migrate_remote_repo_shortcuts(&mut settings);
    let (mut document, _) = read_settings_document(app);
    let profile = profile_from_settings(settings);
    if let Some(key) = document
        .binding
        .as_ref()
        .and_then(|binding| normalized_login(&binding.login))
    {
        document.profiles.insert(key, profile);
    } else {
        document.anonymous = profile;
    }
    write_settings_document(app, &document)
}

fn reset_workspace_runtime_state(app: &AppHandle) {
    crate::workspace::refresh::reset_refresh_scheduler();
    let _ = clear_startup_cache(app);
    crate::workspace::watcher::clear_repo_watchers();
}

pub(super) fn switch_github_binding(
    app: &AppHandle,
    binding: lilia_github_contracts::workspace::GitHubBindingMetadata,
) -> Result<WorkspaceSettings, String> {
    let (mut document, _) = read_settings_document(app);
    document.binding = Some(binding);
    write_settings_document(app, &document)?;
    reset_workspace_runtime_state(app);
    Ok(visible_workspace_settings(settings_from_document(
        &document,
    )))
}

pub(super) fn clear_github_binding(app: &AppHandle) -> Result<WorkspaceSettings, String> {
    let (mut document, _) = read_settings_document(app);
    document.binding = None;
    write_settings_document(app, &document)?;
    reset_workspace_runtime_state(app);
    Ok(visible_workspace_settings(settings_from_document(
        &document,
    )))
}

pub(super) fn load_startup_cache(app: &AppHandle) -> Option<WorkspaceStartupCache> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(STARTUP_CACHE_KEY))
        .and_then(|value| serde_json::from_value(value).ok())
}

pub(super) fn save_startup_cache(
    app: &AppHandle,
    cache: &WorkspaceStartupCache,
) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开启动缓存失败：{e}"))?;
    store.set(
        STARTUP_CACHE_KEY,
        serde_json::to_value(cache).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| format!("保存启动缓存失败：{e}"))
}

pub(super) fn clear_startup_cache(app: &AppHandle) -> Result<(), String> {
    let _guard = startup_cache_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    clear_startup_cache_unlocked(app)
}

fn clear_startup_cache_unlocked(app: &AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开启动缓存失败：{e}"))?;
    store.delete(STARTUP_CACHE_KEY);
    store.save().map_err(|e| format!("清理启动缓存失败：{e}"))
}

pub(super) fn startup_cache_matches_settings(
    cache: &WorkspaceStartupCache,
    settings: &WorkspaceSettings,
) -> bool {
    cache.workspace_root == settings.workspace_root
        && cache.binding_login
            == settings
                .github_binding
                .as_ref()
                .map(|binding| binding.login.clone())
}

fn startup_cache_shell(settings: &WorkspaceSettings) -> WorkspaceStartupCache {
    WorkspaceStartupCache {
        workspace_root: settings.workspace_root.clone(),
        binding_login: settings
            .github_binding
            .as_ref()
            .map(|binding| binding.login.clone()),
        ..WorkspaceStartupCache::default()
    }
}

pub(super) fn matching_startup_cache(
    app: &AppHandle,
    settings: &WorkspaceSettings,
) -> WorkspaceStartupCache {
    load_startup_cache(app)
        .filter(|cache| startup_cache_matches_settings(cache, settings))
        .unwrap_or_else(|| startup_cache_shell(settings))
}

pub(super) fn cached_repo_summary(
    cache: &WorkspaceStartupCache,
    lightweight: RepoSummary,
) -> RepoSummary {
    let Some(entry) = cache.repos_by_id.get(&lightweight.id) else {
        return lightweight;
    };
    let mut summary = entry.summary.clone();
    summary.id = lightweight.id;
    summary.name = lightweight.name;
    summary.path = lightweight.path;
    summary.relative_path = lightweight.relative_path;
    summary.worktree = lightweight.worktree;
    summary
}

pub(super) fn write_startup_repo_summary(
    app: &AppHandle,
    settings: &WorkspaceSettings,
    summary: &RepoSummary,
) -> Result<(), String> {
    let _guard = startup_cache_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut cache = matching_startup_cache(app, settings);
    let remote_checked_at = cache
        .repos_by_id
        .get(&summary.id)
        .and_then(|entry| entry.remote_checked_at);
    cache.repos_by_id.insert(
        summary.id.clone(),
        CachedRepoSummary {
            summary: summary.clone(),
            cached_at: now_millis(),
            remote_checked_at,
        },
    );
    save_startup_cache(app, &cache)
}

pub(super) fn write_startup_repo_summary_after_fetch(
    app: &AppHandle,
    settings: &WorkspaceSettings,
    summary: &RepoSummary,
    remote_checked_at: i64,
) -> Result<(), String> {
    let _guard = startup_cache_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut cache = matching_startup_cache(app, settings);
    cache.repos_by_id.insert(
        summary.id.clone(),
        CachedRepoSummary {
            summary: summary.clone(),
            cached_at: now_millis(),
            remote_checked_at: Some(remote_checked_at),
        },
    );
    save_startup_cache(app, &cache)
}

pub(super) fn write_startup_contributions(
    app: &AppHandle,
    settings: &WorkspaceSettings,
    contributions: WorkspaceStartupContributions,
) -> Result<WorkspaceStartupCache, String> {
    let _guard = startup_cache_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut cache = matching_startup_cache(app, settings);
    cache.contributions = Some(CachedContributionResult {
        days: contributions.days,
        meta: contributions.meta,
        cached_at: now_millis(),
    });
    save_startup_cache(app, &cache)?;
    Ok(cache)
}

pub(super) fn remove_startup_cache_repo(app: &AppHandle, repo_id: &str) -> Result<(), String> {
    let _guard = startup_cache_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let Some(mut cache) = load_startup_cache(app) else {
        return Ok(());
    };
    cache.repos_by_id.remove(repo_id);
    if cache.repos_by_id.is_empty() && cache.contributions.is_none() {
        clear_startup_cache_unlocked(app)
    } else {
        save_startup_cache(app, &cache)
    }
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
    ensure_ntfs_path(&path)?;
    Ok(path)
}

#[cfg(target_os = "windows")]
pub(super) fn ensure_ntfs_path(path: &Path) -> Result<(), String> {
    let file_system = volume_file_system(path)?;
    if file_system.trim().eq_ignore_ascii_case("NTFS") {
        Ok(())
    } else {
        Err(NTFS_REQUIRED.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
pub(super) fn ensure_ntfs_path(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn volume_file_system(path: &Path) -> Result<String, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{GetVolumeInformationW, GetVolumePathNameW};

    let canonical = dunce::canonicalize(path).map_err(|_| NTFS_REQUIRED.to_string())?;
    let path_wide = canonical
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut volume_path = vec![0_u16; 32_768];
    let volume_path_ok = unsafe {
        GetVolumePathNameW(
            path_wide.as_ptr(),
            volume_path.as_mut_ptr(),
            volume_path.len() as u32,
        )
    };
    if volume_path_ok == 0 {
        return Err(NTFS_REQUIRED.to_string());
    }

    let mut file_system = vec![0_u16; 64];
    let info_ok = unsafe {
        GetVolumeInformationW(
            volume_path.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            file_system.as_mut_ptr(),
            file_system.len() as u32,
        )
    };
    if info_ok == 0 {
        return Err(NTFS_REQUIRED.to_string());
    }
    let length = file_system
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(file_system.len());
    Ok(String::from_utf16_lossy(&file_system[..length]))
}

pub(super) fn repo_path_by_id(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let root = workspace_root(app)?;
    repo_path_from_id(&root, id)
}

pub(super) fn repo_path_from_id(root: &Path, id: &str) -> Result<PathBuf, String> {
    let normalized = id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    let relative = PathBuf::from(normalized.replace('/', std::path::MAIN_SEPARATOR_STR));
    if relative.is_absolute() {
        return Err(format!("未找到 Git 仓库：{normalized}"));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("读取工作区路径失败：{e}"))?;
    let target = canonical_root.join(relative);
    let canonical_target = target
        .canonicalize()
        .map_err(|_| format!("未找到 Git 仓库：{normalized}"))?;
    if !canonical_target.starts_with(&canonical_root) || !is_git_repo(&canonical_target) {
        return Err(format!("未找到 Git 仓库：{normalized}"));
    }
    Ok(canonical_target)
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
    settings.repo_bindings.remove(repo_id);
    for group in &mut settings.repo_groups {
        group.repo_ids.retain(|id| id != repo_id);
    }
    settings.project_launch_configs.remove(repo_id);
    settings.repo_sync_preferences.remove(repo_id);
    settings.repo_remote_sync_policies.remove(repo_id);
    remove_local_contribution_cache(settings, repo_id);
}

pub fn workspace_get_settings(app: AppHandle) -> WorkspaceSettings {
    let mut settings = load_settings(&app);
    if migrate_remote_repo_shortcuts(&mut settings) {
        let _ = save_settings(&app, &settings);
    }
    visible_workspace_settings(settings)
}

pub fn workspace_read_startup_cache(app: AppHandle) -> Option<WorkspaceStartupCache> {
    let settings = load_settings(&app);
    if let Some(root) = settings.workspace_root.as_deref() {
        let path = PathBuf::from(root);
        if ensure_ntfs_path(&path).is_err() {
            return None;
        }
    }
    load_startup_cache(&app).filter(|cache| startup_cache_matches_settings(cache, &settings))
}

pub fn workspace_clear_startup_cache(app: AppHandle) -> Result<(), String> {
    clear_startup_cache(&app)
}

pub fn workspace_write_startup_contributions(
    app: AppHandle,
    contributions: WorkspaceStartupContributions,
) -> Result<WorkspaceStartupCache, String> {
    let settings = load_settings(&app);
    write_startup_contributions(&app, &settings, contributions)
}

pub fn workspace_set_root(
    app: AppHandle,
    workspace_root: String,
) -> Result<WorkspaceSettings, String> {
    let root = PathBuf::from(workspace_root.trim());
    if !root.exists() || !root.is_dir() {
        return Err(format!("工作区不存在或不是文件夹：{}", root.display()));
    }
    ensure_ntfs_path(&root)?;
    let mut settings = load_settings(&app);
    let workspace_root = root.to_string_lossy().to_string();
    settings.workspace_root = Some(workspace_root.clone());
    settings.account_preferences.default_workspace_root = Some(workspace_root);
    save_settings(&app, &settings)?;
    reset_workspace_runtime_state(&app);
    Ok(visible_workspace_settings(settings))
}

fn validate_repository_scope(
    scope: &lilia_github_contracts::workspace::GitHubRepositoryScope,
) -> Result<(), String> {
    use lilia_github_contracts::workspace::GitHubRepositoryScope;
    let login = match scope {
        GitHubRepositoryScope::All => return Ok(()),
        GitHubRepositoryScope::Personal { login }
        | GitHubRepositoryScope::Organization { login } => login.trim(),
    };
    if login.is_empty()
        || login.len() > 39
        || login.starts_with('-')
        || login.ends_with('-')
        || !login
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("GitHub 账号或组织名称无效".to_string());
    }
    Ok(())
}

pub fn workspace_update_account_preferences(
    app: AppHandle,
    mut preferences: AccountPreferences,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    validate_repository_scope(&preferences.repository_scope)?;
    preferences.default_workspace_root = preferences
        .default_workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .map(str::to_string);
    if let Some(root) = preferences.default_workspace_root.as_deref() {
        let path = PathBuf::from(root);
        if !path.exists() || !path.is_dir() {
            return Err(format!("工作区不存在或不是文件夹：{}", path.display()));
        }
        ensure_ntfs_path(&path)?;
    }
    let mut settings = load_settings(&app);
    let root_changed = settings.workspace_root != preferences.default_workspace_root;
    settings.workspace_root = preferences.default_workspace_root.clone();
    settings.account_preferences = preferences;
    save_settings(&app, &settings)?;
    if root_changed {
        reset_workspace_runtime_state(&app);
    }
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_set_contribution_identities(
    app: AppHandle,
    identities: Vec<ContributionIdentity>,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    settings.contribution_identities = normalize_contribution_identities(identities);
    save_settings(&app, &settings)?;
    let _ = clear_startup_cache(&app);
    Ok(visible_workspace_settings(settings))
}

pub async fn workspace_scan_contribution_identities(
    app: AppHandle,
) -> Result<ContributionIdentityRecommendationResult, String> {
    let root = workspace_root(&app)?;
    let settings = load_settings(&app);
    let mut common_dirs = managed_repo_paths(&root, &settings)
        .into_iter()
        .map(|path| git_common_dir(&path).unwrap_or(path))
        .collect::<Vec<_>>();
    common_dirs.sort();
    common_dirs.dedup();
    let mut spec = OperationSpec::new(OperationKind::WorkspaceAnalysis)
        .lane(DispatchLane::Background)
        .priority(-50)
        .visible(VisibleOperation::new("contributions", "扫描贡献身份推荐").priority("low"));
    for common_dir in &common_dirs {
        spec = spec.resource(repo_resource_id(common_dir), ResourceAccessMode::Read);
    }
    run_operation(app, spec, move || {
        Ok(with_repo_guards(common_dirs, RepoAccess::Read, || {
            scan_contribution_identity_recommendations(&root, &settings)
        }))
    })
    .await
}

const CONTRIBUTION_IDENTITY_SCAN_LOG_LIMIT: usize = 750;

#[derive(Debug, Clone)]
struct ContributionIdentityRepoScan {
    repo_id: String,
    repo_name: String,
    path: PathBuf,
    config_identity: Option<ContributionIdentity>,
    authors: Vec<ContributionIdentityAuthorScan>,
}

#[derive(Debug, Clone)]
struct ContributionIdentityAuthorScan {
    identity: ContributionIdentity,
    commit_count: usize,
    latest_commit_at: Option<i64>,
}

#[derive(Debug, Clone)]
struct ContributionIdentityRecommendationDraft {
    identity: ContributionIdentity,
    confidence: ContributionIdentityRecommendationConfidence,
    missed_commit_count: usize,
    latest_commit_at: Option<i64>,
    repos: Vec<ContributionIdentityRecommendationRepo>,
}

pub(super) fn scan_contribution_identity_recommendations(
    root: &Path,
    settings: &WorkspaceSettings,
) -> ContributionIdentityRecommendationResult {
    let mut scanned_repo_count = 0;
    let mut skipped_repo_count = 0;
    let mut seen_repo_groups = HashSet::new();
    let mut repo_scans = Vec::new();
    let persisted_identities =
        normalize_contribution_identities(settings.contribution_identities.clone());

    for path in managed_repo_paths(root, settings) {
        let canonical_path = canonical_repo_path(&path);
        let repo_group_key =
            git_common_dir(&canonical_path).unwrap_or_else(|| canonical_path.clone());
        if !seen_repo_groups.insert(repo_group_key) {
            continue;
        }
        let repo_id = repo_id(root, &canonical_path);
        let include = settings
            .repo_sync_preferences
            .get(&repo_id)
            .map(|preference| preference.include_in_home_contribution_stats)
            .unwrap_or(true);
        if !include {
            continue;
        }
        scanned_repo_count += 1;
        let repo_name = canonical_path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or(&repo_id)
            .to_string();
        let config_identity = repo_git_identity(&canonical_path);
        let Some(authors) = scan_recent_contribution_authors(&canonical_path) else {
            skipped_repo_count += 1;
            repo_scans.push(ContributionIdentityRepoScan {
                repo_id,
                repo_name,
                path: canonical_path,
                config_identity,
                authors: Vec::new(),
            });
            continue;
        };
        repo_scans.push(ContributionIdentityRepoScan {
            repo_id,
            repo_name,
            path: canonical_path,
            config_identity,
            authors,
        });
    }

    let trusted_identities: Vec<_> = persisted_identities
        .iter()
        .cloned()
        .chain(
            repo_scans
                .iter()
                .filter_map(|repo| repo.config_identity.clone()),
        )
        .collect();
    let mut recommendations: HashMap<(String, String), ContributionIdentityRecommendationDraft> =
        HashMap::new();

    for repo in &repo_scans {
        if let Some(identity) = repo.config_identity.as_ref() {
            if !identity_matched_by(identity, &persisted_identities) {
                add_contribution_identity_recommendation(
                    &mut recommendations,
                    identity.clone(),
                    ContributionIdentityRecommendationConfidence::GitConfig,
                    0,
                    None,
                    ContributionIdentityRecommendationRepo {
                        repo_id: repo.repo_id.clone(),
                        repo_name: repo.repo_name.clone(),
                        source: ContributionIdentityRecommendationSource::GitConfig,
                        commit_count: 0,
                        latest_commit_at: None,
                    },
                );
            }
        }

        let local_identities = local_contribution_identities(&repo.path, settings);
        let single_author_without_config =
            repo.config_identity.is_none() && repo.authors.len() == 1;
        for author in &repo.authors {
            let author_name = author.identity.name.as_deref().unwrap_or_default();
            let author_email = author.identity.email.as_deref().unwrap_or_default();
            if contribution_identity_matches(&local_identities, author_name, author_email) {
                continue;
            }
            if identity_matched_by(&author.identity, &persisted_identities) {
                continue;
            }
            let confidence = if identity_matched_by(&author.identity, &trusted_identities) {
                ContributionIdentityRecommendationConfidence::RelatedAuthor
            } else if single_author_without_config {
                ContributionIdentityRecommendationConfidence::SingleAuthor
            } else {
                continue;
            };
            add_contribution_identity_recommendation(
                &mut recommendations,
                author.identity.clone(),
                confidence,
                author.commit_count,
                author.latest_commit_at,
                ContributionIdentityRecommendationRepo {
                    repo_id: repo.repo_id.clone(),
                    repo_name: repo.repo_name.clone(),
                    source: ContributionIdentityRecommendationSource::RecentAuthor,
                    commit_count: author.commit_count,
                    latest_commit_at: author.latest_commit_at,
                },
            );
        }
    }

    let mut recommendations: Vec<_> = recommendations
        .into_values()
        .map(|draft| {
            let repo_count = draft
                .repos
                .iter()
                .map(|repo| repo.repo_id.as_str())
                .collect::<HashSet<_>>()
                .len();
            ContributionIdentityRecommendation {
                identity: draft.identity,
                confidence: draft.confidence,
                missed_commit_count: draft.missed_commit_count,
                repo_count,
                latest_commit_at: draft.latest_commit_at,
                repos: draft.repos,
            }
        })
        .collect();
    recommendations.sort_by(|a, b| {
        contribution_identity_confidence_rank(&a.confidence)
            .cmp(&contribution_identity_confidence_rank(&b.confidence))
            .then_with(|| b.missed_commit_count.cmp(&a.missed_commit_count))
            .then_with(|| b.latest_commit_at.cmp(&a.latest_commit_at))
            .then_with(|| {
                contribution_identity_display(&a.identity)
                    .cmp(&contribution_identity_display(&b.identity))
            })
    });

    ContributionIdentityRecommendationResult {
        scanned_repo_count,
        skipped_repo_count,
        recommendations,
    }
}

fn scan_recent_contribution_authors(path: &Path) -> Option<Vec<ContributionIdentityAuthorScan>> {
    let end_day_index = current_utc_day_index();
    let start_day_index = end_day_index - GITHUB_CONTRIBUTION_DAYS as i64 + 1;
    let since = format!("{}T00:00:00Z", format_day_index(start_day_index));
    let until = format!("{}T23:59:59Z", format_day_index(end_day_index));
    let max_count = format!("--max-count={CONTRIBUTION_IDENTITY_SCAN_LOG_LIMIT}");
    let output = git_command_lossy(
        path,
        &[
            "log",
            &format!("--since={since}"),
            &format!("--until={until}"),
            &max_count,
            "--format=%an%x1f%ae%x1f%ct",
        ],
    )?;
    let mut authors: HashMap<(String, String), ContributionIdentityAuthorScan> = HashMap::new();
    for line in output.lines() {
        let mut parts = line.split('\x1f');
        let name = parts
            .next()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let email = parts
            .next()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        if name.is_none() && email.is_none() {
            continue;
        }
        let latest_commit_at = parts.next().and_then(|value| value.trim().parse().ok());
        let identity = ContributionIdentity { name, email };
        let Some(key) = contribution_identity_key(&identity) else {
            continue;
        };
        let entry = authors
            .entry(key)
            .or_insert_with(|| ContributionIdentityAuthorScan {
                identity,
                commit_count: 0,
                latest_commit_at: None,
            });
        entry.commit_count += 1;
        entry.latest_commit_at = latest_commit_at.max(entry.latest_commit_at);
    }
    Some(authors.into_values().collect())
}

fn identity_matched_by(
    identity: &ContributionIdentity,
    identities: &[ContributionIdentity],
) -> bool {
    contribution_identity_matches(
        identities,
        identity.name.as_deref().unwrap_or_default(),
        identity.email.as_deref().unwrap_or_default(),
    )
}

fn add_contribution_identity_recommendation(
    recommendations: &mut HashMap<(String, String), ContributionIdentityRecommendationDraft>,
    identity: ContributionIdentity,
    confidence: ContributionIdentityRecommendationConfidence,
    missed_commit_count: usize,
    latest_commit_at: Option<i64>,
    repo: ContributionIdentityRecommendationRepo,
) {
    let Some(key) = contribution_identity_key(&identity) else {
        return;
    };
    let entry =
        recommendations
            .entry(key)
            .or_insert_with(|| ContributionIdentityRecommendationDraft {
                identity,
                confidence: confidence.clone(),
                missed_commit_count: 0,
                latest_commit_at: None,
                repos: Vec::new(),
            });
    if contribution_identity_confidence_rank(&confidence)
        < contribution_identity_confidence_rank(&entry.confidence)
    {
        entry.confidence = confidence;
    }
    entry.missed_commit_count += missed_commit_count;
    entry.latest_commit_at = latest_commit_at.max(entry.latest_commit_at);
    if let Some(existing) = entry
        .repos
        .iter_mut()
        .find(|existing| existing.repo_id == repo.repo_id && existing.source == repo.source)
    {
        existing.commit_count += repo.commit_count;
        existing.latest_commit_at = repo.latest_commit_at.max(existing.latest_commit_at);
    } else {
        entry.repos.push(repo);
    }
}

fn contribution_identity_confidence_rank(
    confidence: &ContributionIdentityRecommendationConfidence,
) -> usize {
    match confidence {
        ContributionIdentityRecommendationConfidence::GitConfig => 0,
        ContributionIdentityRecommendationConfidence::RelatedAuthor => 1,
        ContributionIdentityRecommendationConfidence::SingleAuthor => 2,
    }
}

fn contribution_identity_display(identity: &ContributionIdentity) -> String {
    format!(
        "{}\u{1f}{}",
        identity
            .name
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        identity
            .email
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase()
    )
}

pub(super) fn normalize_contribution_identities(
    identities: Vec<ContributionIdentity>,
) -> Vec<ContributionIdentity> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for identity in identities {
        let name = normalize_optional_string(identity.name);
        let email =
            normalize_optional_string(identity.email).map(|value| value.to_ascii_lowercase());
        if name.is_none() && email.is_none() {
            continue;
        }
        let key = format!(
            "{}\x1f{}",
            name.as_deref().unwrap_or("").to_ascii_lowercase(),
            email.as_deref().unwrap_or("")
        );
        if !seen.insert(key) {
            continue;
        }
        normalized.push(ContributionIdentity { name, email });
    }
    normalized
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn repo_set_preference(
    app: AppHandle,
    repo_id: String,
    key: String,
    value: bool,
) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    let mut settings = load_settings(&app);
    set_repo_preference_value(&mut settings, normalized, key.trim(), value)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn repo_set_auto_sync(
    app: AppHandle,
    repo_id: String,
    auto_sync: bool,
) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    let mut settings = load_settings(&app);
    set_repo_preference_value(&mut settings, normalized, "autoSync", auto_sync)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn repo_get_remote_sync_config(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoRemoteSyncConfig, String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    let path = repo_path_by_id(&app, normalized)?;
    resolve_remote_sync_config(&load_settings(&app), normalized, &path)
}

pub fn repo_set_remote_sync_policy(
    app: AppHandle,
    repo_id: String,
    policy: RepoRemoteSyncPolicy,
) -> Result<RepoRemoteSyncConfig, String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    let path = repo_path_by_id(&app, normalized)?;
    let mut settings = load_settings(&app);
    settings
        .repo_remote_sync_policies
        .insert(normalized.to_string(), policy);
    let config = resolve_remote_sync_config(&settings, normalized, &path)?;
    if !config.validation_errors.is_empty() {
        return Err(config.validation_errors.join("；"));
    }
    settings
        .repo_remote_sync_policies
        .insert(normalized.to_string(), config.resolved_policy.clone());
    save_settings(&app, &settings)?;
    resolve_remote_sync_config(&settings, normalized, &path)
}

fn set_repo_preference_value(
    settings: &mut WorkspaceSettings,
    repo_id: &str,
    key: &str,
    value: bool,
) -> Result<(), String> {
    let mut preference = settings
        .repo_sync_preferences
        .get(repo_id)
        .cloned()
        .unwrap_or_default();
    match key {
        "autoSync" => preference.auto_sync = value,
        "includeInHomeCodeStats" => preference.include_in_home_code_stats = value,
        "includeInHomeContributionStats" => preference.include_in_home_contribution_stats = value,
        "calculateHomeTimeline" => preference.calculate_home_timeline = value,
        _ => return Err(format!("未知项目设置：{key}")),
    }
    if is_default_repo_sync_preference(&preference) {
        settings.repo_sync_preferences.remove(repo_id);
    } else {
        settings
            .repo_sync_preferences
            .insert(repo_id.to_string(), preference);
    }
    Ok(())
}

fn is_default_repo_sync_preference(preference: &RepoSyncPreference) -> bool {
    !preference.auto_sync
        && preference.include_in_home_code_stats
        && preference.include_in_home_contribution_stats
        && preference.calculate_home_timeline
}

pub fn workspace_pick_root(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择 Git 工作区")
        .blocking_pick_folder();
    Ok(picked.map(|path| path.to_string()))
}

pub fn workspace_pick_repo(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择 Git 仓库")
        .blocking_pick_folder();
    Ok(picked.map(|path| path.to_string()))
}

pub fn workspace_pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择 Release 资源")
        .blocking_pick_files();
    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.to_string())
        .collect())
}

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
    remove_startup_cache_repo(&app, normalized)?;
    crate::workspace::watcher::sync_repo_watchers(&app);
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_create_repo_group(
    app: AppHandle,
    name: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    create_repo_group(&mut settings, &name)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_rename_repo_group(
    app: AppHandle,
    group_id: String,
    name: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    rename_repo_group(&mut settings, &group_id, &name)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_delete_repo_group(
    app: AppHandle,
    group_id: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    delete_repo_group(&mut settings, &group_id)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

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
    Ok(visible_workspace_settings(settings))
}

pub async fn workspace_delete_local_repo(
    app: AppHandle,
    repo_id: String,
) -> Result<WorkspaceSettings, String> {
    let operation_repo_id = repo_id.trim().to_string();
    run_repo_visible_blocking(
        app.clone(),
        operation_repo_id,
        OperationKind::LocalWrite,
        "workspace",
        "删除本地仓库",
        move || {
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
            remove_startup_cache_repo(&app, normalized)?;
            crate::workspace::watcher::sync_repo_watchers(&app);
            Ok(visible_workspace_settings(settings))
        },
    )
    .await
}

pub fn workspace_remember_remote_repo(
    app: AppHandle,
    mut repo: RemoteRepoShortcut,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    migrate_remote_repo_shortcuts(&mut settings);
    let account_login = current_github_account_login(&settings)
        .ok_or_else(|| "请先绑定 GitHub 账号".to_string())?;
    repo.account_login = Some(account_login);
    remember_remote_repo_shortcut(&mut settings.remote_repo_shortcuts, repo)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_forget_remote_repo(
    app: AppHandle,
    full_name: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    migrate_remote_repo_shortcuts(&mut settings);
    let account_login = current_github_account_login(&settings)
        .ok_or_else(|| "请先绑定 GitHub 账号".to_string())?;
    forget_remote_repo_shortcut(
        &mut settings.remote_repo_shortcuts,
        &full_name,
        &account_login,
    )?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_unhide_repo(app: AppHandle, repo_id: String) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    let mut settings = load_settings(&app);
    settings.hidden_repo_ids.retain(|id| id != normalized);
    save_settings(&app, &settings)?;
    crate::workspace::watcher::sync_repo_watchers(&app);
    Ok(visible_workspace_settings(settings))
}

pub fn repo_use_default_token_auth(
    app: AppHandle,
    repo_id: String,
) -> Result<WorkspaceSettings, String> {
    let mut settings = load_settings(&app);
    remove_system_git_repo_id(&mut settings, &repo_id)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

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

#[cfg(test)]
mod account_profile_storage_tests {
    use super::*;
    use crate::runtime::{WorkspaceContext, WorkspaceRuntime};
    use lilia_github_contracts::workspace::{
        GitHubBindingMetadata, GitHubRepositoryScope, PullRequestListSortKey, SortDirection,
    };
    use serde_json::Value;
    use std::sync::Arc;

    #[derive(Default)]
    struct MemoryRuntime {
        values: Mutex<HashMap<(String, String), Value>>,
    }

    impl MemoryRuntime {
        fn insert(&self, file: &str, key: &str, value: Value) {
            self.values
                .lock()
                .unwrap()
                .insert((file.to_string(), key.to_string()), value);
        }

        fn value(&self, file: &str, key: &str) -> Option<Value> {
            self.values
                .lock()
                .unwrap()
                .get(&(file.to_string(), key.to_string()))
                .cloned()
        }
    }

    impl WorkspaceRuntime for MemoryRuntime {
        fn store_get(&self, file: &str, key: &str) -> Result<Option<Value>, String> {
            Ok(self.value(file, key))
        }

        fn store_set(&self, file: &str, key: &str, value: Value) -> Result<(), String> {
            self.insert(file, key, value);
            Ok(())
        }

        fn store_delete(&self, file: &str, key: &str) -> Result<(), String> {
            self.values
                .lock()
                .unwrap()
                .remove(&(file.to_string(), key.to_string()));
            Ok(())
        }

        fn store_save(&self, _file: &str) -> Result<(), String> {
            Ok(())
        }

        fn pick_folder(&self, _title: Option<&str>) -> Result<Option<String>, String> {
            Ok(None)
        }

        fn pick_files(&self, _title: Option<&str>) -> Result<Option<Vec<String>>, String> {
            Ok(None)
        }

        fn open_path(&self, _path: &str, _with: Option<&str>) -> Result<(), String> {
            Ok(())
        }

        fn open_url(&self, _url: &str, _with: Option<&str>) -> Result<(), String> {
            Ok(())
        }

        fn emit(&self, _event: &str, _payload: Value) -> Result<(), String> {
            Ok(())
        }
    }

    fn binding(login: &str) -> GitHubBindingMetadata {
        GitHubBindingMetadata {
            login: login.to_string(),
            avatar_url: None,
            bound_at: 1,
            scopes: vec!["repo".to_string()],
            client_id_source: "bundled".to_string(),
        }
    }

    #[test]
    fn legacy_settings_migrate_and_profiles_are_isolated_by_normalized_login() {
        let runtime = Arc::new(MemoryRuntime::default());
        let mut legacy = WorkspaceSettings {
            workspace_root: Some("/legacy-root".to_string()),
            github_binding: Some(binding("Alice")),
            ..WorkspaceSettings::default()
        };
        legacy.hidden_repo_ids.push("alice/repo".to_string());
        let mut legacy_value = serde_json::to_value(&legacy).unwrap();
        legacy_value
            .as_object_mut()
            .unwrap()
            .remove("accountPreferences");
        runtime.insert(STORE_FILE, SETTINGS_KEY, legacy_value);
        let app = WorkspaceContext::new(runtime.clone());

        let alice = load_settings(&app);
        assert_eq!(alice.workspace_root.as_deref(), Some("/legacy-root"));
        assert_eq!(
            alice.account_preferences.default_workspace_root.as_deref(),
            Some("/legacy-root")
        );
        let persisted = runtime.value(STORE_FILE, SETTINGS_KEY).unwrap();
        assert_eq!(persisted["version"], SETTINGS_VERSION);
        assert!(persisted["profiles"].get("alice").is_some());
        assert_eq!(persisted["binding"]["login"], "Alice");
        assert!(persisted["profiles"]["alice"]["githubBinding"].is_null());

        let mut bob = switch_github_binding(&app, binding("Bob")).unwrap();
        assert!(bob.workspace_root.is_none());
        bob.hidden_repo_ids.push("bob/repo".to_string());
        save_settings(&app, &bob).unwrap();

        let restored = switch_github_binding(&app, binding("ALICE")).unwrap();
        assert_eq!(restored.hidden_repo_ids, vec!["alice/repo"]);
        let anonymous = clear_github_binding(&app).unwrap();
        assert!(anonymous.hidden_repo_ids.is_empty());
        assert!(anonymous.github_binding.is_none());
    }

    #[test]
    fn unbound_legacy_settings_migrate_into_the_anonymous_profile() {
        let runtime = Arc::new(MemoryRuntime::default());
        let mut legacy = WorkspaceSettings {
            workspace_root: Some("/anonymous-root".to_string()),
            ..WorkspaceSettings::default()
        };
        legacy.hidden_repo_ids.push("anonymous/repo".to_string());
        let mut legacy_value = serde_json::to_value(&legacy).unwrap();
        legacy_value
            .as_object_mut()
            .unwrap()
            .remove("accountPreferences");
        runtime.insert(STORE_FILE, SETTINGS_KEY, legacy_value);
        let app = WorkspaceContext::new(runtime.clone());

        let migrated = load_settings(&app);

        assert_eq!(migrated.workspace_root.as_deref(), Some("/anonymous-root"));
        assert_eq!(
            migrated
                .account_preferences
                .default_workspace_root
                .as_deref(),
            Some("/anonymous-root")
        );
        assert_eq!(migrated.hidden_repo_ids, vec!["anonymous/repo"]);
        let persisted = runtime.value(STORE_FILE, SETTINGS_KEY).unwrap();
        assert_eq!(persisted["anonymous"]["workspaceRoot"], "/anonymous-root");
        assert!(persisted["profiles"].as_object().unwrap().is_empty());
        assert!(persisted["binding"].is_null());
    }

    #[test]
    fn account_preferences_update_workspace_root_atomically() {
        let runtime = Arc::new(MemoryRuntime::default());
        let app = WorkspaceContext::new(runtime);
        let root = std::env::temp_dir().join(format!(
            "lilia-account-preferences-{}",
            crate::workspace::shared::now_millis()
        ));
        fs::create_dir_all(&root).unwrap();
        let mut preferences = AccountPreferences {
            default_workspace_root: Some(root.to_string_lossy().to_string()),
            repository_scope: GitHubRepositoryScope::Organization {
                login: "lilia-org".to_string(),
            },
            ..AccountPreferences::default()
        };
        preferences.pull_requests.sort = PullRequestListSortKey::Updated;
        preferences.pull_requests.direction = SortDirection::Desc;

        let settings = workspace_update_account_preferences(app.clone(), preferences).unwrap();
        assert_eq!(
            settings.workspace_root,
            settings.account_preferences.default_workspace_root
        );
        assert_eq!(
            load_settings(&app).account_preferences,
            settings.account_preferences
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unavailable_account_workspace_is_inactive_but_preference_is_preserved() {
        let missing_root = std::env::temp_dir()
            .join(format!(
                "lilia-missing-account-workspace-{}",
                crate::workspace::shared::now_millis()
            ))
            .to_string_lossy()
            .to_string();
        let settings = WorkspaceSettings {
            workspace_root: Some(missing_root.clone()),
            account_preferences: AccountPreferences {
                default_workspace_root: Some(missing_root.clone()),
                ..AccountPreferences::default()
            },
            ..WorkspaceSettings::default()
        };

        let visible = visible_workspace_settings(settings);

        assert_eq!(visible.workspace_root, None);
        assert_eq!(
            visible.account_preferences.default_workspace_root,
            Some(missing_root)
        );
    }
}
