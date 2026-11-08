//! Desktop control: the task that holds the desktop, its lease, the Escape
//! guard, and the island and mist it shows. All state lives on the main queue.
use std::{
    cell::RefCell,
    ffi::c_void,
    ptr::NonNull,
    time::{SystemTime, UNIX_EPOCH},
};

use block2::RcBlock;
use objc2::{rc::Retained, MainThreadMarker};
use objc2_app_kit::NSPanel;
use objc2_core_foundation::{
    kCFRunLoopCommonModes, CFMachPort, CFRetained, CFRunLoop, CFRunLoopSource,
};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGEvent, CGEventField, CGEventFlags, CGEventTapLocation,
    CGEventTapOptions, CGEventTapPlacement, CGEventTapProxy, CGEventType,
    CGPreflightScreenCaptureAccess,
};
use objc2_foundation::{
    NSBundle, NSProcessInfo, NSRunLoop, NSRunLoopCommonModes, NSString, NSTimer,
};
use serde_json::{json, Value};

use super::{ask::AskPanel, capture::capture_stop, island};
use crate::agents::cursor::macos::{
    accessibility, pointer::pointer_hide, pointer_actions::AGENT_EVENT_TAG, ring,
    ring_views::mist_waiting, support::on_main,
};

const VK_ESCAPE: i64 = 0x35;

struct Tap {
    port: CFRetained<CFMachPort>,
    source: CFRetained<CFRunLoopSource>,
}

#[derive(Default)]
pub(super) struct State {
    pub(super) task: Option<String>,
    pub(super) stopped: bool,
    pub(super) controlling: bool,
    pub(super) ask_before_control: bool,
    pub(super) lease_until: f64,
    pub(super) last_action_at: f64,
    pub(super) controlled_display: u32,
    tap: Option<Tap>,
    pub(super) control_panel: Option<Retained<NSPanel>>,
    pub(super) watchdog: Option<Retained<NSTimer>>,
    pub(super) notify_stopped: Option<fn(Value)>,
    pub(super) ask_panel: Option<Retained<AskPanel>>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

pub(super) fn state<R>(read: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|state| read(&mut state.borrow_mut()))
}

pub(super) fn uptime() -> f64 {
    NSProcessInfo::processInfo().systemUptime()
}

pub(super) fn epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// The task that holds the desktop, if any.
pub(super) fn task() -> Option<String> {
    state(|state| state.task.clone())
}

/// Gives the desktop back without ending the task: no input tap, cursor or
/// capture. While the task waits for the person the island stays and the mist
/// thins; otherwise both go. The next visual tool call enters control again.
fn release_control(waiting: bool) {
    let tap = state(|state| {
        state.controlling = false;
        state.tap.take()
    });
    if let Some(tap) = tap {
        CGEvent::tap_enable(&tap.port, false);
        tap.port.invalidate();
        if let Some(main) = CFRunLoop::main() {
            // SAFETY: a static mode constant.
            main.remove_source(Some(&tap.source), unsafe { kCFRunLoopCommonModes });
        }
    }
    pointer_hide();
    capture_stop();
    let has_panel = state(|state| state.control_panel.is_some());
    if waiting && has_panel {
        island::mode(true);
        mist_waiting(true);
        return;
    }
    if let Some(panel) = state(|state| state.control_panel.take()) {
        panel.orderOut(None);
    }
    ring::hide();
    mist_waiting(false);
}

/// Ends control; a reason is announced to Misty once.
pub(super) fn stop_control(reason: Option<&str>) {
    let reason = reason.filter(|reason| !reason.is_empty());
    let announce = state(|state| {
        let announce = !state.stopped && reason.is_some();
        state.stopped = true;
        announce
    });
    if let Some(panel) = state(|state| state.ask_panel.take()) {
        panel.decline();
    }
    release_control(false);
    if let Some(timer) = state(|state| state.watchdog.take()) {
        timer.invalidate();
    }
    if let (true, Some(reason)) = (announce, reason) {
        let (task, notify) = state(|state| (state.task.clone(), state.notify_stopped));
        if let Some(notify) = notify {
            notify(json!({"taskId": task.unwrap_or_default(), "reason": reason}));
        }
    }
}

/// Misty acts with its own cursor, so the person's input is never blocked. The
/// tap only listens for Escape and the voice shortcut, which stop the task.
unsafe extern "C-unwind" fn guard_input(
    _proxy: CGEventTapProxy,
    kind: CGEventType,
    event: NonNull<CGEvent>,
    _info: *mut c_void,
) -> *mut CGEvent {
    let pass = event.as_ptr();
    if kind == CGEventType::TapDisabledByTimeout || kind == CGEventType::TapDisabledByUserInput {
        stop_control(Some("Desktop control stopped. You have control."));
        return pass;
    }
    // SAFETY: the tap passes a live event for the duration of the callback.
    let event = unsafe { event.as_ref() };
    let controlling = state(|state| state.controlling);
    if !controlling
        || CGEvent::integer_value_field(Some(event), CGEventField::EventSourceUserData)
            == AGENT_EVENT_TAG
    {
        return pass;
    }
    if kind == CGEventType::KeyDown
        && CGEvent::integer_value_field(Some(event), CGEventField::KeyboardEventKeycode)
            == VK_ESCAPE
    {
        stop_control(Some(
            "Desktop control stopped with Escape. You have control.",
        ));
        return std::ptr::null_mut();
    }
    let flags = CGEvent::flags(Some(event));
    if kind == CGEventType::FlagsChanged
        && flags.contains(CGEventFlags::MaskControl)
        && flags.contains(CGEventFlags::MaskAlternate)
    {
        stop_control(Some("Desktop control interrupted by the voice shortcut."));
    }
    pass
}

