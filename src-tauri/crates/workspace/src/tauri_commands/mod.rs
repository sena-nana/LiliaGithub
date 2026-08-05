use std::sync::Arc;

use serde_json::Value as JsonValue;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

use crate::runtime::{
    StoreError, StoreErrorKind, WorkspaceAppState, WorkspaceContext, WorkspaceRuntime,
};

macro_rules! delegate_command {
    (async $module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> Result<$ok:ty, String>) => {
        #[tauri::command]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name<R: tauri::Runtime>($app: tauri::AppHandle<R>, $($arg: $arg_ty),*) -> Result<$ok, lilia_github_contracts::error::AppError> {
            let app = crate::tauri_commands::workspace_context($app);
            crate::workspace::$module::$name(app, $($arg),*)
                .await
                .map_err(lilia_github_contracts::error::AppError::from_legacy)
        }
    };
    ($module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> Result<$ok:ty, String>) => {
        #[tauri::command]
        #[allow(clippy::too_many_arguments)]
        pub fn $name<R: tauri::Runtime>($app: tauri::AppHandle<R>, $($arg: $arg_ty),*) -> Result<$ok, lilia_github_contracts::error::AppError> {
            let app = crate::tauri_commands::workspace_context($app);
            crate::workspace::$module::$name(app, $($arg),*)
                .map_err(lilia_github_contracts::error::AppError::from_legacy)
        }
    };
    (async $module:ident; fn $name:ident($($arg:ident: $arg_ty:ty),* $(,)?) -> Result<$ok:ty, String>) => {
        #[tauri::command]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name($($arg: $arg_ty),*) -> Result<$ok, lilia_github_contracts::error::AppError> {
            crate::workspace::$module::$name($($arg),*)
                .await
                .map_err(lilia_github_contracts::error::AppError::from_legacy)
        }
    };
    ($module:ident; fn $name:ident($($arg:ident: $arg_ty:ty),* $(,)?) -> Result<$ok:ty, String>) => {
        #[tauri::command]
        #[allow(clippy::too_many_arguments)]
        pub fn $name($($arg: $arg_ty),*) -> Result<$ok, lilia_github_contracts::error::AppError> {
            crate::workspace::$module::$name($($arg),*)
                .map_err(lilia_github_contracts::error::AppError::from_legacy)
        }
    };
    (async $module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name<R: tauri::Runtime>($app: tauri::AppHandle<R>, $($arg: $arg_ty),*) -> $ret {
            let app = crate::tauri_commands::workspace_context($app);
            crate::workspace::$module::$name(app, $($arg),*).await
        }
    };
    ($module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        #[allow(clippy::too_many_arguments)]
        pub fn $name<R: tauri::Runtime>($app: tauri::AppHandle<R>, $($arg: $arg_ty),*) -> $ret {
            let app = crate::tauri_commands::workspace_context($app);
            crate::workspace::$module::$name(app, $($arg),*)
        }
    };
    (async $module:ident; fn $name:ident($($arg:ident: $arg_ty:ty),* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        #[allow(clippy::too_many_arguments)]
        pub async fn $name($($arg: $arg_ty),*) -> $ret {
            crate::workspace::$module::$name($($arg),*).await
        }
    };
    ($module:ident; fn $name:ident($($arg:ident: $arg_ty:ty),* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        #[allow(clippy::too_many_arguments)]
        pub fn $name($($arg: $arg_ty),*) -> $ret {
            crate::workspace::$module::$name($($arg),*)
        }
    };
}

macro_rules! delegate_dialog_command {
    ($module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> Result<$ok:ty, String>) => {
        #[tauri::command(async)]
        pub fn $name<R: tauri::Runtime>(
            $app: tauri::AppHandle<R>,
            window: tauri::WebviewWindow<R>,
            $($arg: $arg_ty),*
        ) -> Result<$ok, lilia_github_contracts::error::AppError> {
            let app = crate::tauri_commands::workspace_dialog_context(
                $app,
                window.label().to_string(),
            );
            crate::workspace::$module::$name(app, $($arg),*)
                .map_err(lilia_github_contracts::error::AppError::from_legacy)
        }
    };
    ($module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> $ret:ty) => {
        #[tauri::command(async)]
        pub fn $name<R: tauri::Runtime>(
            $app: tauri::AppHandle<R>,
            window: tauri::WebviewWindow<R>,
            $($arg: $arg_ty),*
        ) -> $ret {
            let app = crate::tauri_commands::workspace_dialog_context(
                $app,
                window.label().to_string(),
            );
            crate::workspace::$module::$name(app, $($arg),*)
        }
    };
}

mod bulk;
mod code_review;
mod conversations;
mod file_browser;
mod github;
mod github_discussions;
mod home_attention;
mod launch;
mod refresh;
mod registry;
mod repos;
mod settings;
mod storage;
mod system;
mod tasks;

pub use registry::{invoke_handler, workspace_command_manifest, WorkspaceCommandDescriptor};

#[derive(Clone)]
struct TauriWorkspaceRuntime<R: Runtime> {
    app: AppHandle<R>,
    parent_window_label: Option<String>,
}

fn workspace_context<R: Runtime>(app: AppHandle<R>) -> WorkspaceContext {
    let app_state = app.state::<WorkspaceAppState>().inner().clone();
    WorkspaceContext::with_app_state(
        Arc::new(TauriWorkspaceRuntime {
            app,
            parent_window_label: None,
        }),
        app_state,
    )
}

fn workspace_dialog_context<R: Runtime>(
    app: AppHandle<R>,
    parent_window_label: String,
) -> WorkspaceContext {
    let app_state = app.state::<WorkspaceAppState>().inner().clone();
    WorkspaceContext::with_app_state(
        Arc::new(TauriWorkspaceRuntime {
            app,
            parent_window_label: Some(parent_window_label),
        }),
        app_state,
    )
}

impl<R: Runtime> WorkspaceRuntime for TauriWorkspaceRuntime<R> {
    fn store_get(&self, file: &str, key: &str) -> Result<Option<JsonValue>, StoreError> {
        let store = self.app.store(file).map_err(map_store_error)?;
        Ok(store.get(key))
    }

    fn store_set(&self, file: &str, key: &str, value: JsonValue) -> Result<(), StoreError> {
        let store = self.app.store(file).map_err(map_store_error)?;
        store.set(key, value);
        Ok(())
    }

    fn store_delete(&self, file: &str, key: &str) -> Result<(), StoreError> {
        let store = self.app.store(file).map_err(map_store_error)?;
        store.delete(key);
        Ok(())
    }

    fn store_save(&self, file: &str) -> Result<(), StoreError> {
        let store = self.app.store(file).map_err(map_store_error)?;
        store.save().map_err(map_store_error)
    }

    fn pick_folder(&self, title: Option<&str>) -> Result<Option<String>, String> {
        let mut dialog = self.app.dialog().file();
        if let Some(parent_window_label) = &self.parent_window_label {
            if let Some(parent) = self.app.get_webview_window(parent_window_label) {
                dialog = dialog.set_parent(&parent);
            }
        }
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        Ok(dialog.blocking_pick_folder().map(|path| path.to_string()))
    }

    fn pick_files(&self, title: Option<&str>) -> Result<Option<Vec<String>>, String> {
        let mut dialog = self.app.dialog().file();
        if let Some(parent_window_label) = &self.parent_window_label {
            if let Some(parent) = self.app.get_webview_window(parent_window_label) {
                dialog = dialog.set_parent(&parent);
            }
        }
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

    fn resource_dir(&self) -> Option<std::path::PathBuf> {
        self.app.path().resource_dir().ok()
    }
}

fn map_store_error(error: tauri_plugin_store::Error) -> StoreError {
    match error {
        tauri_plugin_store::Error::Deserialize(error) => {
            StoreError::new(StoreErrorKind::Corrupt, error.to_string())
        }
        tauri_plugin_store::Error::Json(error) => {
            StoreError::new(StoreErrorKind::Corrupt, error.to_string())
        }
        tauri_plugin_store::Error::Io(error) => StoreError::from_io(error),
        error => StoreError::new(StoreErrorKind::Io, error.to_string()),
    }
}

pub fn handle_invoke<R: Runtime>(invoke: tauri::ipc::Invoke<R>) -> bool {
    invoke_handler::<R>()(invoke)
}
