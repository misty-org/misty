//! Desktop control on Windows: Misty uses the person's apps with its own
//! cursor (docs/design/agents-at-cursor/BRIEF.md), the counterpart of
//! `MistyDesktopControl.m`.
//!
//! The person's pointer and keyboard stay theirs: controls are pressed,
//! focused, filled and scrolled through UI Automation, and only the named
//! keys an action asks for are typed into the app in front, tagged as
//! Misty's. Escape from the person stops control at once, as does the voice
//! shortcut or the island's Stop. A 30-second lease, renewed while the task
//! runs, ends control when Misty stops renewing it. Registration takes
//! nothing: the first capture enters control (after asking, when the person
//! wants to be asked), so a question answered from the first screenshot
//! never takes the desktop.
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use windows_sys::Win32::{
    Foundation::{LPARAM, LRESULT, POINT, WPARAM},
    System::Threading::GetCurrentThreadId,
    UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
            VK_BACK, VK_CONTROL, VK_DOWN, VK_ESCAPE, VK_LCONTROL, VK_LEFT, VK_LMENU, VK_RCONTROL,
            VK_RETURN, VK_RIGHT, VK_RMENU, VK_TAB, VK_UP,
        },
        WindowsAndMessaging::{
            CallNextHookEx, DispatchMessageW, GetCursorPos, GetForegroundWindow, GetMessageW,
            GetWindowThreadProcessId, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
            UnhookWindowsHookEx, WindowFromPoint, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG,
            WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
        },
    },
};

use super::desktop_overlays_windows::{self as overlays, Frame, Island};

mod actions;
mod guard;

use crate::platform::windows::automation::{Automation, Element};
pub use actions::action;
use guard::{end_guard, start_guard};

/// Marks the keys Misty types, so the guard never takes them for the person's.
const AGENT_TAG: usize = 0x4D49_5354;
const LEASE: Duration = Duration::from_secs(30);
const ASK_TIMEOUT: Duration = Duration::from_secs(25);
/// The longest edge of a desktop frame the agent sees.
const MAX_EDGE: u32 = 2000;

#[derive(Default)]
struct Control {
    app: Option<AppHandle>,
    task: String,
    stopped: bool,
    controlling: bool,
    ask: bool,
    asking: bool,
    lease_until: Option<Instant>,
    last_action: Option<Instant>,
    display: Option<(u32, Frame)>,
    island: Island,
}

static CONTROL: Mutex<Option<Control>> = Mutex::new(None);
/// Read by the keyboard guard, which can't take the lock.
static CONTROLLING: AtomicBool = AtomicBool::new(false);
/// The guard's thread, to end it; 0 when none runs.
static GUARD_THREAD: AtomicU32 = AtomicU32::new(0);
/// Bumped on every prepare, so an old watchdog ends.
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn with<T>(work: impl FnOnce(&mut Control) -> T) -> T {
    let mut control = CONTROL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    work(control.get_or_insert_with(Control::default))
}

/// Registers `task` for desktop control. Nothing is captured or taken yet.
pub fn prepare(app: &AppHandle, task: &str, ask: bool) {
    stop_control(None);
    let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    with(|control| {
        *control = Control {
            app: Some(app.clone()),
            task: task.to_owned(),
            ask,
            lease_until: Some(Instant::now() + LEASE),
            ..Control::default()
        };
    });
    let _ = thread::Builder::new()
        .name("misty-desktop-watchdog".into())
        .spawn(move || loop {
            thread::sleep(Duration::from_millis(500));
            if GENERATION.load(Ordering::Acquire) != generation {
                return;
            }
            let expired = with(|control| {
                !control.stopped
                    && control
                        .lease_until
                        .is_some_and(|until| Instant::now() >= until)
            });
            if expired {
                stop_control(Some(
                    "Desktop control paused because its connection expired. You have control.",
                ));
                return;
            }
            if with(|control| control.stopped) {
                return;
            }
        });
}

pub fn renew(task: &str) {
    with(|control| {
        if !control.stopped && control.task == task {
            control.lease_until = Some(Instant::now() + LEASE);
        }
    });
}

/// The task waits for the person: hand the desktop back, keep the task.
pub fn yield_control(task: &str) {
    if with(|control| !control.stopped && control.task == task) {
        release_control(true);
    }
}

