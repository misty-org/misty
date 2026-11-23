// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/files.rs: only the lenient path resolution the engines use.

use std::path::{Component, Path, PathBuf};

#[allow(
    clippy::disallowed_methods,
    reason = "resolves an image path against the person's project folder, which may not be linked"
)]
pub(crate) fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    match std::fs::canonicalize(path) {
        Ok(resolved) => return Ok(resolved),
        Err(e)
            if e.kind() != std::io::ErrorKind::NotFound
                || std::fs::symlink_metadata(path).is_ok() =>
        {
            return Err(format!("cannot resolve {}: {e}", path.display()));
        }
        Err(_) => {}
    }
    let unresolved = || format!("cannot resolve {}", path.display());
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(unresolved());
    }
    let name = path.file_name().ok_or_else(unresolved)?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(unresolved)?;
    Ok(canonicalize_lenient(parent)?.join(name))
}
