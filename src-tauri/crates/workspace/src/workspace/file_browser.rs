use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path};

use crate::runtime::WorkspaceContext as AppHandle;
use crate::workspace::operations::OperationKind;
use crate::workspace::readme::{image_mime_for_path, readme_image_data_urls};
use crate::workspace::repos::{run_repo_blocking, safe_repo_file_path, summarize_repo};
use crate::workspace::settings::{repo_path_by_id, workspace_root};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use lilia_github_contracts::workspace::{RepoFilePreview, RepoFileTreeEntry, RepoSummary};

pub(super) const MAX_FILE_PREVIEW_BYTES: u64 = 1024 * 1024;

pub(super) fn repo_file_entries(
    repo_path: &Path,
    parent_path: Option<&str>,
) -> Result<Vec<RepoFileTreeEntry>, String> {
    let directory = match parent_path {
        Some(path) if !path.trim().is_empty() => {
            let path = safe_repo_file_path(repo_path, path.trim())?;
            if !path.exists() || !path.is_dir() {
                return Err(format!("目录不存在：{}", path.display()));
            }
            path
        }
        _ => repo_path.to_path_buf(),
    };
    let mut entries = fs::read_dir(&directory)
        .map_err(|err| format!("读取目录失败：{}（{err}）", directory.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| is_visible_repo_entry(path))
        .map(|path| {
            let kind = if path.is_dir() { "dir" } else { "file" };
            Ok(RepoFileTreeEntry {
                path: repo_relative_path(repo_path, &path),
                name: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("")
                    .to_string(),
                kind: kind.to_string(),
                has_children: path.is_dir() && directory_has_visible_entries(&path),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    entries.sort_by(|left, right| {
        let left_kind = left.kind == "dir";
        let right_kind = right.kind == "dir";
        right_kind
            .cmp(&left_kind)
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(entries)
}

pub(super) fn repo_file_preview(
    repo_path: &Path,
    file_path: &str,
) -> Result<RepoFilePreview, String> {
    let file_path = safe_repo_file_path(repo_path, file_path.trim())?;
    if !file_path.exists() || !file_path.is_file() {
        return Err(format!("未找到文件：{}", file_path.display()));
    }
    let metadata = fs::metadata(&file_path)
        .map_err(|err| format!("读取文件信息失败：{}（{err}）", file_path.display()))?;
    let relative_path = repo_relative_path(repo_path, &file_path);
    let name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let mime = file_preview_mime(&file_path);
    if metadata.len() > MAX_FILE_PREVIEW_BYTES {
        return Ok(RepoFilePreview {
            path: relative_path,
            name,
            preview_kind: "tooLarge".to_string(),
            content: None,
            data_url: None,
            images: HashMap::new(),
            size: metadata.len(),
            mime_type: mime.map(str::to_string),
            truncated: false,
        });
    }

    let bytes = fs::read(&file_path)
        .map_err(|err| format!("读取文件失败：{}（{err}）", file_path.display()))?;
    if is_markdown_path(&file_path) {
        let content = decode_text_preview(&bytes)
            .ok_or_else(|| format!("Markdown 文件不是 UTF-8：{}", file_path.display()))?;
        let readme_dir = file_path.parent().unwrap_or(repo_path);
        return Ok(RepoFilePreview {
            path: relative_path,
            name,
            preview_kind: "markdown".to_string(),
            content: Some(content.clone()),
            data_url: None,
            images: readme_image_data_urls(&content, readme_dir, repo_path),
            size: metadata.len(),
            mime_type: Some("text/markdown".to_string()),
            truncated: false,
        });
    }

    if let Some(image_mime) = image_mime_for_path(&file_path) {
        return Ok(RepoFilePreview {
            path: relative_path,
            name,
            preview_kind: "image".to_string(),
            content: None,
            data_url: Some(format!(
                "data:{image_mime};base64,{}",
                STANDARD.encode(bytes)
            )),
            images: HashMap::new(),
            size: metadata.len(),
            mime_type: Some(image_mime.to_string()),
            truncated: false,
        });
    }

    if let Some(content) = decode_text_preview(&bytes) {
        return Ok(RepoFilePreview {
            path: relative_path,
            name,
            preview_kind: "text".to_string(),
            content: Some(content),
            data_url: None,
            images: HashMap::new(),
            size: metadata.len(),
            mime_type: mime
                .map(str::to_string)
                .or_else(|| Some("text/plain".to_string())),
            truncated: false,
        });
    }

    Ok(RepoFilePreview {
        path: relative_path,
        name,
        preview_kind: "binary".to_string(),
        content: None,
        data_url: None,
        images: HashMap::new(),
        size: metadata.len(),
        mime_type: mime.map(str::to_string),
        truncated: false,
    })
}

pub(super) fn delete_repo_file(repo_path: &Path, file_path: &str) -> Result<(), String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    if Path::new(trimmed)
        .components()
        .any(|component| matches!(component, Component::Normal(name) if name == ".git"))
    {
        return Err("不能删除 Git 内部文件".to_string());
    }
    let file_path = safe_repo_file_path(repo_path, trimmed)?;
    if !file_path.exists() {
        return Err(format!("文件不存在：{}", file_path.display()));
    }
    if !file_path.is_file() {
        return Err(format!("只能删除文件：{}", file_path.display()));
    }
    fs::remove_file(&file_path)
        .map_err(|err| format!("删除文件失败：{}（{err}）", file_path.display()))
}

fn is_visible_repo_entry(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if name == ".git" {
        return false;
    }
    path.is_dir() || path.is_file()
}

fn directory_has_visible_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .any(|child| is_visible_repo_entry(&child))
}

fn repo_relative_path(repo_path: &Path, path: &Path) -> String {
    path.strip_prefix(repo_path)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase()),
        Some(extension) if extension == "md" || extension == "markdown"
    )
}

pub(super) fn file_preview_mime(path: &Path) -> Option<&'static str> {
    if let Some(mime) = image_mime_for_path(path) {
        return Some(mime);
    }
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "json" => Some("application/json"),
        "md" | "markdown" => Some("text/markdown"),
        "svg" => Some("image/svg+xml"),
        "txt" => Some("text/plain"),
        "vue" | "ts" | "tsx" | "js" | "jsx" | "css" | "html" | "rs" | "yml" | "yaml" => {
            Some("text/plain")
        }
        _ => None,
    }
}

fn decode_text_preview(bytes: &[u8]) -> Option<String> {
    let content = String::from_utf8(bytes.to_vec()).ok()?;
    if content.contains('\0') {
        return None;
    }
    Some(content)
}

pub async fn repo_list_files(
    app: AppHandle,
    repo_id: String,
    parent_path: Option<String>,
) -> Result<Vec<RepoFileTreeEntry>, String> {
    run_repo_blocking(
        app.clone(),
        repo_id.clone(),
        OperationKind::LocalRead,
        "读取文件树",
        move || {
            let repo_path = repo_path_by_id(&app, &repo_id)?;
            repo_file_entries(&repo_path, parent_path.as_deref())
        },
    )
    .await
}

pub async fn repo_get_file_preview(
    app: AppHandle,
    repo_id: String,
    path: String,
) -> Result<RepoFilePreview, String> {
    run_repo_blocking(
        app.clone(),
        repo_id.clone(),
        OperationKind::LocalRead,
        "读取文件预览",
        move || {
            let repo_path = repo_path_by_id(&app, &repo_id)?;
            repo_file_preview(&repo_path, &path)
        },
    )
    .await
}

pub async fn repo_delete_file(
    app: AppHandle,
    repo_id: String,
    path: String,
) -> Result<RepoSummary, String> {
    run_repo_blocking(
        app.clone(),
        repo_id.clone(),
        OperationKind::LocalWrite,
        "删除文件",
        move || {
            let root = workspace_root(&app)?;
            let repo_path = repo_path_by_id(&app, &repo_id)?;
            delete_repo_file(&repo_path, &path)?;
            Ok(summarize_repo(&root, &repo_path))
        },
    )
    .await
}
