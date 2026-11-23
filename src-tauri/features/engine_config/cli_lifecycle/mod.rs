// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// The engine CLIs' lifecycle in Settings › Engines and first run: the local version
// (`<cli> --version`), the latest one on npm, installing and updating, and whether the person is
// signed in, asked of the CLI itself or, for Gemini CLI and Qwen Code, read from the sign-in way
// their settings name (Misty never opens a CLI's credential files), and signing in through the
// CLI's own login in a terminal (`sign_in.rs`).
//
// Every install runs inside the app with its output streamed to the dialog, never typed into a
// terminal (`routes.rs`). An engine already on the computer is used as it is; a missing one goes
// into `~/.misty/shared/engines/<engine>`, and npm engines get Misty's own Node.js when the computer has
// none (`node_runtime.rs`). Remove deletes only what Misty installed.
//
// Probes run only when asked (Settings opened, refresh pressed), never on a timer: each one
// starts processes and the latest-version check is a network call.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use super::support;
use crate::engines::support::paths::own_copy_env;

mod developer_tools;
mod downloads;
mod hermes_launchers;
#[cfg(windows)]
pub(crate) mod job;
mod maker_builds;
mod node_runtime;
mod plan;
mod routes;
pub mod sign_in;
mod uninstall;
pub(crate) mod upkeep;
mod user_path;

pub use plan::CliUpdatePlan;

use routes::Route;

pub const CLI_UPDATE_PROGRESS_EVENT: &str = "engine-cli://update-progress";

const CLI_VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const NPM_VIEW_TIMEOUT: Duration = Duration::from_secs(15);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(15);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(420);
const ERROR_TAIL_CAP: usize = 2048;
const PROGRESS_LINE_CAP: usize = 1000;
const CAPTURE_CAP_BYTES: usize = 1024 * 1024;

fn npm_package(engine: &str) -> Option<&'static str> {
    match engine {
        "claude" => Some("@anthropic-ai/claude-code"),
        "gemini" => Some("@google/gemini-cli"),
        "qwen" => Some("@qwen-code/qwen-code"),
        "kimi" => Some("@moonshot-ai/kimi-code"),
        "codex" => Some("@openai/codex"),
        "pi" => Some("@earendil-works/pi-coding-agent"),
        "omp" => Some("@oh-my-pi/pi-coding-agent"),
        "dsh" => Some("@deepseek-ai/dsh"),
        "opencode" => Some("opencode-ai"),
        _ => None,
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliVersionStatus {
    pub engine: String,
    pub installed: bool,
    pub local_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub update_kind: Option<&'static str>,
    pub remove_kind: Option<&'static str>,
}

fn cli_binary_name(engine: &str) -> &str {
    match engine {
        "minimax" => "mcode",
        "qoder" => "qodercli",
        "qoder-cn" => "qoderclicn",
        _ => engine,
    }
}

pub(crate) fn engine_bin(engine: &str) -> String {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let overridden = settings
        .bin_override(engine)
        .is_some_and(|path| !path.trim().is_empty())
        || (engine == "codex" && settings.codex_home.is_some());
    if overridden {
        return crate::engines::engine_bin(&settings, engine);
    }
    let name = cli_binary_name(engine);
    support::find_program(name)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string())
}

pub(crate) fn command_for_binary(bin: &str) -> Command {
    #[cfg(windows)]
    let mut command = {
        let wrapper = std::path::Path::new(bin)
            .extension()
            .and_then(|ending| ending.to_str())
            .is_some_and(|ending| {
                ending.eq_ignore_ascii_case("cmd") || ending.eq_ignore_ascii_case("bat")
            });
        if wrapper {
            let mut command = Command::new("cmd");
            command.arg("/c").arg(bin);
            command
        } else {
            Command::new(bin)
        }
    };
    #[cfg(not(windows))]
    let mut command = Command::new(bin);
    command.envs(support::child_env()).envs(own_copy_env(bin));
    command
}

