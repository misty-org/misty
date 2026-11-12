// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Pets: Codex-compatible v2 sprite-sheet packages, shown in a small always-on-top window that
//! follows what the person's agents are doing.
//!
//! A package is a `pet.json` and the spritesheet it names. Importing copies both into Misty's data
//! folder (`~/.misty/data/pets/<id>`); nothing ships built in. Which pet is shown, its size and
//! where it sits are this device's settings, kept in `misty.db` (`device:pet`), and never sync.

pub mod overlay;

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use file_access::fs;
use image::ImageDecoder as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::app::runtime::MistyRuntime;

const PETS_DIR: &str = "pets";
const MANIFEST_FILE: &str = "pet.json";
const ATLAS_WIDTH: u32 = 1536;
const ATLAS_HEIGHT: u32 = 2288;
const ATLAS_COLUMNS: u32 = 8;
const ATLAS_ROWS: u32 = 11;
const CELL_WIDTH: u32 = 192;
const CELL_HEIGHT: u32 = 208;
/// `pet.json` is a tiny manifest; anything larger is refused before it is parsed.
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
/// A 1536x2288 lossless webp atlas is a few MiB at most. The cap keeps a hostile package from
/// forcing a huge buffered decode.
const MAX_SPRITESHEET_BYTES: u64 = 64 * 1024 * 1024;
/// The settings scope this device keeps the pet's choices under.
const SETTINGS_SCOPE: &str = "device:pet";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetManifest {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    pub sprite_version_number: u32,
    pub spritesheet_path: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSummary {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub sprite_version_number: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPackage {
    #[serde(flatten)]
    pub summary: PetSummary,
    pub spritesheet_path: String,
    pub spritesheet_data_url: String,
    /// How many cells of each atlas row hold a frame, up to the last one that isn't transparent.
    /// Some valid Codex v2 rows use fewer than eight cells and must not animate into the padding.
    pub frame_counts: Vec<u8>,
}

/// Where the pet sits, in logical desktop points (its top-left corner, without the bubble).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct PetPosition {
    pub x: f64,
    pub y: f64,
}

/// This device's pet choices.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub pet_id: String,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default)]
    pub position: Option<PetPosition>,
}

fn default_scale() -> f64 {
    1.0
}

impl Default for PetSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            pet_id: String::new(),
            scale: default_scale(),
            position: None,
        }
    }
}

fn summary(manifest: &PetManifest) -> PetSummary {
    PetSummary {
        id: manifest.id.clone(),
        display_name: manifest.display_name.clone(),
        description: manifest.description.clone(),
        sprite_version_number: manifest.sprite_version_number,
    }
}

pub(crate) fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_lowercase() || first.is_ascii_digit())
        && (2..=64).contains(&id.len())
        && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn read_manifest(path: &Path) -> Result<PetManifest, String> {
    let size = fs::metadata(path)
        .map_err(|_| "This folder has no pet.json.".to_string())?
        .len();
    if size > MAX_MANIFEST_BYTES {
        return Err("This pet.json is too large.".to_string());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let manifest: PetManifest = serde_json::from_str(&content)
        .map_err(|error| format!("This pet.json can't be read: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PetManifest) -> Result<(), String> {
    if !valid_id(&manifest.id) {
        return Err(format!("“{}” isn't a valid pet id.", manifest.id));
    }
    if manifest.display_name.trim().is_empty() {
        return Err("This pet has no name.".to_string());
    }
    if manifest.sprite_version_number != 2 {
        return Err(format!(
            "Misty shows v2 pets; this one is version {}.",
            manifest.sprite_version_number
        ));
    }
    let path = Path::new(&manifest.spritesheet_path);
    // ParentDir covers ".."; RootDir and Prefix only parse on Windows ("\\foo", "C:foo") and would
    // let join() replace the target path there, so they are refused here too.
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(..)
            )
        })
        || path.file_name().is_none()
    {
        return Err("The spritesheet must be a file inside the pet's folder.".to_string());
    }
    Ok(())
}

