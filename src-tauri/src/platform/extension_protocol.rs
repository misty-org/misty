use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use tauri::http::{header, Request, Response, StatusCode};

pub fn handle(
    _context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let uri_path = request.uri().path();
    match resolve_request_path(uri_path).and_then(|path| {
        fs::read(&path)
            .map(|body| (path, body))
            .map_err(|_| StatusCode::NOT_FOUND)
    }) {
        Ok((path, body)) => package_response(uri_path, content_type(&path), body),
        Err(StatusCode::NOT_FOUND) => legacy_official_app_document(uri_path).unwrap_or_else(|| {
            response(
                StatusCode::NOT_FOUND,
                "text/plain; charset=utf-8",
                StatusCode::NOT_FOUND.as_str().as_bytes().to_vec(),
            )
        }),
        Err(status) => response(
            status,
            "text/plain; charset=utf-8",
            status.as_str().as_bytes().to_vec(),
        ),
    }
}

fn package_response(
    uri_path: &str,
    content_type: &'static str,
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    // Early official App documents shipped a self-only meta CSP that did not
    // recognize Misty's custom package scheme. Adapt only that known policy
    // on public App entry documents, preserving the signed files on disk,
    // asset integrity attributes, and all other document bytes.
    let body = if content_type == "text/html; charset=utf-8"
        && legacy_official_app_assets(uri_path).is_some()
    {
        match String::from_utf8(body) {
            Ok(document) => document
                .replace(LEGACY_APP_META_CSP, COMPATIBLE_APP_META_CSP)
                .into_bytes(),
            Err(error) => error.into_bytes(),
        }
    } else {
        body
    };
    response(StatusCode::OK, content_type, body)
}

const LEGACY_APP_META_CSP: &str = concat!(
    "<meta http-equiv=\"Content-Security-Policy\" content=\"",
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; ",
    "font-src 'self' data:; img-src 'self' data: blob:; connect-src 'none'; ",
    "object-src 'none'; base-uri 'none'; form-action 'none'\">",
);

const COMPATIBLE_APP_META_CSP: &str = concat!(
    "<meta http-equiv=\"Content-Security-Policy\" content=\"",
    "default-src 'none'; ",
    "script-src 'self' misty-extension: http://misty-extension.localhost; ",
    "style-src 'self' 'unsafe-inline' misty-extension: http://misty-extension.localhost; ",
    "font-src 'self' data: misty-extension: http://misty-extension.localhost; ",
    "img-src 'self' data: blob: misty-extension: http://misty-extension.localhost; ",
    "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\">",
);

fn resolve_request_path(uri_path: &str) -> Result<PathBuf, StatusCode> {
    let home = crate::infra::paths::misty_home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    resolve_package_path(uri_path, &home.join("plugins"))
}

fn resolve_package_path(uri_path: &str, packages: &Path) -> Result<PathBuf, StatusCode> {
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

    let plugin_root = packages.join(root_kind).join(plugin_id.as_ref());
    let canonical_root = fs::canonicalize(&plugin_root).map_err(|_| StatusCode::NOT_FOUND)?;
    let canonical_candidate =
        fs::canonicalize(plugin_root.join(&asset_path)).map_err(|_| StatusCode::NOT_FOUND)?;
    if canonical_candidate.starts_with(&canonical_root) && canonical_candidate.is_file() {
        return Ok(canonical_candidate);
    }
    Err(StatusCode::NOT_FOUND)
}

// Packages installed before official Apps gained a document entry contain
// only app.js and app.css. Keep those signed packages runnable while the host
// migrates to /web/index.html; freshly installed packages serve their own
// integrity-pinned document through the normal path above.
fn legacy_official_app_document(uri_path: &str) -> Option<Response<Vec<u8>>> {
    let (script_path, style_path) = legacy_official_app_assets(uri_path)?;
    resolve_request_path(&script_path).ok()?;
    resolve_request_path(&style_path).ok()?;
    let document = concat!(
        "<!doctype html><html><head><meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        "<link rel=\"stylesheet\" href=\"./app.css\"></head>",
        "<body><div id=\"misty-app-root\"></div>",
        "<script src=\"./app.js\"></script></body></html>"
    );
    Some(response(
        StatusCode::OK,
        "text/html; charset=utf-8",
        document.as_bytes().to_vec(),
    ))
}

