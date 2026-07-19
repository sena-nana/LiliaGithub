use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::Duration;

use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::refresh::{enqueue_uncertain_repo_refreshes, enqueue_watcher_repo_refresh};
use crate::workspace::repos::{canonical_repo_path, git_command_lossy, git_common_dir, repo_id};
use crate::workspace::settings::{
    load_settings, repo_path_by_id, workspace_root, workspace_root_by_id,
};
use crate::workspace::shared::configure_background_command;

const REPO_WATCH_DEBOUNCE: Duration = Duration::from_secs(2);

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

fn watcher_manager() -> &'static Mutex<RepoWatcherManager> {
    static MANAGER: OnceLock<Mutex<RepoWatcherManager>> = OnceLock::new();
    MANAGER.get_or_init(|| Mutex::new(RepoWatcherManager::default()))
}

pub(super) fn sync_repo_watchers(app: &AppHandle) {
    let settings = load_settings(app);
    let repos = settings
        .managed_repo_ids
        .iter()
        .filter(|id| !settings.hidden_repo_ids.contains(id))
        .filter_map(|id| {
            let path = repo_path_by_id(app, &id).ok()?;
            let root = id
                .strip_prefix("local:")
                .and_then(|value| value.split_once('/'))
                .and_then(|(root_id, _)| workspace_root_by_id(app, root_id).ok())
                .or_else(|| workspace_root(app).ok())?;
            Some(repo_watch_spec(&root, path))
        })
        .collect::<Vec<_>>();
    if repos.is_empty() {
        clear_repo_watchers();
        return;
    }
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

fn watch_event_loop(
    app: AppHandle,
    index: Arc<RwLock<WatchIndex>>,
    receiver: mpsc::Receiver<notify::Result<Event>>,
) {
    while let Ok(first) = receiver.recv() {
        let mut batch = vec![first];
        loop {
            match receiver.recv_timeout(REPO_WATCH_DEBOUNCE) {
                Ok(result) => batch.push(result),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
        handle_notify_batch(&app, &index, batch);
    }
}

fn handle_notify_batch(
    app: &AppHandle,
    index: &RwLock<WatchIndex>,
    results: Vec<notify::Result<Event>>,
) {
    let index = index
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    let mut uncertain_repo_ids = HashSet::new();
    let mut paths = Vec::new();
    for result in results {
        let event = match result {
            Ok(event) => event,
            Err(error) => {
                let repo_ids = index.repo_ids_for_paths(&error.paths);
                if repo_ids.is_empty() {
                    uncertain_repo_ids.extend(index.repo_ids());
                } else {
                    uncertain_repo_ids.extend(repo_ids);
                }
                continue;
            }
        };
        if event.need_rescan() {
            uncertain_repo_ids.extend(index.repo_ids());
        } else if !matches!(event.kind, EventKind::Access(_)) {
            paths.extend(event.paths);
        }
    }

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
    {
        let stdin = child.stdin.as_mut().ok_or(())?;
        for path in paths {
            stdin.write_all(path.as_bytes()).map_err(|_| ())?;
            stdin.write_all(&[0]).map_err(|_| ())?;
        }
    }
    let output = child.wait_with_output().map_err(|_| ())?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(());
    }
    Ok(output.stdout.iter().filter(|byte| **byte == 0).count() == paths.len())
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
        minimal_non_overlapping_roots, repo_has_relevant_worktree_change, watch_roots,
        RepoChangeKind, RepoWatchSpec, WatchIndex,
    };
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

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
