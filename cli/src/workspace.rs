use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
    pub misty: PathBuf,
    pub file_manager: PathBuf,
    pub server: PathBuf,
    pub cli: PathBuf,
}

impl Workspace {
    pub fn from_root(root: PathBuf) -> Result<Self> {
        let root = absolute(root)?;
        Ok(Self {
            misty: root.join("misty"),
            file_manager: root.join("misty-file-manager"),
            server: root.join("misty-server"),
            cli: root.join("misty-cli"),
            root,
        })
    }

    pub fn validate(&self) -> Result<()> {
        require_repository(&self.misty, "misty")?;
        require_repository(&self.server, "misty-server")?;
        require_repository(&self.cli, "misty-cli")?;
        Ok(())
    }

    pub fn validate_file_manager(&self) -> Result<()> {
        require_repository(&self.file_manager, "misty-file-manager")
    }
}

fn require_repository(path: &Path, name: &str) -> Result<()> {
    if !path.join(".git").exists() {
        bail!("{name} checkout was not found at {}", path.display());
    }
    Ok(())
}

fn absolute(path: PathBuf) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path);
    }
    std::env::current_dir()
        .context("could not read current directory")
        .map(|current| current.join(path))
}
