//! Which files of a folder are shared: ripgrep's walker with the folder's `.gitignore` (and Git's
//! own exclude file), then its `.mistyignore`, which adds rules and can take one back with
//! `!pattern`. Dotfiles count unless a rule leaves them out; `.git` never does, and links are
//! never followed.

use std::collections::HashSet;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest as _, Sha256};

use super::paths::relative_text;

/// The folder's own ignore file, written by the share dialog.
pub(crate) const IGNORE_FILE: &str = ".mistyignore";

/// More files than this is not a folder to share in one go.
const MAX_FILES: usize = 50_000;
/// What the picker shows at most, and how deep it looks.
const SCAN_ENTRIES: usize = 5_000;
const SCAN_DEPTH: usize = 12;
/// How many kept entries the picker remembers while it looks for the excluded ones.
const SCAN_KEPT: usize = 200_000;

fn builder(root: &Path) -> ignore::WalkBuilder {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(false)
        .ignore(false)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .add_custom_ignore_filename(IGNORE_FILE)
        .filter_entry(|entry| entry.depth() == 0 || entry.file_name() != ".git");
    builder
}

/// One file the walker keeps.
#[derive(Debug)]
pub(crate) struct LocalFile {
    /// Relative to the folder, `/` between parts.
    pub path: String,
    pub absolute: PathBuf,
    pub size: u64,
}

/// Every file that is shared from `root`, by path.
pub(crate) fn included_files(root: &Path) -> Result<Vec<LocalFile>, String> {
    let mut files = Vec::new();
    for entry in builder(root).build().flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Some(path) = relative_text(root, entry.path()) else {
            continue;
        };
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        files.push(LocalFile {
            path,
            absolute: entry.path().to_path_buf(),
            size,
        });
        if files.len() > MAX_FILES {
            return Err(format!(
                "That folder has more than {MAX_FILES} files. Leave some out in .mistyignore."
            ));
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFile {
    pub path: String,
    pub size: u64,
}

/// The picker's tree: the files that are shared, and the topmost files and folders a rule leaves
/// out (a folder's path ends in `/`). Capped and depth-limited; `truncated` says it stopped short.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub included: Vec<ScanFile>,
    pub excluded: Vec<String>,
    pub truncated: bool,
}

pub(crate) fn scan(root: &Path) -> Scan {
    let mut kept: HashSet<String> = HashSet::new();
    let mut included = Vec::new();
    let mut truncated = false;
    let mut walker = builder(root);
    walker.max_depth(Some(SCAN_DEPTH));
    for entry in walker.build().flatten() {
        let Some(path) = relative_text(root, entry.path()) else {
            continue;
        };
        let Some(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            kept.insert(path);
        } else if kind.is_file() {
            if included.len() < SCAN_ENTRIES {
                included.push(ScanFile {
                    path: path.clone(),
                    size: entry.metadata().map(|meta| meta.len()).unwrap_or(0),
                });
            } else {
                truncated = true;
            }
            kept.insert(path);
        }
        if kept.len() >= SCAN_KEPT {
            truncated = true;
            break;
        }
    }
    let mut excluded = Vec::new();
    // Stopped early, the kept set is short, and anything after it would look excluded.
    if kept.len() < SCAN_KEPT {
        excluded_under(root, root, 0, &kept, &mut excluded);
    }
    if excluded.len() >= SCAN_ENTRIES {
        truncated = true;
    }
    included.sort_by(|a, b| a.path.cmp(&b.path));
    excluded.sort();
    Scan {
        included,
        excluded,
        truncated,
    }
}

/// Entries under `dir` the walker didn't keep, without looking inside an excluded folder.
fn excluded_under(
    root: &Path,
    dir: &Path,
    depth: usize,
    kept: &HashSet<String>,
    out: &mut Vec<String>,
) {
    let Ok(entries) = file_access::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= SCAN_ENTRIES {
            return;
        }
        if entry.file_name() == ".git" {
            continue;
        }
        // `DirEntry::file_type` doesn't follow links.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() || !(kind.is_dir() || kind.is_file()) {
            continue;
        }
        let path = entry.path();
        let Some(rel) = relative_text(root, &path) else {
            continue;
        };
        if !kept.contains(&rel) {
            out.push(if kind.is_dir() { format!("{rel}/") } else { rel });
        } else if kind.is_dir() && depth + 1 < SCAN_DEPTH {
            excluded_under(root, &path, depth + 1, kept, out);
        }
    }
}

/// A file's SHA-256 in hex and its size, read in chunks; `read` hears each chunk's length.
pub(crate) fn sha256_file(path: &Path, mut read: impl FnMut(u64)) -> io::Result<(String, u64)> {
    let mut file = file_access::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut size = 0u64;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        size += count as u64;
        read(count as u64);
    }
    Ok((hex::encode(hasher.finalize()), size))
}