fn shown_path(path: &std::path::Path) -> String {
    let home = support::home_dir();
    match path.strip_prefix(&home) {
        Ok(rest) if !home.as_os_str().is_empty() => {
            let sep = std::path::MAIN_SEPARATOR;
            format!("~{sep}{}", rest.display())
        }
        _ => path.display().to_string(),
    }
}

fn npm_bin() -> String {
    support::find_program("npm")
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "npm".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub ok: bool,
    pub version: Option<String>,
}
fn native_or_npm_kind(engine: &str, bin: &str) -> &'static str {
    let resolved = resolve_link(bin)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| bin.to_string());
    if resolved.contains("node_modules") || beside_npm_package(engine, bin) {
        "npm"
    } else {
        "native"
    }
}

fn beside_npm_package(engine: &str, bin: &str) -> bool {
    let Some(package) = npm_package(engine) else {
        return false;
    };
    let path = std::path::Path::new(bin);
    path.is_absolute()
        && path
            .parent()
            .is_some_and(|dir| is_dir_outside_gate(&dir.join("node_modules").join(package)))
}

#[allow(clippy::disallowed_methods)]
fn resolve_link(bin: &str) -> std::io::Result<std::path::PathBuf> {
    std::fs::canonicalize(bin)
}

#[allow(clippy::disallowed_methods)]
fn is_dir_outside_gate(path: &std::path::Path) -> bool {
    path.is_dir()
}

fn route_for(engine: &str, bin: &str, installed: bool) -> Option<Route> {
    routes::route(engine, bin, installed, cfg!(windows))
}

pub(crate) struct CliProbe {
    pub(crate) installed: bool,
    pub(crate) version: Option<String>,
}

pub(crate) async fn probe_local_version(bin: &str) -> CliProbe {
    let mut command = command_for_binary(bin);
    command.arg("--version");
    let output = match run_capture(&mut command, CLI_VERSION_TIMEOUT).await {
        Ok(output) => output,
        Err(_) => {
            return CliProbe {
                installed: false,
                version: None,
            }
        }
    };
    let version = output
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string);
    CliProbe {
        installed: true,
        version,
    }
}

