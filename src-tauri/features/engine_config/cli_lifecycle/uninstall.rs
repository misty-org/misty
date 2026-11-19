// Uninstalling an engine, whoever installed it. Misty's own copy goes with its folder in
// `~/.misty/shared/engines` (`routes::remove`). A copy that was on the computer before goes the way
// it came: npm's global copy through npm, Homebrew's through brew, and a copy from the maker's own
// installer by deleting its program and the versions that installer keeps beside it. The engine's
// sign-in, settings and history (`~/.claude`, `~/.codex`, `~/.hermes` and the like) always stay.
// A copy found anywhere else is left alone, since Misty can't tell what else would go with it, and
// the row offers no Uninstall for it.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{hermes_launchers, node_runtime, npm_package, routes, support, ProcOutput};
use crate::engines::support::paths::InstallRoot;

/// npm and brew take a few seconds to uninstall; this only stops one that hangs.
const UNINSTALL_TIMEOUT: Duration = Duration::from_secs(180);

/// How an installed engine is uninstalled, from where its program was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Removal {
    /// Misty installed it: its folder in `~/.misty/shared/engines`.
    Misty,
    /// npm installed it globally under `prefix`: `npm uninstall -g --prefix <prefix> <package>`.
    Npm {
        prefix: PathBuf,
        package: &'static str,
    },
    /// Homebrew installed it: `<brew> uninstall [--cask] <name>`.
    Brew {
        brew: PathBuf,
        name: String,
        cask: bool,
    },
    /// The maker's installer put it here: these files and folders go.
    Files(Vec<PathBuf>),
}

impl Removal {
    /// How the frontend words the confirmation: "misty", "npm", "brew" or "maker".
    pub(super) fn kind(&self) -> &'static str {
        match self {
            Removal::Misty => "misty",
            Removal::Npm { .. } => "npm",
            Removal::Brew { .. } => "brew",
            Removal::Files(_) => "maker",
        }
    }
}

/// The person's folders a maker's installer writes into.
pub(super) struct Homes {
    pub(super) home: PathBuf,
    /// `CODEX_HOME`, else `~/.codex`.
    pub(super) codex_home: PathBuf,
    /// `HERMES_HOME`, else Hermes Agent's own default.
    pub(super) hermes_home: PathBuf,
}

impl Homes {
    fn here() -> Self {
        let home = support::home_dir();
        let codex_home = std::env::var_os("CODEX_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"));
        Self {
            codex_home,
            hermes_home: support::hermes_home(),
            home,
        }
    }
}

/// How `engine`'s copy at `bin` is uninstalled, or `None` when Misty can't tell.
pub(super) fn removal(engine: &str, bin: &str) -> Option<Removal> {
    removal_in(
        &InstallRoot::here(),
        &Homes::here(),
        engine,
        bin,
        cfg!(windows),
    )
}

/// [`removal`] with Misty's folder at `root` and the person's folders at `homes`.
pub(super) fn removal_in(
    root: &InstallRoot,
    homes: &Homes,
    engine: &str,
    bin: &str,
    windows: bool,
) -> Option<Removal> {
    let path = Path::new(bin);
    if !path.is_absolute() {
        return None;
    }
    if routes::installed_by_misty_in(root, engine, bin) {
        return Some(Removal::Misty);
    }
    let real = real(path);
    // Homebrew first: a formula built on an npm package also has a `node_modules` inside.
    brew_package(&real)
        .or_else(|| npm_global(engine, path, &real, windows))
        .or_else(|| maker_files(engine, path, &real, homes).map(Removal::Files))
}

/// A program inside Homebrew's `Cellar/<formula>` or `Caskroom/<cask>`, uninstalled with the
/// `brew` of that same Homebrew.
fn brew_package(real: &Path) -> Option<Removal> {
    let parts: Vec<_> = real.components().collect();
    let at = parts.iter().position(|part| {
        let part = part.as_os_str();
        part == "Cellar" || part == "Caskroom"
    })?;
    let cask = parts[at].as_os_str() == "Caskroom";
    let name = parts.get(at + 1)?.as_os_str().to_string_lossy().into_owned();
    let prefix: PathBuf = parts[..at].iter().collect();
    let brew = prefix.join("bin").join("brew");
    (!name.is_empty() && is_file(&brew)).then_some(Removal::Brew { brew, name, cask })
}

