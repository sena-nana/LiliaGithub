use super::*;

pub(super) fn readme_name_priority(name: &str) -> Option<usize> {
    let name = name.to_ascii_lowercase();
    match name.as_str() {
        "readme.md" => Some(0),
        "readme.markdown" => Some(1),
        "readme" => Some(2),
        "readme.txt" => Some(3),
        _ if name.starts_with("readme.")
            && matches!(
                Path::new(&name)
                    .extension()?
                    .to_str()?
                    .to_ascii_lowercase()
                    .as_str(),
                "md" | "markdown" | "txt"
            ) =>
        {
            Some(4)
        }
        _ => None,
    }
}

pub(super) fn repo_readme_priority(path: &Path) -> Option<usize> {
    let name = path.file_name()?.to_str()?;
    readme_name_priority(name)
}

pub(super) fn repo_readme_paths(repo_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = fs::read_dir(repo_path)
        .map_err(|e| format!("读取仓库目录失败：{}（{e}）", repo_path.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file() && repo_readme_priority(path).is_some())
        .collect::<Vec<_>>();
    paths.sort_by(|a, b| {
        let a_priority = repo_readme_priority(a).unwrap_or(usize::MAX);
        let b_priority = repo_readme_priority(b).unwrap_or(usize::MAX);
        a_priority.cmp(&b_priority).then_with(|| {
            let a_name = a
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let b_name = b
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            a_name.cmp(&b_name)
        })
    });
    Ok(paths)
}

pub(super) fn read_repo_readme_file(
    repo_id: &str,
    repo_path: &Path,
    path: &Path,
) -> Result<RepoReadme, String> {
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取 README 失败：{}（{e}）", path.display()))?;
    let updated_at = path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    let relative_path = path
        .strip_prefix(repo_path)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let readme_dir = path.parent().unwrap_or(repo_path);
    let images = readme_image_data_urls(&content, readme_dir, repo_path);
    let format = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| extension == "md" || extension == "markdown")
        .unwrap_or_else(|| "text".to_string());
    Ok(RepoReadme {
        repo_id: repo_id.to_string(),
        path: relative_path,
        images,
        content,
        format,
        updated_at,
    })
}

pub(super) fn read_repo_readmes(
    repo_id: &str,
    repo_path: &Path,
) -> Result<Vec<RepoReadme>, String> {
    repo_readme_paths(repo_path)?
        .into_iter()
        .map(|path| read_repo_readme_file(repo_id, repo_path, &path))
        .collect()
}

pub(super) fn read_repo_readme(
    repo_id: &str,
    repo_path: &Path,
) -> Result<Option<RepoReadme>, String> {
    Ok(read_repo_readmes(repo_id, repo_path)?.into_iter().next())
}

pub(super) fn readme_format_for_path(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| extension == "md" || extension == "markdown")
        .unwrap_or_else(|| "text".to_string())
}

pub(super) fn decode_github_file_content(
    prefix: &str,
    repo_full_name: &str,
    file: GitHubContentFileResponse,
) -> Result<RepoReadme, String> {
    let encoding = file.encoding.unwrap_or_default();
    if encoding.to_ascii_lowercase() != "base64" {
        return Err(format!("{prefix}：不支持的 README 编码：{encoding}"));
    }
    let encoded = file
        .content
        .unwrap_or_default()
        .chars()
        .filter(|value| !value.is_whitespace())
        .collect::<String>();
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|e| format!("{prefix}：README 解码失败：{e}"))?;
    let content =
        String::from_utf8(bytes).map_err(|e| format!("{prefix}：README 不是 UTF-8 文本：{e}"))?;
    Ok(RepoReadme {
        repo_id: format!("github:{repo_full_name}"),
        path: file.path.clone(),
        images: HashMap::new(),
        content,
        format: readme_format_for_path(&file.name),
        updated_at: None,
    })
}