async fn probe_latest_version(package: &str) -> Option<String> {
    if let Some(version) = registry_latest(package).await {
        return Some(version);
    }
    let npm = npm_bin();
    let mut command = command_for_binary(&npm);
    command.args(["view", package, "version"]);
    let output = run_capture(&mut command, NPM_VIEW_TIMEOUT).await.ok()?;
    output
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

async fn registry_latest(package: &str) -> Option<String> {
    let client = support::http_client().ok()?;
    let url = format!(
        "https://registry.npmjs.org/{}/latest",
        package.replace('/', "%2F")
    );
    let response = timeout(NPM_VIEW_TIMEOUT, client.get(url).send())
        .await
        .ok()?
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let value: serde_json::Value = response.json().await.ok()?;
    value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn checked_engine(engine: &str) -> Result<String, String> {
    super::channels::checked_engine(engine)
}

#[tauri::command]
pub async fn engine_cli_status(engine: String) -> Result<CliVersionStatus, String> {
    let engine = checked_engine(&engine)?;
    let bin = engine_bin(&engine);
    let package = npm_package(&engine);
    let (local, latest) = tokio::join!(probe_local_version(&bin), async move {
        match package {
            Some(package) => probe_latest_version(package).await,
            None => None,
        }
    });
    let update_available = match (
        local.version.as_deref().and_then(parse_version),
        latest.as_deref().and_then(parse_version),
    ) {
        (Some(local), Some(latest)) => latest > local,
        _ => false,
    };
    Ok(CliVersionStatus {
        update_kind: route_for(&engine, &bin, local.installed).map(Route::kind),
        remove_kind: local
            .installed
            .then(|| uninstall::removal(&engine, &bin))
            .flatten()
            .map(|removal| removal.kind()),
        engine,
        installed: local.installed,
        local_version: local.version,
        latest_version: latest,
        update_available,
    })
}

#[tauri::command]
pub async fn engine_cli_update_plan(engine: String) -> Result<CliUpdatePlan, String> {
    let engine = checked_engine(&engine)?;
    let bin = engine_bin(&engine);
    let installed = probe_local_version(&bin).await.installed;
    Ok(plan::build(engine, &bin, installed).await)
}

#[tauri::command]
pub async fn engine_cli_update(engine: String, run_id: String) -> Result<UpdateResult, String> {
    let engine = checked_engine(&engine)?;
    let bin = engine_bin(&engine);
    let reporter = ProgressReporter::new(run_id, engine.clone());
    let installed = probe_local_version(&bin).await.installed;
    let route = route_for(&engine, &bin, installed)
        .ok_or_else(|| format!("Misty can't install or update {engine} for you."))?;
    if developer_tools::needed(&engine, route).await {
        developer_tools::open_installer(&reporter).await?;
        return Ok(UpdateResult {
            ok: true,
            version: None,
        });
    }
    routes::run(&engine, route, &bin, &reporter).await?;
    let probe = probe_local_version(&engine_bin(&engine)).await;
    if !probe.installed {
        return Err(format!(
            "The install finished, but Misty can't find {engine} yet. Try Check again."
        ));
    }
    Ok(UpdateResult {
        ok: true,
        version: probe.version,
    })
}

#[tauri::command]
pub async fn engine_cli_remove(engine: String) -> Result<(), String> {
    let engine = checked_engine(&engine)?;
    let bin = engine_bin(&engine);
    let removal = uninstall::removal(&engine, &bin).ok_or_else(|| {
        "Misty can't tell how this copy was installed, so it leaves it alone.".to_string()
    })?;
    uninstall::run(&engine, &bin, removal).await
}

#[allow(clippy::disallowed_methods)]
fn is_file_outside_gate(path: &std::path::Path) -> bool {
    path.is_file()
}

#[derive(Clone)]
struct ProgressReporter {
    sink: Arc<dyn support::Emit>,
    run_id: Arc<str>,
    engine: Arc<str>,
}

struct AppEmit;

impl support::Emit for AppEmit {
    fn emit_json(&self, name: &str, raw_json: &str) {
        if let Some(app) = support::app() {
            support::Emit::emit_json(app, name, raw_json);
        }
    }
}

impl ProgressReporter {
    fn new(run_id: String, engine: String) -> Self {
        Self::with_sink(Arc::new(AppEmit), run_id, engine)
    }

    fn with_sink(sink: Arc<dyn support::Emit>, run_id: String, engine: String) -> Self {
        Self {
            sink,
            run_id: run_id.into(),
            engine: engine.into(),
        }
    }

    fn emit(&self, phase: &'static str, line: Option<String>, exit_ok: Option<bool>) {
        let event = serde_json::json!([{
            "runId": self.run_id,
            "engine": self.engine,
            "phase": phase,
            "line": line,
            "exitOk": exit_ok,
        }]);
        self.sink
            .emit_json(CLI_UPDATE_PROGRESS_EVENT, &event.to_string());
    }

    fn flush(&self) {}
}

pub(crate) struct ProcOutput {
    pub(crate) status: Option<std::process::ExitStatus>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) timed_out: bool,
}

pub(crate) async fn run_capture(
    command: &mut Command,
    limit: Duration,
) -> Result<ProcOutput, String> {
    run_capture_capped(command, limit, CAPTURE_CAP_BYTES).await
}

pub(crate) async fn run_capture_capped(
    command: &mut Command,
    limit: Duration,
    cap: usize,
) -> Result<ProcOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    support::hide_console_tokio(command);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    #[cfg(windows)]
    let _tree_guard = job::assign_kill_on_close(&child);
    let stdout = child.stdout.take().map(|pipe| spawn_read_all(pipe, cap));
    let stderr = child.stderr.take().map(|pipe| spawn_read_all(pipe, cap));
    let (status, timed_out) = match timeout(limit, child.wait()).await {
        Ok(Ok(status)) => (Some(status), false),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            if let Some(pid) = pid {
                support::kill_process_group(pid);
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
            (None, true)
        }
    };
    #[cfg(unix)]
    if let Some(pid) = pid.filter(|p| *p != 0) {
        support::kill_process_group(pid);
    }
    let stdout = match stdout {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    let stderr = match stderr {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    Ok(ProcOutput {
        status,
        stdout,
        stderr,
        timed_out,
    })
}

fn spawn_read_all<R: AsyncRead + Unpin + Send + 'static>(
    pipe: R,
    cap: usize,
) -> JoinHandle<String> {
    tokio::spawn(async move {
        let mut taken = pipe.take((cap + 1) as u64);
        let mut bytes = Vec::new();
        let _ = taken.read_to_end(&mut bytes).await;
        let _ = tokio::io::copy(&mut taken.into_inner(), &mut tokio::io::sink()).await;
        String::from_utf8_lossy(&bytes).into_owned()
    })
}
async fn run_streaming(
    command: &mut Command,
    limit: Duration,
    reporter: &ProgressReporter,
) -> Result<ProcOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    support::hide_console_tokio(command);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    #[cfg(windows)]
    let _tree_guard = job::assign_kill_on_close(&child);
    reporter.emit("started", None, None);
    let stdout = child
        .stdout
        .take()
        .map(|pipe| spawn_read_lines(pipe, reporter.clone(), "stdout"));
    let stderr = child
        .stderr
        .take()
        .map(|pipe| spawn_read_lines(pipe, reporter.clone(), "stderr"));
    let (status, timed_out) = match timeout(limit, child.wait()).await {
        Ok(Ok(status)) => (Some(status), false),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            if let Some(pid) = pid {
                support::kill_process_group(pid);
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
            (None, true)
        }
    };
    #[cfg(unix)]
    if let Some(pid) = pid.filter(|p| *p != 0) {
        support::kill_process_group(pid);
    }
    let stdout = match stdout {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    let stderr = match stderr {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    reporter.emit("finished", None, status.map(|s| s.success()));
    reporter.flush();
    Ok(ProcOutput {
        status,
        stdout,
        stderr,
        timed_out,
    })
}

fn spawn_read_lines<R: AsyncRead + Unpin + Send + 'static>(
    pipe: R,
    reporter: ProgressReporter,
    stream: &'static str,
) -> JoinHandle<String> {
    tokio::spawn(async move {
        let mut lines = tokio::io::BufReader::new(pipe).lines();
        let mut captured = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if captured.len() + line.len() <= CAPTURE_CAP_BYTES {
                captured.push_str(&line);
                captured.push('\n');
            }
            let clipped = if line.chars().count() > PROGRESS_LINE_CAP {
                line.chars().take(PROGRESS_LINE_CAP).collect()
            } else {
                line
            };
            reporter.emit(stream, Some(clipped), None);
        }
        captured
    })
}

