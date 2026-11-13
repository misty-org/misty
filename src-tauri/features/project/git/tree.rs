// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// What the file tree shows of Git: each listed entry's color (changed, new, or the top of a
// repository) and, for a folder that is itself a repository, its branch and change counts.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use git2::{Repository, StatusOptions};
use serde::{Deserialize, Serialize};

use super::repo::is_skip_worktree;

/// A folder in the tree that is the top of a Git repository, with its branch and counts. Unlike
/// the panel's status it names no files.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySummary {
    pub path: String,
    pub branch: String,
    pub changed: usize,
    pub untracked: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTreeLevel {
    pub path: String,
    pub files: Vec<String>,
    pub directories: Vec<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTreeStatus {
    pub repositories: Vec<RepositorySummary>,
    pub file_colors: HashMap<String, HashMap<String, String>>,
}

/// Opens `path` only when that folder is itself the top of a repository (a `.git` folder, or a
/// linked worktree's `.git` file), so an ordinary folder inside a repository isn't mistaken for
/// one. The real paths are compared too, so an odd `.git` can't pass the parent off as this one.
pub(super) fn open_exact_repo(path: &Path) -> Option<Repository> {
    if !file_access::fs::exists(path.join(".git")) {
        return None;
    }
    let repo = Repository::open(path).ok()?;
    let workdir = repo.workdir()?;
    let expected = file_access::fs::canonicalize(path).ok()?;
    let actual = file_access::fs::canonicalize(workdir).ok()?;
    (actual == expected).then_some(repo)
}

/// One status scan per repository for a whole batch of tree levels.
pub(super) struct TreeSnapshots {
    statuses: HashMap<PathBuf, Option<Vec<(String, git2::Status)>>>,
    recurse_untracked_dirs: bool,
    #[cfg(test)]
    pub(super) scans: usize,
}

impl TreeSnapshots {
    pub(super) fn new(recurse_untracked_dirs: bool) -> Self {
        Self {
            statuses: HashMap::new(),
            recurse_untracked_dirs,
            #[cfg(test)]
            scans: 0,
        }
    }

    fn get(&mut self, repo: &Repository) -> Option<&Vec<(String, git2::Status)>> {
        let key = file_access::fs::canonicalize(repo.path()).ok()?;
        let recurse = self.recurse_untracked_dirs;
        #[cfg(test)]
        let scans = &mut self.scans;
        self.statuses
            .entry(key)
            .or_insert_with(|| {
                #[cfg(test)]
                {
                    *scans += 1;
                }
                let mut options = StatusOptions::new();
                options
                    .include_untracked(true)
                    .recurse_untracked_dirs(recurse);
                // A sparse checkout's absent paths aren't changes, as in the panel's status.
                let index = repo.index().ok();
                repo.statuses(Some(&mut options)).ok().map(|statuses| {
                    statuses
                        .iter()
                        .filter_map(|entry| {
                            let path = entry.path().filter(|path| !path.is_empty())?;
                            if is_skip_worktree(index.as_ref(), path) {
                                return None;
                            }
                            Some((path.to_string(), entry.status()))
                        })
                        .collect()
                })
            })
            .as_ref()
    }
}

#[cfg(test)]
pub(super) fn exact_repository_summary(path: &Path) -> Option<RepositorySummary> {
    repository_summary_cached(path, &mut TreeSnapshots::new(true))
}

fn repository_summary_cached(
    path: &Path,
    snapshots: &mut TreeSnapshots,
) -> Option<RepositorySummary> {
    let repo = open_exact_repo(path)?;
    let branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
        .unwrap_or_else(|| "HEAD".to_string());
    let statuses = snapshots.get(&repo)?;
    // A file can be staged and changed again; it counts once.
    let mut changed = HashSet::new();
    let mut untracked = HashSet::new();
    for (file, status) in statuses {
        if status.contains(git2::Status::WT_NEW) && !status.contains(git2::Status::INDEX_NEW) {
            untracked.insert(file.clone());
        } else {
            changed.insert(file.clone());
        }
    }
    Some(RepositorySummary {
        path: path.to_string_lossy().into_owned(),
        branch,
        changed: changed.len(),
        untracked: untracked.len(),
    })
}

#[cfg(test)]
pub(super) fn repository_summaries_blocking(paths: Vec<String>) -> Vec<RepositorySummary> {
    paths
        .iter()
        .filter_map(|path| exact_repository_summary(Path::new(path)))
        .collect()
}

/// Colors for one loaded tree level, from two places:
/// 1. The repository that holds the listed folder, at any depth. Its status paths are relative
///    to the repository, so they're re-based onto the listed folder first.
/// 2. Each listed folder that is itself a repository, which is marked as one: the repository
///    around it usually sees it as one entry, or nothing when the tree's root isn't a repository.
#[cfg(test)]
pub(super) fn file_tree_colors(path: &str, files: &[String]) -> HashMap<String, &'static str> {
    file_tree_colors_cached(path, files, &mut TreeSnapshots::new(false))
}

