use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::github::{
    forget_remote_repo_shortcut, normalize_github_repo_input, remember_remote_repo_shortcut,
    GITHUB_CONTRIBUTION_DAYS,
};
use crate::workspace::operations::{run_operation, OperationKind, OperationSpec, VisibleOperation};
use crate::workspace::repo_guard::{repo_resource_id, with_repo_guards, RepoAccess};
#[cfg(test)]
use crate::workspace::repos::managed_repo_paths;
use crate::workspace::repos::{
    canonical_repo_path, git_command, git_command_lossy, git_common_dir, is_git_repo, repo_id,
    resolve_remote_sync_config, resolve_repo_worktree, run_repo_visible_blocking,
    ResolvedRepoWorktree,
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
    ContributionIdentityRecommendationSource, GitHubOwnerKind, HiddenRepo, NamedWorkspace,
    RecentLocalRepoVisit, RemoteRepoShortcut, RepoRemoteSyncConfig, RepoRemoteSyncPolicy,
    RepoSummary, RepoSyncPreference, WorkspaceBootstrap, WorkspaceCatalogEntry,
    WorkspaceCloneRepositoryRef, WorkspaceProfile, WorkspaceRepoGroup, WorkspaceRepoPlacement,
    WorkspaceRoot, WorkspaceSettings, WorkspaceStartupCache, WorkspaceStartupContributions,
    WorkspaceViewPreferences,
};
use mutsuki_runtime_contracts::{DispatchLane, ResourceAccessMode};

pub(super) const STORE_FILE: &str = "lilia-github.json";
pub(super) const SETTINGS_KEY: &str = "workspace.settings";
pub(super) const STARTUP_CACHE_KEY: &str = "workspace.startupCache.v2";
const LEGACY_STARTUP_CACHE_KEY: &str = "workspace.startupCache.v1";
#[cfg(target_os = "windows")]
const NTFS_REQUIRED: &str = "工作区必须位于 NTFS 文件系统";
const SETTINGS_VERSION: u32 = 3;
const RECENT_LOCAL_REPO_LIMIT: usize = 12;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSettingsDocument {
    version: u32,
    #[serde(default)]
    binding: Option<lilia_github_contracts::workspace::GitHubBindingMetadata>,
    #[serde(default)]
    anonymous: WorkspaceProfile,
    #[serde(default)]
    profiles: HashMap<String, WorkspaceProfile>,
}

