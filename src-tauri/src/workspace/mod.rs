macro_rules! delegate_command {
    (async $module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        pub async fn $name($app: tauri::AppHandle, $($arg: $arg_ty),*) -> $ret {
            let app = crate::runtime::workspace_context($app);
            lilia_github_workspace::workspace::$module::$name(app, $($arg),*).await
        }
    };
    ($module:ident; fn $name:ident($app:ident: AppHandle $(, $arg:ident: $arg_ty:ty)* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        pub fn $name($app: tauri::AppHandle, $($arg: $arg_ty),*) -> $ret {
            let app = crate::runtime::workspace_context($app);
            lilia_github_workspace::workspace::$module::$name(app, $($arg),*)
        }
    };
    (async $module:ident; fn $name:ident($($arg:ident: $arg_ty:ty),* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        pub async fn $name($($arg: $arg_ty),*) -> $ret {
            lilia_github_workspace::workspace::$module::$name($($arg),*).await
        }
    };
    ($module:ident; fn $name:ident($($arg:ident: $arg_ty:ty),* $(,)?) -> $ret:ty) => {
        #[tauri::command]
        pub fn $name($($arg: $arg_ty),*) -> $ret {
            lilia_github_workspace::workspace::$module::$name($($arg),*)
        }
    };
}

pub(crate) mod bulk;
pub(crate) mod file_browser;
pub(crate) mod github;
pub(crate) mod launch;
pub(crate) mod repos;
pub(crate) mod settings;
pub(crate) mod system;
pub(crate) mod tasks;
