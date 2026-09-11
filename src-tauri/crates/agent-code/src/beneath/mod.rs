//! File access that can never leave a project folder.
//!
//! Commands inside the project can create symlinks anywhere, and Misty's own
//! file tools run outside the sandbox. So every path is opened one component
//! at a time, starting from the project's folder handle and never following a
//! link: a symlink (or, on Windows, a junction) at any depth is refused, and a
//! folder swapped for a link between a check and an open is refused too.
use std::{
    fs::Metadata,
    io,
    path::{Component, Path, PathBuf},
};

use crate::CodeError;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::*;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

/// What sits at a path, without following a final link.
pub enum Entry {
    Missing,
    File { mode: u32 },
    Directory,
    Symlink,
    Other,
}

/// Relative path inside a project, validated: no root, no `..`, no empty parts.
pub fn clean_relative(value: &str) -> Result<PathBuf, CodeError> {
    let trimmed = value.trim().trim_start_matches("./").trim_matches('/');
    if trimmed.contains('\0') {
        return Err(CodeError::fix("Paths can't contain NUL characters."));
    }
    let path = Path::new(trimmed);
    let mut clean = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(name) => clean.push(name),
            Component::CurDir => {}
            _ => {
                return Err(CodeError::fix(
                    "Use a path inside the project, relative to its top folder.",
                ))
            }
        }
    }
    if clean.as_os_str().len() > 1024 {
        return Err(CodeError::fix("That path is too long."));
    }
    Ok(clean)
}

/// Names Misty never reads or writes for an agent: secrets and Git internals.
/// `.env.example` and similar templates stay readable.
pub fn protected(relative: &Path) -> Option<&'static str> {
    for part in relative.components() {
        if let Some(reason) = internal_folder(&part.as_os_str().to_string_lossy()) {
            return Some(reason);
        }
    }
    let file = relative
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if is_secret_name(&file) {
        return Some("Environment and key files can hold secrets, so agents can't open them. Use .env.example for placeholders.");
    }
    None
}

/// Git's and Misty's own folders, by any case: macOS and Windows volumes are
/// usually case-insensitive, so `.GIT` opens the real `.git`.
pub fn internal_folder(name: &str) -> Option<&'static str> {
    match name.to_lowercase().as_str() {
        ".git" => Some("Git's own files are off limits to agents."),
        ".misty" => Some("Misty's own project files are off limits to agents."),
        _ => None,
    }
}

pub fn is_secret_name(file: &str) -> bool {
    let env = file == ".env"
        || (file.starts_with(".env.")
            && ![".example", ".sample", ".template", ".dist"]
                .iter()
                .any(|suffix| file.ends_with(suffix)));
    env || file.ends_with(".pem")
        || file.ends_with(".key")
        || file == "id_rsa"
        || file == "id_ed25519"
        || file == ".npmrc"
        || file == ".netrc"
        || file == ".pypirc"
}

/// Replaces (or creates) a file atomically: the bytes go to a temporary file
/// in the same folder, which is then renamed over the target. A link at the
/// target is refused rather than written through.
pub fn write_file(root: &std::fs::File, relative: &Path, bytes: &[u8]) -> io::Result<bool> {
    write_file_mode(root, relative, bytes, None)
}

/// Removes a folder and everything in it, through folder handles only: no
/// path is ever resolved again, and a link anywhere is removed as a link,
/// never followed.
pub fn remove_tree(root: &std::fs::File, relative: &Path) -> io::Result<()> {
    let (parent, name) = open_parent(root, relative, false)?;
    remove_entry(&parent, name, 0)
}

/// What undo compares to tell whether a file changed besides its size and
/// time: its permission bits and its identity on disk. Windows has no
/// permission bits, so a read-only file reads as 0o444 and others as 0o644,
/// and a file's creation time stands in for its identity.
pub fn mode(metadata: &Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        metadata.mode() & 0o7777
    }
    #[cfg(windows)]
    {
        if metadata.permissions().readonly() {
            0o444
        } else {
            0o644
        }
    }
}

/// See [`mode`].
pub fn file_identity(metadata: &Metadata) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        metadata.ino()
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.creation_time()
    }
}

#[cfg(test)]
mod tests;