/// npm's global copy: `<prefix>/bin/<cli>` linking into `<prefix>/lib/node_modules/<package>`, or
/// on Windows a `<prefix>\<cli>.cmd` shim beside `<prefix>\node_modules\<package>`.
fn npm_global(engine: &str, path: &Path, real: &Path, windows: bool) -> Option<Removal> {
    let package = npm_package(engine)?;
    let (prefix, modules) = if windows {
        let prefix = path.parent()?;
        (prefix, prefix.join("node_modules"))
    } else {
        let prefix = path.parent()?.parent()?;
        (prefix, prefix.join("lib").join("node_modules"))
    };
    let installed = modules.join(package);
    if !super::is_dir_outside_gate(&installed) {
        return None;
    }
    // On Windows the shim is a file of its own; elsewhere the program must lead into the package.
    (windows || real.starts_with(self::real(&installed))).then(|| Removal::Npm {
        prefix: prefix.to_path_buf(),
        package,
    })
}

/// What a maker's installer left, for the installers whose layout is known. Only the program and
/// the versions kept for it go, never the engine's own settings folder.
fn maker_files(engine: &str, path: &Path, real: &Path, homes: &Homes) -> Option<Vec<PathBuf>> {
    let local_bin = homes.home.join(".local").join("bin");
    let in_local_bin = path.parent() == Some(local_bin.as_path());
    match engine {
        // Claude Code's installer: `~/.local/bin/claude`, its versions in `~/.local/share/claude`.
        "claude" => {
            let versions = homes.home.join(".local").join("share").join("claude");
            let ours = real.starts_with(self::real(&versions))
                || (in_local_bin && super::is_dir_outside_gate(&versions));
            ours.then(|| vec![path.to_path_buf(), versions])
        }
        // Codex's script: a link in `~/.local/bin` into `~/.codex/packages/standalone`, with its
        // code-mode host beside it.
        "codex" => {
            let standalone = homes.codex_home.join("packages").join("standalone");
            let standalone_real = self::real(&standalone);
            if !real.starts_with(&standalone_real) {
                return None;
            }
            let mut files = vec![path.to_path_buf()];
            let dir = path.parent()?;
            for name in ["codex-code-mode-host", "codex-code-mode-host.exe"] {
                let host = dir.join(name);
                if host.as_path() != path && self::real(&host).starts_with(&standalone_real) {
                    files.push(host);
                }
            }
            files.push(standalone);
            Some(files)
        }
        // OpenCode's script: one program in `~/.opencode/bin`.
        "opencode" => {
            let dir = homes.home.join(".opencode").join("bin");
            (path.parent() == Some(dir.as_path())).then(|| vec![path.to_path_buf()])
        }
        // Antigravity's script: one program copied into `~/.local/bin`.
        "agy" => in_local_bin.then(|| vec![path.to_path_buf()]),
        // Hermes Agent's script: a checkout in `<hermes home>/hermes-agent` and wrappers that start
        // it; `run` takes every wrapper naming that checkout.
        "hermes" => {
            let checkout = homes.hermes_home.join("hermes-agent");
            let ours = hermes_launchers::wrapper_names(path, &checkout)
                || hermes_launchers::starts_checkout(path, &checkout)
                || real.starts_with(self::real(&checkout));
            ours.then(|| vec![path.to_path_buf(), checkout])
        }
        _ => None,
    }
}

