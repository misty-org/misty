//! Keeps this computer's copy of a shared folder (`<data>/spaces/<space>/folders/<folder id>/`)
//! the same as its manifest: files the manifest no longer lists go, changed or missing ones are
//! fetched, checked against their SHA-256, and moved into place whole from a temporary file.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::{stream, TryStreamExt};
use serde::Deserialize;
use sha2::{Digest as _, Sha256};

use super::paths;
use super::progress::Progress;
use super::upload::{skipped_header, transfer_client};
use super::walk::sha256_file;

const AT_ONCE: usize = 4;

/// One file of the manifest: where it goes, what it must hash to, and where to fetch it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub url: String,
    /// Only for the server's own address when it proxies content: the page's session.
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

/// Where shared folders are kept on this computer, under Misty's data folder.
pub(crate) fn cache_root(misty_dir: &Path, space: &str, folder_id: &str) -> Result<PathBuf, String> {
    Ok(misty_dir
        .join("spaces")
        .join(paths::id(space)?)
        .join("folders")
        .join(paths::id(folder_id)?))
}

/// Where a download's files wait until they are whole, beside the cache rather than in it.
fn partial_root(cache: &Path) -> Option<PathBuf> {
    let name = cache.file_name()?.to_str()?;
    Some(cache.with_file_name(format!(".{name}.partial")))
}

struct Wanted {
    file: RemoteFile,
    relative: PathBuf,
    sha256: String,
}

/// The manifest's files, each path checked. Two files at one path, or a file where another needs
/// a folder, are refused.
pub(crate) fn checked(files: Vec<RemoteFile>) -> Result<Vec<(PathBuf, RemoteFile, String)>, String> {
    let mut seen = HashSet::new();
    let mut folders = HashSet::new();
    let mut out = Vec::with_capacity(files.len());
    for file in files {
        let relative = paths::relative(&file.path)?;
        let sha256 = paths::sha256(&file.sha256)?;
        paths::http_url(&file.url)?;
        if !seen.insert(relative.clone()) {
            return Err(format!("The folder lists {} twice.", file.path));
        }
        let mut parent = relative.parent();
        while let Some(folder) = parent.filter(|folder| !folder.as_os_str().is_empty()) {
            folders.insert(folder.to_path_buf());
            parent = folder.parent();
        }
        out.push((relative, file, sha256));
    }
    if let Some((_, file, _)) = out.iter().find(|(relative, _, _)| folders.contains(relative)) {
        return Err(format!("The folder lists {} as both a file and a folder.", file.path));
    }
    Ok(out)
}

pub(crate) async fn sync(
    cache: PathBuf,
    files: Vec<RemoteFile>,
    progress: impl FnOnce(usize, u64) -> Progress,
) -> Result<(), String> {
    let wanted: Vec<Wanted> = checked(files)?
        .into_iter()
        .map(|(relative, file, sha256)| Wanted {
            file,
            relative,
            sha256,
        })
        .collect();
    let progress = Arc::new(progress(
        wanted.len(),
        wanted.iter().map(|want| want.file.size).sum(),
    ));
    progress.send(true);
    let partial = partial_root(&cache).ok_or("Misty couldn't find its data folder.")?;
    let (sweep_cache, sweep_progress) = (cache.clone(), progress.clone());
    let needed = tokio::task::spawn_blocking(move || -> Result<Vec<Wanted>, String> {
        file_access::fs::create_dir_all(&sweep_cache).map_err(|error| error.to_string())?;
        let keep: HashSet<PathBuf> = wanted.iter().map(|want| want.relative.clone()).collect();
        sweep(&sweep_cache, &sweep_cache, &keep)?;
        // What is already here and the same is counted as done.
        let mut needed = Vec::new();
        for want in wanted {
            let target = sweep_cache.join(&want.relative);
            let same = file_access::fs::symlink_metadata(&target)
                .is_ok_and(|meta| meta.is_file() && meta.len() == want.file.size)
                && sha256_file(&target, |_| ()).is_ok_and(|(sha, _)| sha == want.sha256);
            if same {
                sweep_progress.bytes(want.file.size);
                sweep_progress.file_done();
            } else {
                needed.push(want);
            }
        }
        Ok(needed)
    })
    .await
    .map_err(|error| error.to_string())??;
    if !needed.is_empty() {
        file_access::fs::create_dir_all(&partial).map_err(|error| error.to_string())?;
        let client = transfer_client()?;
        let result = stream::iter(needed.into_iter().enumerate().map(Ok::<_, String>))
            .try_for_each_concurrent(AT_ONCE, |(index, want)| {
                let client = client.clone();
                let progress = progress.clone();
                let target = cache.join(&want.relative);
                let temp = partial.join(index.to_string());
                async move { fetch_one(&client, &want, &target, &temp, &progress).await }
            })
            .await;
        let _ = file_access::fs::remove_dir_all(&partial);
        result?;
    }
    progress.send(true);
    Ok(())
}

/// Removes what `keep` doesn't list under `dir`: files, links and then empty folders.
fn sweep(root: &Path, dir: &Path, keep: &HashSet<PathBuf>) -> Result<(), String> {
    let entries = file_access::fs::read_dir(dir).map_err(|error| error.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        if kind.is_dir() {
            sweep(root, &path, keep)?;
            let empty = file_access::fs::read_dir(&path).is_ok_and(|mut rest| rest.next().is_none());
            if empty {
                file_access::fs::remove_dir(&path).map_err(|error| error.to_string())?;
            }
        } else if kind.is_symlink() || !keep.contains(&relative) {
            file_access::fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

async fn fetch_one(
    client: &reqwest::Client,
    want: &Wanted,
    target: &Path,
    temp: &Path,
    progress: &Progress,
) -> Result<(), String> {
    let name = &want.file.path;
    let url = paths::http_url(&want.file.url)?;
    let mut request = client.get(url);
    for (header, value) in &want.file.headers {
        if !skipped_header(header) {
            request = request.header(header.as_str(), value.as_str());
        }
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| format!("Couldn't download {name}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Couldn't download {name} ({}).",
            response.status().as_u16()
        ));
    }
    let written = async {
        let mut out = file_access::fs::File::create(temp).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut received = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("The download of {name} stopped: {error}"))?
        {
            received += chunk.len() as u64;
            if received > want.file.size {
                return Err(format!("{name} didn't match what was shared. Try again."));
            }
            hasher.update(&chunk);
            out.write_all(&chunk).map_err(|error| error.to_string())?;
            progress.bytes(chunk.len() as u64);
        }
        out.flush().map_err(|error| error.to_string())?;
        if received != want.file.size || hex::encode(hasher.finalize()) != want.sha256 {
            return Err(format!("{name} didn't match what was shared. Try again."));
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = written {
        let _ = file_access::fs::remove_file(temp);
        return Err(error);
    }
    if let Some(parent) = target.parent() {
        file_access::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    file_access::fs::rename(temp, target).map_err(|error| error.to_string())?;
    progress.file_done();
    Ok(())
}
