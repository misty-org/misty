// Signing in to an engine's CLI from Settings: the vendor's own login runs in a hidden
// pseudo-terminal, which the dialog folds under Show details. The CLI does the whole flow (its
// browser page, its device code, its key prompt) and keeps what it gets in its own files; Misty
// never reads, keeps or forwards a token.
//
// Most engines have a login command that opens the browser and exits (`sign_in_plans.rs`), so
// the dialog says in a sentence what to do on the page. Where the CLI shows a page and waits for
// its code (Claude Code, Antigravity), the dialog asks for the code in a plain field and
// `engine_cli_sign_in_code` types it, then Return, into the terminal; the code goes only to the
// pty, never into a log, an error or anything kept.
//
// Where the login is only a slash command inside the CLI's own screen (CodeBuddy's `/login`,
// Qwen Code's `/auth`), the program starts first and the command is typed once its screen is up,
// the way desktop-cc-gui drives its built-in terminal for Pi, Oh My Pi and CodeBuddy
// (terminalLogin.ts, piFamilyLogin.ts, codebuddyLogin.ts), and the person answers under Show
// details.
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

#[path = "sign_in_plans.rs"]
mod plans;
pub(crate) use plans::remembered_sign_in;
pub use plans::Asks;
use plans::{
    google_sign_in_choice, needs_version, pasted_code, remembers_sign_in, shown_command,
    sign_in_plan, Found, GoogleChoice, Plan,
};

/// Between a pasted code and its Return, so a screen that reads a burst of keys as a paste
/// still takes the Return as Enter.
const CODE_PAUSE: Duration = Duration::from_millis(120);

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
    /// For an engine with no status command: the engine, and whether this is its sign-in (true)
    /// or sign-out, recorded when the CLI exits cleanly.
    remember: Option<(String, bool)>,
    /// What the person does meanwhile: a pasted code is typed only into one that asks for it,
    /// and one whose own screen asks is remembered when the person says they're done.
    asks: Asks,
}

impl Session {
    fn record(&self) {
        if let Some((engine, signed_in)) = &self.remember {
            let _ = crate::engines::support::settings::set_signed_in_here(engine, *signed_in);
        }
    }
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
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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

fn pump(
    app: tauri::AppHandle,
    id: String,
    session: Arc<Session>,
    mut reader: Box<dyn Read + Send>,
) {
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
                        let _ = app.emit_to(
                            session.window.as_str(),
                            OUTPUT,
                            json!({ "id": id, "data": data }),
                        );
                    }
                }
            }
        }
        session.ended.store(true, Ordering::Relaxed);
        let ok = lock(&session.child)
            .wait()
            .map(|status| status.success())
            .unwrap_or(false);
        if ok {
            session.record();
        }
        let current = {
            let mut held = open();
            let current = held
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current, &session));
            if current {
                held.remove(&id);
            }
            current
        };
        if current {
            let _ = app.emit_to(
                session.window.as_str(),
                CLOSED,
                json!({ "id": id, "ok": ok }),
            );
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
            let (Some(first), Some(last)) =
                (*lock(&session.first_output), *lock(&session.last_output))
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
    /// What the person does during the sign-in.
    pub asks: Asks,
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
    let sign_out = sign_out.unwrap_or(false);
    let program = super::engine_bin(&engine);
    let mut found = Found::default();
    if needs_version(&engine) {
        found.version = super::probe_local_version(&program)
            .await
            .version
            .as_deref()
            .and_then(super::parse_version);
    }
    if engine == "gemini" && !sign_out {
        found.google_chosen = tokio::task::spawn_blocking(choose_google_sign_in)
            .await
            .unwrap_or(false);
    }
    let plan = sign_in_plan(&engine, provider.as_deref(), sign_out, &found)?;
    let remember = remembers_sign_in(&engine).then(|| (engine.clone(), !sign_out));
    spawn_session(
        &app, &webview, &id, &engine, &program, &plan, remember, cols, rows,
    )?;
    let name = std::path::Path::new(&program)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or(program);
    Ok(SignInStarted {
        command: shown_command(&name, &plan),
        asks: plan.asks,
    })
}