pub(super) fn read_github_repo_readmes(
    app: &AppHandle,
    repo_full_name: &str,
) -> Result<Vec<RepoReadme>, String> {
    let repo = normalize_github_repo_input(repo_full_name)?;
    let (_, token) = github_require_token(app)?;
    let client = build_client()?;
    let repo_path = github_api_repo_path(&repo.full_name);
    let repo_url = format!("https://api.github.com/repos/{repo_path}");
    let repo_response = github_send(
        app,
        "读取 GitHub 仓库信息失败",
        github_headers(client.get(repo_url), Some(&token)),
    )?;
    let repo_info: GitHubRepoResponse = github_json("读取 GitHub 仓库信息失败", repo_response)?;
    let branch = repo_info
        .default_branch
        .unwrap_or_else(|| "main".to_string());
    let root_url = format!(
        "https://api.github.com/repos/{repo_path}/contents?ref={}",
        url_encode_path_segment(&branch),
    );
    let root_response = github_send(
        app,
        "读取 GitHub README 失败",
        github_headers(client.get(root_url), Some(&token)),
    )?;
    if root_response.status() == StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }
    let mut candidates: Vec<GitHubContentListItem> =
        github_json("读取 GitHub README 失败", root_response)?;
    candidates.retain(|item| item.kind == "file" && readme_name_priority(&item.name).is_some());
    candidates.sort_by(|a, b| {
        let a_priority = readme_name_priority(&a.name).unwrap_or(usize::MAX);
        let b_priority = readme_name_priority(&b.name).unwrap_or(usize::MAX);
        a_priority.cmp(&b_priority).then_with(|| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
        })
    });
    let mut readmes = Vec::new();
    for item in candidates {
        let file_url = format!(
            "https://api.github.com/repos/{repo_path}/contents/{}?ref={}",
            github_api_repo_path(&item.path),
            url_encode_path_segment(&branch),
        );
        let file_response = github_send(
            app,
            "读取 GitHub README 失败",
            github_headers(client.get(file_url), Some(&token)),
        )?;
        if file_response.status() == StatusCode::NOT_FOUND {
            continue;
        }
        let file: GitHubContentFileResponse =
            github_json("读取 GitHub README 失败", file_response)?;
        readmes.push(decode_github_file_content(
            "读取 GitHub README 失败",
            &repo.full_name,
            file,
        )?);
    }
    Ok(readmes)
}

pub(super) fn readme_image_data_urls(
    content: &str,
    readme_dir: &Path,
    repo_path: &Path,
) -> HashMap<String, String> {
    readme_image_sources(content)
        .into_iter()
        .filter_map(|source| {
            let file_path = resolve_readme_image_path(readme_dir, repo_path, &source)?;
            let mime = image_mime_for_path(&file_path)?;
            let bytes = fs::read(file_path).ok()?;
            Some((
                source,
                format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
            ))
        })
        .collect()
}

pub(super) fn readme_image_sources(content: &str) -> HashSet<String> {
    let mut sources = HashSet::new();

    collect_readme_image_sources(content, "](", ')', &mut sources);
    collect_readme_image_sources(content, "src=\"", '"', &mut sources);
    collect_readme_image_sources(content, "src='", '\'', &mut sources);

    sources
}

pub(super) fn collect_readme_image_sources(
    content: &str,
    prefix: &str,
    suffix: char,
    sources: &mut HashSet<String>,
) {
    for capture in content.match_indices(prefix) {
        let value = &content[capture.0 + prefix.len()..];
        let Some(end) = value.find(suffix) else {
            continue;
        };
        let source = value[..end].trim();
        if is_relative_readme_image_source(source) {
            sources.insert(source.to_string());
        }
    }
}

pub(super) fn is_relative_readme_image_source(source: &str) -> bool {
    !source.is_empty()
        && !source.starts_with('#')
        && !source.starts_with("//")
        && !source.contains(':')
        && image_extension(source).is_some()
}

pub(super) fn resolve_readme_image_path(
    readme_dir: &Path,
    repo_path: &Path,
    source: &str,
) -> Option<PathBuf> {
    let relative = Path::new(clean_readme_image_source(source));
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }

    let path = readme_dir.join(relative);
    let canonical = path.canonicalize().ok()?;
    let repo = repo_path.canonicalize().ok()?;
    if !canonical.starts_with(repo) || !canonical.is_file() {
        return None;
    }
    Some(canonical)
}

pub(super) fn image_mime_for_path(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "gif" => Some("image/gif"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

pub(super) fn image_extension(source: &str) -> Option<String> {
    clean_readme_image_source(source)
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
}

pub(super) fn clean_readme_image_source(source: &str) -> &str {
    source
        .split('#')
        .next()
        .unwrap_or(source)
        .split('?')
        .next()
        .unwrap_or(source)
}

#[tauri::command]
pub async fn repo_get_readme(
    app: AppHandle,
    repo_id: String,
) -> Result<Option<RepoReadme>, String> {
    run_blocking("读取 README", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        read_repo_readme(&repo_id, &path)
    })
    .await
}

#[tauri::command]
pub async fn repo_list_readmes(app: AppHandle, repo_id: String) -> Result<Vec<RepoReadme>, String> {
    run_blocking("读取 README", move || {
        let path = repo_path_by_id(&app, &repo_id)?;
        read_repo_readmes(&repo_id, &path)
    })
    .await
}