impl Default for WorkspaceSettingsDocument {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            binding: None,
            anonymous: WorkspaceProfile::default(),
            profiles: HashMap::new(),
        }
    }
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyWorkspaceSettingsDocument {
    #[allow(dead_code)]
    version: u32,
    #[serde(default)]
    binding: Option<lilia_github_contracts::workspace::GitHubBindingMetadata>,
    #[serde(default)]
    anonymous: serde_json::Value,
    #[serde(default)]
    profiles: HashMap<String, serde_json::Value>,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStartupCacheDocument {
    version: u32,
    #[serde(default)]
    anonymous: HashMap<String, WorkspaceStartupCache>,
    #[serde(default)]
    profiles: HashMap<String, HashMap<String, WorkspaceStartupCache>>,
}

fn startup_cache_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub(super) fn settings_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn normalized_login(login: &str) -> Option<String> {
    let login = login.trim();
    (!login.is_empty()).then(|| login.to_ascii_lowercase())
}

fn next_stable_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!(
        "{prefix}-{}-{}",
        now_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

pub(super) fn root_id_for_path(path: &Path) -> String {
    let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let normalized = canonical
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in normalized.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("root-{hash:016x}")
}

fn workspace_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("默认工作区")
        .to_string()
}

fn runtime_root(mut root: WorkspaceRoot) -> WorkspaceRoot {
    let path = PathBuf::from(&root.path);
    let error = if !path.exists() || !path.is_dir() {
        Some(format!("工作区不存在或不是文件夹：{}", path.display()))
    } else {
        ensure_ntfs_path(&path).err()
    };
    root.available = error.is_none();
    root.unavailable_reason = error;
    root
}

fn qualify_legacy_repo_id(root_id: &str, id: &str) -> String {
    let id = id.trim();
    if id.starts_with("local:") || id.starts_with("github:") {
        return id.to_string();
    }
    let relative = if id.is_empty() { "." } else { id };
    format!("local:{root_id}/{}", relative.replace('\\', "/"))
}

fn migrate_repo_ids(workspace: &mut NamedWorkspace, root_id: &str) {
    let qualify = |id: &str| qualify_legacy_repo_id(root_id, id);
    for values in [
        &mut workspace.hidden_repo_ids,
        &mut workspace.managed_repo_ids,
        &mut workspace.system_git_repo_ids,
        &mut workspace.favorite_repo_ids,
        &mut workspace.organization_grouping_resolved_repo_ids,
    ] {
        *values = values.iter().map(|id| qualify(id)).collect();
        sort_dedup(values);
    }
    for group in &mut workspace.repo_groups {
        group.repo_ids = group.repo_ids.iter().map(|id| qualify(id)).collect();
        sort_dedup(&mut group.repo_ids);
    }
    for visit in &mut workspace.recent_local_repos {
        visit.repo_id = qualify(&visit.repo_id);
    }
    fn rekey<T>(values: &mut HashMap<String, T>, qualify: &impl Fn(&str) -> String) {
        *values = std::mem::take(values)
            .into_iter()
            .map(|(id, value)| (qualify(&id), value))
            .collect();
    }
    rekey(&mut workspace.project_launch_configs, &qualify);
    rekey(&mut workspace.repo_sync_preferences, &qualify);
    rekey(&mut workspace.repo_remote_sync_policies, &qualify);
    rekey(&mut workspace.repo_bindings, &qualify);
    rekey(&mut workspace.local_contribution_cache, &qualify);
}

fn workspace_from_legacy(mut legacy: WorkspaceSettings) -> Option<NamedWorkspace> {
    let root_path = legacy.workspace_root.take()?;
    let root_id = root_id_for_path(Path::new(&root_path));
    let mut workspace = NamedWorkspace {
        id: next_stable_id("workspace"),
        name: workspace_name_from_path(&root_path),
        roots: vec![WorkspaceRoot {
            id: root_id.clone(),
            path: root_path,
            available: false,
            unavailable_reason: None,
        }],
        primary_root_id: Some(root_id.clone()),
        project_launch_configs: legacy.project_launch_configs,
        repo_sync_preferences: legacy.repo_sync_preferences,
        repo_remote_sync_policies: legacy.repo_remote_sync_policies,
        hidden_repo_ids: legacy.hidden_repo_ids,
        managed_repo_ids: legacy.managed_repo_ids,
        system_git_repo_ids: legacy.system_git_repo_ids,
        repo_bindings: legacy.repo_bindings,
        favorite_repo_ids: legacy.favorite_repo_ids,
        repo_groups: legacy.repo_groups,
        organization_grouping_resolved_repo_ids: legacy.organization_grouping_resolved_repo_ids,
        remote_repo_shortcuts: legacy.remote_repo_shortcuts,
        recent_local_repos: legacy.recent_local_repos,
        local_contribution_cache: legacy.local_contribution_cache,
        contribution_identities: legacy.contribution_identities,
        view_preferences: WorkspaceViewPreferences::default(),
    };
    migrate_repo_ids(&mut workspace, &root_id);
    Some(workspace)
}

fn profile_from_legacy(mut legacy: WorkspaceSettings) -> WorkspaceProfile {
    let account_preferences = std::mem::take(&mut legacy.account_preferences);
    let workspace = workspace_from_legacy(legacy);
    WorkspaceProfile {
        account_preferences,
        active_workspace_id: workspace.as_ref().map(|workspace| workspace.id.clone()),
        workspaces: workspace.into_iter().collect(),
    }
}

fn legacy_settings_from_value(value: serde_json::Value) -> WorkspaceSettings {
    let fallback_root = value
        .get("accountPreferences")
        .and_then(|preferences| preferences.get("defaultWorkspaceRoot"))
        .and_then(|root| root.as_str())
        .map(str::to_string);
    let mut settings = serde_json::from_value::<WorkspaceSettings>(value).unwrap_or_default();
    if settings.workspace_root.is_none() {
        settings.workspace_root = fallback_root;
    }
    settings
}

fn migrate_legacy_settings(legacy: WorkspaceSettings) -> WorkspaceSettingsDocument {
    let binding = legacy.github_binding.clone();
    let profile = profile_from_legacy(legacy);
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

fn migrate_v2_document(legacy: LegacyWorkspaceSettingsDocument) -> WorkspaceSettingsDocument {
    WorkspaceSettingsDocument {
        version: SETTINGS_VERSION,
        binding: legacy.binding,
        anonymous: profile_from_legacy(legacy_settings_from_value(legacy.anonymous)),
        profiles: legacy
            .profiles
            .into_iter()
            .map(|(login, settings)| {
                (
                    login,
                    profile_from_legacy(legacy_settings_from_value(settings)),
                )
            })
            .collect(),
    }
}

fn read_settings_document(app: &AppHandle) -> (WorkspaceSettingsDocument, bool) {
    let Some(value) = app
        .store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(SETTINGS_KEY))
    else {
        return (WorkspaceSettingsDocument::default(), false);
    };
    if value.get("version").and_then(|version| version.as_u64()) == Some(SETTINGS_VERSION as u64) {
        if let Ok(mut document) = serde_json::from_value::<WorkspaceSettingsDocument>(value.clone())
        {
            document.version = SETTINGS_VERSION;
            return (document, false);
        }
    }
    if value.get("version").is_some() {
        if let Ok(document) =
            serde_json::from_value::<LegacyWorkspaceSettingsDocument>(value.clone())
        {
            return (migrate_v2_document(document), true);
        }
    }
    let legacy = legacy_settings_from_value(value);
    (migrate_legacy_settings(legacy), true)
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

fn profile_from_document(document: &WorkspaceSettingsDocument) -> WorkspaceProfile {
    document
        .binding
        .as_ref()
        .and_then(|binding| normalized_login(&binding.login))
        .and_then(|key| document.profiles.get(&key).cloned())
        .unwrap_or_else(|| {
            if document.binding.is_some() {
                WorkspaceProfile::default()
            } else {
                document.anonymous.clone()
            }
        })
}

fn profile_mut_from_document(document: &mut WorkspaceSettingsDocument) -> &mut WorkspaceProfile {
    if let Some(login) = document
        .binding
        .as_ref()
        .and_then(|binding| normalized_login(&binding.login))
    {
        document.profiles.entry(login).or_default()
    } else {
        &mut document.anonymous
    }
}

fn workspace_catalog_entry(workspace: &NamedWorkspace) -> WorkspaceCatalogEntry {
    WorkspaceCatalogEntry {
        id: workspace.id.clone(),
        name: workspace.name.clone(),
        roots: workspace
            .roots
            .clone()
            .into_iter()
            .map(runtime_root)
            .collect(),
        primary_root_id: workspace.primary_root_id.clone(),
    }
}

fn settings_from_document(document: &WorkspaceSettingsDocument) -> WorkspaceSettings {
    let profile = profile_from_document(document);
    let active = profile
        .active_workspace_id
        .as_deref()
        .and_then(|id| {
            profile
                .workspaces
                .iter()
                .find(|workspace| workspace.id == id)
        })
        .cloned();
    let mut settings = WorkspaceSettings {
        github_binding: document.binding.clone(),
        account_preferences: profile.account_preferences.clone(),
        workspace_catalog: profile
            .workspaces
            .iter()
            .map(workspace_catalog_entry)
            .collect(),
        active_workspace_id: active.as_ref().map(|workspace| workspace.id.clone()),
        active_workspace: active.clone().map(|mut workspace| {
            workspace.roots = workspace.roots.into_iter().map(runtime_root).collect();
            workspace
        }),
        ..WorkspaceSettings::default()
    };
    if let Some(workspace) = active {
        settings.workspace_root = workspace
            .primary_root_id
            .as_deref()
            .and_then(|id| workspace.roots.iter().find(|root| root.id == id))
            .map(|root| root.path.clone());
        settings.project_launch_configs = workspace.project_launch_configs;
        settings.repo_sync_preferences = workspace.repo_sync_preferences;
        settings.repo_remote_sync_policies = workspace.repo_remote_sync_policies;
        settings.hidden_repo_ids = workspace.hidden_repo_ids;
        settings.managed_repo_ids = workspace.managed_repo_ids;
        settings.system_git_repo_ids = workspace.system_git_repo_ids;
        settings.repo_bindings = workspace.repo_bindings;
        settings.favorite_repo_ids = workspace.favorite_repo_ids;
        settings.repo_groups = workspace.repo_groups;
        settings.organization_grouping_resolved_repo_ids =
            workspace.organization_grouping_resolved_repo_ids;
        settings.remote_repo_shortcuts = workspace.remote_repo_shortcuts;
        settings.recent_local_repos = workspace.recent_local_repos;
        settings.local_contribution_cache = workspace.local_contribution_cache;
        settings.contribution_identities = workspace.contribution_identities;
    }
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
    let mut profile = profile_from_document(&document);
    profile.account_preferences = settings.account_preferences.clone();
    if profile.active_workspace_id.is_none()
        && (settings.workspace_root.is_some()
            || !settings.project_launch_configs.is_empty()
            || !settings.repo_sync_preferences.is_empty()
            || !settings.repo_remote_sync_policies.is_empty()
            || !settings.hidden_repo_ids.is_empty()
            || !settings.managed_repo_ids.is_empty()
            || !settings.system_git_repo_ids.is_empty()
            || !settings.repo_bindings.is_empty()
            || !settings.favorite_repo_ids.is_empty()
            || !settings.repo_groups.is_empty()
            || !settings.remote_repo_shortcuts.is_empty()
            || !settings.recent_local_repos.is_empty()
            || !settings.local_contribution_cache.is_empty()
            || !settings.contribution_identities.is_empty())
    {
        let workspace_id = next_stable_id("workspace");
        let roots = settings
            .workspace_root
            .as_deref()
            .map(|path| WorkspaceRoot {
                id: root_id_for_path(Path::new(path)),
                path: path.to_string(),
                available: false,
                unavailable_reason: None,
            })
            .into_iter()
            .collect::<Vec<_>>();
        profile.workspaces.push(NamedWorkspace {
            id: workspace_id.clone(),
            name: settings
                .workspace_root
                .as_deref()
                .map(workspace_name_from_path)
                .unwrap_or_else(|| "默认工作区".to_string()),
            primary_root_id: roots.first().map(|root| root.id.clone()),
            roots,
            ..NamedWorkspace::default()
        });
        profile.active_workspace_id = Some(workspace_id);
    }
    if let Some(active_id) = profile.active_workspace_id.clone() {
        if let Some(workspace) = profile
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == active_id)
        {
            workspace.project_launch_configs = settings.project_launch_configs.clone();
            workspace.repo_sync_preferences = settings.repo_sync_preferences.clone();
            workspace.repo_remote_sync_policies = settings.repo_remote_sync_policies.clone();
            workspace.hidden_repo_ids = settings.hidden_repo_ids.clone();
            workspace.managed_repo_ids = settings.managed_repo_ids.clone();
            workspace.system_git_repo_ids = settings.system_git_repo_ids.clone();
            workspace.repo_bindings = settings.repo_bindings.clone();
            workspace.favorite_repo_ids = settings.favorite_repo_ids.clone();
            workspace.repo_groups = settings.repo_groups.clone();
            workspace.organization_grouping_resolved_repo_ids =
                settings.organization_grouping_resolved_repo_ids.clone();
            workspace.remote_repo_shortcuts = settings.remote_repo_shortcuts.clone();
            workspace.recent_local_repos = settings.recent_local_repos.clone();
            workspace.local_contribution_cache = settings.local_contribution_cache.clone();
            workspace.contribution_identities = settings.contribution_identities.clone();
        }
    }
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

fn reset_workspace_runtime_state(_app: &AppHandle) {
    context_revision().fetch_add(1, Ordering::SeqCst);
    crate::workspace::refresh::reset_refresh_scheduler();
    crate::workspace::watcher::clear_repo_watchers();
}

fn context_revision() -> &'static AtomicU64 {
    static REVISION: AtomicU64 = AtomicU64::new(1);
    &REVISION
}

fn current_context_revision() -> u64 {
    context_revision().load(Ordering::SeqCst)
}

pub(super) fn workspace_context_identity(app: &AppHandle) -> (Option<String>, u64) {
    (
        load_settings(app).active_workspace_id,
        current_context_revision(),
    )
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
    let settings = load_settings(app);
    let workspace_id = settings.active_workspace_id.as_deref()?;
    let store = app.store(STORE_FILE).ok()?;
    if let Some(document) = store
        .get(STARTUP_CACHE_KEY)
        .and_then(|value| serde_json::from_value::<WorkspaceStartupCacheDocument>(value).ok())
    {
        let slots = settings
            .github_binding
            .as_ref()
            .and_then(|binding| normalized_login(&binding.login))
            .and_then(|login| document.profiles.get(&login))
            .unwrap_or(&document.anonymous);
        return slots.get(workspace_id).cloned();
    }
    store
        .get(LEGACY_STARTUP_CACHE_KEY)
        .and_then(|value| serde_json::from_value::<WorkspaceStartupCache>(value).ok())
        .map(|cache| migrate_legacy_startup_cache(cache, &settings))
}

fn migrate_legacy_startup_cache(
    mut cache: WorkspaceStartupCache,
    settings: &WorkspaceSettings,
) -> WorkspaceStartupCache {
    cache.workspace_id = settings.active_workspace_id.clone();
    cache.roots_fingerprint = roots_fingerprint(settings);
    let Some(root_id) = settings
        .active_workspace
        .as_ref()
        .and_then(|workspace| workspace.primary_root_id.as_deref())
    else {
        return cache;
    };
    cache.repos_by_id = std::mem::take(&mut cache.repos_by_id)
        .into_iter()
        .map(|(id, mut entry)| {
            let id = qualify_legacy_repo_id(root_id, &id);
            entry.summary.id = id.clone();
            if let Some(main_repo_id) = entry.summary.worktree.main_repo_id.as_mut() {
                *main_repo_id = qualify_legacy_repo_id(root_id, main_repo_id);
            }
            (id, entry)
        })
        .collect();
    if let Some(contributions) = cache.contributions.as_mut() {
        for day in &mut contributions.days {
            for repo in &mut day.repositories {
                repo.repo_id = qualify_legacy_repo_id(root_id, &repo.repo_id);
            }
        }
    }
    cache
}

pub(super) fn save_startup_cache(
    app: &AppHandle,
    cache: &WorkspaceStartupCache,
) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("打开启动缓存失败：{e}"))?;
    let settings = load_settings(app);
    let workspace_id = settings
        .active_workspace_id
        .as_deref()
        .ok_or_else(|| "当前没有工作区".to_string())?;
    let mut document = store
        .get(STARTUP_CACHE_KEY)
        .and_then(|value| serde_json::from_value::<WorkspaceStartupCacheDocument>(value).ok())
        .unwrap_or_else(|| WorkspaceStartupCacheDocument {
            version: 2,
            ..WorkspaceStartupCacheDocument::default()
        });
    let slots = settings
        .github_binding
        .as_ref()
        .and_then(|binding| normalized_login(&binding.login))
        .map(|login| document.profiles.entry(login).or_default())
        .unwrap_or(&mut document.anonymous);
    slots.insert(workspace_id.to_string(), cache.clone());
    store.set(
        STARTUP_CACHE_KEY,
        serde_json::to_value(document).map_err(|e| e.to_string())?,
    );
    store.delete(LEGACY_STARTUP_CACHE_KEY);
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
    let settings = load_settings(app);
    if let Some(mut document) = store
        .get(STARTUP_CACHE_KEY)
        .and_then(|value| serde_json::from_value::<WorkspaceStartupCacheDocument>(value).ok())
    {
        if let Some(workspace_id) = settings.active_workspace_id.as_deref() {
            let slots = settings
                .github_binding
                .as_ref()
                .and_then(|binding| normalized_login(&binding.login))
                .and_then(|login| document.profiles.get_mut(&login))
                .unwrap_or(&mut document.anonymous);
            slots.remove(workspace_id);
        }
        store.set(
            STARTUP_CACHE_KEY,
            serde_json::to_value(document).map_err(|e| e.to_string())?,
        );
    }
    store.delete(LEGACY_STARTUP_CACHE_KEY);
    store.save().map_err(|e| format!("清理启动缓存失败：{e}"))
}

