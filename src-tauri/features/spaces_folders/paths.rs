//! Checks on the paths and ids a window or the server names, before any of them touches disk.

use std::path::{Component, Path, PathBuf};

/// A path inside a shared folder, as the server and the walker write it (`docs/notes.md`), turned
/// into a relative path. Refused: empty, absolute, `.` or `..` parts, backslashes, and any `.git`
/// part, so nothing reaches outside the folder or plants a repository's hooks in Misty's cache.
pub(crate) fn relative(text: &str) -> Result<PathBuf, String> {
    let refuse = || Err(format!("“{text}” isn't a path inside the folder."));
    if text.is_empty() || text.len() > 4096 || text.contains(['\\', '\0']) {
        return refuse();
    }
    let mut path = PathBuf::new();
    for part in text.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.eq_ignore_ascii_case(".git") {
            return refuse();
        }
        if cfg!(windows) && part.contains(':') {
            return refuse();
        }
        path.push(part);
    }
    if path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return refuse();
    }
    Ok(path)
}

/// `relative` joined onto `root`.
pub(crate) fn inside(root: &Path, text: &str) -> Result<PathBuf, String> {
    Ok(root.join(relative(text)?))
}

/// A Space's or a shared folder's id as one folder name: letters, digits, `-` and `_`.
pub(crate) fn id(text: &str) -> Result<&str, String> {
    let fine = !text.is_empty()
        && text.len() <= 128
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    fine.then_some(text)
        .ok_or_else(|| "That shared folder can't be kept on this computer.".to_string())
}

/// A path relative to `root` as the server writes it, `/` between its parts. `None` for the root
/// itself, a path outside it, or a name that isn't UTF-8 (it couldn't be named on the server).
pub(crate) fn relative_text(root: &Path, path: &Path) -> Option<String> {
    let rest = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for part in rest.components() {
        match part {
            Component::Normal(name) => parts.push(name.to_str()?),
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// A 64-character SHA-256 in hex, lowercased.
pub(crate) fn sha256(text: &str) -> Result<String, String> {
    let fine = text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit());
    fine.then(|| text.to_ascii_lowercase())
        .ok_or_else(|| "The folder's file list has a bad checksum.".to_string())
}

/// An http(s) address for a transfer.
pub(crate) fn http_url(text: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(text).map_err(|_| "The server sent an address Misty can't use.")?;
    matches!(url.scheme(), "http" | "https")
        .then_some(url)
        .ok_or_else(|| "The server sent an address Misty can't use.".to_string())
}
