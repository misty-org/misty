// Search over a linked folder: lines of text, the overlay's index of every file, and the
// composer's `@` lookup.
//
// Adapted from desktop-cc-gui's files.rs (MIT, Copyright (c) 2026 zhukunpenglinyutong).

use std::path::Path;

use serde::Serialize;

use super::super::{linked_path, person_window};
use super::{blocking, MAX_READ_BYTES};

const MAX_SEARCH_RESULTS: usize = 200;
/// The search overlay's index: bounds the walk on a huge tree (the gitignore filter drops build
/// output; the cap is the last line of defense).
const MAX_INDEX_ENTRIES: usize = 20_000;
/// Folders the composer's `@` walk never opens: they hold thousands of files nobody edits by hand.
const HEAVY: [&str; 3] = [".git", "node_modules", "target"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexEntry {
    /// Relative to the folder, `/` between names (the panel joins it back to the root, which
    /// keeps the payload half the size of absolute paths).
    pub rel: String,
    pub is_dir: bool,
}

/// A case-insensitive substring check; ASCII takes a path that allocates nothing.
fn contains_case_insensitive(line: &str, needle_lower: &str) -> bool {
    if line.is_ascii() && needle_lower.is_ascii() {
        line.as_bytes()
            .windows(needle_lower.len())
            .any(|window| window.eq_ignore_ascii_case(needle_lower.as_bytes()))
    } else {
        line.to_lowercase().contains(needle_lower)
    }
}

pub(crate) fn search_text_blocking(root: &Path, query: &str) -> Vec<SearchHit> {
    use std::io::BufRead;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if hits.len() >= MAX_SEARCH_RESULTS {
            break;
        }
        let Ok(entries) = file_access::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if hits.len() >= MAX_SEARCH_RESULTS {
                break;
            }
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                stack.push(path);
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() > MAX_READ_BYTES as u64 * 4 {
                continue;
            }
            let Ok(file) = file_access::fs::File::open(&path) else {
                continue;
            };
            for (index, line) in std::io::BufReader::new(file).lines().enumerate() {
                // Not UTF-8 (a binary file): stop reading this one.
                let Ok(line) = line else { break };
                if contains_case_insensitive(&line, &needle) {
                    hits.push(SearchHit {
                        path: path.to_string_lossy().to_string(),
                        line: index + 1,
                        text: line.trim().chars().take(200).collect(),
                    });
                    if hits.len() >= MAX_SEARCH_RESULTS {
                        break;
                    }
                }
            }
        }
    }
    hits
}

/// Lines under a folder that contain `query`, ignoring case, at most 200.
#[tauri::command]
pub async fn project_search_text(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    person_window(&webview)?;
    let root = linked_path(&app, &account, &path).await?;
    blocking(move || Ok(search_text_blocking(&root, &query))).await
}

/// Every file and folder under `root` for the search overlay, .gitignore-aware through ripgrep's
/// walker (`.gitignore`, info/exclude and global excludes count even outside a repository);
/// hidden entries are skipped, and `node_modules` and `target` even where nothing ignores them.
pub(crate) fn file_index_blocking(root: &Path) -> Vec<FileIndexEntry> {
    let mut out = Vec::new();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|entry| {
            !(entry.file_type().is_some_and(|kind| kind.is_dir())
                && (entry.file_name() == "node_modules" || entry.file_name() == "target"))
        })
        .build();
    for entry in walker.flatten() {
        let path = entry.path();
        if path == root {
            continue;
        }
        out.push(FileIndexEntry {
            rel: path
                .strip_prefix(root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/"),
            is_dir: entry.file_type().is_some_and(|kind| kind.is_dir()),
        });
        if out.len() >= MAX_INDEX_ENTRIES {
            break;
        }
    }
    out
}

#[tauri::command]
pub async fn project_file_index(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<Vec<FileIndexEntry>, String> {
    person_window(&webview)?;
    let root = linked_path(&app, &account, &path).await?;
    blocking(move || Ok(file_index_blocking(&root))).await
}

/// A file or folder the composer's `@` menu can mention, by its path inside the folder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    path: String,
    relative: String,
    is_dir: bool,
}

/// Files and folders under a linked folder whose path contains every word of `query`, the
/// closest matches first. Heavy and hidden folders are skipped, and the walk stops early.
#[tauri::command]
pub async fn project_find_files(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    query: String,
) -> Result<Vec<Found>, String> {
    person_window(&webview)?;
    let root = linked_path(&app, &account, &folder).await?;
    tokio::task::spawn_blocking(move || Ok(find_files(&root, &query, 40)))
        .await
        .map_err(|error| error.to_string())?
}

const WALK_LIMIT: usize = 20_000;

pub(crate) fn find_files(root: &std::path::Path, query: &str, limit: usize) -> Vec<Found> {
    let words: Vec<String> = query
        .split_whitespace()
        .map(str::to_lowercase)
        .filter(|word| !word.is_empty())
        .collect();
    let mut found: Vec<(usize, Found)> = Vec::new();
    let mut queue = std::collections::VecDeque::from([root.to_path_buf()]);
    let mut seen = 0usize;
    while let Some(folder) = queue.pop_front() {
        let Ok(items) = file_access::fs::read_dir(&folder) else {
            continue;
        };
        for item in items.flatten() {
            seen += 1;
            if seen > WALK_LIMIT {
                queue.clear();
                break;
            }
            let name = item.file_name().to_string_lossy().to_string();
            let Ok(kind) = item.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            let is_dir = kind.is_dir();
            if is_dir && (HEAVY.contains(&name.as_str()) || name.starts_with('.')) {
                continue;
            }
            let path = item.path();
            let relative = path
                .strip_prefix(root)
                .map(|inside| inside.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());
            if is_dir {
                queue.push_back(path.clone());
            }
            let lower = relative.to_lowercase();
            if !words.iter().all(|word| lower.contains(word.as_str())) {
                continue;
            }
            // A match in the name beats one in the folders above it; shorter paths come first.
            let name_lower = name.to_lowercase();
            let in_name = words
                .iter()
                .filter(|word| name_lower.contains(word.as_str()))
                .count();
            let rank = (words.len() - in_name) * 1000 + relative.len();
            found.push((
                rank,
                Found {
                    path: path.to_string_lossy().to_string(),
                    relative,
                    is_dir,
                },
            ));
        }
    }
    found.sort_by_key(|(rank, _)| *rank);
    found
        .into_iter()
        .take(limit)
        .map(|(_, item)| item)
        .collect()
}

#[cfg(test)]
mod find_tests {
    use super::find_files;

    #[test]
    fn finds_by_every_word_and_skips_heavy_folders() {
        let root = std::env::temp_dir().join(format!("misty-find-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/app")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("src/app/main.ts"), "").unwrap();
        std::fs::write(root.join("node_modules/pkg/main.ts"), "").unwrap();
        std::fs::write(root.join("README.md"), "").unwrap();
        let found = find_files(&root, "app main", 10);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].relative, "src/app/main.ts");
        assert!(find_files(&root, "", 10).len() >= 4);
        let _ = std::fs::remove_dir_all(&root);
    }
}
