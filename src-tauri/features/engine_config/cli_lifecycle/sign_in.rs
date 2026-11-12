// Signing in to an engine's CLI from Settings: the vendor's own login runs in a terminal inside
// the Settings dialog, a real pseudo-terminal the person types into. The vendor installers for
// Claude Code and Codex run in the same terminal, inside the install dialog. The CLI does the whole
// flow (its browser page, its device code, its key prompt) and keeps what it gets in its own
// files; Misty only shows the terminal and never reads, keeps or forwards a token.
//
// Where the login is a slash command inside the CLI's own screen (Pi's `/login`, CodeBuddy's
// `/login`, Gemini's `/auth`), the program starts first and the command is typed once its
// screen is up, the way desktop-cc-gui drives its built-in terminal for Pi, Oh My Pi and
// CodeBuddy (terminalLogin.ts, piFamilyLogin.ts, codebuddyLogin.ts).
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong). See NOTICE.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::json;
use tauri::Emitter;

use super::support;

const OUTPUT: &str = "engine-cli://sign-in-output";
const CLOSED: &str = "engine-cli://sign-in-closed";
/// A sign-in is one dialog at a time; a few cover a dialog reopened before its CLI ended.
const MOST_OPEN: usize = 4;
/// The CLI's screen counts as up once output has paused this long...
const SCREEN_QUIET: Duration = Duration::from_millis(450);
/// ...or has kept drawing (a spinner) this long after it began.
const SCREEN_BUSY: Duration = Duration::from_secs(3);
/// A CLI that has drawn nothing by then never gets the command typed into it.
const SCREEN_DEADLINE: Duration = Duration::from_secs(20);

/// What a sign-in starts: the program's arguments, and a command typed once its screen is up.
#[derive(Debug, PartialEq)]
struct Plan {
    args: Vec<String>,
    then_type: Option<String>,
}

fn plan(args: &[&str], then_type: Option<String>) -> Plan {
    Plan {
        args: args.iter().map(|arg| (*arg).to_string()).collect(),
        then_type,
    }
}

/// A provider id as Pi and Oh My Pi name them (`anthropic`, `openai-codex`): typed into the CLI,
/// so nothing but those characters.
fn provider_id(provider: Option<&str>) -> Result<Option<&str>, String> {
    match provider.map(str::trim).filter(|id| !id.is_empty()) {
        None => Ok(None),
        Some(id)
            if id.len() <= 64
                && id
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-') =>
        {
            Ok(Some(id))
        }
        Some(_) => Err("That isn't a provider.".into()),
    }
}

