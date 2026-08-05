use std::fs;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;

use crate::workspace::repos::{canonical_repo_path, is_git_repo, sanitize_clone_path_segment};
use lilia_github_contracts::workspace::{
    WorkspaceRepoGroup, WorkspaceRepoPathMode, WorkspaceSettings,
};

#[derive(Debug)]
pub(super) enum DirectoryRelocation {
    Move {
        source: PathBuf,
        destination: PathBuf,
        created_parent: Option<PathBuf>,
    },
    Link {
        destination: PathBuf,
        created_parent: Option<PathBuf>,
    },
}

#[derive(Debug)]
pub(super) struct PreparedDirectoryRelocation {
    pub(super) source: PathBuf,
    pub(super) destination: PathBuf,
    pub(super) mode: WorkspaceRepoPathMode,
    pub(super) destination_parent_existed: bool,
}

impl PreparedDirectoryRelocation {
    pub(super) fn apply(&self) -> Result<DirectoryRelocation, String> {
        let created_parent = create_parent_directory(&self.destination)?;
        let result = match self.mode {
            WorkspaceRepoPathMode::Keep => Err("仓库路径无需迁移".to_string()),
            WorkspaceRepoPathMode::Move => fs::rename(&self.source, &self.destination)
                .map_err(|error| format!("移动仓库目录失败：{error}")),
            WorkspaceRepoPathMode::Link => create_directory_link(&self.source, &self.destination),
        };
        if let Err(error) = result {
            let cleanup_error = remove_created_parent(created_parent.as_deref()).err();
            return Err(match cleanup_error {
                Some(cleanup_error) => format!("{error}；清理新建目录失败：{cleanup_error}"),
                None => error,
            });
        }
        Ok(match self.mode {
            WorkspaceRepoPathMode::Move => DirectoryRelocation::Move {
                source: self.source.clone(),
                destination: self.destination.clone(),
                created_parent,
            },
            WorkspaceRepoPathMode::Link => DirectoryRelocation::Link {
                destination: self.destination.clone(),
                created_parent,
            },
            WorkspaceRepoPathMode::Keep => unreachable!(),
        })
    }
}

impl DirectoryRelocation {
    pub(super) fn rollback(&self) -> Result<(), String> {
        let created_parent = match self {
            Self::Move {
                source,
                destination,
                created_parent,
            } => {
                fs::rename(destination, source)
                    .map_err(|error| format!("将仓库移回旧路径失败：{error}"))?;
                created_parent
            }
            Self::Link {
                destination,
                created_parent,
            } => {
                remove_directory_link(destination)?;
                created_parent
            }
        };
        remove_created_parent(created_parent.as_deref())
    }
}

pub(super) fn remap_repo_id_in_settings(
    settings: &mut WorkspaceSettings,
    old_id: &str,
    new_id: &str,
    new_local_path: Option<&str>,
) {
    let old_id = old_id.trim();
    let new_id = new_id.trim();
    if old_id.is_empty() || new_id.is_empty() || old_id == new_id {
        if let (Some(path), Some(binding)) =
            (new_local_path, settings.repo_bindings.get_mut(old_id))
        {
            binding.local_path = path.to_string();
        }
        return;
    }

    let replace_list = |values: &mut Vec<String>| {
        for value in values.iter_mut() {
            if value == old_id {
                *value = new_id.to_string();
            }
        }
        values.sort();
        values.dedup();
    };

    replace_list(&mut settings.hidden_repo_ids);
    replace_list(&mut settings.managed_repo_ids);
    replace_list(&mut settings.system_git_repo_ids);
    replace_list(&mut settings.favorite_repo_ids);
    replace_list(&mut settings.organization_grouping_resolved_repo_ids);

    for group in &mut settings.repo_groups {
        replace_list(&mut group.repo_ids);
    }

    for visit in &mut settings.recent_local_repos {
        if visit.repo_id == old_id {
            visit.repo_id = new_id.to_string();
        }
    }

    fn rekey_map<T>(values: &mut std::collections::HashMap<String, T>, old_id: &str, new_id: &str) {
        if let Some(value) = values.remove(old_id) {
            values.insert(new_id.to_string(), value);
        }
    }

    rekey_map(&mut settings.project_launch_configs, old_id, new_id);
    rekey_map(&mut settings.repo_sync_preferences, old_id, new_id);
    rekey_map(&mut settings.repo_remote_sync_policies, old_id, new_id);
    rekey_map(&mut settings.local_contribution_cache, old_id, new_id);
    if let Some(mut binding) = settings.repo_bindings.remove(old_id) {
        if let Some(path) = new_local_path {
            binding.local_path = path.to_string();
        }
        settings.repo_bindings.insert(new_id.to_string(), binding);
    }
}

