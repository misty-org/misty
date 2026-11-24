// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/paths.rs: where the engine layer keeps its own files. In Misty that is a folder
// inside Misty's data root (`~/.misty/shared/engines`), set once at startup; structured data lives in
// misty.db instead of ccgui's own database file.

use std::path::PathBuf;
use std::sync::OnceLock;

static ENGINES_HOME: OnceLock<PathBuf> = OnceLock::new();

pub fn init(misty_root: &std::path::Path) {
    let _ = ENGINES_HOME.set(engines_in(misty_root));
}

fn engines_in(misty_root: &std::path::Path) -> PathBuf {
    misty_root
        .join(file_access::paths::SHARED_FOLDER)
        .join("engines")
}

pub(crate) fn home_dir() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(home);
        }
        #[cfg(windows)]
        if let Some(profile) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
            return PathBuf::from(profile);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[cfg(test)]
pub(crate) static HOME_ENV_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

pub fn app_home() -> PathBuf {
    #[cfg(test)]
    {
        return engines_in(&home_dir().join(".misty"));
    }
    #[allow(unreachable_code)]
    ENGINES_HOME
        .get()
        .cloned()
        .unwrap_or_else(|| engines_in(&home_dir().join(".misty")))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstallRoot {
    engines: PathBuf,
}

impl InstallRoot {
    pub fn here() -> Self {
        Self::at(app_home())
    }

    pub fn at(engines: PathBuf) -> Self {
        Self { engines }
    }

    pub fn engine_dir(&self, engine: &str) -> PathBuf {
        self.engines.join(engine)
    }

    pub fn program_dirs(&self, engine: &str) -> Vec<PathBuf> {
        let dir = self.engine_dir(engine);
        let mut dirs = vec![dir.join("bin"), dir.join("node_modules").join(".bin")];
        if engine == "hermes" {
            dirs.push(self.checkout_dir(engine).join(".hermes").join("bin"));
        }
        dirs
    }

    pub fn checkout_dir(&self, engine: &str) -> PathBuf {
        self.engine_dir(engine).join(format!("{engine}-agent"))
    }

    pub fn node_dir(&self) -> PathBuf {
        self.engines
            .parent()
            .map(|misty| misty.join("runtime"))
            .unwrap_or_else(|| self.engines.join("runtime"))
            .join("node")
    }

    pub fn node_bin_dir(&self) -> PathBuf {
        if cfg!(windows) {
            self.node_dir()
        } else {
            self.node_dir().join("bin")
        }
    }

    pub fn all_program_dirs(&self) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = super::config::ENGINES
            .iter()
            .flat_map(|engine| self.program_dirs(engine))
            .collect();
        dirs.push(self.node_bin_dir());
        dirs
    }
}

pub fn own_copy_env(bin: &str) -> Vec<(&'static str, &'static str)> {
    own_copy_env_in(&InstallRoot::here(), bin)
}

pub fn own_copy_env_in(root: &InstallRoot, bin: &str) -> Vec<(&'static str, &'static str)> {
    let path = std::path::Path::new(bin);
    let folder = root.engine_dir("claude");
    let inside = path.is_absolute()
        && (path.starts_with(&folder)
            || file_access::fs::canonicalize(&folder).is_ok_and(|folder| {
                program_real_path(path).is_some_and(|bin| bin.starts_with(folder))
            }));
    if inside {
        vec![("DISABLE_AUTOUPDATER", "1")]
    } else {
        Vec::new()
    }
}

#[allow(clippy::disallowed_methods)]
fn program_real_path(path: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::canonicalize(path).ok()
}

pub(crate) fn own_copy_command(bin: &str) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(bin);
    command.envs(own_copy_env(bin));
    command
}

pub fn engine_install_dir(engine: &str) -> PathBuf {
    InstallRoot::here().engine_dir(engine)
}

pub fn node_runtime_dir() -> PathBuf {
    InstallRoot::here().node_dir()
}

pub fn node_runtime_bin_dir() -> PathBuf {
    InstallRoot::here().node_bin_dir()
}

pub fn installed_program_dirs() -> Vec<PathBuf> {
    InstallRoot::here().all_program_dirs()
}

pub fn legacy_home() -> PathBuf {
    home_dir().join(".ccgui")
}

pub fn ensure_dirs() -> std::io::Result<()> {
    file_access::fs::create_dir_all(app_home())
}
