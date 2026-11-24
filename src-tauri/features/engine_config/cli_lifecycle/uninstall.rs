use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{hermes_launchers, node_runtime, npm_package, routes, support, ProcOutput};
use crate::engines::support::paths::InstallRoot;

const UNINSTALL_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Removal {
    Misty,
    Npm {
        prefix: PathBuf,
        package: &'static str,
    },
    Brew {
        brew: PathBuf,
        name: String,
        cask: bool,
    },
    Files(Vec<PathBuf>),
}

impl Removal {
    pub(super) fn kind(&self) -> &'static str {
        match self {
            Removal::Misty => "misty",
            Removal::Npm { .. } => "npm",
            Removal::Brew { .. } => "brew",
            Removal::Files(_) => "maker",
        }
    }
}

pub(super) struct Homes {
    pub(super) home: PathBuf,
    pub(super) codex_home: PathBuf,
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

pub(super) fn removal(engine: &str, bin: &str) -> Option<Removal> {
    removal_in(
        &InstallRoot::here(),
        &Homes::here(),
        engine,
        bin,
        cfg!(windows),
    )
}

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
    brew_package(&real)
        .or_else(|| npm_global(engine, path, &real, windows))
        .or_else(|| maker_files(engine, path, &real, homes).map(Removal::Files))
}

fn brew_package(real: &Path) -> Option<Removal> {
    let parts: Vec<_> = real.components().collect();
    let at = parts.iter().position(|part| {
        let part = part.as_os_str();
        part == "Cellar" || part == "Caskroom"
    })?;
    let cask = parts[at].as_os_str() == "Caskroom";
    let name = parts
        .get(at + 1)?
        .as_os_str()
        .to_string_lossy()
        .into_owned();
    let prefix: PathBuf = parts[..at].iter().collect();
    let brew = prefix.join("bin").join("brew");
    (!name.is_empty() && is_file(&brew)).then_some(Removal::Brew { brew, name, cask })
}

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
    (windows || real.starts_with(self::real(&installed))).then(|| Removal::Npm {
        prefix: prefix.to_path_buf(),
        package,
    })
}

fn maker_files(engine: &str, path: &Path, real: &Path, homes: &Homes) -> Option<Vec<PathBuf>> {
    let local_bin = homes.home.join(".local").join("bin");
    let in_local_bin = path.parent() == Some(local_bin.as_path());
    match engine {
        "claude" => {
            let versions = homes.home.join(".local").join("share").join("claude");
            let ours = real.starts_with(self::real(&versions))
                || (in_local_bin && super::is_dir_outside_gate(&versions));
            ours.then(|| vec![path.to_path_buf(), versions])
        }
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
        "agy" => in_local_bin.then(|| vec![path.to_path_buf()]),
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

#[allow(clippy::disallowed_methods)]
fn delete_files(engine: &str, files: &[PathBuf]) -> Result<(), String> {
    if engine == "hermes" {
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
