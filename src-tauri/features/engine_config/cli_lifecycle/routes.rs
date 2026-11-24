use std::path::Path;

use super::{hermes_launchers, maker_builds, node_runtime, npm_package, support, ProgressReporter};
use crate::engines::support::paths::{engine_install_dir, InstallRoot};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Route {
    MistyNpm,
    MistyDownload,
    MistyScript,
    NpmGlobal,
    VendorScript,
    SelfUpdate,
}

impl Route {
    pub(super) fn kind(self) -> &'static str {
        match self {
            Route::MistyNpm | Route::NpmGlobal => "npm",
            _ => "native",
        }
    }
}

pub(super) fn installed_by_misty(engine: &str, bin: &str) -> bool {
    installed_by_misty_in(&InstallRoot::here(), engine, bin)
}

pub(super) fn installed_by_misty_in(root: &InstallRoot, engine: &str, bin: &str) -> bool {
    let path = Path::new(bin);
    if !path.is_absolute() {
        return false;
    }
    let Some(parent) = path.parent() else {
        return false;
    };
    if real(parent).starts_with(real(&root.engine_dir(engine))) {
        return true;
    }
    let checkout = root.checkout_dir(engine);
    engine == "hermes"
        && (hermes_launchers::wrapper_names(path, &checkout)
            || hermes_launchers::starts_checkout(path, &checkout))
}

fn real(path: &Path) -> std::path::PathBuf {
    super::resolve_link(&path.to_string_lossy()).unwrap_or_else(|_| path.to_path_buf())
}

pub(super) fn script_target(root: &InstallRoot, engine: &str) -> std::path::PathBuf {
    if engine == "hermes" {
        root.checkout_dir(engine)
    } else {
        root.engine_dir(engine).join("bin")
    }
}

pub(super) fn route(engine: &str, bin: &str, installed: bool) -> Option<Route> {
    route_in(&InstallRoot::here(), engine, bin, installed)
}

pub(super) fn route_in(
    root: &InstallRoot,
    engine: &str,
    bin: &str,
    installed: bool,
) -> Option<Route> {
    let has_npm = npm_package(engine).is_some();
    if !installed {
        return match engine {
            "claude" | "codex" | "agy" => Some(Route::MistyDownload),
            "hermes" => Some(Route::MistyScript),
            _ if has_npm => Some(Route::MistyNpm),
            _ => None,
        };
    }
    if installed_by_misty_in(root, engine, bin) {
        let npm = bin.contains("node_modules");
        return match engine {
            _ if npm && has_npm => Some(Route::MistyNpm),
            "claude" | "codex" | "agy" => Some(Route::MistyDownload),
            "hermes" => Some(Route::MistyScript),
            _ if has_npm => Some(Route::MistyNpm),
            _ => None,
        };
    }
    let npm_copy = super::native_or_npm_kind(engine, bin) == "npm";
    match engine {
        _ if npm_copy && has_npm => Some(Route::NpmGlobal),
        "claude" => Some(Route::SelfUpdate),
        "codex" | "agy" | "hermes" => Some(Route::VendorScript),
        _ if has_npm => Some(Route::NpmGlobal),
        _ => None,
    }
}

pub(super) fn npm_prefix_args(dir: &Path, package: &str) -> Vec<String> {
    vec![
        "install".into(),
        "--prefix".into(),
        dir.to_string_lossy().into_owned(),
        "--no-audit".into(),
        "--no-fund".into(),
        "--maxsockets=1".into(),
        "--fetch-retries=5".into(),
        format!("{package}@latest"),
    ]
}

fn npm_global_args(package: &str) -> Vec<String> {
    vec![
        "install".into(),
        "-g".into(),
        "--no-audit".into(),
        "--no-fund".into(),
        format!("{package}@latest"),
    ]
}

pub(super) fn computer_npm() -> Option<String> {
    let found = support::find_program("npm")?;
    let runtime = crate::engines::support::paths::node_runtime_dir();
    (!found.starts_with(&runtime)).then(|| found.to_string_lossy().into_owned())
}

pub(super) fn needs_node() -> bool {
    !node_runtime::installed() && computer_npm().is_none()
}

fn script_url(engine: &str, windows: bool) -> &'static str {
    match (engine, windows) {
        ("agy", false) => "https://antigravity.google/cli/install.sh",
        ("agy", true) => "https://antigravity.google/cli/install.ps1",
        ("hermes", false) => "https://hermes-agent.nousresearch.com/install.sh",
        ("hermes", true) => "https://hermes-agent.nousresearch.com/install.ps1",
        (_, false) => "https://chatgpt.com/codex/install.sh",
        (_, true) => "https://chatgpt.com/codex/install.ps1",
    }
}

