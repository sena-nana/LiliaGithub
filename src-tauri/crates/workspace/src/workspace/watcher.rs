use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::refresh::{enqueue_uncertain_repo_refreshes, enqueue_watcher_repo_refresh};
use crate::workspace::repos::{
    canonical_repo_path, git_command_lossy, git_common_dir, managed_repo_paths, repo_id,
};
use crate::workspace::settings::{load_settings, workspace_root};

const NOISE_DIR_NAMES: &[&str] = &["node_modules", "target", "dist", ".cache"];

#[derive(Debug, PartialEq, Eq)]
struct RepoWatchSpec {
    repo_id: String,
    worktree_path: PathBuf,
    git_dir: PathBuf,
    git_common_dir: PathBuf,
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
enum RepoChangeKind {
    Worktree,
    GitMetadata,
}

#[derive(Debug, Default)]
struct WatchIndex {
    repos: Vec<RepoWatchSpec>,
}

impl WatchIndex {
    fn repo_ids(&self) -> impl Iterator<Item = String> + '_ {
        self.repos.iter().map(|repo| repo.repo_id.clone())
    }

    fn affected_repos(&self, path: &Path) -> Vec<(String, RepoChangeKind)> {
        if should_ignore_watch_path(path) || self.is_git_object_path(path) {
            return Vec::new();
        }

        if let Some(repo) = longest_matching_repo(&self.repos, path, |repo| {
            repo.git_dir != repo.git_common_dir && is_path_inside(path, &repo.git_dir)
        }) {
            return vec![(repo.repo_id.clone(), RepoChangeKind::GitMetadata)];
        }

        if let Some(repo) = longest_matching_repo(&self.repos, path, |repo| {
            path == repo.worktree_path.join(".git")
        }) {
            return vec![(repo.repo_id.clone(), RepoChangeKind::GitMetadata)];
        }

        if let Some(common_dir) = self.longest_matching_common_dir(path) {
            if is_private_worktree_metadata(path, common_dir) {
                if let Some(repo) =
                    longest_matching_repo(&self.repos, path, |repo| repo.git_dir == common_dir)
                {
                    return vec![(repo.repo_id.clone(), RepoChangeKind::GitMetadata)];
                }
            }

            return self
                .repos
                .iter()
                .filter(|repo| repo.git_common_dir == common_dir)
                .map(|repo| (repo.repo_id.clone(), RepoChangeKind::GitMetadata))
                .collect();
        }

        longest_matching_repo(&self.repos, path, |repo| {
            is_path_inside(path, &repo.worktree_path)
        })
        .map(|repo| vec![(repo.repo_id.clone(), RepoChangeKind::Worktree)])
        .unwrap_or_default()
    }

    fn longest_matching_common_dir(&self, path: &Path) -> Option<&Path> {
        self.repos
            .iter()
            .map(|repo| repo.git_common_dir.as_path())
            .filter(|common_dir| is_path_inside(path, common_dir))
            .max_by_key(|common_dir| common_dir.components().count())
    }

    fn is_git_object_path(&self, path: &Path) -> bool {
        self.repos.iter().any(|repo| {
            path.strip_prefix(&repo.git_common_dir)
                .ok()
                .and_then(|relative| relative.components().next())
                .is_some_and(|component| component.as_os_str() == "objects")
        })
    }

    fn repo_ids_for_paths(&self, paths: &[PathBuf]) -> Vec<String> {
        let mut ids = HashSet::new();
        for path in paths {
            for (repo_id, _) in self.affected_repos(path) {
                ids.insert(repo_id);
            }
        }
        ids.into_iter().collect()
    }

    fn repo_ids_for_watch_root(&self, root: &Path) -> Vec<String> {
        self.repos
            .iter()
            .filter(|repo| {
                paths_overlap(root, &repo.worktree_path)
                    || paths_overlap(root, &repo.git_dir)
                    || paths_overlap(root, &repo.git_common_dir)
            })
            .map(|repo| repo.repo_id.clone())
            .collect()
    }
}

struct RepoWatcherManager {
    watcher: Option<RecommendedWatcher>,
    watched_roots: HashSet<PathBuf>,
    index: Arc<RwLock<WatchIndex>>,
}

impl Default for RepoWatcherManager {
    fn default() -> Self {
        Self {
            watcher: None,
            watched_roots: HashSet::new(),
            index: Arc::new(RwLock::new(WatchIndex::default())),
        }
    }
}

