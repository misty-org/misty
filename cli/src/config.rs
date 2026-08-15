use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::workspace::Workspace;

#[derive(Debug, Clone)]
pub struct Settings {
    pub workspace: Workspace,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct StoredSettings {
    workspace_root: Option<PathBuf>,
}

impl Settings {
    pub fn load(command_line_workspace: Option<&Path>) -> Result<Self> {
        let stored = read_stored_settings()?;
        let root = select_workspace(
            command_line_workspace.map(Path::to_path_buf),
            env::var_os("MISTY_ROOT")
                .or_else(|| env::var_os("MISTY_ORG_ROOT"))
                .map(PathBuf::from),
            stored.workspace_root,
            default_workspace(),
        );
        Ok(Self {
            workspace: Workspace::from_root(root)?,
        })
    }

    pub fn save_workspace(root: &Path) -> Result<PathBuf> {
        let path = settings_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("could not create {}", parent.display()))?;
        }
        let contents = toml::to_string_pretty(&StoredSettings {
            workspace_root: Some(root.to_path_buf()),
        })?;
        fs::write(&path, contents)
            .with_context(|| format!("could not write {}", path.display()))?;
        Ok(path)
    }
}

pub fn load_workspace_environment(workspace: &Workspace) -> Result<()> {
    let path = workspace.cli.join(".env");
    if !path.is_file() {
        return Ok(());
    }
    let contents =
        fs::read_to_string(&path).with_context(|| format!("could not read {}", path.display()))?;
    let dotenv = contents
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            trimmed.is_empty() || trimmed.starts_with('#') || trimmed.contains('=')
        })
        .collect::<Vec<_>>()
        .join("\n");
    for item in dotenvy::from_read_iter(dotenv.as_bytes()) {
        let (name, value) = item?;
        if env::var_os(&name).is_none() {
            env::set_var(name, value);
        }
    }
    copy_legacy_value("MISTY_CODESIGN_IDENTITY", "APPLE_SIGNING_IDENTITY");
    Ok(())
}

fn copy_legacy_value(old_name: &str, new_name: &str) {
    if env::var_os(new_name).is_none() {
        if let Some(value) = env::var_os(old_name) {
            env::set_var(new_name, value);
        }
    }
}

fn read_stored_settings() -> Result<StoredSettings> {
    for path in settings_paths()? {
        if !path.is_file() {
            continue;
        }
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("could not read {}", path.display()))?;
        return toml::from_str(&contents)
            .with_context(|| format!("could not parse {}", path.display()));
    }
    Ok(StoredSettings::default())
}

fn settings_path() -> Result<PathBuf> {
    let root =
        dirs::config_dir().context("could not locate the platform configuration directory")?;
    Ok(root.join("misty").join("cli.toml"))
}

fn settings_paths() -> Result<[PathBuf; 3]> {
    let current = settings_path()?;
    let root = current
        .parent()
        .and_then(Path::parent)
        .context("could not locate the platform configuration directory")?
        .to_path_buf();
    Ok([
        current,
        root.join("mcli").join("config.toml"),
        root.join("misty-cli").join("config.toml"),
    ])
}

fn default_workspace() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("misty-org")
        .join("misty")
}

fn select_workspace(
    command_line: Option<PathBuf>,
    environment: Option<PathBuf>,
    stored: Option<PathBuf>,
    fallback: PathBuf,
) -> PathBuf {
    command_line.or(environment).or(stored).unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_precedence_is_stable() {
        let path = |name: &str| Some(PathBuf::from(name));
        assert_eq!(
            select_workspace(path("flag"), path("env"), path("saved"), "home".into()),
            PathBuf::from("flag")
        );
        assert_eq!(
            select_workspace(None, path("env"), path("saved"), "home".into()),
            PathBuf::from("env")
        );
        assert_eq!(
            select_workspace(None, None, path("saved"), "home".into()),
            PathBuf::from("saved")
        );
        assert_eq!(
            select_workspace(None, None, None, "home".into()),
            PathBuf::from("home")
        );
    }
}