pub(super) fn startup_cache_matches_settings(
    cache: &WorkspaceStartupCache,
    settings: &WorkspaceSettings,
) -> bool {
    cache.workspace_id == settings.active_workspace_id
        && cache.roots_fingerprint == roots_fingerprint(settings)
        && cache.workspace_root == settings.workspace_root
        && cache.binding_login
            == settings
                .github_binding
                .as_ref()
                .map(|binding| binding.login.clone())
}

fn roots_fingerprint(settings: &WorkspaceSettings) -> String {
    settings
        .active_workspace
        .as_ref()
        .map(|workspace| {
            workspace
                .roots
                .iter()
                .map(|root| format!("{}:{}", root.id, root.path.to_ascii_lowercase()))
                .collect::<Vec<_>>()
                .join("|")
        })
        .unwrap_or_default()
}

fn startup_cache_shell(settings: &WorkspaceSettings) -> WorkspaceStartupCache {
    WorkspaceStartupCache {
        workspace_id: settings.active_workspace_id.clone(),
        roots_fingerprint: roots_fingerprint(settings),
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
        organization_login: None,
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
    let deleted_repo_ids = settings
        .repo_groups
        .iter()
        .find(|group| group.id == normalized)
        .map(|group| group.repo_ids.clone())
        .ok_or_else(|| "未找到仓库分组".to_string())?;
    for repo_id in deleted_repo_ids {
        mark_organization_grouping_resolved(settings, &repo_id);
    }
    settings.repo_groups.retain(|group| group.id != normalized);
    Ok(())
}

fn move_repo_membership(
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

fn mark_organization_grouping_resolved(settings: &mut WorkspaceSettings, repo_id: &str) {
    let repo_id = repo_id.trim();
    if repo_id.is_empty() {
        return;
    }
    if !settings
        .organization_grouping_resolved_repo_ids
        .iter()
        .any(|id| id == repo_id)
    {
        settings
            .organization_grouping_resolved_repo_ids
            .push(repo_id.to_string());
        sort_dedup(&mut settings.organization_grouping_resolved_repo_ids);
    }
}

fn repo_has_group(settings: &WorkspaceSettings, repo_id: &str) -> bool {
    settings
        .repo_groups
        .iter()
        .any(|group| group.repo_ids.iter().any(|id| id == repo_id))
}

fn ensure_organization_repo_group(
    settings: &mut WorkspaceSettings,
    organization_login: &str,
) -> Result<String, String> {
    let login = organization_login.trim();
    if login.is_empty() {
        return Err("组织 login 不能为空".to_string());
    }
    if let Some(group) = settings.repo_groups.iter().find(|group| {
        group
            .organization_login
            .as_deref()
            .is_some_and(|current| current.eq_ignore_ascii_case(login))
    }) {
        return Ok(group.id.clone());
    }
    if let Some(group) = settings.repo_groups.iter_mut().find(|group| {
        group.organization_login.is_none() && group.name.trim().eq_ignore_ascii_case(login)
    }) {
        group.organization_login = Some(login.to_string());
        return Ok(group.id.clone());
    }
    let group = create_repo_group(settings, login)?;
    let group_id = group.id;
    if let Some(group) = settings
        .repo_groups
        .iter_mut()
        .find(|group| group.id == group_id)
    {
        group.organization_login = Some(login.to_string());
    }
    Ok(group_id)
}

pub(super) fn reconcile_organization_repo_groups(
    settings: &mut WorkspaceSettings,
    organization_logins: &[String],
) -> Result<(), String> {
    let mut organizations = HashMap::new();
    for login in organization_logins {
        let login = login.trim();
        if !login.is_empty() {
            organizations
                .entry(login.to_ascii_lowercase())
                .or_insert_with(|| login.to_string());
        }
    }
    let mut repo_ids = settings.managed_repo_ids.clone();
    sort_dedup(&mut repo_ids);
    for repo_id in repo_ids {
        if settings
            .organization_grouping_resolved_repo_ids
            .iter()
            .any(|id| id == &repo_id)
        {
            continue;
        }
        if repo_has_group(settings, &repo_id) {
            mark_organization_grouping_resolved(settings, &repo_id);
            continue;
        }
        let organization_login = settings
            .repo_bindings
            .get(&repo_id)
            .and_then(|binding| binding.remote_full_name.split_once('/'))
            .map(|(owner, _)| owner.trim().to_ascii_lowercase())
            .and_then(|owner| organizations.get(&owner).cloned());
        if let Some(login) = organization_login {
            let group_id = ensure_organization_repo_group(settings, &login)?;
            move_repo_membership(settings, &repo_id, Some(&group_id))?;
            mark_organization_grouping_resolved(settings, &repo_id);
        }
    }
    Ok(())
}

pub(super) fn apply_repo_placement(
    settings: &mut WorkspaceSettings,
    repo_id: &str,
    repository: Option<&WorkspaceCloneRepositoryRef>,
    placement: &WorkspaceRepoPlacement,
) -> Result<(), String> {
    validate_repo_placement(settings, placement)?;
    match placement {
        WorkspaceRepoPlacement::Ungrouped => {
            move_repo_membership(settings, repo_id, None)?;
            mark_organization_grouping_resolved(settings, repo_id);
        }
        WorkspaceRepoPlacement::Group { group_id } => {
            move_repo_membership(settings, repo_id, Some(group_id))?;
            mark_organization_grouping_resolved(settings, repo_id);
        }
        WorkspaceRepoPlacement::Automatic => {
            if settings
                .organization_grouping_resolved_repo_ids
                .iter()
                .any(|id| id == repo_id)
            {
                return Ok(());
            }
            if repo_has_group(settings, repo_id) {
                mark_organization_grouping_resolved(settings, repo_id);
                return Ok(());
            }
            let Some(owner) = repository.and_then(|repository| repository.owner.as_ref()) else {
                return Ok(());
            };
            match owner.kind {
                GitHubOwnerKind::Organization => {
                    let login = owner.login.trim();
                    if login.is_empty() {
                        return Ok(());
                    }
                    let group_id = ensure_organization_repo_group(settings, login)?;
                    move_repo_membership(settings, repo_id, Some(&group_id))?;
                    mark_organization_grouping_resolved(settings, repo_id);
                }
                GitHubOwnerKind::User => {
                    move_repo_membership(settings, repo_id, None)?;
                    mark_organization_grouping_resolved(settings, repo_id);
                }
            }
        }
    }
    Ok(())
}

pub(super) fn validate_repo_placement(
    settings: &WorkspaceSettings,
    placement: &WorkspaceRepoPlacement,
) -> Result<(), String> {
    let WorkspaceRepoPlacement::Group { group_id } = placement else {
        return Ok(());
    };
    let group_id = group_id.trim();
    if group_id.is_empty()
        || !settings
            .repo_groups
            .iter()
            .any(|group| group.id == group_id)
    {
        return Err("未找到仓库分组".to_string());
    }
    Ok(())
}

pub(super) fn move_repo_to_group(
    settings: &mut WorkspaceSettings,
    repo_id: &str,
    group_id: Option<&str>,
) -> Result<(), String> {
    move_repo_membership(settings, repo_id, group_id)?;
    mark_organization_grouping_resolved(settings, repo_id);
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
    let Some(workspace) = settings.active_workspace else {
        return Err("请先选择工作区文件夹".to_string());
    };
    let root = workspace
        .primary_root_id
        .as_deref()
        .and_then(|id| workspace.roots.iter().find(|root| root.id == id))
        .or_else(|| workspace.roots.first())
        .ok_or_else(|| "请先选择工作区文件夹".to_string())?;
    let path = PathBuf::from(&root.path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("工作区不存在或不是文件夹：{}", path.display()));
    }
    ensure_ntfs_path(&path)?;
    Ok(path)
}

pub(super) fn workspace_roots(app: &AppHandle) -> Result<Vec<(String, PathBuf)>, String> {
    let settings = load_settings(app);
    let workspace = settings
        .active_workspace
        .ok_or_else(|| "请先选择工作区文件夹".to_string())?;
    let roots = workspace
        .roots
        .into_iter()
        .filter_map(|root| {
            let path = PathBuf::from(root.path);
            (path.is_dir() && ensure_ntfs_path(&path).is_ok()).then_some((root.id, path))
        })
        .collect::<Vec<_>>();
    if roots.is_empty() {
        Err("当前工作区没有可用的根目录".to_string())
    } else {
        Ok(roots)
    }
}

pub(super) fn workspace_root_by_id(app: &AppHandle, root_id: &str) -> Result<PathBuf, String> {
    let settings = load_settings(app);
    let workspace = settings
        .active_workspace
        .ok_or_else(|| "当前没有工作区".to_string())?;
    let root = workspace
        .roots
        .iter()
        .find(|root| root.id == root_id)
        .ok_or_else(|| "未找到工作区根目录".to_string())?;
    let path = PathBuf::from(&root.path);
    if !path.is_dir() {
        return Err(format!("工作区不存在或不是文件夹：{}", path.display()));
    }
    ensure_ntfs_path(&path)?;
    Ok(path)
}

pub(super) fn workspace_root_for_path(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let canonical_path = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    workspace_roots(app)?
        .into_iter()
        .map(|(_, root)| dunce::canonicalize(&root).unwrap_or(root))
        .find(|root| canonical_path.starts_with(root))
        .ok_or_else(|| "仓库必须位于当前工作区的某个根目录内".to_string())
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
    repo_root_and_path_by_id(app, id).map(|(_, path)| path)
}

pub(super) fn repo_root_and_path_by_id(
    app: &AppHandle,
    id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let normalized = id.trim();
    if let Some(value) = normalized.strip_prefix("local:") {
        let (root_id, _) = value
            .split_once('/')
            .ok_or_else(|| format!("未找到 Git 仓库：{normalized}"))?;
        let root = workspace_root_by_id(app, root_id)?;
        let path = repo_path_from_id(&root, normalized)?;
        return Ok((root, path));
    }
    let root = workspace_root(app)?;
    let path = repo_path_from_id(&root, normalized)?;
    Ok((root, path))
}

pub(super) fn repo_path_from_id(root: &Path, id: &str) -> Result<PathBuf, String> {
    let normalized = id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    let relative_id = if let Some(value) = normalized.strip_prefix("local:") {
        let (root_id, relative) = value
            .split_once('/')
            .ok_or_else(|| format!("未找到 Git 仓库：{normalized}"))?;
        if root_id != root_id_for_path(root) {
            return Err(format!("未找到 Git 仓库：{normalized}"));
        }
        relative
    } else {
        normalized
    };
    let relative = PathBuf::from(relative_id.replace('/', std::path::MAIN_SEPARATOR_STR));
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
    settings.favorite_repo_ids.retain(|id| id != repo_id);
    settings
        .recent_local_repos
        .retain(|visit| visit.repo_id != repo_id);
    settings
        .organization_grouping_resolved_repo_ids
        .retain(|id| id != repo_id);
    for group in &mut settings.repo_groups {
        group.repo_ids.retain(|id| id != repo_id);
    }
    settings.project_launch_configs.remove(repo_id);
    settings.repo_sync_preferences.remove(repo_id);
    settings.repo_remote_sync_policies.remove(repo_id);
    remove_local_contribution_cache(settings, repo_id);
}

fn prune_workspace_root_settings(workspace: &mut NamedWorkspace, root_id: &str) {
    let prefix = format!("local:{root_id}/");
    let keep = |id: &str| !id.starts_with(&prefix);
    workspace.managed_repo_ids.retain(|id| keep(id));
    workspace.hidden_repo_ids.retain(|id| keep(id));
    workspace.system_git_repo_ids.retain(|id| keep(id));
    workspace.repo_bindings.retain(|id, _| keep(id));
    workspace.favorite_repo_ids.retain(|id| keep(id));
    workspace
        .recent_local_repos
        .retain(|visit| keep(&visit.repo_id));
    workspace
        .organization_grouping_resolved_repo_ids
        .retain(|id| keep(id));
    for group in &mut workspace.repo_groups {
        group.repo_ids.retain(|id| keep(id));
    }
    workspace.project_launch_configs.retain(|id, _| keep(id));
    workspace.repo_sync_preferences.retain(|id, _| keep(id));
    workspace.repo_remote_sync_policies.retain(|id, _| keep(id));
    workspace.local_contribution_cache.retain(|id, _| keep(id));
}

pub fn workspace_get_settings(app: AppHandle) -> WorkspaceSettings {
    let mut settings = load_settings(&app);
    if migrate_remote_repo_shortcuts(&mut settings) {
        let _ = save_settings(&app, &settings);
    }
    visible_workspace_settings(settings)
}

pub fn workspace_get_bootstrap(app: AppHandle) -> WorkspaceBootstrap {
    let settings = workspace_get_settings(app.clone());
    let startup_cache =
        load_startup_cache(&app).filter(|cache| startup_cache_matches_settings(cache, &settings));
    WorkspaceBootstrap {
        settings,
        startup_cache,
        context_revision: current_context_revision(),
    }
}

fn validate_workspace_name(
    profile: &WorkspaceProfile,
    name: &str,
    except_id: Option<&str>,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err("工作区名称必须为 1 到 64 个字符".to_string());
    }
    if profile.workspaces.iter().any(|workspace| {
        Some(workspace.id.as_str()) != except_id && workspace.name.eq_ignore_ascii_case(name)
    }) {
        return Err("工作区名称已存在".to_string());
    }
    Ok(name.to_string())
}

