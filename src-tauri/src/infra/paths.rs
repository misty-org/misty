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

/// Tests never reach the person's real data, whatever they exercise: everything that looks for a
/// home folder finds this one, the credential store included.
#[cfg(test)]
#[ctor::ctor]
#[allow(clippy::disallowed_methods)] // It runs before anything else, and only in tests.
fn isolate_tests() {
    let home = env::temp_dir().join(format!("misty-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&home);
    let home = std::fs::canonicalize(&home).unwrap_or(home);
    unsafe {
        env::set_var("HOME", &home);
        env::set_var("USERPROFILE", &home);
        env::remove_var("MISTY_DATA_ROOT");
    }
}