pub(super) fn target_path_for_group(
    root: &Path,
    current: &Path,
    group: Option<&WorkspaceRepoGroup>,
) -> Result<PathBuf, String> {
    let leaf = current
        .file_name()
        .ok_or_else(|| "无法确定仓库目录名".to_string())?;
    match group {
        Some(group) => {
            let raw = group
                .organization_login
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(group.name.trim());
            let segment = sanitize_clone_path_segment(raw)?;
            Ok(root.join(segment).join(leaf))
        }
        None => Ok(root.join(leaf)),
    }
}

pub(super) fn path_already_matches_group(
    root: &Path,
    current: &Path,
    group: Option<&WorkspaceRepoGroup>,
) -> bool {
    let Ok(target) = target_path_for_group(root, current, group) else {
        return false;
    };
    canonical_repo_path(current) == canonical_repo_path(&target)
}

pub(super) fn prepare_directory_relocation(
    source: &Path,
    destination: &Path,
    mode: WorkspaceRepoPathMode,
) -> Result<PreparedDirectoryRelocation, String> {
    prepare_directory_relocation_with_identity(source, destination, mode, filesystem_identity)
}

fn prepare_directory_relocation_with_identity<F>(
    source: &Path,
    destination: &Path,
    mode: WorkspaceRepoPathMode,
    filesystem_identity: F,
) -> Result<PreparedDirectoryRelocation, String>
where
    F: Fn(&Path) -> Result<String, String>,
{
    if mode == WorkspaceRepoPathMode::Keep {
        return Err("仓库路径无需迁移".to_string());
    }
    let source = if source.exists() {
        canonical_repo_path(source)
    } else {
        source.to_path_buf()
    };
    if !source.exists() {
        return Err(format!("源目录不存在：{}", source.display()));
    }
    if fs::symlink_metadata(destination).is_ok() {
        return Err(format!("目标位置已存在：{}", destination.display()));
    }
    ensure_relocation_permissions(&source, destination, mode)?;
    if mode == WorkspaceRepoPathMode::Move {
        ensure_same_filesystem(&source, destination, &filesystem_identity)?;
    }
    Ok(PreparedDirectoryRelocation {
        source,
        destination: destination.to_path_buf(),
        mode,
        destination_parent_existed: destination.parent().is_some_and(Path::exists),
    })
}

pub(super) fn recover_directory_relocation(
    source: &Path,
    destination: &Path,
    mode: WorkspaceRepoPathMode,
    destination_parent_existed: bool,
    keep_destination: bool,
) -> Result<(), String> {
    let source_exists = fs::symlink_metadata(source).is_ok();
    let destination_exists = fs::symlink_metadata(destination).is_ok();
    match mode {
        WorkspaceRepoPathMode::Keep => Err("仓库路径无需恢复".to_string()),
        WorkspaceRepoPathMode::Move => {
            match (source_exists, destination_exists, keep_destination) {
                (true, false, false) => {
                    remove_recovery_parent(destination, destination_parent_existed)
                }
                (false, true, true) => Ok(()),
                (true, false, true) => {
                    ensure_same_filesystem(source, destination, &filesystem_identity)?;
                    apply_recovery_with_parent(destination, || {
                        fs::rename(source, destination)
                            .map_err(|error| format!("继续完成仓库移动失败：{error}"))
                    })
                }
                (false, true, false) => {
                    fs::rename(destination, source)
                        .map_err(|error| format!("恢复仓库旧路径失败：{error}"))?;
                    remove_recovery_parent(destination, destination_parent_existed)
                }
                (true, true, _) => Err(format!(
                    "迁移恢复发现旧路径与新路径同时存在：旧路径 {}；新路径 {}",
                    source.display(),
                    destination.display()
                )),
                (false, false, _) => Err(format!(
                    "迁移恢复找不到旧路径和新路径：旧路径 {}；新路径 {}",
                    source.display(),
                    destination.display()
                )),
            }
        }
        WorkspaceRepoPathMode::Link => {
            if !source_exists {
                return Err(format!("迁移恢复找不到源目录：{}", source.display()));
            }
            if keep_destination {
                if destination_exists {
                    ensure_directory_link_target(source, destination)
                } else {
                    apply_recovery_with_parent(destination, || {
                        create_directory_link(source, destination)
                    })
                }
            } else if destination_exists {
                ensure_directory_link_target(source, destination)?;
                remove_directory_link(destination)?;
                remove_recovery_parent(destination, destination_parent_existed)
            } else {
                remove_recovery_parent(destination, destination_parent_existed)
            }
        }
    }
}