fn validated_root(path: &str) -> Result<(String, String, PathBuf), String> {
    let path = PathBuf::from(path.trim());
    if !path.exists() || !path.is_dir() {
        return Err(format!("工作区不存在或不是文件夹：{}", path.display()));
    }
    ensure_ntfs_path(&path)?;
    let canonical =
        dunce::canonicalize(&path).map_err(|error| format!("读取工作区路径失败：{error}"))?;
    let id = root_id_for_path(&canonical);
    let text = canonical.to_string_lossy().to_string();
    Ok((id, text, canonical))
}

fn normalized_path_for_overlap(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn ensure_root_not_overlapping(
    workspace: &NamedWorkspace,
    candidate: &Path,
    except_id: Option<&str>,
) -> Result<(), String> {
    let candidate = normalized_path_for_overlap(candidate);
    for root in &workspace.roots {
        if Some(root.id.as_str()) == except_id {
            continue;
        }
        let existing =
            dunce::canonicalize(&root.path).unwrap_or_else(|_| PathBuf::from(&root.path));
        let existing = normalized_path_for_overlap(&existing);
        if candidate == existing
            || candidate.starts_with(&format!("{existing}/"))
            || existing.starts_with(&format!("{candidate}/"))
        {
            return Err("同一工作区的根目录不能相同或互相包含".to_string());
        }
    }
    Ok(())
}

fn write_workspace_document(
    app: &AppHandle,
    document: &WorkspaceSettingsDocument,
    reset_runtime: bool,
) -> Result<WorkspaceBootstrap, String> {
    write_settings_document(app, document)?;
    if reset_runtime {
        reset_workspace_runtime_state(app);
    }
    Ok(workspace_get_bootstrap(app.clone()))
}

pub fn workspace_create(
    app: AppHandle,
    name: String,
    root_path: String,
) -> Result<WorkspaceBootstrap, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (root_id, root_path, _) = validated_root(&root_path)?;
    let (mut document, _) = read_settings_document(&app);
    let profile = profile_mut_from_document(&mut document);
    let name = validate_workspace_name(profile, &name, None)?;
    let workspace_id = next_stable_id("workspace");
    profile.workspaces.push(NamedWorkspace {
        id: workspace_id.clone(),
        name,
        roots: vec![WorkspaceRoot {
            id: root_id.clone(),
            path: root_path,
            available: true,
            unavailable_reason: None,
        }],
        primary_root_id: Some(root_id),
        ..NamedWorkspace::default()
    });
    profile.active_workspace_id = Some(workspace_id);
    write_workspace_document(&app, &document, true)
}

