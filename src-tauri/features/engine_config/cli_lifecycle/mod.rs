// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// The engine CLIs' lifecycle in Settings › Engines and first run: the local version
// (`<cli> --version`), the latest one on npm, installing and updating, and whether the person is
// signed in, asked of the CLI itself or, for Gemini CLI and Qwen Code, read from the sign-in way
// their settings name (Misty never opens a CLI's credential files), and signing in through the
// CLI's own login in a terminal (`sign_in.rs`).
//
// npm installs run inside the app with their output streamed to the dialog. The vendors'
// official installer scripts (Claude Code's and Codex's standalone builds) never run as a hidden
// child: the plan carries the exact line to type into a terminal, where the person watches it
// and can stop it.
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

#[cfg(windows)]
pub(crate) mod job;
pub mod sign_in;

/// The blocker an npm install has on a computer without Node.js.
const NEEDS_NODE: &str = "This needs Node.js, which isn't on this computer yet.";

/// The event an install's output is streamed on.
pub const CLI_UPDATE_PROGRESS_EVENT: &str = "engine-cli://update-progress";

const CLI_VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const NPM_VIEW_TIMEOUT: Duration = Duration::from_secs(15);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(15);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(420);
/// Bytes of installer output quoted back in a failure error.
const ERROR_TAIL_CAP: usize = 2048;
/// Chars per streamed output line; minified progress-bar lines would
/// otherwise flood the IPC channel in one event.
const PROGRESS_LINE_CAP: usize = 1000;
/// Per-stream capture cap for run_capture/run_streaming. Callers need the
/// first line (version probes) or a failure tail — both fit in a few KB,
/// and normal npm output stays well under this. Without a cap a chatty or
/// stuck installer buffered unboundedly for up to INSTALL_TIMEOUT.
const CAPTURE_CAP_BYTES: usize = 1024 * 1024;

/// The npm package of each engine published there. Grok, Antigravity and Qoder ship through their
/// own installers, so they get the local version only: no latest version and no install action.
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
    /// How the install/update button acts: "npm" | "native"; null when the
    /// engine has no lifecycle action (grok).
    pub update_kind: Option<&'static str>,
}

/// The program each engine is started as, when it differs from the engine id.
fn cli_binary_name(engine: &str) -> &str {
    match engine {
        "minimax" => "mcode",
        "qoder" => "qodercli",
        "qoder-cn" => "qoderclicn",
        _ => engine,
    }
}

/// Where the engine's program is: the program path set in Settings › Engines when there is one,
/// else found the way Misty finds engines to run; the bare name when it isn't installed
/// (starting it then fails, which reads as not installed).
fn engine_bin(engine: &str) -> String {
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

/// A command for `bin` with Misty's search PATH and the proxy from Settings. On Windows a `.cmd`
/// or `.bat` wrapper (how npm installs a program) runs through `cmd /c`.
fn command_for_binary(bin: &str) -> Command {
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
    command.envs(support::child_env());
    command
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
/// What the one-click install dialog shows before the user confirms:
/// the exact command plus a copy-paste fallback for manual runs.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdatePlan {
    pub engine: String,
    /// "install" | "update"
    pub action: &'static str,
    /// "npm" | "native" | "none"
    pub kind: &'static str,
    pub command: Vec<String>,
    pub manual_command: String,
    /// Set when the run happens in the built-in terminal (official installer
    /// scripts): the exact line the app types there, completion marker
    /// included. npm runs stay in the app (`cli_update`) and leave this null.
    pub terminal_command: Option<String>,
    pub can_run: bool,
    pub blockers: Vec<String>,
    pub platform: &'static str,
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// Claude Code / Codex ship both as npm packages and as native installer
/// builds; pushing an npm global install onto a native install would shadow
/// it with a second binary. The npm copy is either inside a node_modules tree
/// (unix: the bin symlink resolves into it) or an npm global shim sitting next
/// to one (Windows: `%APPDATA%\npm\<cli>.cmd` beside
/// `%APPDATA%\npm\node_modules\<package>`). Not installed → "native" (the
/// official installer is the default path).
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

/// `bin` is an npm global shim: its directory holds `node_modules/<package>`.
fn beside_npm_package(engine: &str, bin: &str) -> bool {
    let Some(package) = npm_package(engine) else {
        return false;
    };
    // Only an absolute shim path has a real install directory; a bare name
    // would resolve `node_modules` against the app's working directory.
    let path = std::path::Path::new(bin);
    path.is_absolute()
        && path
            .parent()
            .is_some_and(|dir| is_dir_outside_gate(&dir.join("node_modules").join(package)))
}

// Telling an npm install from a standalone one only follows the program's link and asks whether
// a package folder sits beside it; nothing is read. These are program folders, outside the file
// gate, as when Misty finds a program to run (`engines::resolve`).
#[allow(clippy::disallowed_methods)]
fn resolve_link(bin: &str) -> std::io::Result<std::path::PathBuf> {
    std::fs::canonicalize(bin)
}

#[allow(clippy::disallowed_methods)]
fn is_dir_outside_gate(path: &std::path::Path) -> bool {
    path.is_dir()
}

fn update_kind(engine: &str, bin: &str) -> Option<&'static str> {
    if engine == "claude" || engine == "codex" {
        return Some(native_or_npm_kind(engine, bin));
    }
    npm_package(engine).map(|_| "npm")
}

/// Where a planned install runs: npm installs stream inside the app's
/// dialog; the official installer scripts are typed into the built-in
/// terminal, where the user sees the command and its output and can Ctrl+C.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunLocation {
    App,
    Terminal,
}