fn tail(text: &str, cap: usize) -> &str {
    if text.len() <= cap {
        return text.trim();
    }
    let mut start = text.len() - cap;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].trim()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliSignInStatus {
    pub engine: String,
    pub installed: bool,
    pub signed_in: Option<bool>,
    pub detail: Option<String>,
}

fn sign_in_status_args(engine: &str) -> Option<&'static [&'static str]> {
    match engine {
        "claude" => Some(&["auth", "status"]),
        "codex" => Some(&["login", "status"]),
        "qoder" | "qoder-cn" => Some(&["status"]),
        "grok" => Some(&["models"]),
        _ => None,
    }
}

fn parse_sign_in(output: &ProcOutput) -> (Option<bool>, Option<String>) {
    let text = format!("{}\n{}", output.stdout, output.stderr);
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('{'))
        .collect();
    let detail = lines
        .iter()
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            ["account", "logged", "signed", "authenticated"]
                .iter()
                .any(|word| lower.contains(word))
        })
        .or(lines.first())
        .map(|line| line.chars().take(200).collect::<String>());
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(output.stdout.trim()) {
        if let Some(logged_in) = value.get("loggedIn").and_then(serde_json::Value::as_bool) {
            let detail = value
                .get("email")
                .or_else(|| value.get("authMethod"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .or(detail);
            return (Some(logged_in), detail);
        }
    }
    let lower = text.to_ascii_lowercase();
    if ["not logged in", "not signed in", "not authenticated"]
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return (Some(false), detail);
    }
    match output.status {
        Some(status) => (Some(status.success()), detail),
        None => (None, detail),
    }
}