fn legacy_official_app_assets(uri_path: &str) -> Option<(String, String)> {
    let components = Path::new(uri_path.trim_start_matches('/'))
        .components()
        .collect::<Vec<_>>();
    let [Component::Normal(root), Component::Normal(plugin_id), Component::Normal(web), Component::Normal(index)] =
        components.as_slice()
    else {
        return None;
    };
    let plugin_id = plugin_id.to_str()?;
    if *root != "public" || *web != "web" || *index != "index.html" || !valid_plugin_id(plugin_id) {
        return None;
    }
    let base = format!("/public/{plugin_id}/web");
    Some((format!("{base}/app.js"), format!("{base}/app.css")))
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
        // Legacy custom-scheme documents can send an opaque origin for asset
        // reads. These files are constrained to a validated installed-App
        // directory. The current App runtime resolves the package into a
        // separate top-level native WebView and does not expose the Host DOM.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .header(
            header::CONTENT_SECURITY_POLICY,
            concat!(
                "default-src 'none'; ",
                "script-src 'self' misty-extension: http://misty-extension.localhost; ",
                "style-src 'self' 'unsafe-inline' misty-extension: http://misty-extension.localhost; ",
                "img-src 'self' data: blob: misty-extension: http://misty-extension.localhost; ",
                "font-src 'self' data: misty-extension: http://misty-extension.localhost; ",
                "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
            ),
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
    fn resolves_assets_in_the_configured_installation_root() {
        let profile = tempfile::tempdir().unwrap();
        let package = profile.path().join("public/terminal/web");
        fs::create_dir_all(&package).unwrap();
        fs::write(package.join("app.js"), "export default {}; ").unwrap();
        assert_eq!(
            resolve_package_path("/public/terminal/web/app.js", profile.path()).unwrap(),
            package.join("app.js").canonicalize().unwrap()
        );
        assert_eq!(
            resolve_package_path("/public/terminal/../web/app.js", profile.path()),
            Err(StatusCode::BAD_REQUEST)
        );
        #[cfg(unix)]
        {
            let other = tempfile::NamedTempFile::new().unwrap();
            std::os::unix::fs::symlink(other.path(), package.join("escape.js")).unwrap();
            assert_eq!(
                resolve_package_path("/public/terminal/web/escape.js", profile.path()),
                Err(StatusCode::NOT_FOUND)
            );
        }
    }

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

    #[test]
    fn package_responses_allow_opaque_sandbox_asset_requests() {
        let result = response(StatusCode::OK, "text/javascript; charset=utf-8", Vec::new());

        assert_eq!(
            result.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(&header::HeaderValue::from_static("*"))
        );
        assert_eq!(
            result.headers().get(header::X_CONTENT_TYPE_OPTIONS),
            Some(&header::HeaderValue::from_static("nosniff"))
        );
    }

    #[test]
    fn adapts_legacy_document_policy_without_changing_asset_integrity() {
        let assets = concat!(
            "<link rel=\"stylesheet\" href=\"./app.css\" integrity=\"sha256-css\" crossorigin=\"anonymous\">",
            "</head><body><div id=\"misty-app-root\"></div>",
            "<script type=\"module\" src=\"./app.js\" integrity=\"sha256-js\" crossorigin=\"anonymous\"></script>",
            "</body></html>",
        );
        let document = format!("<!doctype html><html><head>{LEGACY_APP_META_CSP}{assets}");
        let result = package_response(
            "/public/browser/web/index.html",
            "text/html; charset=utf-8",
            document.into_bytes(),
        );

        assert_eq!(
            String::from_utf8(result.into_body()).unwrap(),
            format!("<!doctype html><html><head>{COMPATIBLE_APP_META_CSP}{assets}"),
        );
    }

    #[test]
    fn leaves_other_documents_and_assets_unchanged() {
        for (path, mime, document) in [
            (
                "/private/browser/web/index.html",
                "text/html; charset=utf-8",
                LEGACY_APP_META_CSP,
            ),
            (
                "/public/browser/web/other.html",
                "text/html; charset=utf-8",
                LEGACY_APP_META_CSP,
            ),
            (
                "/public/browser/web/app.js",
                "text/javascript; charset=utf-8",
                LEGACY_APP_META_CSP,
            ),
            (
                "/public/browser/web/index.html",
                "text/html; charset=utf-8",
                COMPATIBLE_APP_META_CSP,
            ),
            (
                "/public/browser/web/index.html",
                "text/html; charset=utf-8",
                "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\">",
            ),
        ] {
            assert_eq!(
                package_response(path, mime, document.as_bytes().to_vec()).body(),
                document.as_bytes(),
                "unexpected document rewrite for {path}",
            );
        }
    }

    #[test]
    fn recognizes_only_legacy_official_app_document_paths() {
        assert_eq!(
            legacy_official_app_assets("/public/browser/web/index.html"),
            Some((
                "/public/browser/web/app.js".to_owned(),
                "/public/browser/web/app.css".to_owned()
            ))
        );
        assert_eq!(
            legacy_official_app_assets("/private/browser/web/index.html"),
            None
        );
        assert_eq!(
            legacy_official_app_assets("/public/../web/index.html"),
            None
        );
        assert_eq!(
            legacy_official_app_assets("/public/browser/web/other.html"),
            None
        );
    }
}
