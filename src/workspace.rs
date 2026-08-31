use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
    pub misty: PathBuf,
    pub server: PathBuf,
    pub website: PathBuf,
    pub extensions: PathBuf,
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
                extensions: root.join("extensions"),
                cli: root.join("cli"),
                root,
            });
        }
        Ok(Self {
            misty: root.join("misty"),
            server: root.join("misty-server"),
            website: root.join("misty-website"),
            extensions: root.join("misty-extensions"),
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
        require_file(
            &self.extensions.join("package.json"),
            "Misty extensions package.json",
        )?;
        require_file(&self.cli.join("Cargo.toml"), "misty Cargo.toml")?;
        Ok(())
    }
}

fn normalize_root(root: PathBuf) -> PathBuf {
    if root.join("misty/package.json").is_file() || root.join("app/package.json").is_file() {
        root
    } else if is_repository_checkout(&root) {
        root.parent().map(Path::to_path_buf).unwrap_or(root)
    } else {
        root
    }
}

fn is_repository_checkout(root: &Path) -> bool {
    let Some(name) = root.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    match name {
        "misty" => {
            root.join("package.json").is_file() && root.join("src-tauri/tauri.conf.json").is_file()
        }
        "misty-server" => root.join("go.mod").is_file(),
        "misty-website" | "misty-extensions" => root.join("package.json").is_file(),
        "misty-cli" => root.join("Cargo.toml").is_file(),
        _ => false,
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
            "misty-extensions/package.json",
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
        assert_eq!(workspace.extensions, root.join("misty-extensions"));
        assert_eq!(workspace.cli, root.join("misty-cli"));

        for repository in [
            "misty",
            "misty-server",
            "misty-website",
            "misty-extensions",
            "misty-cli",
        ] {
            let from_checkout = Workspace::from_root(root.join(repository)).unwrap();
            assert_eq!(from_checkout.root, root);
            from_checkout.validate().unwrap();
        }
    }

    #[test]
    fn keeps_archived_monorepo_layout_compatible() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().to_path_buf();
        for path in [
            "app/package.json",
            "app/src-tauri/tauri.conf.json",
            "server/go.mod",
            "website/package.json",
            "extensions/package.json",
            "cli/Cargo.toml",
        ] {
            let path = root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }
        let workspace = Workspace::from_root(root.clone()).unwrap();
        workspace.validate().unwrap();
        assert_eq!(workspace.extensions, root.join("extensions"));
    }
}