/// Each engine's own sign-in (or sign-out), as its CLI offers it.
fn sign_in_plan(engine: &str, provider: Option<&str>, sign_out: bool) -> Result<Plan, String> {
    let provider = provider_id(provider)?;
    Ok(match (engine, sign_out) {
        ("claude", false) => plan(&["auth", "login"], None),
        ("claude", true) => plan(&["auth", "logout"], None),
        ("codex", false) => plan(&["login"], None),
        ("codex", true) => plan(&["logout"], None),
        ("opencode", false) => plan(&["auth", "login"], None),
        ("opencode", true) => plan(&["auth", "logout"], None),
        // Their own "Login with Google" (or a key) is the auth dialog of their screen.
        ("gemini" | "qwen", _) => plan(&[], Some("/auth".into())),
        // Slash commands can't go through argv (Pi would send them to the model as a prompt).
        ("pi", false) => plan(
            &[],
            Some(match provider {
                Some(id) => format!("/login {id}"),
                None => "/login".into(),
            }),
        ),
        // Pi's `/logout` asks which account itself; Misty never chooses for the person.
        ("pi", true) => plan(&[], Some("/logout".into())),
        ("omp", false) => match provider {
            Some(id) => plan(&["auth-broker", "login", id], None),
            None => plan(&[], Some("/login".into())),
        },
        ("omp", true) => match provider {
            Some(id) => plan(&["auth-broker", "logout", id], None),
            None => return Err("Choose the provider to sign out of.".into()),
        },
        // Kimi Code and Qoder CLI sign in and out only through slash commands in their own
        // screen (no `login` subcommand; Qoder's `/signin` is an alias). Checked against their
        // docs (moonshotai.github.io/kimi-code, docs.qoder.com/cli/auth); ccgui has no sign-in
        // for either.
        ("codebuddy" | "kimi" | "qoder" | "qoder-cn", false) => plan(&[], Some("/login".into())),
        ("codebuddy" | "kimi" | "qoder" | "qoder-cn", true) => plan(&[], Some("/logout".into())),
        // Grok Build: `grok login` opens xAI's sign-in page (`--device-auth` prints a code for a
        // remote machine, which the person can run in the terminal themselves).
        ("grok", false) => plan(&["login"], None),
        ("grok", true) => plan(&["logout"], None),
        // MiniMax Code: `mcode login` is a mainland China account, `--region global` a Global
        // one; the person picks, Misty never guesses.
        ("minimax", false) => match provider {
            Some("global") => plan(&["login", "--region", "global"], None),
            Some("cn") | None => plan(&["login"], None),
            Some(_) => return Err("Choose Global or China.".into()),
        },
        ("minimax", true) => plan(&["logout"], None),
        // Antigravity has no login subcommand: `agy` signs in from its first screen (a browser
        // page, or a code over SSH) and signs out with `/logout` in its prompt.
        ("agy", false) => plan(&[], None),
        ("agy", true) => plan(&[], Some("/logout".into())),
        ("dsh", _) => {
            return Err("DeepSeek Harness keeps its providers in its own web page.".into())
        }
        (_, true) => return Err("Sign out from the CLI itself.".into()),
        _ => return Err("Misty can't sign in to that engine.".into()),
    })
}

/// The line the dialog shows for what runs.
fn shown_command(program: &str, plan: &Plan) -> String {
    let mut line = std::iter::once(program.to_string())
        .chain(plan.args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    if let Some(typed) = &plan.then_type {
        line.push_str(", then ");
        line.push_str(typed);
    }
    line
}

struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    window: String,
    /// Output so far and when it last came, for typing the command once the screen is up.
    printed: AtomicUsize,
    first_output: Mutex<Option<Instant>>,
    last_output: Mutex<Option<Instant>>,
    ended: AtomicBool,
}

impl Session {
    fn kill(&self) {
        let _ = lock(&self.child).kill();
    }

    fn type_line(&self, line: &str) -> Result<(), String> {
        let mut writer = lock(&self.writer);
        // A terminal's Enter is CR.
        writer
            .write_all(format!("{line}\r").as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|error| error.to_string())
    }
}

static OPEN: LazyLock<Mutex<HashMap<String, Arc<Session>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn open() -> MutexGuard<'static, HashMap<String, Arc<Session>>> {
    lock(&OPEN)
}

fn owned(webview: &tauri::Webview, id: &str) -> Result<Option<Arc<Session>>, String> {
    let Some(session) = open().get(id).cloned() else {
        return Ok(None);
    };
    if session.window != webview.label() {
        return Err("That sign-in belongs to another window.".into());
    }
    Ok(Some(session))
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(20, 400),
        rows: rows.clamp(5, 200),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Bytes into text without cutting a character in two.
fn take_text(held: &mut Vec<u8>) -> String {
    match std::str::from_utf8(held) {
        Ok(text) => {
            let text = text.to_string();
            held.clear();
            text
        }
        Err(error) if error.error_len().is_none() => {
            let good = error.valid_up_to();
            let text = String::from_utf8_lossy(&held[..good]).into_owned();
            held.drain(..good);
            text
        }
        Err(_) => {
            let text = String::from_utf8_lossy(held).into_owned();
            held.clear();
            text
        }
    }
}

fn pump(app: tauri::AppHandle, id: String, session: Arc<Session>, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut held = Vec::new();
        let mut chunk = [0_u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    let now = Instant::now();
                    lock(&session.first_output).get_or_insert(now);
                    *lock(&session.last_output) = Some(now);
                    session.printed.fetch_add(read, Ordering::Relaxed);
                    held.extend_from_slice(&chunk[..read]);
                    let data = take_text(&mut held);
                    if !data.is_empty() {
                        let _ = app.emit_to(session.window.as_str(), OUTPUT, json!({ "id": id, "data": data }));
                    }
                }
            }
        }
        session.ended.store(true, Ordering::Relaxed);
        let ok = lock(&session.child).wait().map(|status| status.success()).unwrap_or(false);
        let current = {
            let mut held = open();
            let current = held.get(&id).is_some_and(|current| Arc::ptr_eq(current, &session));
            if current {
                held.remove(&id);
            }
            current
        };
        if current {
            let _ = app.emit_to(session.window.as_str(), CLOSED, json!({ "id": id, "ok": ok }));
        }
    });
}

