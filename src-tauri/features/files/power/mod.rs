// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Finder's power tools: a file's checksum, Make Alias, Rename Items (several at once), finding
//! duplicates in a folder and comparing two folders by what is in their files.
use std::{io::Read, path::Path};

use file_access::disk::fs_disk;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::transfer::TransferResult;
use super::undo::{record, Change};
use super::{asked_path, blocking, display_name, failed, person_window};

mod compare;
mod duplicates;
mod rename;

pub use compare::{CompareRow, CompareState};
pub use duplicates::DuplicateGroup;
pub use rename::{RenamePreview, RenameRule};

pub(crate) fn sha256_of(
    path: &Path,
    mut read: impl FnMut(u64) -> bool,
) -> Result<Option<String>, String> {
    let mut file = fs_disk::open(path).map_err(|error| failed(path, error))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| failed(path, error))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        if !read(count as u64) {
            return Ok(None);
        }
    }
    Ok(Some(hex::encode(hasher.finalize())))
}

fn alias_path(path: &Path) -> Result<std::path::PathBuf, String> {
    let dir = path
        .parent()
        .ok_or_else(|| failed(path, "an alias can't be made here"))?;
    let name = display_name(path);
    let mut number = 1u32;
    loop {
        let alias = if number == 1 {
            format!("{name} alias")
        } else {
            format!("{name} alias {number}")
        };
        let candidate = dir.join(alias);
        if !fs_disk::exists(&candidate) {
            return Ok(candidate);
        }
        number += 1;
    }
}

#[tauri::command]
pub async fn files_checksum(webview: tauri::Webview, path: String) -> Result<String, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || {
        if fs_disk::is_dir(&path) {
            return Err(failed(&path, "a folder has no checksum"));
        }
        sha256_of(&path, |_| true)?.ok_or_else(|| failed(&path, "the checksum was stopped"))
    })
    .await
}

#[tauri::command]
pub async fn files_make_link(webview: tauri::Webview, path: String) -> Result<String, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || {
        fs_disk::symlink_metadata(&path).map_err(|error| failed(&path, error))?;
        let link = alias_path(&path)?;
        fs_disk::symlink(&path, &link).map_err(|error| failed(&link, error))?;
        record("Make Alias", Change::Created(link.clone()));
        super::search::note_added(&link);
        Ok(link.display().to_string())
    })
    .await
}

#[tauri::command]
pub async fn files_rename_preview(
    webview: tauri::Webview,
    paths: Vec<String>,
    rule: RenameRule,
) -> Result<Vec<RenamePreview>, String> {
    person_window(&webview)?;
    let paths = paths
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || {
        Ok(rename::plan(&paths, &rule)
            .into_iter()
            .map(|plan| plan.preview)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn files_rename_many(
    webview: tauri::Webview,
    paths: Vec<String>,
    rule: RenameRule,
) -> Result<TransferResult, String> {
    person_window(&webview)?;
    let paths = paths
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || Ok(rename::rename_many(&paths, &rule))).await
}

#[tauri::command]
pub async fn files_duplicates(
    app: AppHandle,
    webview: tauri::Webview,
    dir: String,
    op_id: String,
) -> Result<Vec<DuplicateGroup>, String> {
    person_window(&webview)?;
    let dir = asked_path(&dir)?;
    blocking(move || duplicates::find(&app, &dir, &op_id)).await
}

#[tauri::command]
pub async fn files_compare(
    webview: tauri::Webview,
    left: String,
    right: String,
) -> Result<Vec<CompareRow>, String> {
    person_window(&webview)?;
    let left = asked_path(&left)?;
    let right = asked_path(&right)?;
    blocking(move || compare::compare(&left, &right)).await
}