fn apply_recovery_with_parent(
    destination: &Path,
    apply: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let created_parent = create_parent_directory(destination)?;
    if let Err(error) = apply() {
        let cleanup = remove_created_parent(created_parent.as_deref());
        return Err(match cleanup {
            Ok(()) => error,
            Err(cleanup_error) => format!("{error}；清理新建目录失败：{cleanup_error}"),
        });
    }
    Ok(())
}

fn ensure_directory_link_target(source: &Path, destination: &Path) -> Result<(), String> {
    let source = canonical_repo_path(source);
    let destination_target = dunce::canonicalize(destination)
        .map(|path| canonical_repo_path(&path))
        .map_err(|error| format!("读取目录链接目标失败：{error}"))?;
    if destination_target == source {
        return Ok(());
    }
    Err(format!(
        "迁移恢复拒绝修改指向其它位置的目录链接：{}",
        destination.display()
    ))
}

fn remove_recovery_parent(
    destination: &Path,
    destination_parent_existed: bool,
) -> Result<(), String> {
    if destination_parent_existed {
        return Ok(());
    }
    remove_created_parent(destination.parent())
}

fn create_parent_directory(destination: &Path) -> Result<Option<PathBuf>, String> {
    let Some(parent) = destination.parent() else {
        return Ok(None);
    };
    if parent.exists() {
        return Ok(None);
    }
    match fs::create_dir(parent) {
        Ok(()) => Ok(Some(parent.to_path_buf())),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(None),
        Err(error) => Err(format!("创建目标目录失败：{error}")),
    }
}

fn remove_created_parent(path: Option<&Path>) -> Result<(), String> {
    let Some(path) = path else {
        return Ok(());
    };
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(unix)]
fn remove_directory_link(path: &Path) -> Result<(), String> {
    fs::remove_file(path).map_err(|error| format!("删除新建目录链接失败：{error}"))
}

#[cfg(windows)]
fn remove_directory_link(path: &Path) -> Result<(), String> {
    fs::remove_dir(path).map_err(|error| format!("删除新建目录链接失败：{error}"))
}

#[cfg(not(any(unix, windows)))]
fn remove_directory_link(path: &Path) -> Result<(), String> {
    fs::remove_file(path).map_err(|error| format!("删除新建目录链接失败：{error}"))
}

fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

fn ensure_relocation_permissions(
    source: &Path,
    destination: &Path,
    mode: WorkspaceRepoPathMode,
) -> Result<(), String> {
    let source_parent = source
        .parent()
        .ok_or_else(|| format!("无法确定源目录父路径：{}", source.display()))?;
    let destination_parent = destination
        .parent()
        .and_then(nearest_existing_ancestor)
        .ok_or_else(|| format!("无法确定目标目录父路径：{}", destination.display()))?;
    let mut paths = vec![destination_parent.as_path()];
    if mode == WorkspaceRepoPathMode::Move {
        paths.push(source_parent);
    }
    for path in paths {
        let metadata = fs::metadata(path).map_err(|error| format!("读取目录权限失败：{error}"))?;
        if metadata.permissions().readonly() {
            return Err(format!("目录没有迁移写入权限：{}", path.display()));
        }
    }
    Ok(())
}

fn ensure_same_filesystem<F>(
    source: &Path,
    destination: &Path,
    filesystem_identity: &F,
) -> Result<(), String>
where
    F: Fn(&Path) -> Result<String, String>,
{
    let destination_anchor = destination
        .parent()
        .and_then(nearest_existing_ancestor)
        .ok_or_else(|| format!("无法确定目标路径所在卷：{}", destination.display()))?;
    if filesystem_identity(source)? == filesystem_identity(&destination_anchor)? {
        return Ok(());
    }
    Err(format!(
        "不支持跨卷移动仓库：旧路径 {}；新路径 {}",
        source.display(),
        destination.display()
    ))
}

#[cfg(windows)]
fn filesystem_identity(path: &Path) -> Result<String, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        GetVolumeNameForVolumeMountPointW, GetVolumePathNameW,
    };

    let canonical =
        dunce::canonicalize(path).map_err(|error| format!("读取路径所在卷失败：{error}"))?;
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
        return Err(format!("读取路径所在卷失败：{}", path.display()));
    }
    let mut volume_name = vec![0_u16; 32_768];
    let volume_name_ok = unsafe {
        GetVolumeNameForVolumeMountPointW(
            volume_path.as_ptr(),
            volume_name.as_mut_ptr(),
            volume_name.len() as u32,
        )
    };
    let value = if volume_name_ok == 0 {
        &volume_path
    } else {
        &volume_name
    };
    let length = value
        .iter()
        .position(|item| *item == 0)
        .unwrap_or(value.len());
    Ok(String::from_utf16_lossy(&value[..length]).to_ascii_lowercase())
}