fn settings_sign_in(engine: &str) -> Option<(Option<bool>, Option<String>)> {
    let folder = match engine {
        "gemini" => std::env::var_os("GEMINI_CLI_HOME")
            .filter(|home| !home.is_empty())
            .map(std::path::PathBuf::from)
            .unwrap_or_else(support::home_dir)
            .join(".gemini"),
        "qwen" => support::home_dir().join(".qwen"),
        _ => return None,
    };
    let settings = file_access::fs::read_to_string(folder.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
    let selected = settings.as_ref().and_then(|value| {
        value
            .pointer("/security/auth/selectedType")
            .or_else(|| value.get("selectedAuthType"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    });
    Some(sign_in_from_selection(
        selected.as_deref(),
        file_access::fs::is_file(folder.join("oauth_creds.json")),
    ))
}

fn sign_in_from_selection(
    selected: Option<&str>,
    creds_exist: bool,
) -> (Option<bool>, Option<String>) {
    match selected {
        None | Some("") => (Some(false), None),
        Some(kind @ ("oauth-personal" | "qwen-oauth" | "login-with-google")) => {
            (Some(creds_exist), Some(kind.to_string()))
        }
        Some(kind) => (Some(true), Some(kind.to_string())),
    }
}

fn agy_sign_in() -> (Option<bool>, Option<String>) {
    let token = crate::engines::agy::agy_home().join("antigravity-oauth-token");
    let signed_in = (cfg!(target_os = "linux") && is_file_outside_gate(&token))
        || crate::engines::support::settings::signed_in_here("agy");
    (Some(signed_in), None)
}

#[tauri::command]
pub async fn engine_cli_signed_in(engine: String) -> Result<CliSignInStatus, String> {
    let engine = checked_engine(&engine)?;
    let bin = engine_bin(&engine);
    let known = match engine.as_str() {
        "agy" => Some(agy_sign_in()),
        _ => sign_in::remembered_sign_in(&engine).or_else(|| settings_sign_in(&engine)),
    };
    if let Some((signed_in, detail)) = known {
        let installed = probe_local_version(&bin).await.installed;
        return Ok(CliSignInStatus {
            engine,
            installed,
            signed_in: installed.then_some(signed_in).flatten(),
            detail,
        });
    }
    let Some(args) = sign_in_status_args(&engine) else {
        let installed = probe_local_version(&bin).await.installed;
        return Ok(CliSignInStatus {
            engine,
            installed,
            signed_in: None,
            detail: None,
        });
    };
    let mut command = command_for_binary(&bin);
    command.args(args);
    let Ok(output) = run_capture(&mut command, SIGN_IN_TIMEOUT).await else {
        return Ok(CliSignInStatus {
            engine,
            installed: false,
            signed_in: None,
            detail: None,
        });
    };
    let (signed_in, detail) = if output.timed_out {
        (None, None)
    } else {
        parse_sign_in(&output)
    };
    Ok(CliSignInStatus {
        engine,
        installed: true,
        signed_in,
        detail,
    })
}

fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let text = text.trim();
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let mut parts = text[start..].split('.');
    let major = leading_number(parts.next()?)?;
    let minor = parts.next().and_then(leading_number).unwrap_or(0);
    let patch = parts.next().and_then(leading_number).unwrap_or(0);
    Some((major, minor, patch))
}

fn leading_number(text: &str) -> Option<u64> {
    let digits: String = text.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

#[cfg(test)]
#[path = "install_tests.rs"]
mod install_tests;

#[cfg(test)]
#[path = "download_tests.rs"]
mod download_tests;

#[cfg(test)]
#[path = "build_tests.rs"]
mod build_tests;

#[cfg(test)]
#[path = "user_path_tests.rs"]
mod user_path_tests;