pub fn workspace_rename(
    app: AppHandle,
    workspace_id: String,
    name: String,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (mut document, _) = read_settings_document(&app);
    let profile = profile_mut_from_document(&mut document);
    let name = validate_workspace_name(profile, &name, Some(workspace_id.trim()))?;
    let workspace = profile
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id.trim())
        .ok_or_else(|| "未找到工作区".to_string())?;
    workspace.name = name;
    write_settings_document(&app, &document)?;
    Ok(workspace_get_settings(app))
}

pub fn workspace_switch(
    app: AppHandle,
    workspace_id: String,
) -> Result<WorkspaceBootstrap, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (mut document, _) = read_settings_document(&app);
    let profile = profile_mut_from_document(&mut document);
    let workspace_id = workspace_id.trim();
    if !profile
        .workspaces
        .iter()
        .any(|workspace| workspace.id == workspace_id)
    {
        return Err("未找到工作区".to_string());
    }
    if profile.active_workspace_id.as_deref() == Some(workspace_id) {
        return Ok(workspace_get_bootstrap(app));
    }
    if let Some(active_id) = profile.active_workspace_id.as_deref() {
        if crate::workspace::tasks::has_active_workspace_mutation(active_id) {
            return Err("当前工作区有正在执行的写入任务，请等待任务完成后再切换".to_string());
        }
    }
    profile.active_workspace_id = Some(workspace_id.to_string());
    write_workspace_document(&app, &document, true)
}