/// What the island shows: status, meta, and what the person needs to do
/// while the task waits.
pub fn island(task: &str, value: &Value) {
    let text = |key: &str| {
        value[key]
            .as_str()
            .map(|text| text.chars().take(240).collect::<String>())
            .unwrap_or_default()
    };
    let update = with(|control| {
        if control.stopped || control.task != task {
            return None;
        }
        control.island = Island {
            status: text("status"),
            meta: text("meta"),
            waiting: text("waiting"),
        };
        Some((
            control.app.clone()?,
            control.island.clone(),
            !control.controlling,
        ))
    });
    if let Some((app, island, waiting)) = update {
        overlays::set_island(&app, island, waiting);
    }
}

/// Misty stopped the task: end control without announcing it.
pub fn stop(task: &str) {
    if with(|control| control.task == task) {
        stop_control(None);
        with(|control| control.task.clear());
    }
}

/// The person stopped control (Escape, the voice shortcut, the island).
pub fn stop_by_person(reason: &str) {
    stop_control(Some(reason));
}

/// A press on the island that Misty's own island performs.
pub fn island_press(action: &str, text: &str) {
    let target = with(|control| {
        (!control.task.is_empty())
            .then(|| control.app.clone().map(|app| (app, control.task.clone())))
            .flatten()
    });
    if let Some((app, task)) = target {
        let _ = app.emit_to(
            "main",
            "misty://agent-island",
            json!({ "taskId": task, "action": action, "text": text }),
        );
    }
}

/// Gives the desktop back: the guard, pointer and capture go. While the task
/// waits for the person, the island stays (showing Done) and the mist thins.
fn release_control(waiting: bool) {
    CONTROLLING.store(false, Ordering::Release);
    end_guard();
    let state = with(|control| {
        control.controlling = false;
        control.app.clone().map(|app| (app, control.island.clone()))
    });
    let Some((app, island)) = state else {
        return;
    };
    overlays::hide_pointer(&app);
    if waiting {
        overlays::set_island(&app, island, true);
        overlays::set_mist_waiting(&app, true);
    } else {
        overlays::hide_all(&app);
    }
}

fn stop_control(reason: Option<&str>) {
    let announce = with(|control| {
        let announce = !control.stopped && reason.is_some() && !control.task.is_empty();
        control.stopped = true;
        control.lease_until = None;
        announce
            .then(|| control.app.clone().map(|app| (app, control.task.clone())))
            .flatten()
    });
    release_control(false);
    if let (Some((app, task)), Some(reason)) = (announce, reason) {
        let _ = app.emit_to(
            "main",
            "misty://desktop-control-stopped",
            json!({ "taskId": task, "reason": reason }),
        );
    }
}

/// Asks the person once before control begins, when they want to be asked.
/// Until they allow it there is no guard, capture or actionable frame.
fn confirm(task: &str) -> Result<(), String> {
    let pending = with(|control| {
        if control.stopped || control.task != task {
            return Err("Desktop task stopped.".to_owned());
        }
        if !control.ask || control.controlling {
            return Ok(None);
        }
        if control.asking {
            return Err("Desktop confirmation is already pending.".to_owned());
        }
        control.asking = true;
        Ok(control.app.clone())
    })?;
    let Some(app) = pending else {
        return Ok(());
    };
    let (send, receive) = std::sync::mpsc::channel();
    app.dialog()
        .message("Misty is ready to use your apps with its own cursor for this task. Your pointer and keyboard stay yours. Stop at any time with Escape or Stop.")
        .title("Allow desktop control?")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow control".into(),
            "Cancel".into(),
        ))
        .show(move |allowed| {
            let _ = send.send(allowed);
        });
    let answer = receive.recv_timeout(ASK_TIMEOUT);
    let current = with(|control| {
        control.asking = false;
        !control.stopped && control.task == task
    });
    let failure = match answer {
        Ok(true) if current => {
            with(|control| control.ask = false);
            return Ok(());
        }
        Ok(true) => "Desktop task stopped.",
        Ok(false) => "Desktop control was not approved. You have control.",
        Err(_) => "Desktop confirmation expired. Ask Misty to try again when ready.",
    };
    if current {
        stop_control(Some(failure));
    }
    Err(failure.into())
}