fn imported_root() -> Result<PathBuf, String> {
    file_access::paths::misty_home_dir()
        .map(|home| home.join("data").join(PETS_DIR))
        .ok_or_else(|| "Misty's data folder is unavailable.".to_string())
}

fn package_dir(id: &str) -> Option<PathBuf> {
    if !valid_id(id) {
        return None;
    }
    let imported = imported_root().ok()?.join(id);
    fs::is_dir(&imported).then_some(imported)
}

/// The manifest and its spritesheet's real path, which must stay inside the package.
fn package_metadata(root: &Path) -> Result<(PetManifest, PathBuf), String> {
    let manifest_path = root.join(MANIFEST_FILE);
    let manifest = read_manifest(&manifest_path)?;
    let sprite = root.join(&manifest.spritesheet_path);
    let manifest_real = fs::canonicalize(&manifest_path).map_err(|error| error.to_string())?;
    let root_real = manifest_real
        .parent()
        .ok_or_else(|| "This pet has no folder.".to_string())?
        .to_path_buf();
    let sprite_real =
        fs::canonicalize(&sprite).map_err(|_| "This pet's spritesheet is missing.".to_string())?;
    if !sprite_real.starts_with(&root_real) {
        return Err("The spritesheet must be a file inside the pet's folder.".to_string());
    }
    if !fs::is_file(&sprite_real) {
        return Err("This pet's spritesheet is missing.".to_string());
    }
    Ok((manifest, sprite_real))
}

fn package_files(root: &Path) -> Result<(PetManifest, PathBuf, Vec<u8>, Vec<u8>), String> {
    let (manifest, sprite) = package_metadata(root)?;
    let (bytes, frame_counts) = validate_spritesheet(&sprite)?;
    Ok((manifest, sprite, bytes, frame_counts))
}

/// Checks a v2 atlas and counts each row's frames. Returns the file's bytes as read.
fn validate_spritesheet(path: &Path) -> Result<(Vec<u8>, Vec<u8>), String> {
    let size = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_SPRITESHEET_BYTES {
        return Err("This pet's spritesheet is too large.".to_string());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let reader = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|error| format!("This spritesheet can't be read: {error}"))?;
    // Read the dimensions from the header before decoding: a legal but huge image would otherwise
    // force a very large RGBA allocation.
    let decoder = reader
        .into_decoder()
        .map_err(|error| format!("This spritesheet can't be read: {error}"))?;
    let (width, height) = decoder.dimensions();
    if width != ATLAS_WIDTH || height != ATLAS_HEIGHT {
        return Err(format!(
            "A v2 spritesheet is {ATLAS_WIDTH}×{ATLAS_HEIGHT}; this one is {width}×{height}."
        ));
    }
    let image = image::DynamicImage::from_decoder(decoder)
        .map_err(|error| format!("This spritesheet can't be read: {error}"))?;
    if !image.color().has_alpha() {
        return Err("A v2 spritesheet needs a transparent background.".to_string());
    }
    let image = image.to_rgba8();
    let mut frame_counts = Vec::with_capacity(ATLAS_ROWS as usize);
    for row in 0..ATLAS_ROWS {
        let mut last_non_empty = 0u8;
        for column in 0..ATLAS_COLUMNS {
            let has_pixels = ((row * CELL_HEIGHT)..((row + 1) * CELL_HEIGHT)).any(|y| {
                ((column * CELL_WIDTH)..((column + 1) * CELL_WIDTH))
                    .any(|x| image.get_pixel(x, y).0[3] > 0)
            });
            if has_pixels {
                last_non_empty = (column + 1) as u8;
            }
        }
        frame_counts.push(last_non_empty.max(1));
    }
    Ok((bytes, frame_counts))
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "avif" => "image/avif",
        _ => "image/webp",
    }
}