fn run_location(kind: &str) -> Option<RunLocation> {
    match kind {
        "npm" => Some(RunLocation::App),
        "native" => Some(RunLocation::Terminal),
        _ => None,
    }
}

pub(crate) struct CliProbe {
    pub(crate) installed: bool,
    pub(crate) version: Option<String>,
}

/// `<bin> --version`: first non-empty stdout line, 10s cap. A spawn failure
/// means not installed; a successful run with no version line still counts
/// as installed (we just have nothing to display).
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

/// The latest published version, from the npm registry (`/<package>/latest`), through the
/// proxy from Settings. Falls back to `npm view` when the registry can't be reached directly
/// (an npm config with its own registry or proxy).
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
    // Local probe and registry probe are independent — run them concurrently
    // so the header waits on the slower of the two, not the sum.
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
        update_kind: update_kind(&engine, &bin),
        engine,
        installed: local.installed,
        local_version: local.version,
        latest_version: latest,
        update_available,
    })
}

/// Execution plan for the confirm dialog: same argv the run uses, so the
/// preview can never drift from what actually executes.
#[tauri::command]
pub async fn engine_cli_update_plan(engine: String) -> Result<CliUpdatePlan, String> {
    let engine = checked_engine(&engine)?;
    let bin = engine_bin(&engine);
    let installed = probe_local_version(&bin).await.installed;
    let kind = update_kind(&engine, &bin);
    let (command, manual_command, terminal_command, blockers) = match kind {
        Some("npm") => {
            let package = npm_package(&engine).expect("npm kind implies package");
            let (program, args) = npm_install_argv(package);
            let command: Vec<String> = std::iter::once(program).chain(args).collect();
            let manual = command.join(" ");
            // Without npm the install can only fail, so the plan says what's missing first.
            let blockers = if support::find_program("npm").is_none() {
                vec![NEEDS_NODE.to_string()]
            } else {
                Vec::new()
            };
            (command, manual, None, blockers)
        }
        Some("native") => {
            let shell = shell_kind(&terminal_shell_path());
            let line = native_terminal_line(&engine, shell, cfg!(windows));
            (
                vec![line.clone()],
                native_manual_command(&engine, cfg!(windows)),
                Some(line),
                Vec::new(),
            )
        }
        _ => (
            Vec::new(),
            String::new(),
            None,
            vec![format!("Misty can't install or update {engine} for you.")],
        ),
    };
    Ok(CliUpdatePlan {
        action: if installed { "update" } else { "install" },
        kind: kind.unwrap_or("none"),
        can_run: blockers.is_empty(),
        manual_command,
        command,
        terminal_command,
        blockers,
        engine,
        platform: platform_name(),
    })
}

#[tauri::command]
pub async fn engine_cli_update(engine: String, run_id: String) -> Result<UpdateResult, String> {
    let engine = checked_engine(&engine)?;
    let bin = engine_bin(&engine);
    let reporter = ProgressReporter::new(run_id, engine.clone());
    let kind = update_kind(&engine, &bin).unwrap_or("none");
    match run_location(kind) {
        Some(RunLocation::App) => {
            let package = npm_package(&engine).expect("npm kind implies package");
            run_npm_install(package, &reporter).await?;
        }
        // Never run the official installer as a hidden child of the app: it runs in the install
        // dialog's terminal (`sign_in::engine_cli_install_in_terminal`), where the person
        // watches it.
        Some(RunLocation::Terminal) => {
            return Err(format!(
                "{engine}'s official installer runs in the install dialog's terminal."
            ))
        }
        None => return Err(format!("Misty can't install or update {engine} for you.")),
    }
    // The version after the install, found again in case the install moved the program.
    let probe = probe_local_version(&engine_bin(&engine)).await;
    Ok(UpdateResult {
        ok: true,
        version: probe.version,
    })
}

