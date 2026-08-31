use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::{artifacts::write_private, workspace::Workspace};

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
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                    .with_context(|| format!("could not secure {}", parent.display()))?;
            }
        }
        let contents = toml::to_string_pretty(&StoredSettings {
            workspace_root: Some(root.to_path_buf()),
        })?;
        write_private(&path, contents.as_bytes())?;
        Ok(path)
    }
}

pub fn load_cli_environment(workspace: &Workspace, files: &[&str]) -> Result<()> {
    for name in files {
        let path = workspace.cli.join(".env").join(name);
        if !path.is_file() {
            continue;
        }
        require_private_file(&path)?;
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("could not read {}", path.display()))?;
        for item in dotenvy::from_read_iter(contents.as_bytes()) {
            let (name, value) =
                item.with_context(|| format!("could not parse {}", path.display()))?;
            if env::var_os(&name).is_none() {
                env::set_var(name, value);
            }
        }
    }
    copy_legacy_value("MISTY_CODESIGN_IDENTITY", "APPLE_SIGNING_IDENTITY");
    Ok(())
}

fn require_private_file(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)?.permissions().mode() & 0o077;
        if mode != 0 {
            anyhow::bail!(
                "{} must not be accessible by group or others",
                path.display()
            );
        }
    }
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
    let current = settings_path()?;
    for path in settings_paths()? {
        if !path.is_file() {
            continue;
        }
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("could not read {}", path.display()))?;
        let settings = toml::from_str(&contents)
            .with_context(|| format!("could not parse {}", path.display()))?;
        if path != current && !current.exists() {
            if let Some(parent) = current.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("could not create {}", parent.display()))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                        .with_context(|| format!("could not secure {}", parent.display()))?;
                }
            }
            write_private(&current, contents.as_bytes())?;
        }
        return Ok(settings);
    }
    Ok(StoredSettings::default())
}

fn settings_path() -> Result<PathBuf> {
    Ok(settings_path_for(&crate::home::default_root()?))
}

fn settings_path_for(home: &Path) -> PathBuf {
    home.join("cli").join("config.toml")
}

fn settings_paths() -> Result<Vec<PathBuf>> {
    let current = settings_path()?;
    let mut paths = vec![current];
    if let Some(root) = dirs::config_dir() {
        paths.extend([
            root.join("misty").join("cli.toml"),
            root.join("mcli").join("config.toml"),
            root.join("misty-cli").join("config.toml"),
        ]);
    }
    paths.dedup();
    Ok(paths)
}

fn default_workspace() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("misty-org")
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

    #[test]
    fn cli_configuration_lives_in_the_misty_home() {
        let root = Path::new("/Users/misty/.misty");
        assert_eq!(
            settings_path_for(root),
            PathBuf::from("/Users/misty/.misty/cli/config.toml")
        );
    }
}