/// Makes Gemini CLI's own settings pick "Login with Google", as its `/auth` menu would, unless
/// they name another way or can't be read as plain JSON. Whether Google sign-in is now chosen.
fn choose_google_sign_in() -> bool {
    let home = std::env::var_os("GEMINI_CLI_HOME")
        .filter(|home| !home.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(support::home_dir);
    let path = home.join(".gemini").join("settings.json");
    let text = match file_access::fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return false,
    };
    match google_sign_in_choice(text.as_deref()) {
        GoogleChoice::Chosen => true,
        GoogleChoice::Write(written) => support::atomic_write(&path, &written).is_ok(),
        GoogleChoice::Leave => false,
    }
}

/// Starts `program` with the plan's arguments in a new pseudo-terminal the window `webview` shows
/// as `id`, with the search PATH and the proxy from Settings; the plan's line is typed once its
/// screen is up. `name` is what an error calls the program.
#[allow(clippy::too_many_arguments)]
fn spawn_session(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    id: &str,
    name: &str,
    program: &str,
    plan: &Plan,
    remember: Option<(String, bool)>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    {
        let held = open();
        if held.contains_key(id) {
            return Err("That terminal is already running.".into());
        }
        if held.len() >= MOST_OPEN {
            return Err("Close the other sign-in first.".into());
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
            .is_some_and(|ending| {
                ending.eq_ignore_ascii_case("cmd") || ending.eq_ignore_ascii_case("bat")
            });
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
    command.args(&plan.args);
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
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let session = Arc::new(Session {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        window: webview.label().to_string(),
        printed: AtomicUsize::new(0),
        first_output: Mutex::new(None),
        last_output: Mutex::new(None),
        ended: AtomicBool::new(false),
        remember,
        asks: plan.asks,
    });
    open().insert(id.to_string(), Arc::clone(&session));
    pump(app.clone(), id.to_string(), Arc::clone(&session), reader);
    if let Some(line) = plan.then_type.clone() {
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

/// A code the person pasted into the sign-in dialog's field: typed into the CLI, then Return.
/// Only a sign-in that waits for a code takes one. The code is written to the pty and dropped;
/// it is never logged, kept or put into an error.
#[tauri::command]
pub async fn engine_cli_sign_in_code(
    webview: tauri::Webview,
    id: String,
    code: String,
) -> Result<(), String> {
    let session = owned(&webview, &id)?
        .filter(|session| !session.ended.load(Ordering::Relaxed))
        .ok_or("That sign-in has ended. Close this and try again.")?;
    if session.asks != Asks::Code {
        return Err("This sign-in doesn't take a code.".into());
    }
    let code = pasted_code(&code)?.to_owned();
    tokio::task::spawn_blocking(move || {
        let mut writer = lock(&session.writer);
        send_code(&mut **writer, &code, CODE_PAUSE)
            .map_err(|_| "The code couldn't reach the sign-in. Try again.".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Writes `code`, then Return on its own after `pause`.
fn send_code(writer: &mut dyn Write, code: &str, pause: Duration) -> std::io::Result<()> {
    writer.write_all(code.as_bytes())?;
    writer.flush()?;
    std::thread::sleep(pause);
    // A terminal's Enter is CR.
    writer.write_all(b"\r")?;
    writer.flush()
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
    master
        .resize(size(cols, rows))
        .map_err(|error| error.to_string())
}

/// Ends a sign-in's CLI, as its dialog closes. One that has ended changes nothing. `done` says
/// the person pressed Done on a sign-in answered in the CLI's own screen (which never ends by
/// itself), so an engine with no status command counts it as finished.
#[tauri::command]
pub fn engine_cli_sign_in_close(
    webview: tauri::Webview,
    id: String,
    done: Option<bool>,
) -> Result<(), String> {
    if owned(&webview, &id)?.is_none() {
        return Ok(());
    }
    if let Some(session) = open().remove(&id) {
        session.kill();
        if done == Some(true) && session.asks == Asks::Menu {
            session.record();
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "sign_in_tests.rs"]
mod tests;
