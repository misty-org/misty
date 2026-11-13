//! Where the launch-on-login entry lives, which the file gate lets Misty write.
use std::path::PathBuf;

#[cfg(target_os = "macos")]
pub fn launch_entry_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("LaunchAgents")
            .join("com.misty.desktop.plist")
    })
}

#[cfg(target_os = "linux")]
pub fn launch_entry_path() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("autostart").join("misty.desktop"))
}

#[cfg(target_os = "windows")]
pub fn launch_entry_path() -> Option<PathBuf> {
    None
}