/// npm global install argv, shared by the plan preview and the run so the
/// dialog always shows exactly what will execute.
fn npm_install_argv(package: &str) -> (String, Vec<String>) {
    let npm = npm_bin();
    let args = vec![
        "install".to_string(),
        "-g".to_string(),
        "--maxsockets=1".to_string(),
        "--fetch-retries=5".to_string(),
        "--no-audit".to_string(),
        "--no-fund".to_string(),
        format!("{package}@latest"),
    ];
    (npm, args)
}

/// Printed after a terminal install finishes, followed by its exit code (`0` = success). The
/// typed line itself never holds this marker followed by a digit, so the echo of the command
/// can't be taken for completion.
const CLI_DONE_MARKER: &str = "__MISTY_CLI_DONE__";

/// The shell a terminal opens with: `$SHELL`, or `%COMSPEC%` on Windows.
fn terminal_shell_path() -> String {
    let key = if cfg!(windows) { "COMSPEC" } else { "SHELL" };
    std::env::var(key).unwrap_or_else(|_| {
        if cfg!(windows) {
            "cmd.exe".into()
        } else {
            "/bin/zsh".into()
        }
    })
}

/// The shell that owns the built-in terminal, for typing a line it accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellKind {
    Posix,
    Fish,
    PowerShell,
    Cmd,
    Other,
}

fn shell_kind(shell_path: &str) -> ShellKind {
    let name = shell_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match name.strip_suffix(".exe").unwrap_or(&name) {
        "sh" | "bash" | "zsh" | "ksh" | "dash" | "ash" => ShellKind::Posix,
        "fish" => ShellKind::Fish,
        "pwsh" | "powershell" => ShellKind::PowerShell,
        "cmd" => ShellKind::Cmd,
        _ => ShellKind::Other,
    }
}

/// Official installer script URLs: (POSIX `.sh`, Windows `.ps1`). Both
/// handle fresh installs and in-place updates; Codex's updates
/// `~/.local/bin/codex` (or `$CODEX_INSTALL_DIR`) instead of an npm copy.
fn installer_urls(engine: &str) -> (&'static str, &'static str) {
    if engine == "codex" {
        (
            "https://chatgpt.com/codex/install.sh",
            "https://chatgpt.com/codex/install.ps1",
        )
    } else {
        (
            "https://claude.ai/install.sh",
            "https://claude.ai/install.ps1",
        )
    }
}

/// The official one-liner for copy-paste (no completion marker).
fn native_manual_command(engine: &str, windows: bool) -> String {
    let (sh, ps1) = installer_urls(engine);
    if windows {
        format!("irm {ps1} | iex")
    } else {
        format!("curl -fsSL {sh} | bash")
    }
}

/// `%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, resolved
/// here so the typed line never depends on command lookup.
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

/// The exact line typed into the built-in terminal: the official installer
/// for this platform, in the terminal shell's syntax, followed by a marker
/// carrying the exit code. Visible and interruptible on purpose — the old
/// hidden `powershell -ExecutionPolicy Bypass -Command "irm … | iex"` child
/// of the GUI is a download-and-execute pattern endpoint security flags.
fn native_terminal_line(engine: &str, shell: ShellKind, windows: bool) -> String {
    let (sh, ps1) = installer_urls(engine);
    let marker = CLI_DONE_MARKER;
    let ps_status = format!("\"{marker}$(if ($?) {{ 0 }} else {{ 1 }})\"");
    if windows {
        // The terminal opens in the workspace, and cmd resolves a bare name
        // from the current directory before PATH: `powershell` could run a
        // repo-planted powershell.bat. Always spell out the system binary.
        let exe = windows_powershell_path();
        let args = format!("-NoProfile -Command \"irm {ps1} | iex\"");
        let quoted_backslash = format!("\"{exe}\" {args}");
        let quoted_slash = format!("'{}' {args}", exe.replace('\\', "/"));
        // cmd expands %errorlevel% before the line runs, so branch on the
        // result instead; `^_` keeps the typed text from matching the marker.
        let cmd_marker = &marker[..marker.len() - 1];
        match shell {
            ShellKind::PowerShell => format!("irm {ps1} | iex; {ps_status}"),
            ShellKind::Cmd => {
                format!("{quoted_backslash} && echo {cmd_marker}^_0 || echo {cmd_marker}^_1")
            }
            ShellKind::Posix => format!("{quoted_slash}; echo \"{marker}$?\""),
            ShellKind::Fish => format!("{quoted_slash}; echo \"{marker}$status\""),
            ShellKind::Other => quoted_backslash,
        }
    } else {
        let official = format!("curl -fsSL {sh} | bash");
        // pipefail in an explicit bash: a failed download must not read as
        // success (a pipe reports its last command), and the user's own
        // interactive shell options stay untouched.
        let checked = format!("bash -c 'set -o pipefail; {official}'");
        match shell {
            ShellKind::Posix => format!("{checked}; echo \"{marker}$?\""),
            ShellKind::Fish => format!("{checked}; echo \"{marker}$status\""),
            ShellKind::PowerShell => format!("{checked}; {ps_status}"),
            ShellKind::Cmd | ShellKind::Other => official,
        }
    }
}

