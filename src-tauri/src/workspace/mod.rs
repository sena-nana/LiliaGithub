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