/// Types `line` once the CLI's screen is up: after its output pauses, or keeps going past
/// [`SCREEN_BUSY`]. A CLI that ended or drew nothing gets nothing typed.
fn type_when_ready(session: Arc<Session>, line: String) {
    std::thread::spawn(move || {
        let started = Instant::now();
        while started.elapsed() < SCREEN_DEADLINE {
            std::thread::sleep(Duration::from_millis(100));
            if session.ended.load(Ordering::Relaxed) {
                return;
            }
            let (Some(first), Some(last)) = (*lock(&session.first_output), *lock(&session.last_output))
            else {
                continue;
            };
            if last.elapsed() >= SCREEN_QUIET || first.elapsed() >= SCREEN_BUSY {
                let _ = session.type_line(&line);
                return;
            }
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInStarted {
    /// What runs, for the dialog to show.
    pub command: String,
}

/// Starts an engine's own sign-in (or, with `sign_out`, its sign-out) in a terminal the dialog
/// shows. `provider` picks Pi's or Oh My Pi's provider, or MiniMax's region (`global` or `cn`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn engine_cli_sign_in(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    engine: String,
    id: String,
    provider: Option<String>,
    sign_out: Option<bool>,
    cols: u16,
    rows: u16,
) -> Result<SignInStarted, String> {
    let engine = super::checked_engine(&engine)?;
    if id.is_empty() || id.len() > 128 {
        return Err("That isn't a sign-in.".into());
    }
    let plan = sign_in_plan(&engine, provider.as_deref(), sign_out.unwrap_or(false))?;
    let program = super::engine_bin(&engine);
    spawn_session(&app, &webview, &id, &engine, &program, &plan.args, plan.then_type.clone(), cols, rows)?;
    let name = std::path::Path::new(&program)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or(program);
    Ok(SignInStarted {
        command: shown_command(&name, &plan),
    })
}

/// Runs a CLI's vendor installer (Claude Code's or Codex's own script) in the same kind of
/// terminal as a sign-in, inside the install dialog: the person watches its output, answers its
/// prompts and can stop it with Ctrl+C or by closing the dialog. The line is worked out here from
/// the engine, never taken from the window, and its end says whether the installer succeeded.
#[tauri::command]
pub async fn engine_cli_install_in_terminal(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    engine: String,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<SignInStarted, String> {
    let engine = super::checked_engine(&engine)?;
    if id.is_empty() || id.len() > 128 {
        return Err("That isn't an install.".into());
    }
    let (program, args, shown) = super::native_installer_argv(&engine)
        .ok_or_else(|| format!("{engine} doesn't install through its vendor's installer."))?;
    spawn_session(&app, &webview, &id, "The installer", &program, &args, None, cols, rows)?;
    Ok(SignInStarted { command: shown })
}

/// Starts `program` with `args` in a new pseudo-terminal the window `webview` shows as `id`,
/// with the search PATH and the proxy from Settings. `then_type` is typed once its screen is up.
/// `name` is what an error calls the program.
#[allow(clippy::too_many_arguments)]
fn spawn_session(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    id: &str,
    name: &str,
    program: &str,
    args: &[String],
    then_type: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    {
        let held = open();
        if held.contains_key(id) {
            return Err("That terminal is already running.".into());
        }
        if held.len() >= MOST_OPEN {
            return Err("Close the other sign-in or install first.".into());
        }
    }
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|error| format!("A terminal could not be opened: {error}"))?;
    #[cfg(windows)]
    let mut command = {
        let wrapper = std::path::Path::new(program)
            .extension()
            .and_then(|ending| ending.to_str())
            .is_some_and(|ending| ending.eq_ignore_ascii_case("cmd") || ending.eq_ignore_ascii_case("bat"));
        if wrapper {
            let mut command = CommandBuilder::new("cmd");
            command.arg("/c");
            command.arg(program);
            command
        } else {
            CommandBuilder::new(program)
        }
    };
    #[cfg(not(windows))]
    let mut command = CommandBuilder::new(program);
    command.args(args);
    command.cwd(support::home_dir());
    for (key, value) in support::child_env() {
        command.env(key, value);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("{name} could not be started: {error}"))?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;
    let session = Arc::new(Session {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        window: webview.label().to_string(),
        printed: AtomicUsize::new(0),
        first_output: Mutex::new(None),
        last_output: Mutex::new(None),
        ended: AtomicBool::new(false),
    });
    open().insert(id.to_string(), Arc::clone(&session));
    pump(app.clone(), id.to_string(), Arc::clone(&session), reader);
    if let Some(line) = then_type {
        type_when_ready(session, line);
    }
    Ok(())
}

/// What the person types into the sign-in terminal.
#[tauri::command]
pub async fn engine_cli_sign_in_write(
    webview: tauri::Webview,
    id: String,
    data: String,
) -> Result<(), String> {
    let session = owned(&webview, &id)?.ok_or("That sign-in has ended.")?;
    tokio::task::spawn_blocking(move || {
        let mut writer = lock(&session.writer);
        writer
            .write_all(data.as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn engine_cli_sign_in_resize(
    webview: tauri::Webview,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let Some(session) = owned(&webview, &id)? else {
        return Ok(());
    };
    let master = lock(&session.master);
    master.resize(size(cols, rows)).map_err(|error| error.to_string())
}

/// Ends a sign-in's CLI, as its dialog closes. One that has ended changes nothing.
#[tauri::command]
pub fn engine_cli_sign_in_close(webview: tauri::Webview, id: String) -> Result<(), String> {
    if owned(&webview, &id)?.is_none() {
        return Ok(());
    }
    if let Some(session) = open().remove(&id) {
        session.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slash_logins_are_typed_after_the_screen_is_up() {
        let pi = sign_in_plan("pi", Some("anthropic"), false).unwrap();
        assert!(pi.args.is_empty());
        assert_eq!(pi.then_type.as_deref(), Some("/login anthropic"));
        let omp = sign_in_plan("omp", Some("openai-codex"), false).unwrap();
        assert_eq!(omp.args, ["auth-broker", "login", "openai-codex"]);
        assert_eq!(omp.then_type, None);
        assert_eq!(sign_in_plan("claude", None, false).unwrap().args, ["auth", "login"]);
        assert_eq!(sign_in_plan("kimi", None, false).unwrap().then_type.as_deref(), Some("/login"));
        assert_eq!(sign_in_plan("grok", None, true).unwrap().args, ["logout"]);
        assert_eq!(
            sign_in_plan("minimax", Some("global"), false).unwrap().args,
            ["login", "--region", "global"]
        );
        assert!(sign_in_plan("minimax", Some("eu"), false).is_err());
        assert_eq!(sign_in_plan("agy", None, true).unwrap().then_type.as_deref(), Some("/logout"));
    }

    #[test]
    fn providers_are_plain_ids() {
        assert!(sign_in_plan("pi", Some("x; rm -rf ~"), false).is_err());
        assert!(sign_in_plan("pi", Some("Anthropic"), false).is_err());
    }
}