/// The vendor installer as a program and its arguments, for the install dialog's own terminal
/// (`sign_in::engine_cli_install_in_terminal`), and the line it shows. Run directly rather than
/// typed into a shell, so the installer's exit is the terminal's end and no completion marker is
/// needed. `None` unless this engine installs through its vendor's script here.
pub(crate) fn native_installer_argv(engine: &str) -> Option<(String, Vec<String>, String)> {
    if update_kind(engine, &engine_bin(engine)) != Some("native") {
        return None;
    }
    let (sh, ps1) = installer_urls(engine);
    if cfg!(windows) {
        // The full path, never a bare `powershell` a folder could shadow.
        let program = windows_powershell_path();
        let script = format!("irm {ps1} | iex");
        let args = vec!["-NoProfile".to_string(), "-Command".to_string(), script.clone()];
        Some((program, args, script))
    } else {
        // pipefail, so a failed download doesn't read as success (a pipe reports its last
        // command), in a bash of its own that leaves the person's shell options alone.
        let official = format!("curl -fsSL {sh} | bash");
        let program = if is_file_outside_gate(std::path::Path::new("/bin/bash")) {
            "/bin/bash".to_string()
        } else {
            "bash".to_string()
        };
        let args = vec!["-c".to_string(), format!("set -o pipefail; {official}")];
        Some((program, args, official))
    }
}

#[allow(clippy::disallowed_methods)]
fn is_file_outside_gate(path: &std::path::Path) -> bool {
    path.is_file()
}

async fn run_npm_install(package: &str, reporter: &ProgressReporter) -> Result<(), String> {
    let (npm, args) = npm_install_argv(package);
    let mut command = command_for_binary(&npm);
    command.args(&args);
    let output = run_streaming(&mut command, INSTALL_TIMEOUT, reporter)
        .await
        .map_err(|e| format!("Couldn't run npm ({npm}): {e}"))?;
    if output.timed_out {
        return Err(
            "npm took longer than 420 seconds. Check the network and try again.".to_string(),
        );
    }
    if !output.status.map(|s| s.success()).unwrap_or(false) {
        let combined = format!("{}\n{}", output.stdout, output.stderr);
        let tail = tail(&combined, ERROR_TAIL_CAP);
        return Err(format!(
            "npm couldn't install it. {}",
            if tail.is_empty() {
                "It printed nothing.".to_string()
            } else {
                format!("Its last output: {tail}")
            }
        ));
    }
    Ok(())
}

// ==================== Progress streaming ====================

/// Streams an install's output to the dialog as `engine-cli://update-progress` events, each an
/// array of lines, so the dialog shows the install as it happens. `run_id` scopes the events to
/// one confirmed run; the dialog ignores anything else.
#[derive(Clone)]
struct ProgressReporter {
    sink: Arc<dyn support::Emit>,
    run_id: Arc<str>,
    engine: Arc<str>,
}

/// Sends to the app's windows once setup has run.
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

    /// phase: "started" | "stdout" | "stderr" | "finished"
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

// ==================== Shared process helpers ====================

