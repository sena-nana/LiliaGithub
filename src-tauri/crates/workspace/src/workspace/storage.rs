use std::path::Path;

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::run_blocking;
use crate::workspace::settings::{ensure_ntfs_path, repo_path_by_id};
use lilia_github_contracts::workspace::RepoStorageStats;

pub async fn repo_get_storage_stats(
    app: AppHandle,
    repo_id: String,
) -> Result<RepoStorageStats, String> {
    run_blocking("读取项目大小", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        ensure_ntfs_path(&path)?;
        let Some(resource_dir) = app.resource_dir() else {
            return Ok(RepoStorageStats::default());
        };
        Ok(query_everything_folder_size(&resource_dir, &path))
    })
    .await
}

#[cfg(target_os = "windows")]
fn query_everything_folder_size(resource_dir: &Path, folder: &Path) -> RepoStorageStats {
    windows::query_everything_folder_size(resource_dir, folder)
}

#[cfg(not(target_os = "windows"))]
fn query_everything_folder_size(_resource_dir: &Path, _folder: &Path) -> RepoStorageStats {
    RepoStorageStats::default()
}

#[cfg(target_os = "windows")]
mod windows {
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};

    use libloading::{Library, Symbol};

    use super::RepoStorageStats;

    const EVERYTHING_DLL_RELATIVE_PATH: &str = "everything/Everything64.dll";
    const EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME: u32 = 0x0000_0004;
    const EVERYTHING_REQUEST_SIZE: u32 = 0x0000_0010;
    const EVERYTHING_REQUEST_FLAGS: u32 =
        EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME | EVERYTHING_REQUEST_SIZE;
    const MAX_WINDOWS_PATH_WCHARS: usize = 32_768;

    type SetSearchW = unsafe extern "system" fn(*const u16);
    type SetBool = unsafe extern "system" fn(i32);
    type SetRequestFlags = unsafe extern "system" fn(u32);
    type QueryW = unsafe extern "system" fn(i32) -> i32;
    type GetU32 = unsafe extern "system" fn() -> u32;
    type IsFolderResult = unsafe extern "system" fn(u32) -> i32;
    type GetResultFullPathNameW = unsafe extern "system" fn(u32, *mut u16, u32) -> u32;
    type GetResultSize = unsafe extern "system" fn(u32, *mut i64) -> i32;
    type Reset = unsafe extern "system" fn();

    fn query_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    pub(super) fn query_everything_folder_size(
        resource_dir: &Path,
        folder: &Path,
    ) -> RepoStorageStats {
        let _guard = query_lock()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let dll_path = resource_dir.join(EVERYTHING_DLL_RELATIVE_PATH);
        let size = unsafe {
            let library = match Library::new(dll_path) {
                Ok(library) => library,
                Err(_) => return RepoStorageStats::default(),
            };
            query_with_library(&library, folder)
        };
        RepoStorageStats {
            logical_bytes: size,
        }
    }

    unsafe fn query_with_library(library: &Library, folder: &Path) -> Option<u64> {
        let set_search: Symbol<SetSearchW> = library.get(b"Everything_SetSearchW\0").ok()?;
        let set_match_path: Symbol<SetBool> = library.get(b"Everything_SetMatchPath\0").ok()?;
        let set_request_flags: Symbol<SetRequestFlags> =
            library.get(b"Everything_SetRequestFlags\0").ok()?;
        let query: Symbol<QueryW> = library.get(b"Everything_QueryW\0").ok()?;
        let get_num_results: Symbol<GetU32> = library.get(b"Everything_GetNumResults\0").ok()?;
        let is_folder_result: Symbol<IsFolderResult> =
            library.get(b"Everything_IsFolderResult\0").ok()?;
        let get_result_full_path: Symbol<GetResultFullPathNameW> =
            library.get(b"Everything_GetResultFullPathNameW\0").ok()?;
        let get_result_size: Symbol<GetResultSize> =
            library.get(b"Everything_GetResultSize\0").ok()?;
        let reset: Symbol<Reset> = library.get(b"Everything_Reset\0").ok()?;

        reset();
        let result = (|| {
            let canonical = dunce::canonicalize(folder).ok()?;
            let search = exact_path_search(&canonical);
            let search_wide = wide_null(&search);
            set_search(search_wide.as_ptr());
            set_match_path(1);
            set_request_flags(EVERYTHING_REQUEST_FLAGS);
            if query(1) == 0 {
                return None;
            }
            for index in 0..get_num_results() {
                if is_folder_result(index) == 0 {
                    continue;
                }
                let Some(result_path) = result_full_path(&get_result_full_path, index) else {
                    continue;
                };
                if !windows_paths_match(&canonical, Path::new(&result_path)) {
                    continue;
                }
                let mut size = 0_i64;
                if get_result_size(index, &mut size) != 0 && size >= 0 {
                    return Some(size as u64);
                }
            }
            None
        })();
        reset();
        result
    }

    fn exact_path_search(path: &Path) -> String {
        format!("exact:\"{}\"", path.to_string_lossy())
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn result_full_path(
        get_result_full_path: &GetResultFullPathNameW,
        index: u32,
    ) -> Option<String> {
        let mut buffer = vec![0_u16; MAX_WINDOWS_PATH_WCHARS];
        let length = get_result_full_path(index, buffer.as_mut_ptr(), buffer.len().try_into().ok()?)
            as usize;
        if length == 0 || length >= buffer.len() {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..length]))
    }

    fn windows_paths_match(expected: &Path, actual: &Path) -> bool {
        normalize_windows_path(expected) == normalize_windows_path(actual)
    }

    fn normalize_windows_path(path: &Path) -> String {
        let mut value = path.to_string_lossy().replace('/', "\\");
        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            value = stripped.to_string();
        }
        while value.len() > 3 && value.ends_with('\\') {
            value.pop();
        }
        value.to_lowercase()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn exact_result_path_matching_is_case_insensitive_and_separator_tolerant() {
            assert!(windows_paths_match(
                Path::new(r"D:\PROJECT\workspace\repo"),
                Path::new(r"d:/project/workspace/repo\")
            ));
            assert!(!windows_paths_match(
                Path::new(r"D:\PROJECT\workspace\repo"),
                Path::new(r"D:\PROJECT\workspace\repo-child")
            ));
        }

        #[test]
        fn exact_path_query_does_not_match_descendants() {
            assert_eq!(
                exact_path_search(Path::new(r"D:\PROJECT\workspace\repo")),
                r#"exact:"D:\PROJECT\workspace\repo""#
            );
        }
    }
}
