use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

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
    pub fn discover(start: &Path) -> Option<PathBuf> {
        start
            .ancestors()
            .find(|path| {
                path.join("src-tauri/tauri.conf.json").is_file()
                    && path.join("cli/Cargo.toml").is_file()
            })
            .map(Path::to_path_buf)
    }

    pub fn from_root(root: PathBuf) -> Result<Self> {
        let absolute = if root.is_absolute() {
            root
        } else {
            std::env::current_dir()
                .context("could not read current directory")?
                .join(root)
        };
        let misty = Self::discover(&absolute).unwrap_or_else(|| absolute.join("misty"));
        let root = misty.parent().unwrap_or(&misty).to_path_buf();
        Ok(Self {
            extensions: misty.join("apps"),
            cli: misty.join("cli"),
            server: root.join("misty-server"),
            website: root.join("misty-website"),
            misty,
            root,
        })
    }

    /// Local development needs only the product checkout. Remote services and
    /// the website are optional siblings, validated by their own commands.
    pub fn validate(&self) -> Result<()> {
        for (path, label) in [
            (self.misty.join("package.json"), "Misty package.json"),
            (
                self.misty.join("src-tauri/tauri.conf.json"),
                "Misty native configuration",
            ),
            (self.extensions.join("catalog.json"), "Misty app catalog"),
            (self.cli.join("Cargo.toml"), "Misty CLI"),
        ] {
            if !path.is_file() {
                bail!("{label} was not found at {}", path.display());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn a_single_clone_works_from_any_package_without_optional_repositories() {
        let temporary = tempfile::tempdir().unwrap();
        let checkout = temporary.path().join("my-contribution");
        for name in [
            "package.json",
            "src-tauri/tauri.conf.json",
            "cli/Cargo.toml",
            "apps/catalog.json",
            "packages/sdk/package.json",
        ] {
            let file = checkout.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, "").unwrap();
        }
        for path in [
            &checkout,
            &checkout.join("cli"),
            &checkout.join("packages/sdk"),
        ] {
            let workspace = Workspace::from_root(path.clone()).unwrap();
            workspace.validate().unwrap();
            assert_eq!(workspace.misty, checkout);
            assert_eq!(workspace.extensions, checkout.join("apps"));
            assert_eq!(workspace.cli, checkout.join("cli"));
            assert!(!workspace.server.exists());
        }
    }

    #[test]
    fn organization_root_resolves_the_product_checkout() {
        let temporary = tempfile::tempdir().unwrap();
        let workspace = Workspace::from_root(temporary.path().to_path_buf()).unwrap();
        assert_eq!(workspace.misty, temporary.path().join("misty"));
        assert_eq!(workspace.server, temporary.path().join("misty-server"));
    }
}
