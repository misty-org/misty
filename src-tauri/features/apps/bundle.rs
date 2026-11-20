//! App bundles on disk. Misty makes no apps of its own: every app is an open-source maker's release, kept in
//! `<data>/apps/<id>/<version>/`. A downloaded bundle is checked against its pinned hash before a single file of
//! it is written, and unpacked into a staging folder that only becomes the bundle when all of it is valid.
//! `misty-app.json` is at the bundle's top.

use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use file_access::fs;
use sha2::{Digest, Sha256};

use super::manifest::{safe_relative, valid_id, valid_version, AppManifest};

pub const MANIFEST_FILE: &str = "misty-app.json";
/// The most a bundle may unpack to, and the most one file of it may be. WebGPU apps carry large wasm.
const MAX_UNPACKED_BYTES: u64 = 512 << 20;
const MAX_ENTRIES: usize = 20_000;
const MAX_MANIFEST_BYTES: u64 = 64 << 10;

/// A folder tests keep bundles in instead of Misty's own.
#[cfg(test)]
pub static TEST_CACHE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// Misty's folder for app bundles.
pub fn cache_root() -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(dir) = TEST_CACHE.lock().map_err(|error| error.to_string())?.clone() {
        return Ok(dir);
    }
    file_access::paths::misty_home_dir()
        .map(|home| home.join("apps"))
        .ok_or_else(|| "Misty has no data folder to keep apps in.".to_owned())
}

/// Where one version of an app lives. The id and version are checked, so they are one path part each.
pub fn bundle_dir(root: &Path, id: &str, version: &str) -> Result<PathBuf, String> {
    if !valid_id(id) || !valid_version(version) {
        return Err("That isn't an app id and version.".into());
    }
    Ok(root.join(id).join(version))
}

/// Where an app version's files are in the cache.
pub fn locate(id: &str, version: &str) -> Result<PathBuf, String> {
    bundle_dir(&cache_root()?, id, version)
}

/// The manifest in a bundle's folder, `None` when there isn't one, and an error when it is damaged or names
/// another app or version.
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

/// The manifest of an app that is here: `None` when a third-party version isn't on this computer yet.
pub fn installed_manifest(id: &str, version: &str) -> Result<Option<AppManifest>, String> {
    manifest_in(&locate(id, version)?, id, version)
}

pub fn read_manifest(id: &str, version: &str) -> Result<AppManifest, String> {
    installed_manifest(id, version)?.ok_or_else(|| "That app isn't installed on this computer.".to_owned())
}

#[derive(Debug, PartialEq, Eq)]
pub enum FileError {
    Invalid,
    NotFound,
}

/// A file of a bundle, for the scheme to serve. The path is only plain parts, and after links are followed
/// it must still be inside the bundle.
pub fn resolve_file_in(dir: &Path, relative: &str) -> Result<PathBuf, FileError> {
    if !safe_relative(relative) {
        return Err(FileError::Invalid);
    }
    let path = dir.join(relative);
    if !path.components().skip(dir.components().count()).all(|part| matches!(part, Component::Normal(_))) {
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

/// What Misty adds around a maker's own release when it installs it, so the release can be used as the maker
/// published it, without Misty keeping or rebuilding a copy: the manifest, and files copied beside others.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Wrap {
    /// The manifest's fields besides `id` and `version`, which the install fills in.
    pub manifest: serde_json::Value,
    /// A copy added where the release's own layout leaves a file out of reach of the file that imports it. A copy is
    /// made only when its source is there and its target is not, so nothing the release holds is changed.
    #[serde(default)]
    pub add_copies: Vec<AddCopy>,
    /// The release holds everything in one top folder (`photocraft-web-0.23.1/`), whose contents are the bundle.
    #[serde(default)]
    pub strip_top: bool,
    /// The release's layout isn't known ahead (an app added by its link alone): a single top folder, when there is
    /// one, is stripped, and a release with its files at the top is taken as it is.
    #[serde(default)]
    pub auto_top: bool,
    /// Files Misty adds beside the release, such as an adapter script from misty-apps that gives the app its tools
    /// (`mcp: adapter`). They go only under `misty/`, never over a file of the release.
    #[serde(default)]
    pub add_files: Vec<AddFile>,
}

/// A file Misty writes into a wrapped release.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AddFile {
    pub path: String,
    pub content: String,
}