fn watcher_manager() -> &'static Mutex<RepoWatcherManager> {
    static MANAGER: OnceLock<Mutex<RepoWatcherManager>> = OnceLock::new();
    MANAGER.get_or_init(|| Mutex::new(RepoWatcherManager::default()))
}

pub(super) fn sync_repo_watchers(app: &AppHandle) {
    let Ok(root) = workspace_root(app) else {
        clear_repo_watchers();
        return;
    };
    let settings = load_settings(app);
    let repos = managed_repo_paths(&root, &settings)
        .into_iter()
        .map(|path| repo_watch_spec(&root, path))
        .collect::<Vec<_>>();
    let watch_roots = watch_roots(&repos).into_iter().collect::<HashSet<_>>();

    let mut failed_repo_ids = HashSet::new();
    let mut manager = watcher_manager()
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    *manager
        .index
        .write()
        .unwrap_or_else(|error| error.into_inner()) = WatchIndex { repos };

    if manager.watcher.is_none() {
        let callback_app = app.clone();
        let callback_index = Arc::clone(&manager.index);
        match recommended_watcher(move |result| {
            handle_notify_result(&callback_app, &callback_index, result);
        }) {
            Ok(watcher) => manager.watcher = Some(watcher),
            Err(_) => {
                let repo_ids = manager
                    .index
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .repo_ids()
                    .collect::<Vec<_>>();
                drop(manager);
                enqueue_uncertain_repo_refreshes(app.clone(), repo_ids);
                return;
            }
        }
    }

    let removed = manager
        .watched_roots
        .difference(&watch_roots)
        .cloned()
        .collect::<Vec<_>>();
    let added = watch_roots
        .difference(&manager.watched_roots)
        .cloned()
        .collect::<Vec<_>>();

    for path in removed {
        if let Some(watcher) = manager.watcher.as_mut() {
            let _ = watcher.unwatch(&path);
        }
        manager.watched_roots.remove(&path);
    }

    for path in added {
        let installed = manager
            .watcher
            .as_mut()
            .is_some_and(|watcher| watcher.watch(&path, RecursiveMode::Recursive).is_ok());
        if installed {
            manager.watched_roots.insert(path);
        } else {
            let index = manager
                .index
                .read()
                .unwrap_or_else(|error| error.into_inner());
            failed_repo_ids.extend(index.repo_ids_for_watch_root(&path));
        }
    }
    drop(manager);

    if !failed_repo_ids.is_empty() {
        enqueue_uncertain_repo_refreshes(app.clone(), failed_repo_ids);
    }
}

pub(super) fn clear_repo_watchers() {
    let mut manager = watcher_manager()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    manager.watcher = None;
    manager.watched_roots.clear();
    *manager
        .index
        .write()
        .unwrap_or_else(|error| error.into_inner()) = WatchIndex::default();
}

fn repo_watch_spec(root: &Path, path: PathBuf) -> RepoWatchSpec {
    let worktree_path = canonical_repo_path(&path);
    let git_common_dir = git_common_dir(&worktree_path)
        .unwrap_or_else(|| canonical_repo_path(&worktree_path.join(".git")));
    let git_dir = git_dir(&worktree_path).unwrap_or_else(|| git_common_dir.clone());
    RepoWatchSpec {
        repo_id: repo_id(root, &worktree_path),
        worktree_path,
        git_dir,
        git_common_dir,
    }
}

fn git_dir(path: &Path) -> Option<PathBuf> {
    let raw = git_command_lossy(path, &["rev-parse", "--git-dir"])?;
    if raw.is_empty() {
        return None;
    }
    let git_dir = PathBuf::from(raw);
    let absolute = if git_dir.is_absolute() {
        git_dir
    } else {
        path.join(git_dir)
    };
    Some(canonical_repo_path(&absolute))
}

fn watch_roots(repos: &[RepoWatchSpec]) -> Vec<PathBuf> {
    let worktree_roots = minimal_non_overlapping_roots(
        repos
            .iter()
            .map(|repo| repo.worktree_path.clone())
            .collect(),
    );
    let metadata_roots = minimal_non_overlapping_roots(
        repos
            .iter()
            .flat_map(|repo| [repo.git_dir.clone(), repo.git_common_dir.clone()])
            .filter(|path| !worktree_roots.iter().any(|root| is_path_inside(path, root)))
            .collect(),
    );

    worktree_roots.into_iter().chain(metadata_roots).collect()
}