pub(super) fn script_argv(
    engine: &str,
    into: Option<&Path>,
    windows: bool,
) -> (String, Vec<String>, Vec<(String, String)>) {
    let url = script_url(engine, windows);
    let mut env = vec![("CODEX_NON_INTERACTIVE".to_string(), "1".to_string())];
    if let Some(into) = into {
        env.push((
            "MISTY_ENGINE_DIR".into(),
            into.to_string_lossy().into_owned(),
        ));
        if let Some(home) = installer_home(engine, into, windows) {
            let data = support::hermes_home().to_string_lossy().into_owned();
            env.push(("HERMES_HOME".into(), data));
            env.push(("HOME".into(), home.to_string_lossy().into_owned()));
        }
    }
    let quiet = match (engine, windows) {
        ("hermes", false) => Some("--non-interactive"),
        ("hermes", true) => Some("-NonInteractive"),
        _ => None,
    };
    let folder_flag = into.and(match (engine, windows) {
        ("hermes", false) => Some("--dir"),
        ("hermes", true) => Some("-InstallDir"),
        _ => None,
    });
    if windows {
        let mut flags: Vec<String> = quiet.into_iter().map(str::to_string).collect();
        if let Some(flag) = folder_flag {
            flags.push(format!("{flag} $env:MISTY_ENGINE_DIR"));
        }
        let script = if flags.is_empty() {
            format!("irm {url} | iex")
        } else {
            format!("& ([scriptblock]::Create((irm {url}))) {}", flags.join(" "))
        };
        let args = vec![
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-Command".into(),
            script,
        ];
        (windows_powershell_path(), args, env)
    } else {
        let mut flags: Vec<String> = quiet.into_iter().map(str::to_string).collect();
        if let Some(flag) = folder_flag {
            flags.push(format!("{flag} \"$MISTY_ENGINE_DIR\""));
        }
        let rest = if flags.is_empty() {
            String::new()
        } else {
            format!(" -s -- {}", flags.join(" "))
        };
        let line = format!("set -o pipefail; curl -fsSL {url} | bash{rest}");
        let bash = if super::is_file_outside_gate(Path::new("/bin/bash")) {
            "/bin/bash"
        } else {
            "bash"
        };
        (bash.into(), vec!["-c".into(), line], env)
    }
}

pub(super) fn installer_home(
    engine: &str,
    into: &Path,
    windows: bool,
) -> Option<std::path::PathBuf> {
    (engine == "hermes" && !windows)
        .then(|| into.parent().map(|folder| folder.join("home")))
        .flatten()
}

fn windows_powershell_path() -> String {
    let root = std::env::var("SystemRoot")
        .ok()
        .filter(|root| !root.trim().is_empty())
        .unwrap_or_else(|| "C:\\Windows".to_string());
    format!(
        "{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        root.trim_end_matches('\\')
    )
}

pub(super) fn plan_steps(engine: &str, route: Route, bin: &str, helper: bool) -> Vec<String> {
    let windows = cfg!(windows);
    let package = npm_package(engine).unwrap_or_default();
    match route {
        Route::MistyNpm => {
            let mut steps = Vec::new();
            if helper {
                steps.push(node_runtime::plan_step());
            }
            steps.push(format!(
                "npm {}",
                shown_args(&npm_prefix_args(&engine_install_dir(engine), package))
            ));
            steps
        }
        Route::NpmGlobal => vec![format!("npm {}", npm_global_args(package).join(" "))],
        Route::MistyDownload => vec![maker_builds::plan_step(engine)],
        Route::MistyScript | Route::VendorScript => {
            let into =
                (route == Route::MistyScript).then(|| script_target(&InstallRoot::here(), engine));
            let (_, args, env) = script_argv(engine, into.as_deref(), windows);
            let mut steps: Vec<String> = env
                .iter()
                .filter(|(key, _)| key != "MISTY_ENGINE_DIR")
                .map(|(key, value)| format!("{key}={}", super::shown_path(Path::new(value))))
                .collect();
            steps.push(args.last().cloned().unwrap_or_default());
            if let Some(into) = into {
                steps.push(format!("Into {}", super::shown_path(&into)));
            }
            steps
        }
        Route::SelfUpdate => vec![format!("{bin} update")],
    }
}

