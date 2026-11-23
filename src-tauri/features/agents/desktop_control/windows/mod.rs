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
use tauri::AppHandle;
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

use overlays::{Frame, Island};

mod actions;
mod capture;
mod guard;
#[cfg(windows)]
pub mod overlays;

use crate::app::windows::automation::{Automation, Element};
pub use actions::action;
pub use capture::capture;
use capture::display_of;
use guard::{end_guard, start_guard};

const AGENT_TAG: usize = 0x4D49_5354;
const LEASE: Duration = Duration::from_secs(30);
const ASK_TIMEOUT: Duration = Duration::from_secs(25);
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
static CONTROLLING: AtomicBool = AtomicBool::new(false);
static GUARD_THREAD: AtomicU32 = AtomicU32::new(0);
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn with<T>(work: impl FnOnce(&mut Control) -> T) -> T {
    let mut control = CONTROL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    work(control.get_or_insert_with(Control::default))
}

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

pub fn yield_control(task: &str) {
    if with(|control| !control.stopped && control.task == task) {
        release_control(true);
    }
}

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

pub fn stop(task: &str) {
    if with(|control| control.task == task) {
        stop_control(None);
        with(|control| control.task.clear());
    }
}

pub fn stop_by_person(reason: &str) {
    stop_control(Some(reason));
}

pub fn island_press(action: &str, text: &str) {
    let target = with(|control| {
        (!control.task.is_empty())
            .then(|| control.app.clone().map(|app| (app, control.task.clone())))
            .flatten()
    });
    if let Some((app, task)) = target {
        let _ = crate::browser::app_windows::emit(
            &app,
            "misty://agent-island",
            json!({ "taskId": task, "action": action, "text": text }),
        );
    }
}

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
        let _ = crate::browser::app_windows::emit(
            &app,
            "misty://desktop-control-stopped",
            json!({ "taskId": task, "reason": reason }),
        );
    }
}

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