fn minimal_non_overlapping_roots(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.sort_by(|left, right| {
        left.components()
            .count()
            .cmp(&right.components().count())
            .then_with(|| left.cmp(right))
    });
    paths.dedup();

    let mut roots: Vec<PathBuf> = Vec::new();
    for path in paths {
        if roots.iter().any(|root| is_path_inside(&path, root)) {
            continue;
        }
        roots.push(path);
    }
    roots
}

fn handle_notify_result(
    app: &AppHandle,
    index: &RwLock<WatchIndex>,
    result: notify::Result<Event>,
) {
    let index = index.read().unwrap_or_else(|error| error.into_inner());

    let event = match result {
        Ok(event) => event,
        Err(error) => {
            let mut repo_ids = index.repo_ids_for_paths(&error.paths);
            if repo_ids.is_empty() {
                repo_ids.extend(index.repo_ids());
            }
            drop(index);
            enqueue_uncertain_repo_refreshes(app.clone(), repo_ids);
            return;
        }
    };

    if event.need_rescan() {
        let repo_ids = index.repo_ids().collect::<Vec<_>>();
        drop(index);
        enqueue_uncertain_repo_refreshes(app.clone(), repo_ids);
        return;
    }
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }

    let mut affected = HashMap::<String, RepoChangeKind>::new();
    for path in event.paths {
        for (repo_id, kind) in index.affected_repos(&path) {
            affected
                .entry(repo_id)
                .and_modify(|current| {
                    if kind == RepoChangeKind::GitMetadata {
                        *current = kind;
                    }
                })
                .or_insert(kind);
        }
    }
    drop(index);

    for (repo_id, kind) in affected {
        let _ =
            enqueue_watcher_repo_refresh(app.clone(), repo_id, kind == RepoChangeKind::GitMetadata);
    }
}

fn longest_matching_repo<'a>(
    repos: &'a [RepoWatchSpec],
    path: &Path,
    predicate: impl Fn(&RepoWatchSpec) -> bool,
) -> Option<&'a RepoWatchSpec> {
    repos
        .iter()
        .filter(|repo| predicate(repo))
        .max_by_key(|repo| {
            if is_path_inside(path, &repo.git_dir) {
                repo.git_dir.components().count()
            } else {
                repo.worktree_path.components().count()
            }
        })
}

fn is_private_worktree_metadata(path: &Path, common_dir: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(common_dir) else {
        return false;
    };
    let components = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();
    matches!(
        components.as_slice(),
        ["HEAD"]
            | ["index"]
            | ["FETCH_HEAD"]
            | ["ORIG_HEAD"]
            | ["MERGE_HEAD"]
            | ["CHERRY_PICK_HEAD"]
            | ["REVERT_HEAD"]
            | ["logs", "HEAD"]
            | ["config.worktree"]
            | ["rebase-apply", ..]
            | ["rebase-merge", ..]
            | ["sequencer", ..]
    )
}

fn should_ignore_watch_path(path: &Path) -> bool {
    let components = path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();

    if components.iter().any(|name| NOISE_DIR_NAMES.contains(name)) {
        return true;
    }

    components
        .windows(2)
        .any(|pair| pair == [".git", "objects"])
}

fn paths_overlap(left: &Path, right: &Path) -> bool {
    is_path_inside(left, right) || is_path_inside(right, left)
}

