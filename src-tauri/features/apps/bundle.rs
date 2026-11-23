use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use file_access::fs;
use sha2::{Digest, Sha256};

use super::manifest::{safe_relative, valid_id, valid_version, AppManifest};

pub const MANIFEST_FILE: &str = "misty-app.json";
const MAX_UNPACKED_BYTES: u64 = 512 << 20;
const MAX_ENTRIES: usize = 20_000;
const MAX_MANIFEST_BYTES: u64 = 64 << 10;

#[cfg(test)]
pub static TEST_CACHE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

pub fn cache_root() -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(dir) = TEST_CACHE
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
    {
        return Ok(dir);
    }
    file_access::paths::misty_home_dir()
        .map(|home| home.join("apps"))
        .ok_or_else(|| "Misty has no data folder to keep apps in.".to_owned())
}

pub fn bundle_dir(root: &Path, id: &str, version: &str) -> Result<PathBuf, String> {
    if !valid_id(id) || !valid_version(version) {
        return Err("That isn't an app id and version.".into());
    }
    Ok(root.join(id).join(version))
}

pub fn locate(id: &str, version: &str) -> Result<PathBuf, String> {
    bundle_dir(&cache_root()?, id, version)
}

pub fn manifest_in(dir: &Path, id: &str, version: &str) -> Result<Option<AppManifest>, String> {
    let Ok(bytes) = fs::read(dir.join(MANIFEST_FILE)) else {
        return Ok(None);
    };
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("The app's misty-app.json is too large.".into());
    }
    let manifest = AppManifest::parse(&bytes)?;
    if manifest.id != id || manifest.version != version {
        return Err("The app's misty-app.json names a different id or version.".into());
    }
    Ok(Some(manifest))
}

pub fn installed_manifest(id: &str, version: &str) -> Result<Option<AppManifest>, String> {
    manifest_in(&locate(id, version)?, id, version)
}

pub fn read_manifest(id: &str, version: &str) -> Result<AppManifest, String> {
    installed_manifest(id, version)?
        .ok_or_else(|| "That app isn't installed on this computer.".to_owned())
}

#[derive(Debug, PartialEq, Eq)]
pub enum FileError {
    Invalid,
    NotFound,
}

