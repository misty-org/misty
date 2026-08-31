use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use tauri::http::{header, Request, Response, StatusCode};

pub fn handle(
    _context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    match resolve_request_path(request.uri().path()).and_then(|path| {
        fs::read(&path)
            .map(|body| (path, body))
            .map_err(|_| StatusCode::NOT_FOUND)
    }) {
        Ok((path, body)) => response(StatusCode::OK, content_type(&path), body),
        Err(status) => response(
            status,
            "text/plain; charset=utf-8",
            status.as_str().as_bytes().to_vec(),
        ),
    }
}

fn resolve_request_path(uri_path: &str) -> Result<PathBuf, StatusCode> {
    let relative = Path::new(uri_path.trim_start_matches('/'));
    let mut components = relative.components();
    let root_kind = match components.next() {
        Some(Component::Normal(value)) if value == "private" || value == "public" => value,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    let plugin_id = match components.next() {
        Some(Component::Normal(value)) => value.to_string_lossy(),
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    if !valid_plugin_id(&plugin_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let asset_path: PathBuf = components.collect();
    if asset_path.as_os_str().is_empty()
        || asset_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let plugin_root = home
        .join(".misty/plugins")
        .join(root_kind)
        .join(plugin_id.as_ref());
    let canonical_root = fs::canonicalize(&plugin_root).map_err(|_| StatusCode::NOT_FOUND)?;
    let canonical_candidate =
        fs::canonicalize(plugin_root.join(&asset_path)).map_err(|_| StatusCode::NOT_FOUND)?;
    if canonical_candidate.starts_with(&canonical_root) && canonical_candidate.is_file() {
        return Ok(canonical_candidate);
    }
    Err(StatusCode::NOT_FOUND)
}

fn valid_plugin_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn response(status: StatusCode, content_type: &'static str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .header(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'none'",
        )
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_ids_are_narrowly_scoped() {
        assert!(valid_plugin_id("quick_convert"));
        assert!(valid_plugin_id("theme-tools"));
        assert!(!valid_plugin_id("../themes"));
        assert!(!valid_plugin_id("themes/web"));
    }

    #[test]
    fn rejects_traversal_before_filesystem_access() {
        assert_eq!(
            resolve_request_path("/private/themes/../manifest.json"),
            Err(StatusCode::BAD_REQUEST)
        );
        assert_eq!(
            resolve_request_path("/private/themes"),
            Err(StatusCode::BAD_REQUEST)
        );
        assert_eq!(
            resolve_request_path("/unknown/themes/web/index.html"),
            Err(StatusCode::BAD_REQUEST)
        );
    }
}
