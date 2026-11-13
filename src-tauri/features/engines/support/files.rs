// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/files.rs: only the lenient path resolution the engines use.

use std::path::{Component, Path, PathBuf};

/// Canonicalize a path that may not exist yet: resolve its nearest existing
/// ancestor and re-append the missing names (an agent's write target, and so
/// its grant request, can sit under directories nobody has created yet).
/// Only truly absent components are re-appended: a dangling symlink resolves
/// nowhere, and its lexical tail would escape the root being checked.
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
    // `..` outside the verified prefix is not something we may reproduce
    // lexically: whether a hop over a missing directory still resolves
    // depends on the platform's path parser (Unix fails component-wise,
    // Windows' Win32 layer collapses `..` before touching the filesystem),
    // so the result would diverge per OS. Refuse instead of guessing.
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(unresolved());
    }
    // `file_name` is None for a trailing `..`, which cannot be resolved
    // lexically once the directory before it is missing.
    let name = path.file_name().ok_or_else(unresolved)?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(unresolved)?;
    Ok(canonicalize_lenient(parent)?.join(name))
}