pub fn workspace_delete(
    app: AppHandle,
    workspace_id: String,
) -> Result<WorkspaceBootstrap, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (mut document, _) = read_settings_document(&app);
    let profile = profile_mut_from_document(&mut document);
    let workspace_id = workspace_id.trim();
    if crate::workspace::tasks::has_active_workspace_mutation(workspace_id) {
        return Err("该工作区有正在执行的写入任务，暂时无法删除".to_string());
    }
    if crate::workspace::launch::has_running_launch_for_workspace(workspace_id) {
        return Err("该工作区有正在运行的启动任务，请先停止后再删除".to_string());
    }
    let index = profile
        .workspaces
        .iter()
        .position(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "未找到工作区".to_string())?;
    let was_active = profile.active_workspace_id.as_deref() == Some(workspace_id);
    profile.workspaces.remove(index);
    if was_active {
        profile.active_workspace_id = profile
            .workspaces
            .get(index)
            .or_else(|| {
                index
                    .checked_sub(1)
                    .and_then(|index| profile.workspaces.get(index))
            })
            .map(|workspace| workspace.id.clone());
    }
    write_workspace_document(&app, &document, was_active)
}

pub fn workspace_add_root(
    app: AppHandle,
    workspace_id: String,
    root_path: String,
) -> Result<WorkspaceBootstrap, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (root_id, root_path, canonical) = validated_root(&root_path)?;
    let (mut document, _) = read_settings_document(&app);
    let profile = profile_mut_from_document(&mut document);
    let workspace = profile
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id.trim())
        .ok_or_else(|| "未找到工作区".to_string())?;
    ensure_root_not_overlapping(workspace, &canonical, None)?;
    workspace.roots.push(WorkspaceRoot {
        id: root_id.clone(),
        path: root_path,
        available: true,
        unavailable_reason: None,
    });
    if workspace.primary_root_id.is_none() {
        workspace.primary_root_id = Some(root_id);
    }
    let active = profile.active_workspace_id.as_deref() == Some(workspace_id.trim());
    write_workspace_document(&app, &document, active)
}

pub fn workspace_remove_root(
    app: AppHandle,
    workspace_id: String,
    root_id: String,
) -> Result<WorkspaceBootstrap, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (mut document, _) = read_settings_document(&app);
    let profile = profile_mut_from_document(&mut document);
    let workspace_id = workspace_id.trim();
    let root_id = root_id.trim();
    if crate::workspace::tasks::has_active_root_mutation(workspace_id, root_id) {
        return Err("该根目录有正在执行的写入任务，暂时无法移除".to_string());
    }
    if crate::workspace::launch::has_running_launch_for_root(workspace_id, root_id) {
        return Err("该根目录有正在运行的启动任务，请先停止后再移除".to_string());
    }
    let workspace = profile
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "未找到工作区".to_string())?;
    let before = workspace.roots.len();
    workspace.roots.retain(|root| root.id != root_id);
    if workspace.roots.len() == before {
        return Err("未找到工作区根目录".to_string());
    }
    prune_workspace_root_settings(workspace, root_id);
    if workspace.primary_root_id.as_deref() == Some(root_id) {
        workspace.primary_root_id = workspace.roots.first().map(|root| root.id.clone());
    }
    let active = profile.active_workspace_id.as_deref() == Some(workspace_id);
    write_workspace_document(&app, &document, active)
}

pub fn workspace_set_primary_root(
    app: AppHandle,
    workspace_id: String,
    root_id: String,
) -> Result<WorkspaceBootstrap, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (mut document, _) = read_settings_document(&app);
    let profile = profile_mut_from_document(&mut document);
    let workspace = profile
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id.trim())
        .ok_or_else(|| "未找到工作区".to_string())?;
    if !workspace.roots.iter().any(|root| root.id == root_id.trim()) {
        return Err("未找到工作区根目录".to_string());
    }
    workspace.primary_root_id = Some(root_id.trim().to_string());
    let active = profile.active_workspace_id.as_deref() == Some(workspace_id.trim());
    write_workspace_document(&app, &document, active)
}

pub fn workspace_update_view_preferences(
    app: AppHandle,
    preferences: WorkspaceViewPreferences,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (mut document, _) = read_settings_document(&app);
    let profile = profile_mut_from_document(&mut document);
    let active_id = profile
        .active_workspace_id
        .clone()
        .ok_or_else(|| "当前没有工作区".to_string())?;
    let workspace = profile
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == active_id)
        .ok_or_else(|| "未找到工作区".to_string())?;
    workspace.view_preferences = preferences;
    write_settings_document(&app, &document)?;
    Ok(workspace_get_settings(app))
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
    preferences: AccountPreferences,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    validate_repository_scope(&preferences.repository_scope)?;
    let mut settings = load_settings(&app);
    settings.account_preferences = preferences;
    save_settings(&app, &settings)?;
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
    let settings = load_settings(&app);
    let entries = settings
        .managed_repo_ids
        .iter()
        .filter(|id| !settings.hidden_repo_ids.contains(id))
        .filter_map(|id| repo_root_and_path_by_id(&app, id).ok())
        .collect::<Vec<_>>();
    let mut common_dirs = entries
        .iter()
        .map(|(_, path)| path.clone())
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
            scan_contribution_identity_recommendations_for_entries(entries, &settings)
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

#[cfg(test)]
pub(super) fn scan_contribution_identity_recommendations(
    root: &Path,
    settings: &WorkspaceSettings,
) -> ContributionIdentityRecommendationResult {
    let entries = managed_repo_paths(root, settings)
        .into_iter()
        .map(|path| (root.to_path_buf(), path))
        .collect();
    scan_contribution_identity_recommendations_for_entries(entries, settings)
}

