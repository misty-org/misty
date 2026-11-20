//! What stays on this computer: `.gitignore` and `.mistyignore`, editors' and the OS's scratch
//! files (kuragine's junk names, `names::is_scratch_name`), and the files `file_access::secrets`
//! closes (`.env*`, keys, `.ssh`…). Items they match stay local as `not_synced` and never upload.
//!
//! The walker here is ripgrep's, with a folder's `.gitignore` (and Git's own exclude file), then
//! its `.mistyignore`, which adds rules and can take one back with `!pattern`. Dotfiles count
//! unless a rule leaves them out; `.git` never does, and links are never followed. It moved here
//! from `spaces_folders/walk.rs`, which re-exports it.

use std::collections::HashSet;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;
use sha2::{Digest as _, Sha256};

use crate::names::{self, relative_text};

/// A folder's own ignore file, written by the share dialog.
pub const IGNORE_FILE: &str = ".mistyignore";
/// Git's.
pub const GIT_IGNORE_FILE: &str = ".gitignore";

/// More files than this is not a folder to copy in one go.
const MAX_FILES: usize = 50_000;
/// What the picker shows at most, and how deep it looks.
const SCAN_ENTRIES: usize = 5_000;
const SCAN_DEPTH: usize = 12;
/// How many kept entries the picker remembers while it looks for the excluded ones.
const SCAN_KEPT: usize = 200_000;

/// Whether one name never syncs, wherever it is: junk, a secret, or `.git`.
pub fn never_synced_name(name: &str) -> bool {
    names::is_scratch_name(name)
        || file_access::secrets::is_secret_file(name)
        || file_access::secrets::is_secret_folder(name)
        || name.eq_ignore_ascii_case(".git")
}

/// Whether a drive path never syncs because of its own name or a folder it is in.
pub fn never_synced_path(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let Some((last, folders)) = parts.split_last() else {
        return false;
    };
    never_synced_name(last)
        || folders.iter().any(|folder| {
            file_access::secrets::is_secret_folder(folder) || folder.eq_ignore_ascii_case(".git")
        })
        || file_access::secrets::closed_to_agents(Path::new(path.trim_start_matches('/')))
}

/// The ignore rules found inside a drive: each folder's `.gitignore` and `.mistyignore`, read
/// from what this computer has of them. Rules are matched against drive paths.
#[derive(Default)]
pub struct DriveRules {
    /// (folder's drive path, its rules), shallowest first.
    folders: Vec<(String, Gitignore)>,
}

impl DriveRules {
    /// Adds one folder's ignore file. `text` is its content; `folder` is the drive path of the
    /// folder it sits in.
    pub fn add(&mut self, folder: &str, text: &str) {
        let root = Path::new("/drive").join(folder.trim_start_matches('/'));
        let mut builder = GitignoreBuilder::new(&root);
        for line in text.lines() {
            let _ = builder.add_line(None, line);
        }
        if let Ok(rules) = builder.build() {
            self.folders.push((folder.to_owned(), rules));
        }
        self.folders
            .sort_by_key(|(folder, _)| folder.matches('/').count());
    }

    /// Whether `path` (a drive path) is left out, by its name or by a rule. Deeper folders' rules
    /// come later and win, and `!pattern` takes a rule back, as Git does.
    pub fn ignores(&self, path: &str, is_folder: bool) -> bool {
        if never_synced_path(path) {
            return true;
        }
        let absolute = Path::new("/drive").join(path.trim_start_matches('/'));
        let mut ignored = false;
        for (folder, rules) in &self.folders {
            if !names::is_within(path, folder) || path == folder {
                continue;
            }
            let matched = rules.matched_path_or_any_parents(&absolute, is_folder);
            if matched.is_ignore() {
                ignored = true;
            } else if matched.is_whitelist() {
                ignored = false;
            }
        }
        ignored
    }
}

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
pub struct LocalFile {
    /// Relative to the folder, `/` between parts.
    pub path: String,
    pub absolute: PathBuf,
    pub size: u64,
}

/// Every file that is shared from `root`, by path.
pub fn included_files(root: &Path) -> Result<Vec<LocalFile>, String> {
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

/// The files of `root` that go into a drive: what `included_files` keeps, less junk and secrets.
/// The second count is how many were left out for those.
pub fn drive_files(root: &Path) -> Result<(Vec<LocalFile>, u64), String> {
    let mut skipped = 0u64;
    let files = included_files(root)?
        .into_iter()
        .filter(|file| {
            let keep = !never_synced_path(&file.path);
            if !keep {
                skipped += 1;
            }
            keep
        })
        .collect();
    Ok((files, skipped))
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

pub fn scan(root: &Path) -> Scan {
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
pub fn sha256_file(path: &Path, mut read: impl FnMut(u64)) -> io::Result<(String, u64)> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn junk_and_secrets_never_sync() {
        for path in ["/a/.DS_Store", "/.env", "/keys/server.pem", "/x/.ssh/config", "/r/.git/HEAD"] {
            assert!(never_synced_path(path), "{path}");
        }
        for path in ["/Report.pdf", "/docs/.gitignore", "/environment.txt"] {
            assert!(!never_synced_path(path), "{path}");
        }
    }

    #[test]
    fn drive_rules_follow_git() {
        let mut rules = DriveRules::default();
        rules.add("/", "*.log\nbuild/\n");
        rules.add("/app", "!keep.log\n");
        assert!(rules.ignores("/a.log", false));
        assert!(rules.ignores("/build", true));
        assert!(rules.ignores("/build/out.txt", false));
        assert!(!rules.ignores("/app/keep.log", false));
        assert!(!rules.ignores("/notes.md", false));
    }
}
