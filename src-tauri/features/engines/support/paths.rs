// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/paths.rs: where the engine layer keeps its own files. In Misty that is a folder
// inside Misty's data root (`~/.misty/engines`), set once at startup; structured data lives in
// misty.db instead of ccgui's own database file.

use std::path::PathBuf;
use std::sync::OnceLock;

static ENGINES_HOME: OnceLock<PathBuf> = OnceLock::new();

/// Points the engine layer at Misty's data root. Called once while the app starts.
pub fn init(misty_dir: &std::path::Path) {
    let _ = ENGINES_HOME.set(misty_dir.join("engines"));
}

/// Home dir without panicking: a headless/odd environment falls back to the
/// current directory so startup degrades instead of crashing.
///
/// Tests steer it through HOME / USERPROFILE, because `dirs` ignores the
/// environment on Windows and would read the real profile.
pub(crate) fn home_dir() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(home);
        }
        #[cfg(windows)]
        if let Some(profile) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
            return PathBuf::from(profile);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// Serialize tests that steer process-global HOME / USERPROFILE (read by the
/// cfg(test) branch above): every HOME-mutating test across the crate holds this one lock.
#[cfg(test)]
pub(crate) static HOME_ENV_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// The engine layer's own folder: staging files, pasted images, host credentials.
pub fn app_home() -> PathBuf {
    #[cfg(test)]
    {
        return home_dir().join(".misty").join("engines");
    }
    #[allow(unreachable_code)]
    ENGINES_HOME
        .get()
        .cloned()
        .unwrap_or_else(|| home_dir().join(".misty").join("engines"))
}

/// desktop-cc-gui's own home. Its sessions are listed for import like any CLI's.
pub fn legacy_home() -> PathBuf {
    home_dir().join(".ccgui")
}

pub fn ensure_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(app_home())
}