/// The display under the person's pointer, or the one already controlled:
/// moving the pointer never retargets the agent's frame.
fn target_display() -> Result<(u32, Frame), String> {
    if let Some(display) = with(|control| control.display.filter(|_| control.controlling)) {
        return Ok(display);
    }
    let mut cursor = POINT { x: 0, y: 0 };
    // SAFETY: a plain query into a local.
    unsafe { GetCursorPos(&mut cursor) };
    let monitor = xcap::Monitor::from_point(cursor.x, cursor.y)
        .or_else(|_| {
            xcap::Monitor::all()
                .map_err(|_| xcap::XCapError::new("no display"))?
                .into_iter()
                .find(|monitor| monitor.is_primary().unwrap_or(false))
                .ok_or(xcap::XCapError::new("no display"))
        })
        .map_err(|_| "No display is available to control.".to_owned())?;
    display_of(&monitor)
}

fn display_of(monitor: &xcap::Monitor) -> Result<(u32, Frame), String> {
    let failed = |_| "The display is unavailable.".to_owned();
    Ok((
        monitor.id().map_err(failed)?,
        Frame {
            x: monitor.x().map_err(failed)?,
            y: monitor.y().map_err(failed)?,
            width: monitor.width().map_err(failed)? as i32,
            height: monitor.height().map_err(failed)? as i32,
        },
    ))
}

fn begin_control(display: (u32, Frame)) -> Result<(), String> {
    let app = with(|control| {
        if control.stopped || control.task.is_empty() {
            return Err("Desktop control stopped. Start or resume a task.".to_owned());
        }
        if control
            .lease_until
            .is_none_or(|until| Instant::now() >= until)
        {
            return Err("The desktop execution lease expired.".to_owned());
        }
        Ok((!control.controlling)
            .then(|| control.app.clone())
            .flatten())
    })?;
    let Some(app) = app else {
        return Ok(());
    };
    start_guard()?;
    CONTROLLING.store(true, Ordering::Release);
    let island = with(|control| {
        control.controlling = true;
        control.display = Some(display);
        control.island.clone()
    });
    overlays::show_island(&app, display.1)?;
    overlays::set_island(&app, island, false);
    overlays::show_mist(&app, display.1, false)?;
    Ok(())
}

/// Captures the controlled display for the agent, entering control first.
/// Called on a worker thread.
pub fn capture(task: &str) -> Result<Value, String> {
    confirm(task)?;
    let display = target_display()?;
    if let Err(failure) = begin_control(display) {
        stop_control(Some(&failure));
        return Err(failure);
    }
    // The frame shows the effect of the last action.
    if let Some(last) = with(|control| control.last_action) {
        let settle = Duration::from_millis(150).saturating_sub(last.elapsed());
        thread::sleep(settle);
    }
    let monitor = xcap::Monitor::all()
        .ok()
        .and_then(|monitors| {
            monitors
                .into_iter()
                .find(|monitor| monitor.id().is_ok_and(|id| id == display.0))
        })
        .ok_or("The display was disconnected.")?;
    let image = monitor
        .capture_image()
        .map_err(|_| "The display could not be captured.".to_owned())?;
    let valid = with(|control| {
        !control.stopped
            && control.controlling
            && control.task == task
            && control
                .lease_until
                .is_some_and(|until| Instant::now() < until)
    });
    if !valid {
        return Err("Desktop control stopped during capture.".into());
    }
    let image = image::DynamicImage::ImageRgba8(image);
    let image = if image.width().max(image.height()) > MAX_EDGE {
        image.resize(MAX_EDGE, MAX_EDGE, image::imageops::FilterType::Triangle)
    } else {
        image
    };
    let mut jpeg = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .encode_image(&image.to_rgb8())
        .map_err(|_| "The display frame could not be encoded.".to_owned())?;
    let frame = display.1;
    Ok(json!({
        "image": {
            "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg.into_inner())),
            "width": image.width(),
            "height": image.height(),
        },
        "desktop": true,
        "taskID": task,
        "displayID": display.0,
        "frame": [frame.x, frame.y, frame.width, frame.height],
    }))
}
