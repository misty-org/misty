use std::{env, path::PathBuf};

pub fn misty_data_root() -> Option<PathBuf> {
    resolve_desktop_home_dir()
}

pub fn misty_home_dir() -> Option<PathBuf> {
    misty_data_root().map(|root| root.join(".misty"))
}

fn resolve_desktop_home_dir() -> Option<PathBuf> {
    env::var_os("MISTY_DESKTOP_DATA_ROOT")
        .or_else(|| env::var_os("MISTY_DATA_ROOT"))
        .or_else(|| env::var_os("HOME"))
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