fn scan_contribution_identity_recommendations_for_entries(
    entries: Vec<(PathBuf, PathBuf)>,
    settings: &WorkspaceSettings,
) -> ContributionIdentityRecommendationResult {
    let mut scanned_repo_count = 0;
    let mut skipped_repo_count = 0;
    let mut seen_repo_groups = HashSet::new();
    let mut repo_scans = Vec::new();
    let persisted_identities =
        normalize_contribution_identities(settings.contribution_identities.clone());

    for (root, path) in entries {
        let canonical_path = canonical_repo_path(&path);
        let repo_group_key =
            git_common_dir(&canonical_path).unwrap_or_else(|| canonical_path.clone());
        if !seen_repo_groups.insert(repo_group_key) {
            continue;
        }
        let qualified_repo_id = repo_id(&root, &canonical_path);
        let legacy_repo_id = canonical_path
            .strip_prefix(canonical_repo_path(&root))
            .ok()
            .and_then(|path| path.to_str())
            .map(|path| path.replace('\\', "/"));
        let repo_id = legacy_repo_id
            .filter(|id| settings.managed_repo_ids.contains(id))
            .unwrap_or(qualified_repo_id);
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

pub fn workspace_record_recent_local_repo(
    app: AppHandle,
    repo_id: String,
) -> Result<WorkspaceSettings, String> {
    let repo_id = repo_id.trim();
    if repo_id.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    repo_path_by_id(&app, repo_id)?;

    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut settings = load_settings(&app);
    record_recent_local_repo_visit(&mut settings.recent_local_repos, repo_id, now_millis());
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

fn record_recent_local_repo_visit(
    visits: &mut Vec<RecentLocalRepoVisit>,
    repo_id: &str,
    opened_at: i64,
) {
    visits.retain(|visit| !visit.repo_id.trim().is_empty() && visit.repo_id != repo_id);
    visits.push(RecentLocalRepoVisit {
        repo_id: repo_id.to_string(),
        opened_at,
    });
    visits.sort_by(|left, right| {
        right
            .opened_at
            .cmp(&left.opened_at)
            .then_with(|| left.repo_id.cmp(&right.repo_id))
    });
    visits.dedup_by(|left, right| left.repo_id == right.repo_id);
    visits.truncate(RECENT_LOCAL_REPO_LIMIT);
}

pub fn workspace_create_repo_group(
    app: AppHandle,
    name: String,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
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
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut settings = load_settings(&app);
    rename_repo_group(&mut settings, &group_id, &name)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_delete_repo_group(
    app: AppHandle,
    group_id: String,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
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
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut settings = load_settings(&app);
    move_repo_to_group(&mut settings, normalized, group_id.as_deref())?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_reconcile_organization_repo_groups(
    app: AppHandle,
    organization_logins: Vec<String>,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut settings = load_settings(&app);
    reconcile_organization_repo_groups(&mut settings, &organization_logins)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_set_local_repo_favorite(
    app: AppHandle,
    repo_id: String,
    favorite: bool,
) -> Result<WorkspaceSettings, String> {
    let normalized = repo_id.trim();
    if normalized.is_empty() {
        return Err("仓库 ID 不能为空".to_string());
    }
    if favorite {
        repo_path_by_id(&app, normalized)?;
    }
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut settings = load_settings(&app);
    settings.favorite_repo_ids.retain(|id| id != normalized);
    if favorite {
        settings.favorite_repo_ids.push(normalized.to_string());
        sort_dedup(&mut settings.favorite_repo_ids);
    }
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
            let (root, path) = repo_root_and_path_by_id(&app, normalized)?;
            let worktree = resolve_repo_worktree(&root, &path);
            remove_managed_repo_path(&root, &path, &worktree)?;
            let _guard = settings_write_lock()
                .lock()
                .unwrap_or_else(|error| error.into_inner());
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
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut settings = load_settings(&app);
    migrate_remote_repo_shortcuts(&mut settings);
    let account_login = current_github_account_login(&settings)
        .ok_or_else(|| "请先绑定 GitHub 账号".to_string())?;
    repo.account_login = Some(account_login);
    remember_remote_repo_shortcut(&mut settings.remote_repo_shortcuts, repo)?;
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_set_remote_repo_favorite(
    app: AppHandle,
    mut repo: RemoteRepoShortcut,
    favorite: bool,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut settings = load_settings(&app);
    migrate_remote_repo_shortcuts(&mut settings);
    let account_login = current_github_account_login(&settings)
        .ok_or_else(|| "请先绑定 GitHub 账号".to_string())?;
    repo.account_login = Some(account_login.clone());
    if favorite {
        repo.favorite = true;
        remember_remote_repo_shortcut(&mut settings.remote_repo_shortcuts, repo)?;
    } else {
        let target = normalize_github_repo_input(&repo.full_name)?.full_name;
        for shortcut in &mut settings.remote_repo_shortcuts {
            let same_account = shortcut
                .account_login
                .as_deref()
                .is_some_and(|login| login.eq_ignore_ascii_case(&account_login));
            let same_repo = normalize_github_repo_input(&shortcut.full_name)
                .map(|current| current.full_name.eq_ignore_ascii_case(&target))
                .unwrap_or(false);
            if same_account && same_repo {
                shortcut.favorite = false;
            }
        }
    }
    save_settings(&app, &settings)?;
    Ok(visible_workspace_settings(settings))
}

pub fn workspace_forget_remote_repo(
    app: AppHandle,
    full_name: String,
) -> Result<WorkspaceSettings, String> {
    let _guard = settings_write_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
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
    settings
        .hidden_repo_ids
        .into_iter()
        .map(|id| {
            let name = repo_root_and_path_by_id(&app, &id)
                .ok()
                .map(|(_, path)| path)
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
        GitHubBindingMetadata, GitHubRepositoryScope, ProjectLaunchStatus, PullRequestListSortKey,
        SortDirection,
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
        let root_id = root_id_for_path(Path::new("/legacy-root"));
        assert_eq!(
            alice.hidden_repo_ids,
            vec![format!("local:{root_id}/alice/repo")]
        );
        let persisted = runtime.value(STORE_FILE, SETTINGS_KEY).unwrap();
        assert_eq!(persisted["version"], SETTINGS_VERSION);
        assert!(persisted["profiles"].get("alice").is_some());
        assert_eq!(persisted["binding"]["login"], "Alice");
        assert_eq!(
            persisted["profiles"]["alice"]["workspaces"]
                .as_array()
                .unwrap()
                .len(),
            1
        );

        let bob = switch_github_binding(&app, binding("Bob")).unwrap();
        assert!(bob.workspace_root.is_none());

        let restored = switch_github_binding(&app, binding("ALICE")).unwrap();
        assert_eq!(
            restored.hidden_repo_ids,
            vec![format!("local:{root_id}/alice/repo")]
        );
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
        let root_id = root_id_for_path(Path::new("/anonymous-root"));
        assert_eq!(
            migrated.hidden_repo_ids,
            vec![format!("local:{root_id}/anonymous/repo")]
        );
        let persisted = runtime.value(STORE_FILE, SETTINGS_KEY).unwrap();
        assert_eq!(
            persisted["anonymous"]["workspaces"][0]["roots"][0]["path"],
            "/anonymous-root"
        );
        assert!(persisted["profiles"].as_object().unwrap().is_empty());
        assert!(persisted["binding"].is_null());
    }

    #[test]
    fn v2_document_migration_is_idempotent() {
        let runtime = Arc::new(MemoryRuntime::default());
        runtime.insert(
            STORE_FILE,
            SETTINGS_KEY,
            serde_json::json!({
                "version": 2,
                "binding": null,
                "anonymous": {
                    "accountPreferences": {
                        "defaultWorkspaceRoot": "/v2-root"
                    },
                    "hiddenRepoIds": ["owner/repo"]
                },
                "profiles": {}
            }),
        );
        let app = WorkspaceContext::new(runtime.clone());
        let first = load_settings(&app);
        let workspace_id = first.active_workspace_id.clone().unwrap();
        let repo_id = first.hidden_repo_ids[0].clone();
        let second = load_settings(&app);
        assert_eq!(
            second.active_workspace_id.as_deref(),
            Some(workspace_id.as_str())
        );
        assert_eq!(second.hidden_repo_ids, vec![repo_id]);
        assert_eq!(
            runtime.value(STORE_FILE, SETTINGS_KEY).unwrap()["version"],
            3
        );
    }

    #[test]
    fn account_preferences_no_longer_mutate_workspace_root() {
        let runtime = Arc::new(MemoryRuntime::default());
        let app = WorkspaceContext::new(runtime);
        let mut preferences = AccountPreferences {
            repository_scope: GitHubRepositoryScope::Organization {
                login: "lilia-org".to_string(),
            },
            ..AccountPreferences::default()
        };
        preferences.pull_requests.sort = PullRequestListSortKey::Updated;
        preferences.pull_requests.direction = SortDirection::Desc;

        let settings = workspace_update_account_preferences(app.clone(), preferences).unwrap();
        assert!(settings.workspace_root.is_none());
        assert_eq!(
            load_settings(&app).account_preferences,
            settings.account_preferences
        );
    }

    #[test]
    fn workspace_crud_restores_preferences_and_rejects_overlaps_and_duplicate_names() {
        let runtime = Arc::new(MemoryRuntime::default());
        let app = WorkspaceContext::new(runtime);
        let base = std::env::temp_dir().join(format!("lilia-workspace-v3-{}", now_millis()));
        let first = base.join("first");
        let nested = first.join("nested");
        let second = base.join("second");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(&second).unwrap();

        let first_bootstrap = workspace_create(
            app.clone(),
            "First".to_string(),
            first.to_string_lossy().to_string(),
        )
        .unwrap();
        let first_id = first_bootstrap.settings.active_workspace_id.unwrap();
        assert!(workspace_add_root(
            app.clone(),
            first_id.clone(),
            nested.to_string_lossy().to_string()
        )
        .unwrap_err()
        .contains("不能相同或互相包含"));
        let mut preferences = WorkspaceViewPreferences::default();
        preferences.sidebar_repository_sort = "name".to_string();
        workspace_update_view_preferences(app.clone(), preferences).unwrap();

        let second_bootstrap = workspace_create(
            app.clone(),
            "Second".to_string(),
            second.to_string_lossy().to_string(),
        )
        .unwrap();
        assert!(workspace_create(
            app.clone(),
            " first ".to_string(),
            second.to_string_lossy().to_string()
        )
        .unwrap_err()
        .contains("名称已存在"));
        let restored = workspace_switch(app.clone(), first_id).unwrap();
        assert_eq!(
            restored
                .settings
                .active_workspace
                .unwrap()
                .view_preferences
                .sidebar_repository_sort,
            "name"
        );
        assert!(restored.context_revision > second_bootstrap.context_revision);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn startup_cache_is_isolated_by_workspace() {
        let runtime = Arc::new(MemoryRuntime::default());
        let app = WorkspaceContext::new(runtime);
        let base = std::env::temp_dir().join(format!("lilia-workspace-cache-{}", now_millis()));
        let first = base.join("first");
        let second = base.join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let first_id = workspace_create(
            app.clone(),
            "First".into(),
            first.to_string_lossy().into_owned(),
        )
        .unwrap()
        .settings
        .active_workspace_id
        .unwrap();
        let first_settings = load_settings(&app);
        let first_cache = startup_cache_shell(&first_settings);
        save_startup_cache(&app, &first_cache).unwrap();
        let second_id = workspace_create(
            app.clone(),
            "Second".into(),
            second.to_string_lossy().into_owned(),
        )
        .unwrap()
        .settings
        .active_workspace_id
        .unwrap();
        assert!(load_startup_cache(&app).is_none());
        workspace_switch(app.clone(), first_id).unwrap();
        assert!(load_startup_cache(&app).is_some());
        workspace_switch(app.clone(), second_id).unwrap();
        assert!(load_startup_cache(&app).is_none());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn switching_blocks_active_writes_and_root_removal_blocks_running_launches() {
        let runtime = Arc::new(MemoryRuntime::default());
        let app = WorkspaceContext::new(runtime);
        let base = std::env::temp_dir().join(format!("lilia-workspace-guards-{}", now_millis()));
        let first = base.join("first");
        let second = base.join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let first_bootstrap = workspace_create(
            app.clone(),
            "First".into(),
            first.to_string_lossy().into_owned(),
        )
        .unwrap();
        let first_id = first_bootstrap.settings.active_workspace_id.unwrap();
        let root_id = first_bootstrap.settings.active_workspace.unwrap().roots[0]
            .id
            .clone();
        let second_id = workspace_create(
            app.clone(),
            "Second".into(),
            second.to_string_lossy().into_owned(),
        )
        .unwrap()
        .settings
        .active_workspace_id
        .unwrap();
        workspace_switch(app.clone(), first_id.clone()).unwrap();
        let task = crate::workspace::tasks::record_workspace_task_and_emit(
            &app,
            "git",
            "normal",
            Some(format!("local:{root_id}/repo")),
            "running",
            None,
            false,
        );
        assert!(workspace_switch(app.clone(), second_id)
            .unwrap_err()
            .contains("写入任务"));
        crate::workspace::tasks::finish_workspace_task(&app, &task.id, "success", None);

        let launch_key = format!("guard-{first_id}");
        crate::workspace::launch::launch_runtime()
            .lock()
            .unwrap()
            .insert(
                launch_key.clone(),
                crate::workspace::launch::LaunchEntry {
                    status: ProjectLaunchStatus {
                        workspace_id: Some(first_id.clone()),
                        context_revision: current_context_revision(),
                        repo_id: format!("local:{root_id}/repo"),
                        state: "running".to_string(),
                        pid: None,
                        command: None,
                        started_at: None,
                        exit_code: None,
                        error: None,
                    },
                },
            );
        assert!(
            workspace_remove_root(app.clone(), first_id.clone(), root_id.clone())
                .unwrap_err()
                .contains("启动任务")
        );
        crate::workspace::launch::launch_runtime()
            .lock()
            .unwrap()
            .remove(&launch_key);
        workspace_remove_root(app.clone(), first_id, root_id).unwrap();
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn unavailable_legacy_workspace_alias_is_inactive() {
        let missing_root = std::env::temp_dir()
            .join(format!(
                "lilia-missing-account-workspace-{}",
                crate::workspace::shared::now_millis()
            ))
            .to_string_lossy()
            .to_string();
        let settings = WorkspaceSettings {
            workspace_root: Some(missing_root.clone()),
            ..WorkspaceSettings::default()
        };

        let visible = visible_workspace_settings(settings);

        assert_eq!(visible.workspace_root, None);
    }

    #[test]
    fn recent_local_repo_visits_are_deduplicated_ordered_and_limited() {
        let mut visits = (0..RECENT_LOCAL_REPO_LIMIT + 3)
            .map(|index| RecentLocalRepoVisit {
                repo_id: format!("repo-{index}"),
                opened_at: index as i64,
            })
            .collect::<Vec<_>>();

        record_recent_local_repo_visit(&mut visits, "repo-0", 100);

        assert_eq!(visits.len(), RECENT_LOCAL_REPO_LIMIT);
        assert_eq!(visits[0].repo_id, "repo-0");
        assert_eq!(
            visits
                .iter()
                .filter(|visit| visit.repo_id == "repo-0")
                .count(),
            1
        );
        assert!(visits
            .windows(2)
            .all(|pair| pair[0].opened_at >= pair[1].opened_at));
    }
}
