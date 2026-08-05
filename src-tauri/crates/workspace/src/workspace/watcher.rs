use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::refresh::{enqueue_uncertain_repo_refreshes, enqueue_watcher_repo_refresh};
use crate::workspace::repos::{canonical_repo_path, git_command_lossy, git_common_dir, repo_id};
use crate::workspace::settings::{
    load_settings, repo_path_by_id, workspace_root, workspace_root_by_id,
};
use crate::workspace::shared::configure_background_command;

const REPO_WATCH_DEBOUNCE: Duration = Duration::from_secs(2);
const REPO_WATCH_PATH_LIMIT: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq)]
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

#[derive(Clone, Debug, Default)]
struct WatchIndex {
    repos: Vec<RepoWatchSpec>,
}

impl WatchIndex {
    fn repo_ids(&self) -> impl Iterator<Item = String> + '_ {
        self.repos.iter().map(|repo| repo.repo_id.clone())
    }

    fn affected_repos(&self, path: &Path) -> Vec<(String, RepoChangeKind)> {
        if self.is_git_object_path(path) {
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

#[derive(Default)]
pub(crate) struct WatcherRuntimeState {
    manager: Mutex<RepoWatcherManager>,
    sync_gate: Mutex<()>,
    suspended_repos: Mutex<HashMap<String, usize>>,
}

impl WatcherRuntimeState {
    pub(crate) fn shutdown(&self) {
        let _gate = self
            .sync_gate
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        clear_repo_watchers_locked(self);
        self.suspended_repos
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }
}

pub(super) fn sync_repo_watchers(app: &AppHandle) -> Result<(), String> {
    let state = app.watcher_runtime();
    let _gate = state
        .sync_gate
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    sync_repo_watchers_locked(app)
}

pub(super) struct SuspendedRepoWatcher {
    app: AppHandle,
    repo_id: String,
}

impl Drop for SuspendedRepoWatcher {
    fn drop(&mut self) {
        let state = self.app.watcher_runtime();
        let _gate = state
            .sync_gate
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut suspended = state
            .suspended_repos
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(count) = suspended.get_mut(&self.repo_id) {
            *count -= 1;
            if *count == 0 {
                suspended.remove(&self.repo_id);
            }
        }
        drop(suspended);
        let _ = sync_repo_watchers_locked(&self.app);
    }
}

pub(super) fn suspend_repo_watcher(
    app: &AppHandle,
    repo_id: &str,
) -> Result<SuspendedRepoWatcher, String> {
    let state = app.watcher_runtime();
    let _gate = state
        .sync_gate
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    *state
        .suspended_repos
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .entry(repo_id.to_string())
        .or_default() += 1;
    sync_repo_watchers_locked(app)?;
    Ok(SuspendedRepoWatcher {
        app: app.clone(),
        repo_id: repo_id.to_string(),
    })
}

fn sync_repo_watchers_locked(app: &AppHandle) -> Result<(), String> {
    let runtime = app.watcher_runtime();
    let suspended_repos = runtime
        .suspended_repos
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    let settings = load_settings(app)?;
    let repos = settings
        .managed_repo_ids
        .iter()
        .filter(|id| !settings.hidden_repo_ids.contains(id))
        .filter(|id| !suspended_repos.contains_key(id.as_str()))
        .filter_map(|id| {
            let path = repo_path_by_id(app, id).ok()?;
            let root = id
                .strip_prefix("local:")
                .and_then(|value| value.split_once('/'))
                .and_then(|(root_id, _)| workspace_root_by_id(app, root_id).ok())
                .or_else(|| workspace_root(app).ok())?;
            Some(repo_watch_spec(&root, path))
        })
        .collect::<Vec<_>>();
    if repos.is_empty() {
        clear_repo_watchers_locked(runtime);
        return Ok(());
    }
    let watch_roots = watch_roots(&repos).into_iter().collect::<HashSet<_>>();

    let mut failed_repo_ids = HashSet::new();
    let mut manager = runtime
        .manager
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    *manager
        .index
        .write()
        .unwrap_or_else(|error| error.into_inner()) = WatchIndex { repos };

    if manager.watcher.is_none() {
        let callback_app = app.clone();
        let callback_index = Arc::clone(&manager.index);
        let (sender, receiver) = mpsc::channel();
        let event_thread = thread::Builder::new()
            .name("repo-watch-events".to_string())
            .spawn(move || watch_event_loop(callback_app, callback_index, receiver));
        if event_thread.is_ok() {
            manager.watcher = recommended_watcher(move |result| {
                let _ = sender.send(result);
            })
            .ok();
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
    Ok(())
}

pub(super) fn clear_repo_watchers(app: &AppHandle) {
    let state = app.watcher_runtime();
    let _gate = state
        .sync_gate
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    clear_repo_watchers_locked(state);
}

fn clear_repo_watchers_locked(state: &WatcherRuntimeState) {
    let mut manager = state
        .manager
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    manager.watcher = None;
    manager.watched_roots.clear();
    *manager
        .index
        .write()
        .unwrap_or_else(|error| error.into_inner()) = WatchIndex::default();
}

#[cfg(test)]
pub(super) fn repo_watch_snapshot_for_tests(app: &AppHandle) -> Vec<(String, PathBuf)> {
    let state = app.watcher_runtime();
    let _gate = state
        .sync_gate
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let manager = state
        .manager
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let index = manager
        .index
        .read()
        .unwrap_or_else(|error| error.into_inner());
    index
        .repos
        .iter()
        .map(|repo| (repo.repo_id.clone(), repo.worktree_path.clone()))
        .collect()
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

fn watch_event_loop(
    app: AppHandle,
    index: Arc<RwLock<WatchIndex>>,
    receiver: mpsc::Receiver<notify::Result<Event>>,
) {
    while let Ok(first) = receiver.recv() {
        let index = index
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        let (batch, disconnected) =
            receive_notify_batch(&index, &receiver, first, REPO_WATCH_DEBOUNCE);
        handle_notify_batch(&app, &index, batch);
        if disconnected {
            return;
        }
    }
}

#[derive(Default)]
struct NotifyBatch {
    uncertain_repo_ids: HashSet<String>,
    paths: HashSet<PathBuf>,
    path_limit_exceeded: bool,
}

impl NotifyBatch {
    fn push(&mut self, index: &WatchIndex, result: notify::Result<Event>) {
        let event = match result {
            Ok(event) => event,
            Err(error) => {
                let repo_ids = index.repo_ids_for_paths(&error.paths);
                if repo_ids.is_empty() {
                    self.uncertain_repo_ids.extend(index.repo_ids());
                } else {
                    self.uncertain_repo_ids.extend(repo_ids);
                }
                return;
            }
        };
        if event.need_rescan() {
            self.uncertain_repo_ids.extend(index.repo_ids());
        } else if !matches!(event.kind, EventKind::Access(_)) {
            for path in event.paths {
                self.push_path(index, path);
            }
        }
    }

    fn push_path(&mut self, index: &WatchIndex, path: PathBuf) {
        if self.path_limit_exceeded {
            self.mark_path_uncertain(index, &path);
            return;
        }
        if self.paths.contains(&path) {
            return;
        }
        if self.paths.len() < REPO_WATCH_PATH_LIMIT {
            self.paths.insert(path);
            return;
        }

        self.path_limit_exceeded = true;
        for existing in std::mem::take(&mut self.paths) {
            self.mark_path_uncertain(index, &existing);
        }
        self.mark_path_uncertain(index, &path);
    }

    fn mark_path_uncertain(&mut self, index: &WatchIndex, path: &Path) {
        self.uncertain_repo_ids.extend(
            index
                .affected_repos(path)
                .into_iter()
                .map(|(repo_id, _)| repo_id),
        );
    }
}

fn receive_notify_batch(
    index: &WatchIndex,
    receiver: &mpsc::Receiver<notify::Result<Event>>,
    first: notify::Result<Event>,
    window: Duration,
) -> (NotifyBatch, bool) {
    let deadline = Instant::now() + window;
    let mut batch = NotifyBatch::default();
    batch.push(index, first);
    loop {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            return (batch, false);
        };
        match receiver.recv_timeout(remaining) {
            Ok(result) => batch.push(index, result),
            Err(mpsc::RecvTimeoutError::Timeout) => return (batch, false),
            Err(mpsc::RecvTimeoutError::Disconnected) => return (batch, true),
        }
    }
}

fn handle_notify_batch(app: &AppHandle, index: &WatchIndex, batch: NotifyBatch) {
    let NotifyBatch {
        mut uncertain_repo_ids,
        paths,
        ..
    } = batch;
    let mut affected = HashMap::<String, RepoChangeKind>::new();
    let mut worktree_paths = HashMap::<String, HashSet<PathBuf>>::new();
    for path in paths {
        for (repo_id, kind) in index.affected_repos(&path) {
            if kind == RepoChangeKind::GitMetadata {
                affected.insert(repo_id, kind);
            } else {
                worktree_paths
                    .entry(repo_id)
                    .or_default()
                    .insert(path.clone());
            }
        }
    }
    for (repo_id, paths) in worktree_paths {
        if affected.get(&repo_id) == Some(&RepoChangeKind::GitMetadata) {
            continue;
        }
        let Some(repo) = index.repos.iter().find(|repo| repo.repo_id == repo_id) else {
            uncertain_repo_ids.insert(repo_id);
            continue;
        };
        if repo_has_relevant_worktree_change(repo, paths.iter()) {
            affected.insert(repo_id, RepoChangeKind::Worktree);
        }
    }
    for repo_id in &uncertain_repo_ids {
        affected.remove(repo_id);
    }
    enqueue_uncertain_repo_refreshes(app.clone(), uncertain_repo_ids);
    for (repo_id, kind) in affected {
        let _ =
            enqueue_watcher_repo_refresh(app.clone(), repo_id, kind == RepoChangeKind::GitMetadata);
    }
}

fn repo_has_relevant_worktree_change<'a>(
    repo: &RepoWatchSpec,
    paths: impl Iterator<Item = &'a PathBuf>,
) -> bool {
    let mut relative_paths = Vec::new();
    for path in paths {
        let Ok(relative) = path.strip_prefix(&repo.worktree_path) else {
            return true;
        };
        if relative
            .file_name()
            .is_some_and(|name| name == ".gitignore")
        {
            return true;
        }
        let Some(relative) = relative.to_str() else {
            return true;
        };
        relative_paths.push(relative.replace('\\', "/"));
    }
    if relative_paths.is_empty() {
        return false;
    }
    git_all_paths_ignored(&repo.worktree_path, &relative_paths)
        .map(|ignored| !ignored)
        .unwrap_or(true)
}

fn git_all_paths_ignored(repo_path: &Path, paths: &[String]) -> Result<bool, ()> {
    let mut command = Command::new("git");
    command
        .args(["check-ignore", "--stdin", "-z"])
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_command(&mut command);
    let mut child = command.spawn().map_err(|_| ())?;
    let mut stdin = child.stdin.take().ok_or(())?;
    let (output, write_result) = thread::scope(|scope| {
        let writer = scope.spawn(move || -> Result<(), ()> {
            for path in paths {
                stdin.write_all(path.as_bytes()).map_err(|_| ())?;
                stdin.write_all(&[0]).map_err(|_| ())?;
            }
            Ok(())
        });
        let output = child.wait_with_output();
        let write_result = writer.join().map_err(|_| ()).and_then(|result| result);
        (output, write_result)
    });
    let output = output.map_err(|_| ())?;
    write_result?;

    let ignored_count = if output.stdout.is_empty() {
        0
    } else {
        if output.stdout.last() != Some(&0) {
            return Err(());
        }
        output.stdout.iter().filter(|byte| **byte == 0).count()
    };
    match output.status.code() {
        Some(0) if ignored_count > 0 => Ok(ignored_count == paths.len()),
        Some(1) if ignored_count == 0 => Ok(false),
        _ => Err(()),
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

fn paths_overlap(left: &Path, right: &Path) -> bool {
    is_path_inside(left, right) || is_path_inside(right, left)
}

fn is_path_inside(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::{
        git_all_paths_ignored, minimal_non_overlapping_roots, receive_notify_batch,
        repo_has_relevant_worktree_change, watch_roots, NotifyBatch, RepoChangeKind, RepoWatchSpec,
        WatchIndex, REPO_WATCH_PATH_LIMIT,
    };
    use notify::{Event, EventKind};
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    };
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    fn ignores_git_objects_in_dot_git_or_external_common_dirs() {
        let index = WatchIndex {
            repos: vec![repo(
                "external",
                "E:/external",
                "F:/git/external/worktrees/main",
                "F:/git/external",
            )],
        };

        assert!(affected(&index, "F:/git/external/objects/ab/cd").is_empty());
        assert_eq!(
            affected(&index, "F:/git/external/refs/heads/main"),
            [("external".to_string(), RepoChangeKind::GitMetadata)]
                .into_iter()
                .collect()
        );
    }

    static NEXT_TEST_REPO: AtomicU64 = AtomicU64::new(0);

    struct TestRepo(PathBuf);

    impl TestRepo {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let sequence = NEXT_TEST_REPO.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "lilia-github-watcher-{}-{nonce}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            assert!(Command::new("git")
                .arg("init")
                .arg(&path)
                .status()
                .unwrap()
                .success());
            Self(path)
        }

        fn path(&self, relative: &str) -> PathBuf {
            self.0.join(relative)
        }

        fn write(&self, relative: &str, contents: &str) {
            let path = self.path(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, contents).unwrap();
        }

        fn git(&self, args: &[&str]) {
            assert!(Command::new("git")
                .args(args)
                .current_dir(&self.0)
                .status()
                .unwrap()
                .success());
        }

        fn spec(&self) -> RepoWatchSpec {
            RepoWatchSpec {
                repo_id: "repo".to_string(),
                worktree_path: self.0.clone(),
                git_dir: self.path(".git"),
                git_common_dir: self.path(".git"),
            }
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn filters_git_ignored_paths_with_nested_negation_and_excludes() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "*.log\nbuild/\n!keep.log\n");
        repo.write("nested/.gitignore", "*.tmp\n");
        repo.write(".git/info/exclude", "private.dat\n");
        let global_excludes = repo.path("global-excludes");
        fs::write(&global_excludes, "global.cache\n").unwrap();
        repo.git(&[
            "config",
            "core.excludesFile",
            global_excludes.to_str().unwrap(),
        ]);

        let spec = repo.spec();
        for ignored in [
            "debug.log",
            "build/output.js",
            "nested/item.tmp",
            "private.dat",
            "global.cache",
        ] {
            assert!(!repo_has_relevant_worktree_change(
                &spec,
                [repo.path(ignored)].iter()
            ));
        }
        for relevant in ["keep.log", "src/main.rs", ".gitignore"] {
            assert!(
                repo_has_relevant_worktree_change(&spec, [repo.path(relevant)].iter()),
                "expected {relevant} to trigger a refresh"
            );
        }

        repo.write(".gitignore", "build/\n");
        assert!(repo_has_relevant_worktree_change(
            &spec,
            [repo.path("debug.log")].iter()
        ));
    }

    #[test]
    fn mixed_ignored_and_relevant_paths_refresh() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "ignored/\n");
        let spec = repo.spec();

        assert!(repo_has_relevant_worktree_change(
            &spec,
            [repo.path("ignored/cache.bin"), repo.path("src/main.rs")].iter()
        ));
    }

    #[test]
    fn check_ignore_drains_large_output_without_leaving_the_child_running() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "ignored/\n");
        let repo_path = repo.0.clone();
        let paths = (0..20_000)
            .map(|index| format!("ignored/nested/cache-{index:05}.bin"))
            .collect::<Vec<_>>();
        let (sender, receiver) = mpsc::channel();

        thread::spawn(move || {
            let _ = sender.send(git_all_paths_ignored(&repo_path, &paths));
        });

        assert_eq!(receiver.recv_timeout(Duration::from_secs(5)), Ok(Ok(true)));
    }

    #[test]
    fn notify_batch_uses_a_fixed_window_during_continuous_events() {
        let index = WatchIndex {
            repos: vec![repo(
                "repo",
                "C:/ws/app",
                "C:/ws/app/.git",
                "C:/ws/app/.git",
            )],
        };
        let (sender, receiver) = mpsc::channel();
        let producer = thread::spawn(move || {
            for path_index in 0..30 {
                if sender
                    .send(Ok(Event::new(EventKind::Any).add_path(PathBuf::from(
                        format!("C:/ws/app/src/{path_index}.rs"),
                    ))))
                    .is_err()
                {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        let started = Instant::now();
        let (batch, disconnected) = receive_notify_batch(
            &index,
            &receiver,
            Ok(Event::new(EventKind::Any).add_path(PathBuf::from("C:/ws/app/src/first.rs"))),
            Duration::from_millis(60),
        );
        let elapsed = started.elapsed();
        drop(receiver);
        producer.join().unwrap();

        assert!(!disconnected);
        assert!(elapsed < Duration::from_millis(180), "{elapsed:?}");
        assert!(batch.paths.len() < 30);
    }

    #[test]
    fn notify_batch_caps_unique_paths_and_marks_affected_repos_uncertain() {
        let index = WatchIndex {
            repos: vec![repo(
                "repo",
                "C:/ws/app",
                "C:/ws/app/.git",
                "C:/ws/app/.git",
            )],
        };
        let mut batch = NotifyBatch::default();

        for path_index in 0..(REPO_WATCH_PATH_LIMIT + 100) {
            batch.push(
                &index,
                Ok(Event::new(EventKind::Any).add_path(PathBuf::from(format!(
                    "C:/ws/app/generated/{path_index}.tmp"
                )))),
            );
        }

        assert!(batch.path_limit_exceeded);
        assert!(batch.paths.len() <= REPO_WATCH_PATH_LIMIT);
        assert_eq!(
            batch.uncertain_repo_ids,
            ["repo".to_string()].into_iter().collect()
        );
    }

    #[test]
    fn tracked_paths_and_ignore_failures_still_refresh() {
        let repo = TestRepo::new();
        repo.write(".gitignore", "tracked.log\n");
        repo.write("tracked.log", "tracked");
        repo.git(&["add", "-f", "tracked.log"]);
        let spec = repo.spec();
        assert!(repo_has_relevant_worktree_change(
            &spec,
            [repo.path("tracked.log")].iter()
        ));

        let missing = RepoWatchSpec {
            worktree_path: repo.path("missing"),
            ..spec
        };
        assert!(repo_has_relevant_worktree_change(
            &missing,
            [repo.path("missing/file")].iter()
        ));
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
