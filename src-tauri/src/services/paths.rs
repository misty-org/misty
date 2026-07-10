use std::{env, path::PathBuf, sync::OnceLock};

#[cfg(any(target_os = "ios", target_os = "android"))]
const MOBILE_APP_DATA_DIR_NAME: &str = "Misty";

#[cfg(any(target_os = "ios", target_os = "android"))]
static MOBILE_DATA_ROOT: OnceLock<PathBuf> = OnceLock::new();

#[cfg(any(target_os = "ios", target_os = "android"))]
pub fn set_mobile_data_root(root: PathBuf) {
    let _ = MOBILE_DATA_ROOT.set(root);
}

pub fn misty_data_root() -> Option<PathBuf> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        MOBILE_DATA_ROOT
            .get()
            .cloned()
            .or_else(resolve_mobile_data_root)
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        resolve_desktop_home_dir()
    }
}

pub fn misty_home_dir() -> Option<PathBuf> {
    misty_data_root().map(|root| root.join(".misty"))
}

fn resolve_desktop_home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(any(target_os = "ios", target_os = "android"))]
fn resolve_mobile_data_root() -> Option<PathBuf> {
    dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .or_else(dirs::cache_dir)
        .or_else(resolve_desktop_home_dir)
        .map(|root| root.join(MOBILE_APP_DATA_DIR_NAME))
}
