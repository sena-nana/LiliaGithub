use std::fs;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;

use crate::workspace::repos::{
    canonical_repo_path, is_git_repo, sanitize_clone_path_segment,
};
use lilia_github_contracts::workspace::{
    WorkspaceRepoGroup, WorkspaceRepoPathMode, WorkspaceSettings,
};

pub(super) fn remap_repo_id_in_settings(
    settings: &mut WorkspaceSettings,
    old_id: &str,
    new_id: &str,
    new_local_path: Option<&str>,
) {
    let old_id = old_id.trim();
    let new_id = new_id.trim();
    if old_id.is_empty() || new_id.is_empty() || old_id == new_id {
        if let (Some(path), Some(binding)) = (new_local_path, settings.repo_bindings.get_mut(old_id))
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

pub(super) fn relocate_directory(
    source: &Path,
    destination: &Path,
    mode: WorkspaceRepoPathMode,
) -> Result<(), String> {
    if mode == WorkspaceRepoPathMode::Keep {
        return Ok(());
    }
    let source = if source.exists() {
        canonical_repo_path(source)
    } else {
        source.to_path_buf()
    };
    if !source.exists() {
        return Err(format!("源目录不存在：{}", source.display()));
    }
    if destination.exists() {
        if canonical_repo_path(destination) == canonical_repo_path(&source) {
            return Ok(());
        }
        return Err(format!("目标位置已存在：{}", destination.display()));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建目标目录失败：{error}"))?;
    }
    match mode {
        WorkspaceRepoPathMode::Keep => Ok(()),
        WorkspaceRepoPathMode::Move => {
            fs::rename(&source, destination).map_err(|error| format!("移动仓库目录失败：{error}"))
        }
        WorkspaceRepoPathMode::Link => create_directory_link(&source, destination),
    }
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
        let mut settings = WorkspaceSettings::default();
        settings.managed_repo_ids = vec!["local:root/a/demo".into()];
        settings.favorite_repo_ids = vec!["local:root/a/demo".into()];
        settings.repo_groups = vec![WorkspaceRepoGroup {
            id: "g1".into(),
            name: "前端".into(),
            organization_login: None,
            repo_ids: vec!["local:root/a/demo".into()],
        }];
        remap_repo_id_in_settings(
            &mut settings,
            "local:root/a/demo",
            "local:root/前端/demo",
            Some("/workspace/前端/demo"),
        );
        assert_eq!(settings.managed_repo_ids, vec!["local:root/前端/demo".to_string()]);
        assert_eq!(settings.favorite_repo_ids, vec!["local:root/前端/demo".to_string()]);
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
        relocate_directory(&source, &link, WorkspaceRepoPathMode::Link).unwrap();
        assert!(link.exists());
        assert!(source.exists());
        assert_eq!(
            fs::read_to_string(link.join("marker.txt")).unwrap(),
            "ok"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