fn list_from_root(root: &Path) -> Vec<PetSummary> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut rows = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| fs::is_dir(path))
        .filter_map(|path| {
            // Settings opens this list often. The manifest and paths are enough for the picker;
            // the whole atlas is decoded only when the chosen package is loaded.
            let (manifest, _) = package_metadata(&path).ok()?;
            Some(summary(&manifest))
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    rows
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

// ------------------------------------------------------------- settings ---

fn store(app: &AppHandle) -> database::store::Store {
    app.state::<MistyRuntime>().environment.store()
}

pub(crate) fn read_settings(app: &AppHandle) -> PetSettings {
    settings::profile_store::profile_state(&store(app), SETTINGS_SCOPE, None)
        .ok()
        .and_then(|snapshot| snapshot.state)
        .and_then(|state| serde_json::from_value(state).ok())
        .unwrap_or_default()
}

/// Changes this device's pet settings. Two windows can't overwrite each other: a write that lost
/// the race reads again and applies its change on top.
pub(crate) fn change_settings(
    app: &AppHandle,
    change: impl Fn(&mut PetSettings),
) -> Result<PetSettings, String> {
    let store = store(app);
    for _ in 0..4 {
        let snapshot = settings::profile_store::profile_state(&store, SETTINGS_SCOPE, None)
            .map_err(|error| error.to_string())?;
        let mut next: PetSettings = snapshot
            .state
            .and_then(|state| serde_json::from_value(state).ok())
            .unwrap_or_default();
        change(&mut next);
        let document = serde_json::to_value(&next).map_err(|error| error.to_string())?;
        match settings::profile_store::profile_state(
            &store,
            SETTINGS_SCOPE,
            Some((snapshot.revision, document)),
        ) {
            Ok(_) => return Ok(next),
            Err(error) if error.to_string().contains("SETTINGS_REVISION_CONFLICT") => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Pet settings changed elsewhere. Try again.".to_string())
}

// ------------------------------------------------------------- commands ---

/// The imported pets and this device's choices, for Settings.
#[tauri::command]
pub async fn pet_list(app: AppHandle) -> Result<Value, String> {
    let settings = read_settings(&app);
    let pets = blocking(|| Ok(list_from_root(&imported_root()?))).await?;
    Ok(json!({ "pets": pets, "settings": settings }))
}

/// This device's pet choices.
#[tauri::command]
pub fn pet_settings(app: AppHandle) -> PetSettings {
    read_settings(&app)
}

/// One package with its spritesheet, for the pet window to draw.
#[tauri::command]
pub async fn pet_get_package(id: String) -> Result<PetPackage, String> {
    blocking(move || {
        let root = package_dir(&id).ok_or_else(|| "This pet isn't imported.".to_string())?;
        let (manifest, sprite, bytes, frame_counts) = package_files(&root)?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(PetPackage {
            summary: summary(&manifest),
            spritesheet_path: manifest.spritesheet_path,
            spritesheet_data_url: format!("data:{};base64,{encoded}", mime_for(&sprite)),
            frame_counts,
        })
    })
    .await
}

/// Imports the pet folder the person picks in the system's dialog, and chooses it. `None` when
/// they cancel. The dialog runs here, so a window can't name a path of its own.
#[tauri::command]
pub async fn pet_import(app: AppHandle) -> Result<Option<PetSummary>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a pet folder")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let folder = folder
        .into_path()
        .map_err(|_| "Choose a folder on this computer.".to_string())?;
    let imported = blocking(move || import_from(&folder)).await?;
    let id = imported.id.clone();
    let settings = change_settings(&app, |settings| settings.pet_id = id.clone())?;
    if settings.enabled {
        overlay::reload(&app)?;
    }
    overlay::settings_changed(&app);
    Ok(Some(imported))
}

fn import_from(folder: &Path) -> Result<PetSummary, String> {
    // The person picked this folder in the system's dialog. Misty reads only the package's two
    // files from it: the manifest, then the spritesheet it names once that path is checked.
    let manifest_path = folder.join(MANIFEST_FILE);
    file_access::allow_picked_file(&manifest_path, file_access::Access::Read);
    let manifest = read_manifest(&manifest_path)?;
    file_access::allow_picked_file(
        &folder.join(&manifest.spritesheet_path),
        file_access::Access::Read,
    );
    let (manifest, _sprite, bytes, _) = package_files(folder)?;
    if package_dir(&manifest.id).is_some() {
        return Err(format!("A pet named “{}” is already imported.", manifest.id));
    }
    let destination = imported_root()?.join(&manifest.id);
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    let result = (|| {
        let text = fs::read(&manifest_path).map_err(|error| error.to_string())?;
        fs::write(destination.join(MANIFEST_FILE), text).map_err(|error| error.to_string())?;
        let target_sprite = destination.join(&manifest.spritesheet_path);
        if let Some(parent) = target_sprite.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(target_sprite, bytes).map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&destination);
        return Err(error);
    }
    Ok(summary(&manifest))
}

/// Removes an imported pet. When it was the chosen one, the pet is put away.
#[tauri::command]
pub async fn pet_remove(app: AppHandle, id: String) -> Result<(), String> {
    let removed = id.clone();
    blocking(move || {
        let root = package_dir(&removed).ok_or_else(|| "This pet isn't imported.".to_string())?;
        fs::remove_dir_all(root).map_err(|error| error.to_string())
    })
    .await?;
    let settings = read_settings(&app);
    if settings.pet_id == id {
        change_settings(&app, |settings| {
            settings.pet_id.clear();
            settings.enabled = false;
        })?;
        overlay::set_visible(&app, false)?;
    }
    overlay::settings_changed(&app);
    Ok(())
}

/// Chooses which imported pet is shown, and shows it again if it's on.
#[tauri::command]
pub async fn pet_select(app: AppHandle, id: String) -> Result<PetSettings, String> {
    if package_dir(&id).is_none() {
        return Err("This pet isn't imported.".to_string());
    }
    let settings = change_settings(&app, |settings| settings.pet_id = id.clone())?;
    if settings.enabled {
        overlay::reload(&app)?;
    }
    overlay::settings_changed(&app);
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> PetManifest {
        PetManifest {
            id: "codex-pet".to_string(),
            display_name: "Big cat".to_string(),
            description: String::new(),
            sprite_version_number: 2,
            spritesheet_path: "spritesheet.webp".to_string(),
            extra: BTreeMap::new(),
        }
    }

    #[test]
    fn validates_v2_ids_and_paths() {
        assert!(valid_id("codex-pet"));
        assert!(!valid_id("../pet"));
        assert!(!valid_id("BigCat"));
        assert!(validate_manifest(&manifest()).is_ok());
        assert!(validate_manifest(&PetManifest {
            spritesheet_path: "../outside.webp".to_string(),
            ..manifest()
        })
        .is_err());
        assert!(validate_manifest(&PetManifest {
            spritesheet_path: "/abs/outside.webp".to_string(),
            ..manifest()
        })
        .is_err());
        assert!(validate_manifest(&PetManifest {
            sprite_version_number: 1,
            ..manifest()
        })
        .is_err());
    }

    /// Windows-only component classes: "C:foo" parses with a Prefix and "\\foo" with a RootDir,
    /// and neither is caught by ParentDir.
    #[cfg(windows)]
    #[test]
    fn rejects_windows_prefix_and_root_components() {
        assert!(validate_manifest(&PetManifest {
            spritesheet_path: "C:evil.webp".to_string(),
            ..manifest()
        })
        .is_err());
        assert!(validate_manifest(&PetManifest {
            spritesheet_path: "\\evil.webp".to_string(),
            ..manifest()
        })
        .is_err());
    }

    #[test]
    fn a_missing_folder_lists_nothing() {
        assert!(list_from_root(Path::new("this-directory-does-not-exist")).is_empty());
    }
}
