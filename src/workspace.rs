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
        if root.join("app/package.json").is_file() {
            return Ok(Self {
                misty: root.join("app"),
                server: root.join("server"),
                website: root.join("website"),
                cli: root.join("cli"),
                root,
            });
        }
        Ok(Self {
            misty: root.join("misty"),
            server: root.join("misty-server"),
            website: root.join("misty-website"),
            cli: root.join("misty-cli"),
            root,
        })
    }

    pub fn validate(&self) -> Result<()> {
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
    if root.join("misty/package.json").is_file() || root.join("app/package.json").is_file() {
        root
    } else if (root.join("package.json").is_file()
        && root.join("src-tauri/tauri.conf.json").is_file())
        || (root.join("Cargo.toml").is_file()
            && root.file_name().is_some_and(|name| name == "misty-cli"))
    {
        root.parent().map(Path::to_path_buf).unwrap_or(root)
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
    use std::fs;

    #[test]
    fn resolves_the_sibling_repository_layout() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().to_path_buf();
        for path in [
            "misty/package.json",
            "misty/src-tauri/tauri.conf.json",
            "misty-server/go.mod",
            "misty-website/package.json",
            "misty-cli/Cargo.toml",
        ] {
            let path = root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }
        let workspace = Workspace::from_root(root.clone()).unwrap();
        workspace.validate().unwrap();
        assert_eq!(workspace.root, root);
        assert_eq!(workspace.misty, root.join("misty"));
        assert_eq!(workspace.server, root.join("misty-server"));
        assert_eq!(workspace.website, root.join("misty-website"));
        assert_eq!(workspace.cli, root.join("misty-cli"));
    }
}