/// Run a short-lived command to completion with a timeout, capturing all of
/// stdout/stderr. The child gets its own process group (unix) so a timeout
/// kill takes grandchildren (npm's cmd/node chain) down too.
struct ProcOutput {
    status: Option<std::process::ExitStatus>,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

async fn run_capture(command: &mut Command, limit: Duration) -> Result<ProcOutput, String> {
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
    // Kill-on-close job (Windows): the taskkill timeout path only walks a
    // live tree, so a grandchild orphaned before it ran would escape; the
    // job sweeps members whenever this guard drops — timeout or completion.
    #[cfg(windows)]
    let _tree_guard = job::assign_kill_on_close(&child);
    let stdout = child.stdout.take().map(spawn_read_all);
    let stderr = child.stderr.take().map(spawn_read_all);
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
    // Settle sweep (unix): the group is empty on a clean exit (ESRCH); what
    // remains is a grandchild the probed CLI orphaned — kill it now.
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

fn spawn_read_all<R: AsyncRead + Unpin + Send + 'static>(pipe: R) -> JoinHandle<String> {
    tokio::spawn(async move {
        // Keep the first CAPTURE_CAP_BYTES + 1 bytes, then drain the rest
        // to a sink so the child never blocks on a full pipe (same
        // pattern as plugin_caps::read_stream_capped).
        let mut taken = pipe.take((CAPTURE_CAP_BYTES + 1) as u64);
        let mut bytes = Vec::new();
        let _ = taken.read_to_end(&mut bytes).await;
        let _ = tokio::io::copy(&mut taken.into_inner(), &mut tokio::io::sink()).await;
        String::from_utf8_lossy(&bytes).into_owned()
    })
}
/// Like `run_capture`, but each output line is also pushed to the progress
/// reporter as it arrives. The full text is still captured for failure
/// tails, so error reporting is unchanged.
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
    // Same kill-on-close job rationale as run_capture above.
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
    // Same unix settle sweep as run_capture above.
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

/// Read a stream line by line, reporting each line (clipped to
/// PROGRESS_LINE_CAP chars) while capturing the full text. Invalid UTF-8
/// ends the read early — captured-so-far is still returned.
fn spawn_read_lines<R: AsyncRead + Unpin + Send + 'static>(
    pipe: R,
    reporter: ProgressReporter,
    stream: &'static str,
) -> JoinHandle<String> {
    tokio::spawn(async move {
        let mut lines = tokio::io::BufReader::new(pipe).lines();
        let mut captured = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            // The capture is capped; reading and reporting go on past it so the child never
            // blocks on a full pipe.
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

/// Last `cap` bytes of `text`, on a char boundary.
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

// ==================== Signed in ====================

/// Whether the person is signed in to an engine's CLI, as the CLI itself says. `None` when the
/// CLI has no way to ask (the engine then signs in on its first run).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliSignInStatus {
    pub engine: String,
    pub installed: bool,
    pub signed_in: Option<bool>,
    /// What the CLI said, first line, for the row's tooltip (never a token: these commands print
    /// the account's email or plan at most).
    pub detail: Option<String>,
}

/// The CLI's own sign-in status command, where it has one.
fn sign_in_status_args(engine: &str) -> Option<&'static [&'static str]> {
    match engine {
        "claude" => Some(&["auth", "status"]),
        "codex" => Some(&["login", "status"]),
        _ => None,
    }
}

/// Reads a status command's answer: Claude Code prints JSON with `loggedIn`; otherwise the exit
/// code says it, and a "not logged in" line wins over a zero exit.
fn parse_sign_in(output: &ProcOutput) -> (Option<bool>, Option<String>) {
    let text = format!("{}\n{}", output.stdout, output.stderr);
    let detail = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('{'))
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
    if lower.contains("not logged in") || lower.contains("not signed in") {
        return (Some(false), detail);
    }
    match output.status {
        Some(status) => (Some(status.success()), detail),
        None => (None, detail),
    }
}

/// Gemini CLI and Qwen Code have no status command: their `settings.json` names the way they
/// sign in (`security.auth.selectedType`, or the older `selectedAuthType`), and their own sign-in
/// leaves `oauth_creds.json` beside it. Only whether that file exists is looked at: it is never
/// opened. A key or cloud way counts as signed in once chosen.
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
    let settings = std::fs::read_to_string(folder.join("settings.json"))
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
        folder.join("oauth_creds.json").is_file(),
    ))
}

fn sign_in_from_selection(selected: Option<&str>, creds_exist: bool) -> (Option<bool>, Option<String>) {
    match selected {
        None | Some("") => (Some(false), None),
        Some(kind @ ("oauth-personal" | "qwen-oauth" | "login-with-google")) => {
            (Some(creds_exist), Some(kind.to_string()))
        }
        Some(kind) => (Some(true), Some(kind.to_string())),
    }
}

#[tauri::command]
pub async fn engine_cli_signed_in(engine: String) -> Result<CliSignInStatus, String> {
    let engine = checked_engine(&engine)?;
    let bin = engine_bin(&engine);
    if let Some((signed_in, detail)) = settings_sign_in(&engine) {
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

// ==================== Version compare ====================

/// Semver-ish tuple from the first digit-run in the text: "v1.2.3",
/// "2.1.228 (Claude Code)", "1.2" all parse; anything without digits → None.
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