pub fn resolve_file_in(dir: &Path, relative: &str) -> Result<PathBuf, FileError> {
    if !safe_relative(relative) {
        return Err(FileError::Invalid);
    }
    let path = dir.join(relative);
    if !path
        .components()
        .skip(dir.components().count())
        .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err(FileError::Invalid);
    }
    let real_dir = fs::canonicalize(dir).map_err(|_| FileError::NotFound)?;
    let real = fs::canonicalize(&path).map_err(|_| FileError::NotFound)?;
    if !real.starts_with(&real_dir) {
        return Err(FileError::Invalid);
    }
    if !fs::is_file(&real) {
        return Err(FileError::NotFound);
    }
    Ok(real)
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Wrap {
    pub manifest: serde_json::Value,
    #[serde(default)]
    pub add_copies: Vec<AddCopy>,
    #[serde(default)]
    pub strip_top: bool,
    #[serde(default)]
    pub auto_top: bool,
    #[serde(default)]
    pub add_files: Vec<AddFile>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct AddFile {
    pub path: String,
    pub content: String,
}

const MAX_ADDED_BYTES: usize = 256 << 10;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Top {
    Keep,
    Strip,
    StripIfOne,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct AddCopy {
    pub from: String,
    pub to: String,
}

pub fn install_zip(
    root: &Path,
    id: &str,
    version: &str,
    zip_bytes: &[u8],
    sha256: &str,
) -> Result<AppManifest, String> {
    install_with(root, id, version, zip_bytes, sha256, None)
}

pub fn install_wrapped(
    root: &Path,
    id: &str,
    version: &str,
    zip_bytes: &[u8],
    sha256: &str,
    wrap: &Wrap,
) -> Result<AppManifest, String> {
    install_with(root, id, version, zip_bytes, sha256, Some(wrap))
}

fn install_with(
    root: &Path,
    id: &str,
    version: &str,
    zip_bytes: &[u8],
    sha256: &str,
    wrap: Option<&Wrap>,
) -> Result<AppManifest, String> {
    let final_dir = bundle_dir(root, id, version)?;
    if !sha256.eq_ignore_ascii_case(&sha256_hex(zip_bytes)) {
        return Err(
            "The downloaded app doesn't match the catalog's checksum, so it wasn't installed."
                .into(),
        );
    }
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    let top = match wrap {
        Some(wrap) if wrap.strip_top => Top::Strip,
        Some(wrap) if wrap.auto_top => Top::StripIfOne,
        _ => Top::Keep,
    };
    let result = unpack(&staging, zip_bytes, top).and_then(|()| {
        if let Some(wrap) = wrap {
            add_wrapper(&staging, id, version, wrap)?;
        }
        check_staged(&staging, id, version, wrap.is_none())
    });
    let manifest = match result {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let replace = || -> std::io::Result<()> {
        if fs::exists(&final_dir) {
            fs::remove_dir_all(&final_dir)?;
        }
        if let Some(parent) = final_dir.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&staging, &final_dir)
    };
    if let Err(error) = replace() {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Couldn't save the app: {error}"));
    }
    Ok(manifest)
}

fn add_wrapper(staging: &Path, id: &str, version: &str, wrap: &Wrap) -> Result<(), String> {
    for copy in &wrap.add_copies {
        if !safe_relative(&copy.from) || !safe_relative(&copy.to) {
            return Err(
                "A copy the catalog asks for names a path that leaves the app's folder.".into(),
            );
        }
        let (from, to) = (staging.join(&copy.from), staging.join(&copy.to));
        if !fs::exists(&from) || fs::exists(&to) {
            continue;
        }
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Couldn't save the app: {error}"))?;
        }
        fs::copy_tree(&from, &to).map_err(|error| format!("Couldn't save the app: {error}"))?;
    }
    let added: usize = wrap.add_files.iter().map(|file| file.content.len()).sum();
    if added > MAX_ADDED_BYTES {
        return Err("The files Misty adds to the app are too large.".into());
    }
    for file in &wrap.add_files {
        if !safe_relative(&file.path)
            || !file.path.starts_with("misty/")
            || !file.path.ends_with(".js")
        {
            return Err("A file Misty adds to an app is a script under misty/.".into());
        }
        let target = staging.join(&file.path);
        if fs::exists(&target) {
            return Err("The release already has a file where Misty adds one.".into());
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Couldn't save the app: {error}"))?;
        }
        fs::write(&target, file.content.as_bytes())
            .map_err(|error| format!("Couldn't save the app: {error}"))?;
    }
    if fs::exists(staging.join(MANIFEST_FILE)) {
        return Err("The release already has a misty-app.json, which Misty adds.".into());
    }
    let mut manifest = wrap.manifest.clone();
    let fields = manifest
        .as_object_mut()
        .ok_or_else(|| "The catalog's manifest isn't an object.".to_owned())?;
    fields.insert("id".into(), id.into());
    fields.insert("version".into(), version.into());
    let text = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(staging.join(MANIFEST_FILE), text)
        .map_err(|error| format!("Couldn't save the app: {error}"))
}

fn unpack(staging: &Path, zip_bytes: &[u8], top: Top) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes))
        .map_err(|_| "The app's download isn't a zip file.".to_owned())?;
    if archive.len() > MAX_ENTRIES {
        return Err("The app has too many files.".into());
    }
    let top = match top {
        Top::Keep => None,
        Top::Strip => single_top_folder(&mut archive)?,
        Top::StripIfOne => single_top_folder(&mut archive).ok().flatten(),
    };
    fs::create_dir_all(staging).map_err(|error| format!("Couldn't save the app: {error}"))?;
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "The app's zip is damaged.".to_owned())?;
        if entry.is_symlink() {
            return Err("The app's zip holds a link, which a bundle may not.".into());
        }
        let full = entry.name().trim_end_matches('/').to_owned();
        let name = match &top {
            Some(folder) => match full
                .strip_prefix(folder.as_str())
                .and_then(|rest| rest.strip_prefix('/'))
            {
                Some(rest) => rest.to_owned(),
                None => continue,
            },
            None => full,
        };
        if !safe_relative(&name) {
            return Err("The app's zip holds a path that leaves its folder.".into());
        }
        let target = staging.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|error| format!("Couldn't save the app: {error}"))?;
            continue;
        }
        let budget = MAX_UNPACKED_BYTES - total;
        let mut data = Vec::new();
        entry
            .by_ref()
            .take(budget + 1)
            .read_to_end(&mut data)
            .map_err(|_| "The app's zip is damaged.".to_owned())?;
        total += data.len() as u64;
        if total > MAX_UNPACKED_BYTES {
            return Err("The app is larger than a bundle may be.".into());
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Couldn't save the app: {error}"))?;
        }
        fs::write(&target, &data).map_err(|error| format!("Couldn't save the app: {error}"))?;
    }
    Ok(())
}

fn single_top_folder(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
) -> Result<Option<String>, String> {
    let mut top: Option<String> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| "The app's zip is damaged.".to_owned())?;
        let name = entry.name().trim_end_matches('/').to_owned();
        let first = name.split('/').next().unwrap_or("").to_owned();
        let in_folder = name.contains('/') || entry.is_dir();
        if first.is_empty() || !in_folder || top.as_ref().is_some_and(|known| *known != first) {
            return Err("The release's files aren't all in one folder.".into());
        }
        top = Some(first);
    }
    Ok(top)
}

fn check_staged(
    staging: &Path,
    id: &str,
    version: &str,
    require_logo: bool,
) -> Result<AppManifest, String> {
    let bytes = fs::read(staging.join(MANIFEST_FILE))
        .map_err(|_| "The app has no misty-app.json.".to_owned())?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("The app's misty-app.json is too large.".into());
    }
    let manifest = AppManifest::parse(&bytes)?;
    if manifest.id != id || manifest.version != version {
        return Err(
            "The app's misty-app.json names a different id or version than the catalog.".into(),
        );
    }
    let needed: &[&String] = if require_logo {
        &[&manifest.entry, &manifest.logo]
    } else {
        &[&manifest.entry]
    };
    for file in needed {
        if !fs::is_file(staging.join(file)) {
            return Err(format!("The app is missing {file}."));
        }
    }
    Ok(manifest)
}

pub fn remove_all_versions(root: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("That isn't an app id.".into());
    }
    let dir = root.join(id);
    if fs::exists(&dir) {
        fs::remove_dir_all(&dir).map_err(|error| format!("Couldn't remove the app: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