/// Uninstalls `engine`'s copy at `bin` the way `removal` says.
pub(super) async fn run(engine: &str, bin: &str, removal: Removal) -> Result<(), String> {
    match removal {
        Removal::Misty => {
            let (engine, bin) = (engine.to_string(), bin.to_string());
            tokio::task::spawn_blocking(move || routes::remove(&engine, &bin))
                .await
                .map_err(|error| error.to_string())?
        }
        Removal::Npm { prefix, package } => {
            let (program, mut args) = npm_program()
                .ok_or("npm isn't on this computer anymore, so Misty can't uninstall this copy.")?;
            args.extend([
                "uninstall".to_string(),
                "-g".to_string(),
                "--prefix".to_string(),
                prefix.to_string_lossy().into_owned(),
                package.to_string(),
            ]);
            run_program("npm", &program, &args, &[]).await
        }
        Removal::Brew { brew, name, cask } => {
            let mut args = vec!["uninstall".to_string()];
            if cask {
                args.push("--cask".into());
            }
            args.push(name);
            let env = [("HOMEBREW_NO_AUTO_UPDATE", "1"), ("NONINTERACTIVE", "1")];
            run_program("Homebrew", &brew.to_string_lossy(), &args, &env).await
        }
        Removal::Files(files) => {
            let engine = engine.to_string();
            tokio::task::spawn_blocking(move || delete_files(&engine, &files))
                .await
                .map_err(|error| error.to_string())?
        }
    }
}

/// npm to uninstall with: the computer's own, else Misty's Node.js. The global prefix is passed
/// to it, so it needn't be the npm that installed the copy.
fn npm_program() -> Option<(String, Vec<String>)> {
    if let Some(npm) = routes::computer_npm() {
        return Some((npm, Vec::new()));
    }
    node_runtime::installed().then(node_runtime::npm_argv)
}

async fn run_program(
    name: &str,
    program: &str,
    args: &[String],
    env: &[(&str, &str)],
) -> Result<(), String> {
    let mut command = super::command_for_binary(program);
    command.args(args);
    for (key, value) in env {
        command.env(key, value);
    }
    let output = super::run_capture(&mut command, UNINSTALL_TIMEOUT)
        .await
        .map_err(|error| format!("Couldn't start {name}: {error}"))?;
    finished(name, &output)
}

fn finished(name: &str, output: &ProcOutput) -> Result<(), String> {
    if output.timed_out {
        return Err(format!("{name} took too long to uninstall it. Try again."));
    }
    if output.status.is_some_and(|status| status.success()) {
        return Ok(());
    }
    let combined = format!("{}\n{}", output.stdout, output.stderr);
    let tail = super::tail(&combined, super::ERROR_TAIL_CAP);
    Err(if tail.is_empty() {
        format!("{name} couldn't uninstall it.")
    } else {
        format!("{name} couldn't uninstall it: {tail}")
    })
}

/// Deletes a maker's install: each file or link, and each folder with everything in it. Hermes
/// Agent's other wrappers for the same checkout go too. These are program folders outside the
/// file gate, as when Misty finds a program to run.
#[allow(clippy::disallowed_methods)]
fn delete_files(engine: &str, files: &[PathBuf]) -> Result<(), String> {
    if engine == "hermes" {
        // The checkout holds no record of launchers, so only those that name it go.
        if let Some(checkout) = files.last() {
            hermes_launchers::remove_owned(&hermes_launchers::dirs(), checkout, checkout);
        }
    }
    for file in files {
        let Ok(meta) = std::fs::symlink_metadata(file) else {
            continue;
        };
        let removed = if meta.is_dir() {
            std::fs::remove_dir_all(file)
        } else {
            std::fs::remove_file(file)
        };
        removed.map_err(|error| {
            format!(
                "Couldn't remove {}: {error}",
                super::shown_path(file.as_path())
            )
        })?;
    }
    Ok(())
}

fn real(path: &Path) -> PathBuf {
    super::resolve_link(&path.to_string_lossy()).unwrap_or_else(|_| path.to_path_buf())
}

#[allow(clippy::disallowed_methods)]
fn is_file(path: &Path) -> bool {
    path.is_file()
}
