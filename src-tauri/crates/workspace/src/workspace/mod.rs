pub mod bulk;
pub mod file_browser;
pub mod github;
pub mod launch;
pub(crate) mod readme;
pub(crate) mod refresh;
pub mod repos;
pub mod settings;
mod shared;
pub mod storage;
pub mod system;
pub mod tasks;
pub(crate) mod watcher;

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
