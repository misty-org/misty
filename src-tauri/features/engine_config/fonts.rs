// Interface and code fonts for Settings › Interface › Fonts. The choice is kept on this computer
// (`misty.db`). A font file the person picks is copied into Misty's own folder, so it is still
// there, and still readable through the file gate, the next time Misty starts; the window reads its
// bytes from here and registers them with the FontFace API.
//
// Only real font files pass: the dialog's filter is a hint, and a renamed file has to fail here
// with a stable code instead of as a CSS parse error far from the picker.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use super::support;

/// The ceiling for one font file. Large CJK families with several weights reach about 30 MB;
/// past this it is a mistake (or not a font), and the bytes cross IPC base64-encoded.
const MAX_FONT_BYTES: u64 = 64 * 1024 * 1024;

/// SFNT, TrueType and OpenType collections and the WOFF containers. The first four bytes are the
/// format tag, so a wrong extension can't sneak a non-font through.
const FONT_MAGICS: [&[u8; 4]; 7] = [
    b"\x00\x01\x00\x00", // TrueType outlines (also variable fonts)
    b"\x00\x00\x01\x00", // Apple's legacy TrueType tag
    b"OTTO",             // CFF-based OpenType
    b"ttcf",             // TrueType / OpenType collection
    b"true",             // legacy Apple TrueType
    b"wOFF",             // WOFF
    b"wOF2",             // WOFF2
];

const FONT_EXTENSIONS: [&str; 5] = ["ttf", "otf", "ttc", "woff", "woff2"];

const VALUE_KEY: &str = "fonts";

/// What each font row is set to. An empty family keeps Misty's own font, `custom` uses the file
/// picked for that row, and anything else is a CSS font-family list.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct FontPreferences {
    pub font_family: String,
    pub code_font_family: String,
    pub font_file: String,
    pub code_font_file: String,
}

fn fonts_dir() -> PathBuf {
    support::app_home().join("fonts")
}

/// Reads one font file, base64-encoded. Errors are stable codes the settings page words
/// (`fontErrorMessage` in the window).
pub fn read_font_file(path: &Path) -> Result<String, String> {
    let meta = file_access::fs::metadata(path).map_err(|_| "font.err.read_failed".to_string())?;
    if !meta.is_file() {
        return Err("font.err.read_failed".to_string());
    }
    if meta.len() > MAX_FONT_BYTES {
        return Err("font.err.too_large".to_string());
    }
    let bytes = file_access::fs::read(path).map_err(|_| "font.err.read_failed".to_string())?;
    if !looks_like_font(&bytes) {
        return Err("font.err.unsupported".to_string());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn looks_like_font(bytes: &[u8]) -> bool {
    FONT_MAGICS
        .iter()
        .any(|magic| bytes.starts_with(&magic[..]))
}

/// Copies a picked font into Misty's fonts folder as `<role>.<ext>` and returns where it went.
/// The file is checked first, so a non-font never replaces the saved one.
fn adopt_font_file(source: &Path, role: &str) -> Result<PathBuf, String> {
    read_font_file(source)?;
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|ext| FONT_EXTENSIONS.contains(&ext.as_str()))
        .unwrap_or_else(|| "ttf".to_string());
    let dir = fonts_dir();
    file_access::fs::create_dir_all(&dir).map_err(|_| "font.err.read_failed".to_string())?;
    // Older copies for this row go, whatever their extension.
    if let Ok(entries) = file_access::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_stem().and_then(|stem| stem.to_str()) == Some(role) {
                let _ = file_access::fs::remove_file(&path);
            }
        }
    }
    let target = dir.join(format!("{role}.{extension}"));
    file_access::fs::copy(source, &target).map_err(|_| "font.err.read_failed".to_string())?;
    Ok(target)
}

/// Only files in Misty's own fonts folder are read for a window.
fn ensure_in_fonts_dir(path: &Path) -> Result<PathBuf, String> {
    let dir = file_access::fs::canonicalize(fonts_dir()).map_err(|_| "font.err.read_failed")?;
    let real = file_access::fs::canonicalize(path).map_err(|_| "font.err.read_failed")?;
    if real.starts_with(&dir) {
        Ok(real)
    } else {
        Err("font.err.read_failed".to_string())
    }
}

