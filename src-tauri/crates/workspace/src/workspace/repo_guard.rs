use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock, Weak};

use crate::runtime::WorkspaceContext as AppHandle;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RepoAccess {
    Read,
    Write,
}

#[derive(Default)]
pub(crate) struct RepoGuardRuntimeState {
    guards: Mutex<HashMap<PathBuf, Weak<RwLock<()>>>>,
}

impl RepoGuardRuntimeState {
    fn guard_for(&self, key: PathBuf) -> Arc<RwLock<()>> {
        let mut guards = self
            .guards
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        guards.retain(|_, guard| guard.strong_count() > 0);
        if let Some(guard) = guards.get(&key).and_then(Weak::upgrade) {
            return guard;
        }
        let guard = Arc::new(RwLock::new(()));
        guards.insert(key, Arc::downgrade(&guard));
        guard
    }

    fn with_guard<T>(
        &self,
        common_dir: impl AsRef<Path>,
        access: RepoAccess,
        run: impl FnOnce() -> T,
    ) -> T {
        let key = canonical_repo_guard_key(common_dir);
        let guard = self.guard_for(key);
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

    fn with_guards<T>(
        &self,
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
        let guards = keys
            .into_iter()
            .map(|key| self.guard_for(key))
            .collect::<Vec<_>>();
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
}

pub(crate) fn canonical_repo_guard_key(common_dir: impl AsRef<Path>) -> PathBuf {
    common_dir
        .as_ref()
        .canonicalize()
        .unwrap_or_else(|_| common_dir.as_ref().to_path_buf())
}

pub(crate) fn with_repo_guard<T>(
    app: &AppHandle,
    common_dir: impl AsRef<Path>,
    access: RepoAccess,
    run: impl FnOnce() -> T,
) -> T {
    app.repo_guards().with_guard(common_dir, access, run)
}

pub(crate) fn with_repo_guards<T>(
    app: &AppHandle,
    common_dirs: impl IntoIterator<Item = PathBuf>,
    access: RepoAccess,
    run: impl FnOnce() -> T,
) -> T {
    app.repo_guards().with_guards(common_dirs, access, run)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn reads_share_a_common_dir_but_write_waits() {
        let state = Arc::new(RepoGuardRuntimeState::default());
        let key = PathBuf::from("shared-repo");
        let readers = Arc::new(AtomicUsize::new(0));
        let release = Arc::new(AtomicBool::new(false));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let key = key.clone();
            let readers = Arc::clone(&readers);
            let release = Arc::clone(&release);
            let state = Arc::clone(&state);
            workers.push(std::thread::spawn(move || {
                state.with_guard(key, RepoAccess::Read, || {
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
            let state = Arc::clone(&state);
            std::thread::spawn(move || {
                writer_started.store(true, Ordering::SeqCst);
                state.with_guard(key, RepoAccess::Write, || {
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
        let state = Arc::new(RepoGuardRuntimeState::default());
        let first_started = Arc::new(AtomicBool::new(false));
        let release = Arc::new(AtomicBool::new(false));
        let worker = {
            let first_started = Arc::clone(&first_started);
            let release = Arc::clone(&release);
            let state = Arc::clone(&state);
            std::thread::spawn(move || {
                state.with_guard("repo-a", RepoAccess::Write, || {
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
        state.with_guard("repo-b", RepoAccess::Write, || {});
        release.store(true, Ordering::SeqCst);
        worker.join().unwrap();
    }
}
