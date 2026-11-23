use std::collections::HashSet;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;
use sha2::{Digest as _, Sha256};

use crate::names::{self, relative_text};

pub const IGNORE_FILE: &str = ".mistyignore";
pub const GIT_IGNORE_FILE: &str = ".gitignore";

pub const HEAVY_FOLDERS: &[&str] = &[
    "node_modules",
    "bower_components",
    "jspm_packages",
    ".pnpm-store",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".nox",
    ".ipynb_checkpoints",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".parcel-cache",
    ".vite",
    ".angular",
    ".expo",
    ".cache",
    "coverage",
    ".gradle",
    ".dart_tool",
    ".build",
    "Pods",
    "DerivedData",
    ".terraform",
    ".serverless",
    "elm-stuff",
    ".stack-work",
    "zig-cache",
    ".zig-cache",
    "zig-out",
];

const MAX_FILES: usize = 50_000;
const SCAN_ENTRIES: usize = 5_000;
const SCAN_DEPTH: usize = 12;
const SCAN_KEPT: usize = 200_000;

pub fn never_synced_name(name: &str) -> bool {
    names::is_scratch_name(name)
        || file_access::secrets::is_secret_file(name)
        || file_access::secrets::is_secret_folder(name)
        || name.eq_ignore_ascii_case(".git")
}

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

static HEAVY: LazyLock<Option<Gitignore>> = LazyLock::new(|| {
    let mut builder = GitignoreBuilder::new(Path::new("/drive"));
    for folder in HEAVY_FOLDERS {
        let _ = builder.add_line(None, &format!("{folder}/"));
    }
    builder.build().ok()
});

#[derive(Default)]
pub struct DriveRules {
    folders: Vec<(String, Gitignore)>,
}

impl DriveRules {
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

    pub fn ignores(&self, path: &str, is_folder: bool) -> bool {
        if never_synced_path(path) {
            return true;
        }
        let absolute = Path::new("/drive").join(path.trim_start_matches('/'));
        let mut ignored = HEAVY.as_ref().is_some_and(|defaults| {
            defaults
                .matched_path_or_any_parents(&absolute, is_folder)
                .is_ignore()
        });
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

fn brought_back(root: &Path) -> HashSet<String> {
    let mut names = HashSet::new();
    for file in [GIT_IGNORE_FILE, IGNORE_FILE] {
        let Ok(text) = file_access::fs::read_to_string(root.join(file)) else {
            continue;
        };
        for line in text.lines() {
            let Some(rule) = line.trim().strip_prefix('!') else {
                continue;
            };
            let name = rule.trim_start_matches('/').trim_end_matches('/');
            if HEAVY_FOLDERS.contains(&name) {
                names.insert(name.to_owned());
            }
        }
    }
    names
}

fn builder(root: &Path) -> ignore::WalkBuilder {
    let kept = brought_back(root);
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(false)
        .ignore(false)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .add_custom_ignore_filename(IGNORE_FILE)
        .filter_entry(move |entry| {
            entry.depth() == 0
                || (entry.file_name() != ".git"
                    && !(entry.file_type().is_some_and(|kind| kind.is_dir())
                        && entry.file_name().to_str().is_some_and(|name| {
                            HEAVY_FOLDERS.contains(&name) && !kept.contains(name)
                        })))
        });
    builder
}

#[derive(Debug)]
pub struct LocalFile {
    pub path: String,
    pub absolute: PathBuf,
    pub size: u64,
}

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
            out.push(if kind.is_dir() {
                format!("{rel}/")
            } else {
                rel
            });
        } else if kind.is_dir() && depth + 1 < SCAN_DEPTH {
            excluded_under(root, &path, depth + 1, kept, out);
        }
    }
}

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
        for path in [
            "/a/.DS_Store",
            "/.env",
            "/keys/server.pem",
            "/x/.ssh/config",
            "/r/.git/HEAD",
        ] {
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

    #[test]
    fn heavy_folders_stay_unless_brought_back() {
        let mut rules = DriveRules::default();
        assert!(rules.ignores("/node_modules", true));
        assert!(rules.ignores("/site/node_modules/react/index.js", false));
        assert!(rules.ignores("/app/.venv/bin/python", false));
        assert!(rules.ignores("/crate/target/debug/app", false));
        assert!(rules.ignores("/web/.next/cache/a", false));
        assert!(rules.ignores("/py/__pycache__/m.pyc", false));
        assert!(!rules.ignores("/build", false));
        assert!(!rules.ignores("/notes/target.md", false));
        assert!(!rules.ignores("/Builds/report.pdf", false));
        rules.add("/", "!build/\n");
        rules.add("/site", "!node_modules/\n");
        assert!(!rules.ignores("/build/out.txt", false));
        assert!(!rules.ignores("/site/node_modules/react/index.js", false));
        assert!(rules.ignores("/other/node_modules/react/index.js", false));
        assert!(rules.ignores("/app/dist/bundle.js", false));
    }
}
