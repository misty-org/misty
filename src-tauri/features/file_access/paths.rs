use std::{env, path::PathBuf};

pub fn misty_data_root() -> Option<PathBuf> {
    resolve_desktop_home_dir()
}

pub fn misty_home_dir() -> Option<PathBuf> {
    misty_data_root().map(|root| root.join(".misty"))
}

fn resolve_desktop_home_dir() -> Option<PathBuf> {
    env::var_os("MISTY_DATA_ROOT")
        .or_else(|| env::var_os("HOME"))
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Points every home-folder lookup at a fresh temporary folder, so tests never reach the person's real
/// data, the credential store included. Each test binary calls it once, before anything else runs.
#[allow(clippy::disallowed_methods)] // It runs before anything else, and only in tests.
pub fn isolate_for_tests() {
    let home = env::temp_dir().join(format!("misty-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&home);
    let home = std::fs::canonicalize(&home).unwrap_or(home);
    unsafe {
        env::set_var("HOME", &home);
        env::set_var("USERPROFILE", &home);
        env::remove_var("MISTY_DATA_ROOT");
    }
}
