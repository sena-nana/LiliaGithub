use super::*;

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
    if relative.is_absolute() {
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
        "svg" => Some("image/svg+xml"),
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