fn normalize_role(role: &str) -> Result<&'static str, String> {
    match role {
        "ui" => Ok("ui"),
        "code" => Ok("code"),
        _ => Err("Unknown font row.".to_string()),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// The saved font choices.
#[tauri::command]
pub async fn engine_fonts_get() -> Result<FontPreferences, String> {
    blocking(|| Ok(support::load_value::<FontPreferences>(VALUE_KEY)?.unwrap_or_default())).await
}

/// Saves the font choices and returns them as stored.
#[tauri::command]
pub async fn engine_fonts_set(preferences: FontPreferences) -> Result<FontPreferences, String> {
    blocking(move || {
        let clean = |value: &str| value.trim().chars().take(400).collect::<String>();
        let stored = FontPreferences {
            font_family: clean(&preferences.font_family),
            code_font_family: clean(&preferences.code_font_family),
            font_file: clean(&preferences.font_file),
            code_font_file: clean(&preferences.code_font_file),
        };
        support::save_value(VALUE_KEY, &stored)?;
        Ok(stored)
    })
    .await
}

/// Asks for a font file with the system's dialog, shown from here so a window can't name a path
/// of its own, and copies it into Misty's fonts folder for `role` (`ui` or `code`). Returns the
/// copy's path, or `None` when the person cancels.
#[tauri::command]
pub async fn engine_fonts_pick(
    app: tauri::AppHandle,
    role: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let role = normalize_role(&role)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a font file")
        .add_filter("Font files", &FONT_EXTENSIONS)
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let path: PathBuf = file
        .into_path()
        .map_err(|_| "Choose a font on this computer.".to_string())?;
    file_access::allow_picked_file(&path, file_access::Access::Read);
    blocking(move || {
        adopt_font_file(&path, role).map(|target| Some(target.to_string_lossy().into_owned()))
    })
    .await
}

/// A saved font file's bytes, base64-encoded.
#[tauri::command]
pub async fn engine_fonts_read(path: String) -> Result<String, String> {
    blocking(move || {
        let path = ensure_in_fonts_dir(Path::new(&path))?;
        read_font_file(&path)
    })
    .await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods, clippy::disallowed_types)]
    use std::io::Write;

    use super::*;

    /// A scratch file in the temp folder, removed on drop.
    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "misty-font-test-{}-{}",
                std::process::id(),
                name
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir.join("font.bin"))
        }

        fn dir(&self) -> &Path {
            self.0.parent().unwrap()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.dir());
        }
    }

    #[test]
    fn reads_a_real_font_header_as_base64() {
        let scratch = Scratch::new("read");
        let mut file = std::fs::File::create(&scratch.0).unwrap();
        file.write_all(b"\x00\x01\x00\x00").unwrap();
        file.write_all(&[0u8; 32]).unwrap();
        drop(file);
        let encoded = read_font_file(&scratch.0).unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        assert_eq!(decoded.len(), 36);
        assert_eq!(&decoded[..4], b"\x00\x01\x00\x00");
    }

    #[test]
    fn rejects_a_file_that_is_not_a_font() {
        let scratch = Scratch::new("text");
        std::fs::write(&scratch.0, b"plain text, not a font").unwrap();
        assert_eq!(
            read_font_file(&scratch.0).unwrap_err(),
            "font.err.unsupported"
        );
    }

    #[test]
    fn rejects_missing_files_with_a_stable_code() {
        let scratch = Scratch::new("missing");
        assert_eq!(
            read_font_file(&scratch.0).unwrap_err(),
            "font.err.read_failed"
        );
    }

    #[test]
    fn rejects_files_over_the_size_cap_before_reading() {
        let scratch = Scratch::new("large");
        // A sparse file: only the length matters, no bytes land on disk.
        let file = std::fs::File::create(&scratch.0).unwrap();
        file.set_len(MAX_FONT_BYTES + 1).unwrap();
        drop(file);
        assert_eq!(
            read_font_file(&scratch.0).unwrap_err(),
            "font.err.too_large"
        );
    }

    #[test]
    fn woff_and_collection_magics_pass() {
        assert!(looks_like_font(b"wOF2rest"));
        assert!(looks_like_font(b"wOFFrest"));
        assert!(looks_like_font(b"ttcfrest"));
        assert!(looks_like_font(b"OTTOrest"));
        assert!(!looks_like_font(b"OT"));
    }

    #[test]
    fn a_picked_font_is_copied_per_row_and_only_copies_are_read() {
        let scratch = Scratch::new("adopt");
        let _home = support::TestHome::set(scratch.dir());
        let source = scratch.dir().join("Mono.WOFF2");
        std::fs::write(&source, b"wOF2 font bytes").unwrap();
        let copy = adopt_font_file(&source, "code").unwrap();
        assert_eq!(copy.file_name().unwrap(), "code.woff2");
        assert!(ensure_in_fonts_dir(&copy).is_ok());
        assert!(ensure_in_fonts_dir(&source).is_err());
        // A new pick replaces the row's old copy whatever its extension.
        let other = scratch.dir().join("Mono.ttf");
        std::fs::write(&other, b"\x00\x01\x00\x00rest").unwrap();
        let replaced = adopt_font_file(&other, "code").unwrap();
        assert_eq!(replaced.file_name().unwrap(), "code.ttf");
        assert!(!copy.exists());
        // A non-font never replaces the saved one.
        let text = scratch.dir().join("notes.ttf");
        std::fs::write(&text, b"not a font").unwrap();
        assert_eq!(
            adopt_font_file(&text, "code").unwrap_err(),
            "font.err.unsupported"
        );
        assert!(replaced.exists());
    }

    #[test]
    fn preferences_round_trip_through_the_device_store() {
        let scratch = Scratch::new("prefs");
        let _home = support::TestHome::set(scratch.dir());
        let preferences = FontPreferences {
            font_family: "\"Inter\"".into(),
            code_font_family: "custom".into(),
            font_file: String::new(),
            code_font_file: "/x/code.ttf".into(),
        };
        support::save_value(VALUE_KEY, &preferences).unwrap();
        assert_eq!(
            support::load_value::<FontPreferences>(VALUE_KEY).unwrap(),
            Some(preferences)
        );
    }
}