fn is_path_inside(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::{
        minimal_non_overlapping_roots, should_ignore_watch_path, watch_roots, RepoChangeKind,
        RepoWatchSpec, WatchIndex,
    };
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};

    fn repo(repo_id: &str, worktree: &str, git_dir: &str, common_dir: &str) -> RepoWatchSpec {
        RepoWatchSpec {
            repo_id: repo_id.to_string(),
            worktree_path: PathBuf::from(worktree),
            git_dir: PathBuf::from(git_dir),
            git_common_dir: PathBuf::from(common_dir),
        }
    }

    fn affected(index: &WatchIndex, path: &str) -> HashSet<(String, RepoChangeKind)> {
        index.affected_repos(Path::new(path)).into_iter().collect()
    }

    #[test]
    fn builds_one_minimal_watch_set_for_nested_repos_and_external_metadata() {
        let repos = vec![
            repo("parent", "C:/ws/app", "C:/ws/app/.git", "C:/ws/app/.git"),
            repo(
                "child",
                "C:/ws/app/vendor/child",
                "C:/ws/app/vendor/child/.git",
                "C:/ws/app/vendor/child/.git",
            ),
            repo(
                "linked",
                "D:/feature",
                "C:/ws/app/.git/worktrees/feature",
                "C:/ws/app/.git",
            ),
            repo(
                "external",
                "E:/external",
                "F:/git/external/worktrees/main",
                "F:/git/external",
            ),
        ];

        assert_eq!(
            watch_roots(&repos).into_iter().collect::<HashSet<_>>(),
            [
                PathBuf::from("C:/ws/app"),
                PathBuf::from("D:/feature"),
                PathBuf::from("E:/external"),
                PathBuf::from("F:/git/external"),
            ]
            .into_iter()
            .collect()
        );
    }

    #[test]
    fn maps_nested_worktree_changes_to_the_longest_repo_prefix() {
        let index = WatchIndex {
            repos: vec![
                repo("parent", "C:/ws/app", "C:/ws/app/.git", "C:/ws/app/.git"),
                repo(
                    "child",
                    "C:/ws/app/vendor/child",
                    "C:/ws/app/vendor/child/.git",
                    "C:/ws/app/vendor/child/.git",
                ),
            ],
        };

        assert_eq!(
            affected(&index, "C:/ws/app/vendor/child/src/lib.rs"),
            [("child".to_string(), RepoChangeKind::Worktree)]
                .into_iter()
                .collect()
        );
    }

    #[test]
    fn isolates_linked_worktree_metadata_but_fans_out_shared_refs() {
        let index = WatchIndex {
            repos: vec![
                repo("main", "C:/ws/app", "C:/ws/app/.git", "C:/ws/app/.git"),
                repo(
                    "feature",
                    "D:/feature",
                    "C:/ws/app/.git/worktrees/feature",
                    "C:/ws/app/.git",
                ),
            ],
        };

        assert_eq!(
            affected(&index, "C:/ws/app/.git/worktrees/feature/index"),
            [("feature".to_string(), RepoChangeKind::GitMetadata)]
                .into_iter()
                .collect()
        );
        assert_eq!(
            affected(&index, "C:/ws/app/.git/HEAD"),
            [("main".to_string(), RepoChangeKind::GitMetadata)]
                .into_iter()
                .collect()
        );
        assert_eq!(
            affected(&index, "C:/ws/app/.git/refs/heads/main"),
            [
                ("main".to_string(), RepoChangeKind::GitMetadata),
                ("feature".to_string(), RepoChangeKind::GitMetadata),
            ]
            .into_iter()
            .collect()
        );
    }

    #[test]
    fn ignores_noise_and_objects_in_dot_git_or_external_common_dirs() {
        let index = WatchIndex {
            repos: vec![repo(
                "external",
                "E:/external",
                "F:/git/external/worktrees/main",
                "F:/git/external",
            )],
        };

        assert!(should_ignore_watch_path(Path::new(
            "C:/ws/app/node_modules/a.js"
        )));
        assert!(should_ignore_watch_path(Path::new(
            "C:/ws/app/target/debug/app"
        )));
        assert!(should_ignore_watch_path(Path::new(
            "C:/ws/app/.git/objects/ab/cd"
        )));
        assert!(affected(&index, "F:/git/external/objects/ab/cd").is_empty());
        assert_eq!(
            affected(&index, "F:/git/external/refs/heads/main"),
            [("external".to_string(), RepoChangeKind::GitMetadata)]
                .into_iter()
                .collect()
        );
    }

    #[test]
    fn removes_duplicate_and_descendant_watch_roots() {
        assert_eq!(
            minimal_non_overlapping_roots(vec![
                PathBuf::from("C:/ws/app/vendor"),
                PathBuf::from("C:/ws/app"),
                PathBuf::from("C:/ws/app"),
                PathBuf::from("D:/repo"),
            ])
            .into_iter()
            .collect::<HashSet<_>>(),
            [PathBuf::from("C:/ws/app"), PathBuf::from("D:/repo")]
                .into_iter()
                .collect()
        );
    }
}
