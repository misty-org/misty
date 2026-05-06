use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
    pub misty: PathBuf,
    pub server: PathBuf,
    pub website: PathBuf,
    pub cli: PathBuf,
}

impl Workspace {
    pub fn from_root(root: PathBuf) -> Result<Self> {
        let root = normalize_root(absolute(root)?);
        Ok(Self {
            misty: root.join("app"),
            server: root.join("server"),
            website: root.join("website"),
            cli: root.join("cli"),
            root,
        })
    }

    pub fn validate(&self) -> Result<()> {
        require_file(&self.root.join("package.json"), "monorepo package.json")?;
        require_file(&self.misty.join("package.json"), "Misty app package.json")?;
        require_file(
            &self.misty.join("src-tauri/tauri.conf.json"),
            "Misty Tauri configuration",
        )?;
        require_file(&self.server.join("go.mod"), "Misty server go.mod")?;
        require_file(
            &self.website.join("package.json"),
            "Misty website package.json",
        )?;
        require_file(&self.cli.join("Cargo.toml"), "misty Cargo.toml")?;
        Ok(())
    }
}

fn normalize_root(root: PathBuf) -> PathBuf {
    if root.join("app/package.json").is_file() {
        root
    } else if root.join("misty/app/package.json").is_file() {
        root.join("misty")
    } else {
        root
    }
}

fn require_file(path: &Path, label: &str) -> Result<()> {
    if !path.is_file() {
        bail!("{label} was not found at {}", path.display());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_current_monorepo_layout() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let workspace = Workspace::from_root(root.clone()).unwrap();
        workspace.validate().unwrap();
        assert_eq!(workspace.root, root);
        assert_eq!(workspace.misty, root.join("app"));
        assert_eq!(workspace.server, root.join("server"));
        assert_eq!(workspace.website, root.join("website"));
        assert_eq!(workspace.cli, root.join("cli"));
    }
}
