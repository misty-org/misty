use std::{
    env,
    path::{Path, PathBuf},
};

use anyhow::Result;

use crate::workspace::Workspace;

#[derive(Debug, Clone)]
pub struct Settings {
    pub workspace: Workspace,
}

impl Settings {
    pub fn load(command_line_workspace: Option<&Path>) -> Result<Self> {
        let root = select_workspace(
            command_line_workspace.map(Path::to_path_buf),
            env::var_os("MISTY_ROOT").map(PathBuf::from),
            std::env::current_dir()
                .ok()
                .and_then(|path| Workspace::discover(&path)),
            default_workspace(),
        );
        Ok(Self {
            workspace: Workspace::from_root(root)?,
        })
    }
}

pub fn load_cli_environment(workspace: &Workspace, files: &[&str]) -> Result<()> {
    if files.is_empty() {
        return Ok(());
    }
    for (name, value) in crate::environment::read_selected_cli_files(workspace, files)? {
        if env::var_os(&name).is_none() {
            env::set_var(name, value);
        }
    }
    Ok(())
}

fn default_workspace() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("misty-org")
}

fn select_workspace(
    command_line: Option<PathBuf>,
    environment: Option<PathBuf>,
    discovered: Option<PathBuf>,
    fallback: PathBuf,
) -> PathBuf {
    command_line
        .or(environment)
        .or(discovered)
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_precedence_is_stable() {
        let path = |name: &str| Some(PathBuf::from(name));
        assert_eq!(
            select_workspace(path("flag"), path("env"), path("found"), "home".into()),
            PathBuf::from("flag")
        );
        assert_eq!(
            select_workspace(None, path("env"), path("found"), "home".into()),
            PathBuf::from("env")
        );
        assert_eq!(
            select_workspace(None, None, path("found"), "home".into()),
            PathBuf::from("found")
        );
        assert_eq!(
            select_workspace(None, None, None, "home".into()),
            PathBuf::from("home")
        );
    }
}
