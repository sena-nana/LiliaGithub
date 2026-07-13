use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock, Weak};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RepoAccess {
    Read,
    Write,
}

fn guards() -> &'static Mutex<HashMap<PathBuf, Weak<RwLock<()>>>> {
    static GUARDS: OnceLock<Mutex<HashMap<PathBuf, Weak<RwLock<()>>>>> = OnceLock::new();
    GUARDS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn guard_for(key: PathBuf) -> Arc<RwLock<()>> {
    let mut guards = guards().lock().unwrap_or_else(|error| error.into_inner());
    guards.retain(|_, guard| guard.strong_count() > 0);
    if let Some(guard) = guards.get(&key).and_then(Weak::upgrade) {
        return guard;
    }
    let guard = Arc::new(RwLock::new(()));
    guards.insert(key, Arc::downgrade(&guard));
    guard
}

pub(crate) fn canonical_repo_guard_key(common_dir: impl AsRef<Path>) -> PathBuf {
    common_dir
        .as_ref()
        .canonicalize()
        .unwrap_or_else(|_| common_dir.as_ref().to_path_buf())
}

pub(crate) fn repo_resource_id(common_dir: impl AsRef<Path>) -> String {
    format!(
        "git-common-dir:{}",
        canonical_repo_guard_key(common_dir).to_string_lossy()
    )
}

pub(crate) fn with_repo_guard<T>(
    common_dir: impl AsRef<Path>,
    access: RepoAccess,
    run: impl FnOnce() -> T,
) -> T {
    let key = canonical_repo_guard_key(common_dir);
    let guard = guard_for(key);
    match access {
        RepoAccess::Read => {
            let _held = guard.read().unwrap_or_else(|error| error.into_inner());
            run()
        }
        RepoAccess::Write => {
            let _held = guard.write().unwrap_or_else(|error| error.into_inner());
            run()
        }
    }
}

pub(crate) fn with_repo_guards<T>(
    common_dirs: impl IntoIterator<Item = PathBuf>,
    access: RepoAccess,
    run: impl FnOnce() -> T,
) -> T {
    let mut keys = common_dirs
        .into_iter()
        .map(canonical_repo_guard_key)
        .collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    let guards = keys.into_iter().map(guard_for).collect::<Vec<_>>();
    match access {
        RepoAccess::Read => {
            let _held = guards
                .iter()
                .map(|guard| guard.read().unwrap_or_else(|error| error.into_inner()))
                .collect::<Vec<_>>();
            run()
        }
        RepoAccess::Write => {
            let _held = guards
                .iter()
                .map(|guard| guard.write().unwrap_or_else(|error| error.into_inner()))
                .collect::<Vec<_>>();
            run()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn reads_share_a_common_dir_but_write_waits() {
        let key = PathBuf::from("shared-repo");
        let readers = Arc::new(AtomicUsize::new(0));
        let release = Arc::new(AtomicBool::new(false));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let key = key.clone();
            let readers = Arc::clone(&readers);
            let release = Arc::clone(&release);
            workers.push(std::thread::spawn(move || {
                with_repo_guard(key, RepoAccess::Read, || {
                    readers.fetch_add(1, Ordering::SeqCst);
                    while !release.load(Ordering::SeqCst) {
                        std::thread::yield_now();
                    }
                    readers.fetch_sub(1, Ordering::SeqCst);
                });
            }));
        }
        while readers.load(Ordering::SeqCst) != 2 {
            std::thread::yield_now();
        }
        let writer_started = Arc::new(AtomicBool::new(false));
        let writer_finished = Arc::new(AtomicBool::new(false));
        let writer = {
            let writer_started = Arc::clone(&writer_started);
            let writer_finished = Arc::clone(&writer_finished);
            std::thread::spawn(move || {
                writer_started.store(true, Ordering::SeqCst);
                with_repo_guard(key, RepoAccess::Write, || {
                    writer_finished.store(true, Ordering::SeqCst);
                });
            })
        };
        while !writer_started.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }
        std::thread::sleep(Duration::from_millis(10));
        assert!(!writer_finished.load(Ordering::SeqCst));
        release.store(true, Ordering::SeqCst);
        for worker in workers {
            worker.join().unwrap();
        }
        writer.join().unwrap();
        assert!(writer_finished.load(Ordering::SeqCst));
    }

    #[test]
    fn different_common_dirs_do_not_block_each_other() {
        let first_started = Arc::new(AtomicBool::new(false));
        let release = Arc::new(AtomicBool::new(false));
        let worker = {
            let first_started = Arc::clone(&first_started);
            let release = Arc::clone(&release);
            std::thread::spawn(move || {
                with_repo_guard("repo-a", RepoAccess::Write, || {
                    first_started.store(true, Ordering::SeqCst);
                    while !release.load(Ordering::SeqCst) {
                        std::thread::yield_now();
                    }
                });
            })
        };
        while !first_started.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }
        with_repo_guard("repo-b", RepoAccess::Write, || {});
        release.store(true, Ordering::SeqCst);
        worker.join().unwrap();
    }
}
