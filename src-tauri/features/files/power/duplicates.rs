// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Find duplicates: files in a folder with the same contents. Files are grouped by size first,
//! and only files that share a size are read and hashed, so most of a folder is never opened.
//! Empty files, links, hidden items and what is inside packages are left out, as Finder hides
//! them.
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use file_access::{disk::check_disk, Access};
use serde::Serialize;
use tauri::AppHandle;
use walkdir::WalkDir;

use super::super::entry::is_package_name;
use super::super::progress::Op;
use super::{failed, sha256_of};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub size: u64,
    pub hash: String,
    pub paths: Vec<String>,
}

fn same_sizes(dir: &Path, op: &Op) -> Result<BTreeMap<u64, Vec<PathBuf>>, String> {
    check_disk(dir, Access::Read).map_err(|error| failed(dir, error))?;
    let mut by_size: BTreeMap<u64, Vec<PathBuf>> = BTreeMap::new();
    let walk = WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            entry.depth() == 0
                || !(name.starts_with('.')
                    || (entry.file_type().is_dir() && is_package_name(&name)))
        });
    for entry in walk {
        if op.cancelled() {
            break;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() > 0 {
            by_size
                .entry(meta.len())
                .or_default()
                .push(entry.into_path());
        }
    }
    by_size.retain(|_, paths| paths.len() > 1);
    Ok(by_size)
}

pub(super) fn find(
    app: &AppHandle,
    dir: &Path,
    op_id: &str,
) -> Result<Vec<DuplicateGroup>, String> {
    let mut op = Op::start(app, op_id, "Finding duplicates", 0);
    let by_size = same_sizes(dir, &op)?;
    let total = by_size
        .iter()
        .map(|(size, paths)| size * paths.len() as u64)
        .sum::<u64>();
    op.set_total(total);
    let mut groups = Vec::new();
    for (size, paths) in by_size.into_iter().rev() {
        let mut by_hash: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for path in paths {
            let item = super::display_name(&path);
            let hash = sha256_of(&path, |count| {
                op.advance(count, &item);
                !op.cancelled()
            });
            match hash {
                Ok(Some(hash)) => by_hash
                    .entry(hash)
                    .or_default()
                    .push(path.display().to_string()),
                Ok(None) => return Ok(groups),
                Err(_) => {}
            }
        }
        groups.extend(
            by_hash
                .into_iter()
                .filter(|(_, paths)| paths.len() > 1)
                .map(|(hash, paths)| DuplicateGroup { size, hash, paths }),
        );
        if op.cancelled() {
            break;
        }
    }
    Ok(groups)
}
