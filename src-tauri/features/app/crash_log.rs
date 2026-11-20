//! Every panic, written to `<data folder>/logs/crash.log` with its thread and backtrace.
//!
//! Misty keeps unwinding on panic (see `[profile.release]` in Cargo.toml), so a panic on the main
//! thread ends the app with exit code 101 and macOS writes no crash report. Without this file,
//! all that is left of such a quit is what scrolled past in the terminal, if there was one.
//! Panics a `catch_unwind` recovers from are written too; each entry says which thread it was on.
//!
//! The file is opened once, at startup: the panic hook takes no lock the panicking code might
//! hold (the file gate's policy among them), and skips writing rather than wait.

use std::backtrace::Backtrace;
use std::io::Write;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use file_access::fs;

/// A log over this size is moved to `crash.1.log` at startup, replacing the one before.
const KEEP_BYTES: u64 = 1024 * 1024;

static LOG: OnceLock<Mutex<fs::File>> = OnceLock::new();
/// Where the crash log is, for showing it in the file manager.
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Opens the crash log in `home` (this build's data folder) and adds the hook that writes to it,
/// in front of the default one, which still prints the panic to stderr.
pub fn install(home: &Path) {
    let folder = home.join("logs");
    let path = folder.join("crash.log");
    if fs::create_dir_all(&folder).is_err() {
        return;
    }
    if fs::metadata(&path).is_ok_and(|meta| meta.len() > KEEP_BYTES) {
        let _ = fs::rename(&path, folder.join("crash.1.log"));
    }
    let Ok(file) = fs::OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };
    if LOG.set(Mutex::new(file)).is_err() {
        return;
    }
    let _ = LOG_PATH.set(path.clone());
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        write_entry(info);
        previous(info);
    }));
}

fn write_entry(info: &PanicHookInfo<'_>) {
    let Some(log) = LOG.get() else {
        return;
    };
    let Ok(mut file) = log.try_lock() else {
        return;
    };
    let thread = std::thread::current();
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|text| (*text).to_owned())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "(no message)".to_owned());
    let place = info
        .location()
        .map(|at| format!("{}:{}:{}", at.file(), at.line(), at.column()))
        .unwrap_or_else(|| "unknown place".to_owned());
    let entry = format!(
        "=== {} Misty {} panicked on thread {} at {place}\n{message}\n{}\n\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z"),
        env!("CARGO_PKG_VERSION"),
        thread.name().unwrap_or("(unnamed)"),
        Backtrace::force_capture(),
    );
    let _ = file.write_all(entry.as_bytes());
    let _ = file.flush();
}

/// Shows the crash log in the system's file manager, for Settings › Advanced › Diagnostics.
#[tauri::command]
pub fn app_reveal_crash_log(webview: tauri::Webview, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only the main workspace can show the log".into());
    }
    let path = LOG_PATH.get().ok_or("There is no log on this computer")?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| error.to_string())
}