#[cfg(unix)]
fn filesystem_identity(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path)
        .map(|metadata| metadata.dev().to_string())
        .map_err(|error| format!("读取路径所在文件系统失败：{error}"))
}

#[cfg(not(any(unix, windows)))]
fn filesystem_identity(path: &Path) -> Result<String, String> {
    Ok(path
        .components()
        .next()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .unwrap_or_default())
}

fn create_directory_link(target: &Path, link_path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link_path)
            .map_err(|error| format!("创建符号链接失败：{error}"))
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_dir(target, link_path).is_ok() {
            return Ok(());
        }
        let status = Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &link_path.to_string_lossy(),
                &target.to_string_lossy(),
            ])
            .status()
            .map_err(|error| format!("创建目录联接失败：{error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "创建目录联接失败：无法在 {} 指向 {}",
                link_path.display(),
                target.display()
            ))
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, link_path);
        Err("当前平台不支持创建目录链接".to_string())
    }
}

pub(super) fn ensure_git_repo_path(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() || !path.is_dir() {
        return Err(format!("仓库目录不存在：{}", path.display()));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("读取仓库路径失败：{error}"))?;
    if !is_git_repo(&canonical) {
        return Err(format!("不是 Git 仓库：{}", canonical.display()));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lilia_github_contracts::workspace::WorkspaceRepoGroup;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "lilia-github-path-relocation-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn group_target_uses_group_name_and_leaf() {
        let root = PathBuf::from("/workspace");
        let current = PathBuf::from("/workspace/old/demo");
        let group = WorkspaceRepoGroup {
            id: "g1".into(),
            name: "前端".into(),
            organization_login: None,
            repo_ids: vec![],
        };
        let target = target_path_for_group(&root, &current, Some(&group)).unwrap();
        assert_eq!(target, PathBuf::from("/workspace/前端/demo"));
    }

    #[test]
    fn remap_updates_membership_lists() {
        let mut settings = WorkspaceSettings {
            managed_repo_ids: vec!["local:root/a/demo".into()],
            favorite_repo_ids: vec!["local:root/a/demo".into()],
            repo_groups: vec![WorkspaceRepoGroup {
                id: "g1".into(),
                name: "前端".into(),
                organization_login: None,
                repo_ids: vec!["local:root/a/demo".into()],
            }],
            ..WorkspaceSettings::default()
        };
        remap_repo_id_in_settings(
            &mut settings,
            "local:root/a/demo",
            "local:root/前端/demo",
            Some("/workspace/前端/demo"),
        );
        assert_eq!(
            settings.managed_repo_ids,
            vec!["local:root/前端/demo".to_string()]
        );
        assert_eq!(
            settings.favorite_repo_ids,
            vec!["local:root/前端/demo".to_string()]
        );
        assert_eq!(
            settings.repo_groups[0].repo_ids,
            vec!["local:root/前端/demo".to_string()]
        );
    }

    #[test]
    fn link_creates_directory_alias() {
        let root = temp_dir("link");
        let source = root.join("source");
        let link = root.join("alias");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("marker.txt"), "ok").unwrap();
        prepare_directory_relocation(&source, &link, WorkspaceRepoPathMode::Link)
            .unwrap()
            .apply()
            .unwrap();
        assert!(link.exists());
        assert!(source.exists());
        assert_eq!(fs::read_to_string(link.join("marker.txt")).unwrap(), "ok");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cross_volume_move_is_rejected_before_creating_destination_parent() {
        let root = temp_dir("cross-volume");
        let source = root.join("source");
        fs::create_dir_all(&source).unwrap();
        let destination_parent = root.join("group");
        let destination = destination_parent.join("repo");

        let error = prepare_directory_relocation_with_identity(
            &source,
            &destination,
            WorkspaceRepoPathMode::Move,
            |path| {
                Ok(if path.file_name().is_some_and(|name| name == "source") {
                    "source-volume"
                } else {
                    "destination-volume"
                }
                .to_string())
            },
        )
        .unwrap_err();

        assert!(error.contains("跨卷"));
        assert!(source.exists());
        assert!(!destination_parent.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
