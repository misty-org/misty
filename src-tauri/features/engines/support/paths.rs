// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/paths.rs: where the engine layer keeps its own files. In Misty that is a folder
// inside Misty's data root (`~/.misty/engines`), set once at startup; structured data lives in
// misty.db instead of ccgui's own database file.

use std::path::PathBuf;
use std::sync::OnceLock;

static ENGINES_HOME: OnceLock<PathBuf> = OnceLock::new();

/// Points the engine layer at `~/.misty/engines`, which every build shares (the programs there
/// only run from where they were installed). Called once while the app starts.
pub fn init(misty_root: &std::path::Path) {
    let _ = ENGINES_HOME.set(misty_root.join("engines"));
}

/// Home dir without panicking: a headless/odd environment falls back to the
/// current directory so startup degrades instead of crashing.
///
/// Tests steer it through HOME / USERPROFILE, because `dirs` ignores the
/// environment on Windows and would read the real profile.
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

/// Serialize tests that steer process-global HOME / USERPROFILE (read by the
/// cfg(test) branch above): every HOME-mutating test across the crate holds this one lock.
#[cfg(test)]
pub(crate) static HOME_ENV_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// The engine layer's own folder: staging files, pasted images, host credentials.
pub fn app_home() -> PathBuf {
    #[cfg(test)]
    {
        return home_dir().join(".misty").join("engines");
    }
    #[allow(unreachable_code)]
    ENGINES_HOME
        .get()
        .cloned()
        .unwrap_or_else(|| home_dir().join(".misty").join("engines"))
}

/// Where Misty keeps what it installs, rooted at the engine layer's folder (`~/.misty/engines`).
/// Tests root it in a scratch folder of their own instead of moving the process-wide `HOME`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstallRoot {
    engines: PathBuf,
}

impl InstallRoot {
    /// Misty's own folder on this computer.
    pub fn here() -> Self {
        Self::at(app_home())
    }

    /// A root whose engine folders are inside `engines`.
    pub fn at(engines: PathBuf) -> Self {
        Self { engines }
    }

    /// Where Misty installs an engine: `~/.misty/engines/<engine>`, beside the engine layer's own
    /// staging folders, none of which is named after an engine. Only the program lives here; the
    /// engine's sign-in and settings stay in its own folder (`~/.claude`, `~/.codex` and the like).
    pub fn engine_dir(&self, engine: &str) -> PathBuf {
        self.engines.join(engine)
    }

    /// The folders inside an engine's folder that hold its program: `bin` for a maker's own
    /// build, `node_modules/.bin` for an npm install (`npm install --prefix`), and for Hermes
    /// Agent the launcher its installer keeps inside its source checkout.
    pub fn program_dirs(&self, engine: &str) -> Vec<PathBuf> {
        let dir = self.engine_dir(engine);
        let mut dirs = vec![dir.join("bin"), dir.join("node_modules").join(".bin")];
        if engine == "hermes" {
            dirs.push(self.checkout_dir(engine).join(".hermes").join("bin"));
        }
        dirs
    }

    /// Where an installer that works from a source checkout (Hermes Agent's) puts it.
    pub fn checkout_dir(&self, engine: &str) -> PathBuf {
        self.engine_dir(engine).join(format!("{engine}-agent"))
    }

    /// Misty's own Node.js, fetched only when an engine needs it: `~/.misty/runtime/node`.
    pub fn node_dir(&self) -> PathBuf {
        self.engines
            .parent()
            .map(|misty| misty.join("runtime"))
            .unwrap_or_else(|| self.engines.join("runtime"))
            .join("node")
    }

    /// The folder holding `node` and `npm` in Misty's Node.js.
    pub fn node_bin_dir(&self) -> PathBuf {
        if cfg!(windows) {
            self.node_dir()
        } else {
            self.node_dir().join("bin")
        }
    }

    /// Every folder of programs Misty installed: each engine's, then its Node.js. They go last
    /// on the engines' search PATH, so a copy already on the computer is found first. Never
    /// added to the person's own PATH.
    pub fn all_program_dirs(&self) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = super::config::ENGINES
            .iter()
            .flat_map(|engine| self.program_dirs(engine))
            .collect();
        dirs.push(self.node_bin_dir());
        dirs
    }
}

/// What an engine's program gets in its environment when it is Misty's own copy: Claude Code's
/// auto-updater turned off (`DISABLE_AUTOUPDATER`, as Claude Code documents it), since it would
/// install a new version into `~/.local` instead of Misty's folder. Misty updates its copy itself,
/// the way it installed it. A copy that was on the computer before gets nothing.
pub fn own_copy_env(bin: &str) -> Vec<(&'static str, &'static str)> {
    own_copy_env_in(&InstallRoot::here(), bin)
}

/// [`own_copy_env`] for Misty's folder at `root`.
pub fn own_copy_env_in(root: &InstallRoot, bin: &str) -> Vec<(&'static str, &'static str)> {
    let path = std::path::Path::new(bin);
    let folder = root.engine_dir("claude");
    // The real paths too, so a link elsewhere that leads into Misty's folder still counts. The
    // folder is Misty's own and goes through the gate; the program usually sits in a program
    // folder outside it (`/opt/homebrew/bin`), so its link is followed outside the gate, as when
    // Misty finds a program to run. Going through the gate there refused, and logged, every start.
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

/// Where a program's links lead. Only the links are followed; nothing in the file is read.
#[allow(clippy::disallowed_methods)]
fn program_real_path(path: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::canonicalize(path).ok()
}

/// A command for `bin`, with [`own_copy_env`] set.
pub(crate) fn own_copy_command(bin: &str) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(bin);
    command.envs(own_copy_env(bin));
    command
}

/// [`InstallRoot::engine_dir`] on this computer.
pub fn engine_install_dir(engine: &str) -> PathBuf {
    InstallRoot::here().engine_dir(engine)
}

/// [`InstallRoot::node_dir`] on this computer.
pub fn node_runtime_dir() -> PathBuf {
    InstallRoot::here().node_dir()
}

/// [`InstallRoot::node_bin_dir`] on this computer.
pub fn node_runtime_bin_dir() -> PathBuf {
    InstallRoot::here().node_bin_dir()
}

/// [`InstallRoot::all_program_dirs`] on this computer.
pub fn installed_program_dirs() -> Vec<PathBuf> {
    InstallRoot::here().all_program_dirs()
}

/// desktop-cc-gui's own home. Its sessions are listed for import like any CLI's.
pub fn legacy_home() -> PathBuf {
    home_dir().join(".ccgui")
}

pub fn ensure_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(app_home())
}
