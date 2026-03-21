use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[cfg(target_os = "windows")]
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOnLoginSnapshot {
    pub supported: bool,
    pub enabled: bool,
    pub target: String,
    pub detail: String,
}

pub fn snapshot() -> LaunchOnLoginSnapshot {
    let target = current_target();
    let enabled = is_enabled(&target);
    LaunchOnLoginSnapshot {
        supported: platform_supported(),
        enabled,
        target: target.display().to_string(),
        detail: if platform_supported() {
            launch_entry_path()
                .map(|path| path.display().to_string())
                .unwrap_or_default()
        } else {
            "Launch on login is not supported on this platform yet.".to_owned()
        },
    }
}

pub fn apply(enabled: bool) -> Result<LaunchOnLoginSnapshot, String> {
    if !platform_supported() {
        return Err("Launch on login is not supported on this platform yet.".to_owned());
    }
    let target = current_target();
    if enabled {
        enable(&target)?;
    } else {
        disable()?;
    }
    Ok(snapshot())
}

#[cfg(target_os = "macos")]
fn platform_supported() -> bool {
    true
}

#[cfg(target_os = "linux")]
fn platform_supported() -> bool {
    true
}

#[cfg(target_os = "windows")]
fn platform_supported() -> bool {
    true
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_supported() -> bool {
    false
}

fn current_target() -> PathBuf {
    env::current_exe().unwrap_or_else(|_| PathBuf::from("misty"))
}

#[cfg(target_os = "macos")]
fn launch_entry_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("LaunchAgents")
            .join("com.misty.desktop.plist")
    })
}

#[cfg(target_os = "linux")]
fn launch_entry_path() -> Option<PathBuf> {
    dirs::config_dir().map(|config| config.join("autostart").join("misty.desktop"))
}

#[cfg(target_os = "windows")]
fn launch_entry_path() -> Option<PathBuf> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn launch_entry_path() -> Option<PathBuf> {
    None
}

#[cfg(target_os = "macos")]
fn is_enabled(target: &Path) -> bool {
    let Some(path) = launch_entry_path() else {
        return false;
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    contents.contains(&escape_xml(&target.display().to_string()))
}

#[cfg(target_os = "linux")]
fn is_enabled(target: &Path) -> bool {
    let Some(path) = launch_entry_path() else {
        return false;
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    contents.contains(&format!("Exec={}", target.display()))
}

#[cfg(target_os = "windows")]
fn is_enabled(_target: &Path) -> bool {
    Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "Misty",
        ])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn is_enabled(_target: &Path) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn enable(target: &Path) -> Result<(), String> {
    let path =
        launch_entry_path().ok_or_else(|| "Could not locate LaunchAgents directory.".to_owned())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    fs::write(path, macos_launch_agent_plist(target))
        .map_err(|error| format!("Could not write launch agent: {error}"))
}

#[cfg(target_os = "linux")]
fn enable(target: &Path) -> Result<(), String> {
    let path =
        launch_entry_path().ok_or_else(|| "Could not locate autostart directory.".to_owned())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    fs::write(path, linux_desktop_entry(target))
        .map_err(|error| format!("Could not write autostart entry: {error}"))
}

#[cfg(target_os = "windows")]
fn enable(target: &Path) -> Result<(), String> {
    let target = target.display().to_string();
    let status = Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "Misty",
            "/t",
            "REG_SZ",
            "/d",
            &target,
            "/f",
        ])
        .status()
        .map_err(|error| format!("Could not run reg add: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not enable launch on login.".to_owned())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn enable(_target: &Path) -> Result<(), String> {
    Err("Launch on login is not supported on this platform yet.".to_owned())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn disable() -> Result<(), String> {
    let Some(path) = launch_entry_path() else {
        return Ok(());
    };
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Could not remove {}: {error}", path.display()))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn disable() -> Result<(), String> {
    let status = Command::new("reg")
        .args([
            "delete",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "Misty",
            "/f",
        ])
        .status()
        .map_err(|error| format!("Could not run reg delete: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not disable launch on login.".to_owned())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn disable() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_launch_agent_plist(target: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.misty.desktop</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
        escape_xml(&target.display().to_string())
    )
}

#[cfg(target_os = "linux")]
fn linux_desktop_entry(target: &Path) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=Misty\nExec={}\nX-GNOME-Autostart-enabled=true\n",
        target.display()
    )
}

#[cfg(target_os = "macos")]
fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_plist_escapes_target_path() {
        let plist = macos_launch_agent_plist(Path::new(
            "/Applications/Misty & Test.app/Contents/MacOS/Misty",
        ));
        assert!(plist.contains("Misty &amp; Test.app"));
        assert!(plist.contains("<key>RunAtLoad</key>"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_desktop_entry_contains_exec_path() {
        let entry = linux_desktop_entry(Path::new("/opt/misty/misty"));
        assert!(entry.contains("Exec=/opt/misty/misty"));
        assert!(entry.contains("X-GNOME-Autostart-enabled=true"));
    }
}