fn file_tree_colors_cached(
    path: &str,
    files: &[String],
    snapshots: &mut TreeSnapshots,
) -> HashMap<String, &'static str> {
    let listed = Path::new(path);
    let mut out: HashMap<String, &'static str> = HashMap::new();
    let file_set: HashSet<&str> = files.iter().map(String::as_str).collect();

    if let Ok(repo) = Repository::discover(listed) {
        let _ = (|| {
            let workdir = repo.workdir()?;
            let listed_real = file_access::fs::canonicalize(listed).ok()?;
            let root_real = file_access::fs::canonicalize(workdir).ok()?;
            let relative = listed_real.strip_prefix(&root_real).ok()?;
            let prefix = relative.to_string_lossy().replace('\\', "/");
            let statuses = snapshots.get(&repo)?;
            let with_prefix = (!prefix.is_empty()).then(|| format!("{prefix}/"));
            for (raw, status) in statuses {
                // A trailing slash marks an untracked folder git didn't open; without it the
                // folder (and those above it) can light up too.
                let file = raw.strip_suffix('/').unwrap_or(raw);
                let relative_file = match &with_prefix {
                    Some(prefix) => match file.strip_prefix(prefix.as_str()) {
                        Some(rest) => rest,
                        None => continue,
                    },
                    None => file,
                };
                // Staged but never committed reads as new, like an untracked file.
                let color = if status.intersects(git2::Status::INDEX_NEW | git2::Status::WT_NEW) {
                    "untracked"
                } else {
                    "modified"
                };
                if file_set.contains(relative_file) {
                    out.insert(relative_file.to_string(), color);
                }
                // A folder takes the state of what's inside it, so it shows without opening.
                // Changed wins over new when it holds both.
                let mut folder = Path::new(relative_file);
                while let Some(parent) = folder.parent() {
                    if parent.as_os_str().is_empty() {
                        break;
                    }
                    let key = parent.to_string_lossy().into_owned();
                    if file_set.contains(key.as_str()) {
                        let next = match out.get(&key).copied() {
                            Some("modified") => "modified",
                            _ => color,
                        };
                        out.insert(key, next);
                    }
                    folder = parent;
                }
            }
            Some(())
        })();
    }

    // Folders that are repositories are marked as such whatever their own state: the branch
    // badge beside them carries that.
    for name in files {
        if open_exact_repo(&listed.join(name)).is_some() {
            out.insert(name.clone(), "repository");
        }
    }
    out
}

pub(super) fn tree_status_blocking(
    levels: Vec<GitTreeLevel>,
    snapshots: &mut TreeSnapshots,
) -> GitTreeStatus {
    let mut result = GitTreeStatus::default();
    let mut roots = HashSet::new();
    for level in levels {
        let colors = file_tree_colors_cached(&level.path, &level.files, snapshots);
        result.file_colors.insert(
            level.path.clone(),
            colors
                .into_iter()
                .map(|(name, color)| (name, color.to_string()))
                .collect(),
        );
        let paths = std::iter::once(PathBuf::from(&level.path)).chain(
            level
                .directories
                .iter()
                .map(|name| Path::new(&level.path).join(name)),
        );
        for path in paths {
            if roots.insert(path.clone()) {
                if let Some(summary) = repository_summary_cached(&path, snapshots) {
                    result.repositories.push(summary);
                }
            }
        }
    }
    result
}