pub(super) fn begin_control(
    mtm: MainThreadMarker,
    display_id: CGDirectDisplayID,
) -> Option<String> {
    let (stopped, task, lease_until, controlling) = state(|state| {
        (
            state.stopped,
            state.task.clone(),
            state.lease_until,
            state.controlling,
        )
    });
    if stopped || task.as_deref().unwrap_or("").is_empty() {
        return Some("Desktop control stopped. Start or resume a task.".into());
    }
    if lease_until <= uptime() {
        return Some("The desktop execution lease expired.".into());
    }
    if controlling {
        return None;
    }
    let name = NSBundle::mainBundle()
        .objectForInfoDictionaryKey(&NSString::from_str("CFBundleDisplayName"))
        .and_then(|name| name.downcast::<NSString>().ok())
        .map(|name| name.to_string())
        .unwrap_or_else(|| NSProcessInfo::processInfo().processName().to_string());
    if !CGPreflightScreenCaptureAccess() {
        return Some(format!(
            "Allow {name} in System Settings \u{2192} Privacy & Security \u{2192} Screen Recording, then retry."
        ));
    }
    if !accessibility::trusted() {
        return Some(format!(
            "Allow {name} in System Settings \u{2192} Privacy & Security \u{2192} Accessibility to control the desktop, then retry."
        ));
    }
    let mask = (1u64 << CGEventType::KeyDown.0) | (1u64 << CGEventType::FlagsChanged.0);
    // SAFETY: the callback matches the tap signature and uses no user info.
    let port = unsafe {
        CGEvent::tap_create(
            CGEventTapLocation::SessionEventTap,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            mask,
            Some(guard_input),
            std::ptr::null_mut(),
        )
    };
    let Some(port) = port else {
        return Some("Desktop control is unavailable. Check Accessibility for Misty.".into());
    };
    let Some(source) = CFMachPort::new_run_loop_source(None, Some(&port), 0) else {
        stop_control(None);
        return Some("Desktop control could not start.".into());
    };
    if let Some(main) = CFRunLoop::main() {
        // SAFETY: a static mode constant.
        main.add_source(Some(&source), unsafe { kCFRunLoopCommonModes });
    }
    CGEvent::tap_enable(&port, true);
    let display = CGDisplayBounds(display_id);
    state(|state| {
        state.tap = Some(Tap { port, source });
        state.controlling = true;
        state.controlled_display = display_id;
    });
    if state(|state| state.control_panel.is_none()) {
        let panel = island::panel(mtm, display);
        state(|state| state.control_panel = Some(panel));
    }
    island::mode(false);
    if let Some(panel) = state(|state| state.control_panel.clone()) {
        panel.orderFrontRegardless();
    }
    mist_waiting(false);
    ring::show(
        display.origin.x,
        display.origin.y,
        display.size.width,
        display.size.height,
    );
    None
}

/// Registration does not capture or take input. The first visual tool call enters
/// control, so a question answered from its initial screenshot does not lock input.
pub(crate) fn prepare(task_id: &str, ask: bool, callback: fn(Value), island_callback: fn(Value)) {
    let next = task_id.to_owned();
    on_main(move |_| {
        stop_control(None);
        state(|state| {
            state.task = Some(next);
            state.stopped = false;
            state.notify_stopped = Some(callback);
            state.last_action_at = 0.0;
            state.ask_before_control = ask;
            state.lease_until = uptime() + 30.0;
        });
        island::reset(island_callback);
        let watchdog = RcBlock::new(|_: NonNull<NSTimer>| {
            if uptime() >= state(|state| state.lease_until) {
                stop_control(Some(
                    "Desktop control paused because its connection expired. You have control.",
                ));
            }
        });
        // SAFETY: the block only touches main-thread state, and the timer fires on the main run loop.
        let timer = unsafe { NSTimer::timerWithTimeInterval_repeats_block(0.5, true, &watchdog) };
        // SAFETY: the timer is valid and the mode a framework constant.
        unsafe { NSRunLoop::mainRunLoop().addTimer_forMode(&timer, NSRunLoopCommonModes) };
        state(|state| state.watchdog = Some(timer));
    });
}

pub(super) fn is_current(expected: &str) -> bool {
    state(|state| !state.stopped && state.task.as_deref() == Some(expected))
}

pub(crate) fn renew(task_id: &str) {
    let expected = task_id.to_owned();
    on_main(move |_| {
        if is_current(&expected) {
            state(|state| state.lease_until = uptime() + 30.0);
        }
    });
}

/// The task waits for the person: hand the desktop back but keep the task.
pub(crate) fn yield_control(task_id: &str) {
    let expected = task_id.to_owned();
    on_main(move |_| {
        if is_current(&expected) {
            release_control(true);
        }
    });
}

/// What Misty's island shows: a status line, a meta line (sub-agents, where)
/// and what the person needs to do while the task waits.
pub(crate) fn island_text(task_id: &str, json: &str) {
    let expected = task_id.to_owned();
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(json) else {
        return;
    };
    let text = move |key: &str| {
        input
            .get(key)
            .and_then(Value::as_str)
            .map(|value| value.chars().take(240).collect::<String>())
    };
    let (status, meta, waiting) = (text("status"), text("meta"), text("waiting"));
    on_main(move |_| {
        if !is_current(&expected) {
            return;
        }
        island::set_text(status, meta, waiting);
        if state(|state| state.control_panel.is_some()) {
            island::mode(!state(|state| state.controlling));
        }
    });
}

pub(crate) fn stop(task_id: &str) {
    let expected = task_id.to_owned();
    on_main(move |_| {
        if state(|state| state.task.as_deref() == Some(expected.as_str())) {
            stop_control(None);
            state(|state| state.task = None);
        }
    });
}
