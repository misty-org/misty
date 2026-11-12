// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Computer use: an outside engine sees and works the person's screen with Misty's own cursor.
//!
//! ccgui ships this as a separate stdio MCP binary that an engine spawns. In Misty the tools are
//! offered through Misty's own local MCP server (`engines/mcp.rs`), only to a run the person sent
//! with computer use turned on, and every call passes the same native gate as any other tool
//! (`agents/run_control/tool_policy.rs`) with the mode the run started in: Ask asks before each
//! action, Auto and Bypass go on, and Plan only looks. What stays here:
//! - the OS permission status and the System Settings links (macOS is the only platform that
//!   gates this; elsewhere the driver works as it is),
//! - Escape to stop, watched while an engine acts (on X11; Wayland lets no app watch the keyboard,
//!   so there the compositor's own sharing indicator stops it),
//! - the virtual cursor (overlay.rs).

mod ax;
pub(crate) mod driver;
pub(crate) mod overlay;
#[cfg(target_os = "linux")]
mod portal;
pub(crate) mod tools;

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Emitted when the person stops screen control with Escape: `{ runId }`.
pub const STOPPED_EVENT: &str = "misty://computer-use-stopped";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub accessibility: bool,
    pub screen_recording: bool,
    /// False where the OS has no grant to give, so Settings says nothing is needed.
    pub os_permissions_required: bool,
}

pub fn permission_status() -> PermissionStatus {
    PermissionStatus {
        accessibility: driver::accessibility_granted(),
        screen_recording: driver::screen_recording_granted(),
        os_permissions_required: cfg!(target_os = "macos"),
    }
}

#[tauri::command]
pub fn computer_use_permission_status() -> PermissionStatus {
    permission_status()
}

/// Opens the System Settings pane for one grant. Only these two fixed panes can be opened.
#[tauri::command]
pub fn computer_use_open_permission_settings(kind: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = match kind.as_str() {
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            "screenRecording" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            other => return Err(format!("There's no settings pane named {other}.")),
        };
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|error| format!("Couldn't open System Settings: {error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = kind;
        Err("Only macOS asks for these permissions.".into())
    }
}

// ---- Escape to stop ----

/// The runs that are acting on the screen now, which Escape stops.
static ACTIVE: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
/// The runs the person stopped. Their next action is refused, whatever the engine does.
static STOPPED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
static WATCHING: AtomicBool = AtomicBool::new(false);
/// While Misty itself presses keys, an Escape it sends isn't the person's.
static ACTING: AtomicBool = AtomicBool::new(false);

thread_local! {
    static CURRENT_RUN: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

fn active() -> std::sync::MutexGuard<'static, HashSet<String>> {
    ACTIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn stopped_runs() -> std::sync::MutexGuard<'static, HashSet<String>> {
    STOPPED.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether the run the driver is acting for was stopped.
pub(crate) fn stopped() -> bool {
    CURRENT_RUN.with(|run| stopped_runs().contains(run.borrow().as_str()))
}

fn escape_down() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::{CGEventSource, CGEventSourceStateID};
        const VK_ESCAPE: u16 = 0x35;
        CGEventSource::key_state(CGEventSourceStateID::HIDSystemState, VK_ESCAPE)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
        // SAFETY: a plain query of the key's state.
        (unsafe { GetAsyncKeyState(i32::from(VK_ESCAPE)) } as u16 & 0x8000) != 0
    }
    #[cfg(target_os = "linux")]
    {
        const ESCAPE: u32 = 0xff1b;
        !crate::agents::desktop_control::linux::wayland_session()
            && crate::agents::desktop_control::linux::x11::key_down(ESCAPE)
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        false
    }
}

/// Starts watching for Escape once a run acts. It watches only while some run is acting.
fn watch_escape(app: &AppHandle) {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(40));
            let runs: Vec<String> = active().iter().cloned().collect();
            if runs.is_empty() {
                WATCHING.store(false, Ordering::SeqCst);
                // A run that started acting between the check and now starts a new watcher.
                if !active().is_empty() && !WATCHING.swap(true, Ordering::SeqCst) {
                    continue;
                }
                return;
            }
            if ACTING.load(Ordering::SeqCst) || !escape_down() {
                continue;
            }
            for run in runs {
                stop_run(&app, &run);
            }
        }
    });
}

/// The person pressed Escape: the run stops acting, its turn is stopped and the cursor goes.
fn stop_run(app: &AppHandle, run_id: &str) {
    stopped_runs().insert(run_id.to_string());
    active().remove(run_id);
    overlay::hide();
    let _ = crate::engines::runs::cancel(run_id);
    let _ = app.emit(STOPPED_EVENT, serde_json::json!({ "runId": run_id }));
}

/// A run's computer tools are done: the run ended or the person turned screen control off.
pub(crate) fn release(run_id: &str) {
    active().remove(run_id);
    stopped_runs().remove(run_id);
    if active().is_empty() {
        overlay::hide();
        // The portal session ends with the last run, so its sharing indicator goes too.
        #[cfg(target_os = "linux")]
        portal::end();
    }
}

/// Stops screen control for every run, as the Stop in Settings or the island does.
#[tauri::command]
pub fn computer_use_stop(app: AppHandle) {
    let runs: Vec<String> = active().iter().cloned().collect();
    for run in runs {
        stop_run(&app, &run);
    }
}

/// Runs one driver action for a run, with Escape watched and Misty's own keys not counted.
pub(crate) fn acting<T>(app: &AppHandle, run_id: &str, work: impl FnOnce() -> T) -> T {
    active().insert(run_id.to_string());
    watch_escape(app);
    CURRENT_RUN.with(|run| *run.borrow_mut() = run_id.to_string());
    ACTING.store(true, Ordering::SeqCst);
    let result = work();
    ACTING.store(false, Ordering::SeqCst);
    CURRENT_RUN.with(|run| run.borrow_mut().clear());
    result
}

pub fn init(app: &AppHandle) {
    overlay::init(app);
}
