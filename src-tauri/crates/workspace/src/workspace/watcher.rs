use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use lilia_github_contracts::workspace::RepoChangedEvent;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::repos::{git_common_dir, managed_repo_paths, repo_id};
use crate::workspace::settings::{load_settings, workspace_root};

const REPO_CHANGED_EVENT: &str = "workspace://repo-changed";
const REPO_WATCH_DEBOUNCE: Duration = Duration::from_millis(400);
const NOISE_DIR_NAMES: &[&str] = &["node_modules", "target", "dist", ".cache"];

type RepoDebouncer = Debouncer<RecommendedWatcher, FileIdMap>;

struct RepoWatchEntry {
    worktree_path: PathBuf,
    git_common_dir: PathBuf,
    #[allow(dead_code)]
    debouncer: RepoDebouncer,
}

struct RepoWatcherManager {
    entries: HashMap<String, RepoWatchEntry>,
}

fn watcher_manager() -> &'static Mutex<RepoWatcherManager> {
    static MANAGER: OnceLock<Mutex<RepoWatcherManager>> = OnceLock::new();
    MANAGER.get_or_init(|| Mutex::new(RepoWatcherManager { entries: HashMap::new() }))
}

pub(super) fn sync_repo_watchers(app: &AppHandle) {
    let Ok(root) = workspace_root(app) else {
        clear_repo_watchers();
        return;
    };
    let settings = load_settings(app);
    let desired: Vec<(String, PathBuf)> = managed_repo_paths(&root, &settings)
        .into_iter()
        .map(|path| (repo_id(&root, &path), path))
        .collect();
    let desired_ids: HashSet<String> = desired.iter().map(|(id, _)| id.clone()).collect();

    let mut manager = watcher_manager()
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    manager.entries.retain(|id, _| desired_ids.contains(id));

    for (repo_id, path) in desired {
        let common_dir = git_common_dir(&path).unwrap_or_else(|| path.join(".git"));
        let needs_replace = manager
            .entries
            .get(&repo_id)
            .map(|entry| entry.worktree_path != path || entry.git_common_dir != common_dir)
            .unwrap_or(true);
        if !needs_replace {
            continue;
        }
        if let Some(entry) = install_repo_watch(app, &repo_id, &path, &common_dir) {
            manager.entries.insert(repo_id, entry);
        } else {
            manager.entries.remove(&repo_id);
        }
    }
}

pub(super) fn clear_repo_watchers() {
    watcher_manager()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .entries
        .clear();
}

fn install_repo_watch(
    app: &AppHandle,
    repo_id: &str,
    worktree_path: &Path,
    git_common_dir: &Path,
) -> Option<RepoWatchEntry> {
    let app = app.clone();
    let watched_repo_id = repo_id.to_string();
    let watched_worktree = worktree_path.to_path_buf();
    let watched_common = git_common_dir.to_path_buf();

    let mut debouncer = new_debouncer(REPO_WATCH_DEBOUNCE, None, move |result: DebounceEventResult| {
        handle_debounced_events(&app, &watched_repo_id, &watched_worktree, &watched_common, result);
    })
    .ok()?;

    debouncer
        .watcher()
        .watch(worktree_path, RecursiveMode::Recursive)
        .ok()?;

    if git_common_dir != worktree_path.join(".git") && !is_path_inside(git_common_dir, worktree_path)
    {
        let _ = debouncer
            .watcher()
            .watch(git_common_dir, RecursiveMode::Recursive);
    }

    Some(RepoWatchEntry {
        worktree_path: worktree_path.to_path_buf(),
        git_common_dir: git_common_dir.to_path_buf(),
        debouncer,
    })
}

fn handle_debounced_events(
    app: &AppHandle,
    repo_id: &str,
    worktree_path: &Path,
    git_common_dir: &Path,
    result: DebounceEventResult,
) {
    let Ok(events) = result else {
        return;
    };
    let mut kind = None;
    for event in events {
        if matches!(event.kind, EventKind::Access(_)) {
            continue;
        }
        for path in &event.paths {
            if should_ignore_watch_path(path) {
                continue;
            }
            match classify_repo_change_path(path, worktree_path, git_common_dir) {
                Some("git-metadata") => kind = Some("git-metadata"),
                Some("worktree") if kind.is_none() => kind = Some("worktree"),
                _ => {}
            }
        }
    }
    if let Some(kind) = kind {
        let _ = app.emit(
            REPO_CHANGED_EVENT,
            &RepoChangedEvent {
                repo_id: repo_id.to_string(),
                kind: kind.to_string(),
            },
        );
    }
}

fn should_ignore_watch_path(path: &Path) -> bool {
    let mut components = path.components().peekable();
    while let Some(component) = components.next() {
        let Some(name) = component.as_os_str().to_str() else {
            continue;
        };
        if name == ".git" {
            if components
                .peek()
                .and_then(|value| value.as_os_str().to_str())
                == Some("objects")
            {
                return true;
            }
            continue;
        }
        if NOISE_DIR_NAMES.contains(&name) {
            return true;
        }
    }
    false
}

fn classify_repo_change_path(
    path: &Path,
    worktree_path: &Path,
    git_common_dir: &Path,
) -> Option<&'static str> {
    if is_path_inside(path, git_common_dir) || {
        let local_git = worktree_path.join(".git");
        path == local_git || is_path_inside(path, &local_git)
    } {
        return Some("git-metadata");
    }
    if is_path_inside(path, worktree_path) {
        return Some("worktree");
    }
    None
}

fn is_path_inside(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::{classify_repo_change_path, should_ignore_watch_path};
    use std::path::{Path, PathBuf};

    #[test]
    fn ignores_noise_and_git_objects() {
        assert!(should_ignore_watch_path(Path::new("C:/ws/app/node_modules/a.js")));
        assert!(should_ignore_watch_path(Path::new("C:/ws/app/target/debug/app")));
        assert!(should_ignore_watch_path(Path::new("C:/ws/app/dist/a.js")));
        assert!(should_ignore_watch_path(Path::new("C:/ws/app/.cache/tmp")));
        assert!(should_ignore_watch_path(Path::new("C:/ws/app/.git/objects/ab/cd")));
        assert!(!should_ignore_watch_path(Path::new("C:/ws/app/src/main.rs")));
        assert!(!should_ignore_watch_path(Path::new("C:/ws/app/.git/HEAD")));
    }

    #[test]
    fn classifies_worktree_metadata_and_linked_common_dir() {
        let worktree = PathBuf::from("C:/ws/app");
        let common = PathBuf::from("C:/ws/app/.git");
        assert_eq!(
            classify_repo_change_path(Path::new("C:/ws/app/src/a.rs"), &worktree, &common),
            Some("worktree")
        );
        assert_eq!(
            classify_repo_change_path(Path::new("C:/ws/app/.git/index"), &worktree, &common),
            Some("git-metadata")
        );

        let linked = PathBuf::from("C:/ws/feature");
        let shared = PathBuf::from("C:/ws/app/.git");
        assert_eq!(
            classify_repo_change_path(Path::new("C:/ws/feature/src/a.rs"), &linked, &shared),
            Some("worktree")
        );
        assert_eq!(
            classify_repo_change_path(Path::new("C:/ws/app/.git/HEAD"), &linked, &shared),
            Some("git-metadata")
        );
    }
}
