// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/open_app.rs: only the path helper the engines use.

use std::path::PathBuf;

/// Expand a leading `~` and reject empty paths.
pub(crate) fn expand_user_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }
    if trimmed == "~" {
        return dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string());
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(trimmed))
}