/// The most the files Misty adds to a release may be, all together.
const MAX_ADDED_BYTES: usize = 256 << 10;

/// How the zip's top folder is treated.
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

/// Installs a bundle that already has its `misty-app.json`. `sha256` is the catalog's hash of the zip; nothing is
/// unpacked unless it matches. The manifest must name this id and version.
pub fn install_zip(
    root: &Path,
    id: &str,
    version: &str,
    zip_bytes: &[u8],
    sha256: &str,
) -> Result<AppManifest, String> {
    install_with(root, id, version, zip_bytes, sha256, None)
}

/// Installs a maker's own release: its zip as published, `sha256` being the hash of that zip as the maker
/// released it, with Misty's wrapper (`Wrap`) added around it.
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
        return Err("The downloaded app doesn't match the catalog's checksum, so it wasn't installed.".into());
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

/// Adds what the wrapper says to the unpacked release: its copies, then its manifest.
fn add_wrapper(staging: &Path, id: &str, version: &str, wrap: &Wrap) -> Result<(), String> {
    for copy in &wrap.add_copies {
        if !safe_relative(&copy.from) || !safe_relative(&copy.to) {
            return Err("A copy the catalog asks for names a path that leaves the app's folder.".into());
        }
        let (from, to) = (staging.join(&copy.from), staging.join(&copy.to));
        if !fs::exists(&from) || fs::exists(&to) {
            continue;
        }
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("Couldn't save the app: {error}"))?;
        }
        fs::copy_tree(&from, &to).map_err(|error| format!("Couldn't save the app: {error}"))?;
    }
    let added: usize = wrap.add_files.iter().map(|file| file.content.len()).sum();
    if added > MAX_ADDED_BYTES {
        return Err("The files Misty adds to the app are too large.".into());
    }
    for file in &wrap.add_files {
        if !safe_relative(&file.path) || !file.path.starts_with("misty/") || !file.path.ends_with(".js") {
            return Err("A file Misty adds to an app is a script under misty/.".into());
        }
        let target = staging.join(&file.path);
        if fs::exists(&target) {
            return Err("The release already has a file where Misty adds one.".into());
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("Couldn't save the app: {error}"))?;
        }
        fs::write(&target, file.content.as_bytes()).map_err(|error| format!("Couldn't save the app: {error}"))?;
    }
    if fs::exists(staging.join(MANIFEST_FILE)) {
        return Err("The release already has a misty-app.json, which Misty adds.".into());
    }
    let mut manifest = wrap.manifest.clone();
    let fields = manifest.as_object_mut().ok_or_else(|| "The catalog's manifest isn't an object.".to_owned())?;
    fields.insert("id".into(), id.into());
    fields.insert("version".into(), version.into());
    let text = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(staging.join(MANIFEST_FILE), text).map_err(|error| format!("Couldn't save the app: {error}"))
}

fn unpack(staging: &Path, zip_bytes: &[u8], top: Top) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(|_| "The app's download isn't a zip file.".to_owned())?;
    if archive.len() > MAX_ENTRIES {
        return Err("The app has too many files.".into());
    }
    // A release with everything in one top folder has that folder's contents as the bundle.
    let top = match top {
        Top::Keep => None,
        Top::Strip => single_top_folder(&mut archive)?,
        Top::StripIfOne => single_top_folder(&mut archive).ok().flatten(),
    };
    fs::create_dir_all(staging).map_err(|error| format!("Couldn't save the app: {error}"))?;
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| "The app's zip is damaged.".to_owned())?;
        if entry.is_symlink() {
            return Err("The app's zip holds a link, which a bundle may not.".into());
        }
        let full = entry.name().trim_end_matches('/').to_owned();
        let name = match &top {
            Some(folder) => match full.strip_prefix(folder.as_str()).and_then(|rest| rest.strip_prefix('/')) {
                Some(rest) => rest.to_owned(),
                // The folder entry itself.
                None => continue,
            },
            None => full,
        };
        if !safe_relative(&name) {
            return Err("The app's zip holds a path that leaves its folder.".into());
        }
        let target = staging.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| format!("Couldn't save the app: {error}"))?;
            continue;
        }
        // Read at most what is left of the budget, plus one byte to notice going over.
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
            fs::create_dir_all(parent).map_err(|error| format!("Couldn't save the app: {error}"))?;
        }
        fs::write(&target, &data).map_err(|error| format!("Couldn't save the app: {error}"))?;
    }
    Ok(())
}