fn shown_args(args: &[String]) -> String {
    args.iter()
        .map(|arg| super::shown_path(Path::new(arg)))
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) async fn run(
    engine: &str,
    route: Route,
    bin: &str,
    reporter: &ProgressReporter,
) -> Result<(), String> {
    let windows = cfg!(windows);
    let package = npm_package(engine).unwrap_or_default();
    match route {
        Route::MistyNpm => {
            let computer = (!node_runtime::installed()).then(computer_npm).flatten();
            let (program, mut args, misty_node) = match computer {
                Some(npm) => (npm, Vec::new(), false),
                None => {
                    if !node_runtime::installed() {
                        reporter.emit("step", Some("helper".into()), None);
                        node_runtime::ensure(reporter).await?;
                    }
                    let (node, args) = node_runtime::npm_argv();
                    (node, args, true)
                }
            };
            reporter.emit("step", Some("engine".into()), None);
            file_access::fs::create_dir_all(engine_install_dir(engine))
                .map_err(|error| error.to_string())?;
            args.extend(npm_prefix_args(&engine_install_dir(engine), package));
            run_program("npm", &program, &args, &[], misty_node, reporter).await
        }
        Route::NpmGlobal => {
            let npm = computer_npm()
                .ok_or("npm isn't on this computer anymore, so this copy can't be updated here.")?;
            run_program("npm", &npm, &npm_global_args(package), &[], false, reporter).await
        }
        Route::MistyDownload => {
            reporter.emit("step", Some("engine".into()), None);
            maker_builds::install(engine, reporter).await
        }
        Route::MistyScript | Route::VendorScript => {
            reporter.emit("step", Some("engine".into()), None);
            let into =
                (route == Route::MistyScript).then(|| script_target(&InstallRoot::here(), engine));
            if let Some(into) = &into {
                let folder = into.parent().unwrap_or(into);
                file_access::fs::create_dir_all(folder).map_err(|error| error.to_string())?;
                if let Some(home) = installer_home(engine, into, windows) {
                    file_access::fs::create_dir_all(home).map_err(|error| error.to_string())?;
                }
            }
            let launchers = (engine == "hermes" && windows && into.is_some())
                .then(|| hermes_launchers::absent(&hermes_launchers::dirs()));
            #[cfg(windows)]
            let path_guard = launchers
                .is_some()
                .then(|| super::user_path::Guard::take(&support::hermes_home().join("bin")));
            let (program, args, env) = script_argv(engine, into.as_deref(), windows);
            let ran = run_program("The installer", &program, &args, &env, false, reporter).await;
            #[cfg(windows)]
            if let Some(guard) = path_guard {
                guard.restore(reporter);
            }
            ran?;
            match launchers {
                Some(absent) => {
                    hermes_launchers::record_created(&engine_install_dir(engine), &absent)
                }
                None => Ok(()),
            }
        }
        Route::SelfUpdate => {
            reporter.emit("step", Some("engine".into()), None);
            run_program(engine, bin, &["update".to_string()], &[], false, reporter).await
        }
    }
}

async fn run_program(
    name: &str,
    program: &str,
    args: &[String],
    env: &[(String, String)],
    misty_node: bool,
    reporter: &ProgressReporter,
) -> Result<(), String> {
    let mut command = super::command_for_binary(program);
    command.args(args);
    for (key, value) in env {
        command.env(key, value);
    }
    if misty_node {
        let mut dirs = vec![crate::engines::support::paths::node_runtime_bin_dir()];
        dirs.extend(std::env::split_paths(&support::search_path()));
        if let Ok(path) = std::env::join_paths(dirs) {
            command.env("PATH", path);
        }
    }
    let output = super::run_streaming(&mut command, super::INSTALL_TIMEOUT, reporter)
        .await
        .map_err(|error| format!("Couldn't start {name}: {error}"))?;
    if output.timed_out {
        return Err(format!(
            "{name} took longer than {} minutes. Check the network and try again.",
            super::INSTALL_TIMEOUT.as_secs() / 60
        ));
    }
    if output.status.is_some_and(|status| status.success()) {
        return Ok(());
    }
    let combined = format!("{}\n{}", output.stdout, output.stderr);
    let tail = super::tail(&combined, super::ERROR_TAIL_CAP);
    Err(if tail.is_empty() {
        format!("{name} stopped before it finished, and printed nothing.")
    } else {
        format!("{name} stopped before it finished. Its last output: {tail}")
    })
}

pub(super) fn remove(engine: &str, bin: &str) -> Result<(), String> {
    remove_in(&InstallRoot::here(), &hermes_launchers::dirs(), engine, bin)
}

pub(super) fn remove_in(
    root: &InstallRoot,
    wrapper_dirs: &[std::path::PathBuf],
    engine: &str,
    bin: &str,
) -> Result<(), String> {
    if !installed_by_misty_in(root, engine, bin) {
        return Err("Misty didn't install this copy, so it leaves it alone.".into());
    }
    let folder = root.engine_dir(engine);
    if engine == "hermes" {
        let checkout = root.checkout_dir(engine);
        hermes_launchers::remove_owned(wrapper_dirs, &checkout, &folder);
    }
    if file_access::fs::exists(&folder) {
        file_access::fs::remove_dir_all(&folder)
            .map_err(|error| format!("Couldn't remove it: {error}"))?;
    }
    Ok(())
}
