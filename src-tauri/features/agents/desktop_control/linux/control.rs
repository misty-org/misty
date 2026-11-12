//! Desktop control on Linux: Misty uses the person's apps on one display for a task, with
//! computer use's driver (XTest on X11, the RemoteDesktop portal on Wayland) and its virtual
//! cursor showing where each action lands.
//!
//! As on the other systems, registration takes nothing: the first capture enters control, after
//! asking when the person wants to be asked, and a 30-second lease renewed while the task runs
//! ends control when Misty stops renewing it. On X11 the person's Escape stops control at once;
//! Wayland lets no app watch the keyboard, so there the compositor's sharing indicator and the
//! task's own Stop end it.
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::computer_use::driver;

const LEASE: Duration = Duration::from_secs(30);
const ASK_TIMEOUT: Duration = Duration::from_secs(25);
const ESCAPE: u32 = 0xff1b;

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
    display: Option<u32>,
}

static CONTROL: Mutex<Option<Control>> = Mutex::new(None);
/// Bumped on every prepare, so an old watchdog ends.
static GENERATION: AtomicU64 = AtomicU64::new(0);
/// While Misty itself presses keys, an Escape it sends isn't the person's.
static ACTING: AtomicBool = AtomicBool::new(false);

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
            thread::sleep(Duration::from_millis(40));
            if GENERATION.load(Ordering::Acquire) != generation || with(|control| control.stopped) {
                return;
            }
            let (expired, controlling) = with(|control| {
                (
                    control
                        .lease_until
                        .is_some_and(|until| Instant::now() >= until),
                    control.controlling,
                )
            });
            if expired {
                stop_control(Some(
                    "Desktop control paused because its connection expired. You have control.",
                ));
                return;
            }
            if controlling
                && !ACTING.load(Ordering::SeqCst)
                && !super::wayland_session()
                && super::x11::key_down(ESCAPE)
            {
                stop_control(Some("You pressed Escape, so Misty stopped. You have control."));
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
        release_control();
    }
}

/// Misty stopped the task: end control without announcing it.
pub fn stop(task: &str) {
    if with(|control| control.task == task) {
        stop_control(None);
        with(|control| control.task.clear());
    }
}

fn release_control() {
    with(|control| control.controlling = false);
    crate::computer_use::overlay::hide();
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
    release_control();
    if let (Some((app, task)), Some(reason)) = (announce, reason) {
        let _ = crate::browser::app_windows::emit(
            &app,
            "misty://desktop-control-stopped",
            json!({ "taskId": task, "reason": reason }),
        );
    }
}

/// Asks the person once before control begins, when they want to be asked.
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
    let stop_hint = if super::wayland_session() {
        "Stop at any time from the screen-sharing indicator or with Stop."
    } else {
        "Stop at any time with Escape or Stop."
    };
    let (send, receive) = std::sync::mpsc::channel();
    app.dialog()
        .message(format!("Misty is ready to use your apps with its own cursor for this task. {stop_hint}"))
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

/// The display already controlled, else the primary one.
fn target_display() -> Option<u32> {
    with(|control| control.display.filter(|_| control.controlling))
}

fn live(task: &str) -> Result<(), String> {
    with(|control| {
        if control.stopped || control.task != task {
            return Err("Desktop control stopped. Start or resume a task.".to_owned());
        }
        if control
            .lease_until
            .is_none_or(|until| Instant::now() >= until)
        {
            return Err("The desktop execution lease expired.".to_owned());
        }
        Ok(())
    })
}

/// Captures the controlled display for the agent, entering control first. Worker thread.
pub fn capture(task: &str) -> Result<Value, String> {
    confirm(task)?;
    live(task)?;
    if let Some(last) = with(|control| control.last_action) {
        thread::sleep(Duration::from_millis(150).saturating_sub(last.elapsed()));
    }
    let frame = driver::capture_frame(target_display())?;
    live(task)?;
    with(|control| {
        control.controlling = true;
        control.display = Some(frame.display.id);
    });
    let display = &frame.display;
    Ok(json!({
        "image": {
            "dataUrl": format!("data:image/jpeg;base64,{}", frame.jpeg_b64),
            "width": frame.width,
            "height": frame.height,
        },
        "desktop": true,
        "taskID": task,
        "displayID": display.id,
        "frame": [display.x, display.y, display.width, display.height],
        // The image is handed to the agent; its size stays with the snapshot for mapping.
        "frameSize": [frame.width, frame.height],
    }))
}

/// Performs one validated action on the controlled display. Worker thread.
pub fn action(input: &Value) -> Result<Value, String> {
    let task = input["taskID"].as_str().unwrap_or("");
    live(task)?;
    let display = input["displayID"]
        .as_u64()
        .and_then(|id| u32::try_from(id).ok())
        .ok_or("browser_snapshot_stale: inspect before acting")?;
    if with(|control| !control.controlling || control.display != Some(display)) {
        return Err("browser_snapshot_stale: inspect before acting".into());
    }
    let action = &input["action"];
    let (frame_width, frame_height) = (
        input["frameSize"][0].as_f64().unwrap_or(0.0),
        input["frameSize"][1].as_f64().unwrap_or(0.0),
    );
    let fraction = |key: &str| action[key].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
    let (x, y) = (fraction("x") * frame_width, fraction("y") * frame_height);
    ACTING.store(true, Ordering::SeqCst);
    let result = match action["kind"].as_str().unwrap_or("") {
        "point" => driver::action_click(enigo::Button::Left, "Left", Some(x), Some(y), 1, Some(display)),
        "scroll" => {
            // Wheel steps of about 40 pixels, as Windows' desktop control counts them.
            let steps = |key: &str| {
                let delta = action[key].as_i64().unwrap_or(0) as f64 / 40.0;
                (delta.round() as i32).clamp(-20, 20)
            };
            driver::action_scroll(Some(x), Some(y), steps("deltaX"), steps("deltaY"), Some(display))
        }
        "type" => driver::action_type(action["text"].as_str().unwrap_or("")),
        "key" => chord_of(action["key"].as_str().unwrap_or(""))
            .ok_or_else(|| "Unsupported desktop key.".to_owned())
            .and_then(driver::action_key),
        _ => Err("Unsupported desktop action.".into()),
    };
    // Let Misty's own Escape clear the server's key map before watching again.
    thread::sleep(Duration::from_millis(60));
    ACTING.store(false, Ordering::SeqCst);
    with(|control| control.last_action = Some(Instant::now()));
    result.map(|message| json!({ "attempted": true, "verified": false, "message": message }))
}

/// The driver's chord for a workspace key.
fn chord_of(key: &str) -> Option<&'static str> {
    Some(match key {
        "Enter" => "enter",
        "Escape" => "escape",
        "Tab" => "tab",
        "Backspace" => "backspace",
        "ArrowLeft" => "left",
        "ArrowRight" => "right",
        "ArrowUp" => "up",
        "ArrowDown" => "down",
        "SelectAll" => "ctrl+a",
        "Undo" => "ctrl+z",
        "AddressBar" => "ctrl+l",
        "NewTab" => "ctrl+t",
        "Find" => "ctrl+f",
        _ => return None,
    })
}