/// The one folder every entry of a zip is in, or an error when the release isn't laid out that way.
fn single_top_folder(archive: &mut zip::ZipArchive<Cursor<&[u8]>>) -> Result<Option<String>, String> {
    let mut top: Option<String> = None;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| "The app's zip is damaged.".to_owned())?;
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

/// The staged folder holds a valid manifest for this id and version, and the files it points at.
fn check_staged(staging: &Path, id: &str, version: &str, require_logo: bool) -> Result<AppManifest, String> {
    let bytes = fs::read(staging.join(MANIFEST_FILE)).map_err(|_| "The app has no misty-app.json.".to_owned())?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("The app's misty-app.json is too large.".into());
    }
    let manifest = AppManifest::parse(&bytes)?;
    if manifest.id != id || manifest.version != version {
        return Err("The app's misty-app.json names a different id or version than the catalog.".into());
    }
    // A maker's own release has its icon on the catalog's side, so only a bundle that carries its logo is held to it.
    let needed: &[&String] = if require_logo { &[&manifest.entry, &manifest.logo] } else { &[&manifest.entry] };
    for file in needed {
        if !fs::is_file(staging.join(file)) {
            return Err(format!("The app is missing {file}."));
        }
    }
    Ok(manifest)
}

/// Removes every cached version of an app. A Space's files are never in here.
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
mod tests {
    use std::io::Write;

    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("misty-apps-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn manifest_json(id: &str, version: &str) -> String {
        format!(
            r#"{{"id":"{id}","name":"Demo","version":"{version}","logo":"logo.svg","entry":"index.html","permissions":["files"]}}"#
        )
    }

    fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in files {
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn good_zip(id: &str, version: &str) -> Vec<u8> {
        let manifest = manifest_json(id, version);
        zip_of(&[
            (MANIFEST_FILE, manifest.as_bytes()),
            ("index.html", b"<html></html>"),
            ("logo.svg", b"<svg/>"),
            ("assets/app.js", b"1"),
        ])
    }

    /// Whether a third-party version is in the cache.
    fn installed(root: &Path, id: &str, version: &str) -> bool {
        bundle_dir(root, id, version)
            .ok()
            .is_some_and(|dir| matches!(manifest_in(&dir, id, version), Ok(Some(_))))
    }

    fn file(root: &Path, id: &str, version: &str, relative: &str) -> Result<PathBuf, FileError> {
        let dir = bundle_dir(root, id, version).map_err(|_| FileError::Invalid)?;
        resolve_file_in(&dir, relative)
    }

    #[test]
    fn a_matching_zip_installs_and_serves_only_its_own_files() {
        let root = temp_root("install");
        let bytes = good_zip("demo", "1.0.0");
        let manifest = install_zip(&root, "demo", "1.0.0", &bytes, &sha256_hex(&bytes)).unwrap();
        assert_eq!(manifest.name, "Demo");
        assert!(installed(&root, "demo", "1.0.0"));
        assert!(file(&root, "demo", "1.0.0", "assets/app.js").is_ok());
        assert_eq!(file(&root, "demo", "1.0.0", "nope.js"), Err(FileError::NotFound));
        assert_eq!(file(&root, "demo", "1.0.0", "../1.0.0/index.html"), Err(FileError::Invalid));
        assert_eq!(file(&root, "../demo", "1.0.0", "index.html"), Err(FileError::Invalid));
        // Reinstalling replaces the folder.
        install_zip(&root, "demo", "1.0.0", &bytes, &sha256_hex(&bytes).to_uppercase()).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_wrong_checksum_or_name_installs_nothing() {
        let root = temp_root("refuse");
        let bytes = good_zip("demo", "1.0.0");
        assert!(install_zip(&root, "demo", "1.0.0", &bytes, &"0".repeat(64)).is_err());
        assert!(install_zip(&root, "other", "1.0.0", &bytes, &sha256_hex(&bytes)).is_err());
        assert!(install_zip(&root, "demo", "2.0.0", &bytes, &sha256_hex(&bytes)).is_err());
        assert!(!installed(&root, "demo", "1.0.0"));
        // Nothing is left in staging.
        let leftovers: Vec<_> = std::fs::read_dir(&root).unwrap().flatten().collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_zip_that_leaves_its_folder_or_lacks_its_files_is_refused() {
        let root = temp_root("hostile");
        let manifest = manifest_json("demo", "1.0.0");
        for files in [
            vec![(MANIFEST_FILE, manifest.as_bytes()), ("index.html", b"x"), ("logo.svg", b"x"), ("../evil", b"x")],
            vec![(MANIFEST_FILE, manifest.as_bytes()), ("index.html", b"x")],
            vec![("index.html", b"x"), ("logo.svg", b"x")],
        ] {
            let bytes = zip_of(&files);
            assert!(install_zip(&root, "demo", "1.0.0", &bytes, &sha256_hex(&bytes)).is_err());
        }
        assert!(!installed(&root, "demo", "1.0.0"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn vendor_zip(top: Option<&str>, files: &[(&str, &[u8])]) -> Vec<u8> {
        let prefix = top.map(|folder| format!("{folder}/")).unwrap_or_default();
        let named: Vec<(String, &[u8])> = files.iter().map(|(name, data)| (format!("{prefix}{name}"), *data)).collect();
        let refs: Vec<(&str, &[u8])> = named.iter().map(|(name, data)| (name.as_str(), *data)).collect();
        zip_of(&refs)
    }

    fn wrap(strip_top: bool, copies: &[(&str, &str)]) -> Wrap {
        Wrap {
            manifest: serde_json::json!({
                "name": "Demo", "logo": "logo.png", "entry": "index.html", "permissions": ["files"],
                "own_origin": true, "inline_scripts": true, "shim": true
            }),
            add_copies: copies.iter().map(|(from, to)| AddCopy { from: (*from).into(), to: (*to).into() }).collect(),
            strip_top,
            auto_top: false,
            add_files: Vec::new(),
        }
    }

    #[test]
    fn an_adapter_is_added_under_misty_and_never_over_the_release() {
        let root = temp_root("adapter");
        let zip = vendor_zip(None, &[("index.html", b"<html>")]);
        let with = |path: &str| Wrap {
            add_files: vec![AddFile { path: path.into(), content: "window.mistyAdapter = {};".into() }],
            ..wrap(false, &[])
        };
        install_wrapped(&root, "demo", "1.0.0", &zip, &sha256_hex(&zip), &with("misty/adapter.js")).unwrap();
        assert!(bundle_dir(&root, "demo", "1.0.0").unwrap().join("misty/adapter.js").exists());
        for bad in ["adapter.js", "misty/../index.html", "misty/a.html", "index.html"] {
            assert!(install_wrapped(&root, "demo", "2.0.0", &zip, &sha256_hex(&zip), &with(bad)).is_err(), "{bad}");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_release_of_unknown_layout_is_taken_with_or_without_its_top_folder() {
        let root = temp_root("auto-top");
        let auto = Wrap { strip_top: false, auto_top: true, ..wrap(false, &[]) };
        let nested = vendor_zip(Some("demo-web"), &[("index.html", b"<html>")]);
        let flat = vendor_zip(None, &[("index.html", b"<html>")]);
        install_wrapped(&root, "demo", "1.0.0", &nested, &sha256_hex(&nested), &auto).unwrap();
        install_wrapped(&root, "demo", "2.0.0", &flat, &sha256_hex(&flat), &auto).unwrap();
        assert!(bundle_dir(&root, "demo", "1.0.0").unwrap().join("index.html").exists());
        assert!(bundle_dir(&root, "demo", "2.0.0").unwrap().join("index.html").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_makers_release_is_installed_as_published_with_only_the_wrapper_added() {
        let root = temp_root("wrapped");
        let bytes = vendor_zip(
            Some("demo-web-1.0.0"),
            &[("index.html", b"<html/>"), ("app/glue.js", b"g"), ("snippets/s.js", b"s"), ("LICENSE-MIT", b"mit")],
        );
        let sum = sha256_hex(&bytes);
        let manifest =
            install_wrapped(&root, "demo", "1.0.0", &bytes, &sum, &wrap(true, &[("snippets", "app/snippets")])).unwrap();
        assert_eq!((manifest.id.as_str(), manifest.version.as_str()), ("demo", "1.0.0"));
        assert!(manifest.own_origin && manifest.inline_scripts && manifest.shim);
        let dir = bundle_dir(&root, "demo", "1.0.0").unwrap();
        // The top folder is the bundle's root, the release's files are as they were, and the copy sits beside the glue.
        assert_eq!(std::fs::read(dir.join("index.html")).unwrap(), b"<html/>");
        assert_eq!(std::fs::read(dir.join("snippets/s.js")).unwrap(), b"s");
        assert_eq!(std::fs::read(dir.join("app/snippets/s.js")).unwrap(), b"s");
        assert!(dir.join("LICENSE-MIT").is_file() && dir.join(MANIFEST_FILE).is_file());
        // The checksum is of the maker's zip: a different one installs nothing.
        assert!(install_wrapped(&root, "other", "1.0.0", &bytes, &"0".repeat(64), &wrap(true, &[])).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_wrapped_release_that_doesnt_fit_the_wrapper_installs_nothing() {
        let root = temp_root("wrapped-refuse");
        let try_install = |bytes: Vec<u8>, wrap: Wrap| {
            let sum = sha256_hex(&bytes);
            install_wrapped(&root, "demo", "1.0.0", &bytes, &sum, &wrap)
        };
        // Files in two folders, or none, aren't one top folder.
        assert!(try_install(zip_of(&[("a/index.html", b"x"), ("b/other.js", b"x")]), wrap(true, &[])).is_err());
        assert!(try_install(zip_of(&[("index.html", b"x")]), wrap(true, &[])).is_err());
        // A copy that climbs out, a release with its own manifest, and a missing entry page are refused.
        assert!(try_install(vendor_zip(Some("d"), &[("index.html", b"x")]), wrap(true, &[("../x", "y")])).is_err());
        assert!(try_install(vendor_zip(None, &[("index.html", b"x"), (MANIFEST_FILE, b"{}")]), wrap(false, &[])).is_err());
        assert!(try_install(vendor_zip(Some("d"), &[("other.html", b"x")]), wrap(true, &[])).is_err());
        assert!(!installed(&root, "demo", "1.0.0"));
        let leftovers: Vec<_> = std::fs::read_dir(&root).unwrap().flatten().collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// A maker's real release with its catalog entry: `MISTY_TEST_VENDOR_ZIP=<zip> MISTY_TEST_CATALOG=<catalog.json>
    /// MISTY_TEST_APP=<id> cargo test --lib real_vendor -- --ignored`. It is installed from the maker's own checksum.
    #[test]
    #[ignore = "needs a downloaded release"]
    fn a_real_vendor_release_installs_from_its_catalog_entry() {
        let (Ok(zip), Ok(catalog), Ok(id)) = (
            std::env::var("MISTY_TEST_VENDOR_ZIP"),
            std::env::var("MISTY_TEST_CATALOG"),
            std::env::var("MISTY_TEST_APP"),
        ) else {
            panic!("set MISTY_TEST_VENDOR_ZIP, MISTY_TEST_CATALOG and MISTY_TEST_APP");
        };
        let catalog: serde_json::Value = serde_json::from_slice(&std::fs::read(catalog).unwrap()).unwrap();
        let entry = catalog["apps"].as_array().unwrap().iter().find(|app| app["id"] == id).expect("app in catalog");
        let wrap: Wrap = serde_json::from_value(serde_json::json!({
            "manifest": entry["manifest"], "add_copies": entry["add_copies"], "strip_top": entry["strip_top"]
        }))
        .unwrap();
        let version = entry["version"].as_str().unwrap();
        let bytes = std::fs::read(zip).unwrap();
        let root = temp_root("real");
        let manifest = install_wrapped(&root, &id, version, &bytes, entry["sha256"].as_str().unwrap(), &wrap).unwrap();
        let dir = bundle_dir(&root, &id, version).unwrap();
        assert!(resolve_file_in(&dir, &manifest.entry).is_ok());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
