use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring_core::{Entry, Error as KeyringError};
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::header::{ACCEPT, LINK, USER_AGENT};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

pub(crate) mod bulk;
pub(crate) mod file_browser;
pub(crate) mod github;
pub(crate) mod launch;
pub(crate) mod readme;
pub(crate) mod repos;
pub(crate) mod settings;
mod shared;
pub(crate) mod system;
pub(crate) mod tasks;
mod types;

pub use types::*;

use github::*;
#[cfg(test)]
use file_browser::*;
use readme::*;
use repos::*;
use settings::*;
use shared::*;
use tasks::*;

async fn run_blocking<T, F>(label: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| format!("{label}后台任务异常：{e}"))?
}

#[cfg(test)]
mod tests;
