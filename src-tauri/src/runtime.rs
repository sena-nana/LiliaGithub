use std::sync::Arc;

use lilia_github_workspace::runtime::{WorkspaceContext, WorkspaceRuntime};
use serde_json::Value as JsonValue;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

#[derive(Clone)]
struct TauriWorkspaceRuntime {
    app: AppHandle,
}

pub fn workspace_context(app: AppHandle) -> WorkspaceContext {
    WorkspaceContext::new(Arc::new(TauriWorkspaceRuntime { app }))
}

impl WorkspaceRuntime for TauriWorkspaceRuntime {
    fn store_get(&self, file: &str, key: &str) -> Result<Option<JsonValue>, String> {
        let store = self.app.store(file).map_err(|error| error.to_string())?;
        Ok(store.get(key))
    }

    fn store_set(&self, file: &str, key: &str, value: JsonValue) -> Result<(), String> {
        let store = self.app.store(file).map_err(|error| error.to_string())?;
        store.set(key, value);
        Ok(())
    }

    fn store_delete(&self, file: &str, key: &str) -> Result<(), String> {
        let store = self.app.store(file).map_err(|error| error.to_string())?;
        store.delete(key);
        Ok(())
    }

    fn store_save(&self, file: &str) -> Result<(), String> {
        let store = self.app.store(file).map_err(|error| error.to_string())?;
        store.save().map_err(|error| error.to_string())
    }

    fn pick_folder(&self, title: Option<&str>) -> Result<Option<String>, String> {
        let mut dialog = self.app.dialog().file();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        Ok(dialog.blocking_pick_folder().map(|path| path.to_string()))
    }

    fn pick_files(&self, title: Option<&str>) -> Result<Option<Vec<String>>, String> {
        let mut dialog = self.app.dialog().file();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        Ok(dialog
            .blocking_pick_files()
            .map(|paths| paths.into_iter().map(|path| path.to_string()).collect()))
    }

    fn open_path(&self, path: &str, with: Option<&str>) -> Result<(), String> {
        self.app
            .opener()
            .open_path(path, with)
            .map_err(|error| error.to_string())
    }

    fn open_url(&self, url: &str, with: Option<&str>) -> Result<(), String> {
        self.app
            .opener()
            .open_url(url, with)
            .map_err(|error| error.to_string())
    }

    fn emit(&self, event: &str, payload: JsonValue) -> Result<(), String> {
        self.app
            .emit(event, payload)
            .map_err(|error| error.to_string())
    }
}
