use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::Serialize;

use crate::infra::paths;

#[derive(Clone)]
pub struct AppEnvironmentService {
    inner: Arc<AppEnvironment>,
}

#[derive(Debug, Clone)]
pub struct AppEnvironment {
    pub home_dir: PathBuf,
    pub misty_dir: PathBuf,
    pub cache_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEnvironmentSnapshot {
    pub home_dir: String,
}

impl AppEnvironmentService {
    pub fn new_with_data_root(data_root: Option<PathBuf>) -> Self {
        Self {
            inner: Arc::new(AppEnvironment::load(data_root)),
        }
    }

    pub fn snapshot(&self) -> AppEnvironmentSnapshot {
        self.inner.snapshot()
    }

    /// The database every store lives in: `~/.misty/.local/data/misty.db`.
    pub fn store(&self) -> crate::infra::store::Store {
        crate::infra::store::Store::at(
            self.inner
                .misty_dir
                .join(".local")
                .join("data")
                .join("misty.db"),
        )
    }

    pub fn home_dir(&self) -> PathBuf {
        self.inner.home_dir.clone()
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.inner.cache_dir.clone()
    }

    /// Misty's own data root (never shareable with agents).
    pub fn misty_dir(&self) -> PathBuf {
        self.inner.misty_dir.clone()
    }

    /// Undo copies of coding runs (agents::checkpoints).
    pub fn checkpoints_dir(&self) -> PathBuf {
        self.inner.misty_dir.join("checkpoints")
    }
}

impl AppEnvironment {
    fn load(data_root: Option<PathBuf>) -> Self {
        let home_dir = data_root.or_else(resolve_home_dir).unwrap_or_default();
        let misty_dir = home_dir.join(".misty");
        let cache_dir = misty_dir.join("cache");

        Self {
            home_dir,
            misty_dir,
            cache_dir,
        }
    }

    fn snapshot(&self) -> AppEnvironmentSnapshot {
        AppEnvironmentSnapshot {
            home_dir: display_path(&self.home_dir),
        }
    }
}

fn resolve_home_dir() -> Option<PathBuf> {
    paths::misty_data_root()
}

fn display_path(path: &Path) -> String {
    clean_display_path(path.display().to_string().as_str())
}

#[cfg(windows)]
fn clean_display_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

#[cfg(not(windows))]
fn clean_display_path(path: &str) -> String {
    path.to_string()
}
