use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value as JsonValue;

pub trait WorkspaceRuntime: Send + Sync {
    fn store_get(&self, file: &str, key: &str) -> Result<Option<JsonValue>, String>;
    fn store_set(&self, file: &str, key: &str, value: JsonValue) -> Result<(), String>;
    fn store_delete(&self, file: &str, key: &str) -> Result<(), String>;
    fn store_save(&self, file: &str) -> Result<(), String>;
    fn pick_folder(&self, title: Option<&str>) -> Result<Option<String>, String>;
    fn pick_files(&self, title: Option<&str>) -> Result<Option<Vec<String>>, String>;
    fn open_path(&self, path: &str, with: Option<&str>) -> Result<(), String>;
    fn open_url(&self, url: &str, with: Option<&str>) -> Result<(), String>;
    fn emit(&self, event: &str, payload: JsonValue) -> Result<(), String>;
    fn resource_dir(&self) -> Option<PathBuf> {
        None
    }
}

#[derive(Clone)]
pub struct WorkspaceContext {
    runtime: Arc<dyn WorkspaceRuntime>,
}

impl WorkspaceContext {
    pub fn new(runtime: Arc<dyn WorkspaceRuntime>) -> Self {
        Self { runtime }
    }

    pub fn store(&self, file: &str) -> Result<WorkspaceStore, String> {
        Ok(WorkspaceStore {
            context: self.clone(),
            file: file.to_string(),
        })
    }

    pub fn dialog(&self) -> WorkspaceDialog {
        WorkspaceDialog {
            context: self.clone(),
        }
    }

    pub fn opener(&self) -> WorkspaceOpener {
        WorkspaceOpener {
            context: self.clone(),
        }
    }

    pub fn emit<T: Serialize>(&self, event: &str, payload: &T) -> Result<(), String> {
        let payload = serde_json::to_value(payload).map_err(|error| error.to_string())?;
        self.runtime.emit(event, payload)
    }

    pub fn resource_dir(&self) -> Option<PathBuf> {
        self.runtime.resource_dir()
    }
}

pub struct WorkspaceStore {
    context: WorkspaceContext,
    file: String,
}

impl WorkspaceStore {
    pub fn get(&self, key: &str) -> Option<JsonValue> {
        self.context.runtime.store_get(&self.file, key).ok().flatten()
    }

    pub fn set(&self, key: &str, value: JsonValue) {
        let _ = self.context.runtime.store_set(&self.file, key, value);
    }

    pub fn delete(&self, key: &str) {
        let _ = self.context.runtime.store_delete(&self.file, key);
    }

    pub fn save(&self) -> Result<(), String> {
        self.context.runtime.store_save(&self.file)
    }
}

pub struct WorkspaceDialog {
    context: WorkspaceContext,
}

impl WorkspaceDialog {
    pub fn file(&self) -> WorkspaceFileDialogBuilder {
        WorkspaceFileDialogBuilder {
            context: self.context.clone(),
            title: None,
        }
    }
}

pub struct WorkspaceFileDialogBuilder {
    context: WorkspaceContext,
    title: Option<String>,
}

impl WorkspaceFileDialogBuilder {
    pub fn set_title(mut self, title: &str) -> Self {
        self.title = Some(title.to_string());
        self
    }

    pub fn blocking_pick_folder(&self) -> Option<String> {
        self.context
            .runtime
            .pick_folder(self.title.as_deref())
            .ok()
            .flatten()
    }

    pub fn blocking_pick_files(&self) -> Option<Vec<String>> {
        self.context
            .runtime
            .pick_files(self.title.as_deref())
            .ok()
            .flatten()
    }
}

pub struct WorkspaceOpener {
    context: WorkspaceContext,
}

impl WorkspaceOpener {
    pub fn open_path(&self, path: String, with: Option<&str>) -> Result<(), String> {
        self.context.runtime.open_path(&path, with)
    }

    pub fn open_url(&self, url: String, with: Option<&str>) -> Result<(), String> {
        self.context.runtime.open_url(&url, with)
    }
}
