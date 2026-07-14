use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub fn resolve_executable(name: &str, settings_path: Option<&Path>) -> Option<PathBuf> {
    if !matches!(name, "ffmpeg" | "ffprobe" | "yt-dlp") {
        return None;
    }
    let override_name = match name {
        "ffmpeg" => "FFMPEG_BIN",
        "ffprobe" => "FFPROBE_BIN",
        _ => "YTDLP_BIN",
    };
    if let Some(path) = env::var_os(override_name)
        .map(PathBuf::from)
        .filter(|path| executable_exists(path))
    {
        return Some(path);
    }

    let executable_names = executable_names(name);
    let configured_path = settings_path.and_then(configured_tools_path);
    let path_value = configured_path
        .map(Into::into)
        .or_else(|| env::var_os("PATH"));
    if let Some(path) = path_value
        .clone()
        .into_iter()
        .flat_map(|paths| env::split_paths(&paths).collect::<Vec<_>>())
        .flat_map(|directory| {
            executable_names
                .iter()
                .map(move |candidate| directory.join(candidate))
        })
        .find(|path| executable_exists(path))
    {
        return Some(path);
    }
    if path_value.is_some_and(|value| value.is_empty()) {
        return None;
    }

    let mut directories = Vec::new();
    if let Some(home) = dirs::home_dir() {
        directories.push(home.join(".local/bin"));
        directories.push(home.join("bin"));
    }
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    directories
        .into_iter()
        .flat_map(|directory| {
            executable_names
                .iter()
                .map(move |candidate| directory.join(candidate))
        })
        .find(|path| executable_exists(path))
}

pub fn detected_login_shell_path() -> String {
    #[cfg(target_os = "macos")]
    {
        let shell = env::var("SHELL")
            .ok()
            .filter(|shell| matches!(shell.as_str(), "/bin/zsh" | "/bin/bash"))
            .unwrap_or_else(|| "/bin/zsh".to_owned());
        if let Ok(output) = Command::new(shell)
            .args(["-lc", "printf '%s' \"$PATH\""])
            .stdin(Stdio::null())
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                if !path.is_empty() {
                    return path;
                }
            }
        }
    }
    env::var("PATH").unwrap_or_default()
}

fn configured_tools_path(settings_path: &Path) -> Option<String> {
    let document: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(settings_path).ok()?).ok()?;
    document
        .get("advanced")?
        .get("extension_tools_path")?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn executable_names(name: &str) -> Vec<String> {
    if cfg!(target_os = "windows") {
        vec![
            format!("{name}.exe"),
            format!("{name}.cmd"),
            name.to_owned(),
        ]
    } else {
        vec![name.to_owned()]
    }
}

fn executable_exists(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn only_resolves_allowlisted_dependencies() {
        assert!(resolve_executable("sh", None).is_none());
    }

    #[test]
    fn resolves_from_the_configured_extension_tools_path() {
        let root = env::temp_dir().join(format!("misty-tools-path-{}", Uuid::new_v4()));
        let tools = root.join("tools");
        fs::create_dir_all(&tools).unwrap();
        let executable = tools.join(if cfg!(target_os = "windows") {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        fs::write(&executable, b"test").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let settings = root.join("settings.json");
        fs::write(
            &settings,
            serde_json::json!({
                "advanced": { "extension_tools_path": tools.display().to_string() }
            })
            .to_string(),
        )
        .unwrap();

        assert_eq!(
            resolve_executable("ffmpeg", Some(&settings)),
            Some(executable)
        );
        let _ = fs::remove_dir_all(root);
    }
}
