// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// One file's patch, and both sides of a changed image.

use std::path::Path;

use base64::Engine as _;
use git2::Repository;
use serde::Serialize;

use super::status::open_repo;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitImageDiff {
    pub old: Option<String>,
    pub new: Option<String>,
}

pub(crate) use crate::project::files::{image_mime, is_image};

pub(crate) const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

pub(crate) const MAX_DIFF_PATCH_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const DIFF_TRUNCATED_MARKER: &str = "[… the rest of this diff is too long to show …]\n";

pub(crate) fn git_diff_blocking(path: &Path, file: &str, staged: bool) -> Result<String, String> {
    let repo = open_repo(path)?;
    let mut options = git2::DiffOptions::new();
    options.pathspec(file);
    if !staged {
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
    }
    let diff = if staged {
        let head_tree = repo.head().and_then(|head| head.peel_to_tree()).ok();
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut options))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut options))
    }
    .map_err(|error| error.to_string())?;
    let mut text = String::new();
    let mut truncated = false;
    let printed = diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let content = line.content();
        if text.len() + content.len() + 1 > MAX_DIFF_PATCH_BYTES {
            truncated = true;
            return false;
        }
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            text.push(origin);
        }
        text.push_str(std::str::from_utf8(content).unwrap_or(""));
        true
    });
    match printed {
        Ok(()) => {}
        Err(error) if truncated && error.code() == git2::ErrorCode::User => {}
        Err(error) => return Err(error.to_string()),
    }
    if truncated {
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(DIFF_TRUNCATED_MARKER);
    }
    Ok(text)
}

fn image_data_url(file: &str, bytes: &[u8]) -> String {
    format!(
        "data:{};base64,{}",
        image_mime(Path::new(file)),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn ensure_image_size(size: usize) -> Result<(), String> {
    if size > MAX_IMAGE_BYTES {
        return Err("This image is over the 5MB preview limit.".to_string());
    }
    Ok(())
}

fn head_blob_bytes(repo: &Repository, file: &str) -> Result<Option<Vec<u8>>, String> {
    let Ok(head) = repo.head() else {
        return Ok(None);
    };
    let tree = head.peel_to_tree().map_err(|error| error.to_string())?;
    let Ok(entry) = tree.get_path(Path::new(file)) else {
        return Ok(None);
    };
    let object = entry.to_object(repo).map_err(|error| error.to_string())?;
    let Some(blob) = object.as_blob() else {
        return Ok(None);
    };
    ensure_image_size(blob.size())?;
    Ok(Some(blob.content().to_vec()))
}

fn index_blob_bytes(repo: &Repository, file: &str) -> Result<Option<Vec<u8>>, String> {
    let index = repo.index().map_err(|error| error.to_string())?;
    let Some(entry) = index.get_path(Path::new(file), 0) else {
        return Ok(None);
    };
    let blob = repo
        .find_blob(entry.id)
        .map_err(|error| error.to_string())?;
    ensure_image_size(blob.size())?;
    Ok(Some(blob.content().to_vec()))
}

fn worktree_image_bytes(repo: &Repository, file: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(workdir) = repo.workdir() else {
        return Ok(None);
    };
    let candidate = workdir.join(file);
    if !file_access::fs::is_file(&candidate) {
        return Ok(None);
    }
    let root = file_access::fs::canonicalize(workdir).map_err(|error| error.to_string())?;
    let real = file_access::fs::canonicalize(&candidate).map_err(|error| error.to_string())?;
    if !real.starts_with(&root) {
        return Err(format!("{file} is outside the repository."));
    }
    let size = file_access::fs::metadata(&real)
        .map_err(|error| error.to_string())?
        .len();
    ensure_image_size(size as usize)?;
    file_access::fs::read(&real)
        .map(Some)
        .map_err(|error| format!("{file} couldn't be read: {error}"))
}

pub(crate) fn git_diff_images_blocking(
    path: &Path,
    file: &str,
    staged: bool,
) -> Result<GitImageDiff, String> {
    if !is_image(Path::new(file)) {
        return Err(format!("{file} isn't an image."));
    }
    let repo = open_repo(path)?;
    let (old, new) = if staged {
        (
            head_blob_bytes(&repo, file)?,
            index_blob_bytes(&repo, file)?,
        )
    } else {
        (
            index_blob_bytes(&repo, file)?,
            worktree_image_bytes(&repo, file)?,
        )
    };
    Ok(GitImageDiff {
        old: old.map(|bytes| image_data_url(file, &bytes)),
        new: new.map(|bytes| image_data_url(file, &bytes)),
    })
}
