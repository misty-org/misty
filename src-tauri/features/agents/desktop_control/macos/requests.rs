//! What a desktop task asks of control: the first-use confirmation, one capture
//! of the controlled display, and one checked action. Rust validates the task,
//! operation grant and one-use snapshot first.
use objc2::rc::Retained;
use objc2_app_kit::{NSRunningApplication, NSWorkspace};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGDisplayIsActive, CGEvent, CGGetDisplaysWithPoint,
    CGMainDisplayID,
};
use objc2_foundation::NSRect;
use serde_json::{json, Value};

use super::{
    ask,
    capture::capture_frame,
    control::{begin_control, epoch, is_current, state, stop_control, task, uptime},
};
use crate::agents::cursor::macos::{
    pointer_actions::desktop_action,
    support::{error_json, on_main, MainOnly},
};

/// This confirmation is outside the model's action surface. Until the human
/// accepts, there is no input tap, stream, or actionable desktop snapshot.
pub(super) fn confirm_control(expected: &str) -> Option<String> {
    let want = expected.to_owned();
    let (failure, pending) = on_main(move |mtm| {
        if !is_current(&want) {
            return (Some("Desktop task stopped.".to_owned()), None);
        }
        if !state(|state| state.ask_before_control) || state(|state| state.controlling) {
            return (None, None);
        }
        if state(|state| state.ask_panel.is_some()) {
            return (
                Some("Desktop confirmation is already pending.".to_owned()),
                None,
            );
        }
        let previous = NSWorkspace::sharedWorkspace().frontmostApplication();
        let (panel, answer) = ask::show(mtm);
        state(|state| state.ask_panel = Some(panel.clone()));
        (None, Some((MainOnly(panel), MainOnly(previous), answer)))
    });
    let (panel, previous, answer) = match (failure, pending) {
        (Some(failure), _) => return Some(failure),
        (None, None) => return None,
        (None, Some(pending)) => pending,
    };
    let timed_out = answer
        .recv_timeout(std::time::Duration::from_secs(25))
        .is_err();
    let want = expected.to_owned();
    on_main(move |_| {
        let panel = panel.into_inner();
        let previous: Option<Retained<NSRunningApplication>> = previous.into_inner();
        let current = is_current(&want)
            && state(|state| {
                state
                    .ask_panel
                    .as_ref()
                    .is_some_and(|ask| Retained::as_ptr(ask) == Retained::as_ptr(&panel))
            });
        panel.orderOut(None);
        if state(|state| {
            state
                .ask_panel
                .as_ref()
                .is_some_and(|ask| Retained::as_ptr(ask) == Retained::as_ptr(&panel))
        }) {
            state(|state| state.ask_panel = None);
        }
        if !current || timed_out || !panel.accepted() {
            let failure = if timed_out {
                "Desktop confirmation expired. Ask Misty to try again when ready."
            } else {
                "Desktop control was not approved. You have control."
            };
            if current {
                stop_control(Some(failure));
            }
            Some(failure.to_owned())
        } else {
            state(|state| state.ask_before_control = false);
            if let Some(previous) = previous {
                previous
                    .activateWithOptions(objc2_app_kit::NSApplicationActivationOptions::empty());
            }
            None
        }
    })
}

/// Called on a worker. All state, HUD, and input ownership live on the main queue.
pub(crate) fn capture(task_id: &str) -> Value {
    let expected = task_id.to_owned();
    if let Some(failure) = confirm_control(&expected) {
        return error_json(failure);
    }
    let want = expected.clone();
    let begun = on_main(move |mtm| {
        if state(|state| state.task.as_deref() != Some(want.as_str())) {
            return Err((None, "Desktop task changed.".to_owned()));
        }
        let point = CGEvent::location(CGEvent::new(None).as_deref());
        let mut display: CGDirectDisplayID = 0;
        let mut count: u32 = 0;
        // SAFETY: valid out pointers for one display.
        unsafe { CGGetDisplaysWithPoint(point, 1, &mut display, &mut count) };
        if count == 0 {
            display = CGMainDisplayID();
        }
        // Moving the human pointer must not silently retarget the agent's frame.
        if state(|state| state.controlling) {
            display = state(|state| state.controlled_display);
        }
        let failure = begin_control(mtm, display);
        let owner = task();
        let foreground = NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|app| app.processIdentifier())
            .unwrap_or(0);
        let after = (state(|state| state.last_action_at) + 0.15).max(epoch() - 1.0);
        match failure {
            Some(failure) => Err((owner, failure)),
            None => Ok((display, foreground, owner.unwrap_or_default(), after)),
        }
    });
    let (display, foreground, owner, after) = match begun {
        Ok(begun) => begun,
        Err((owner, failure)) => {
            if let Some(owner) = owner {
                let message = failure.clone();
                on_main(move |_| {
                    if state(|state| state.task.as_deref() == Some(owner.as_str())) {
                        stop_control(Some(&message));
                    }
                });
            }
            return error_json(failure);
        }
    };
    let image = capture_frame(display, after);
    let check = owner.clone();
    let valid = on_main(move |_| {
        state(|state| {
            !state.stopped
                && state.controlling
                && state.task.as_deref() == Some(check.as_str())
                && state.lease_until > uptime()
        })
    });
    if !valid {
        return error_json("Desktop control stopped during capture.");
    }
    if let Some(message) = image["error"].as_str() {
        let message = message.to_owned();
        let check = owner.clone();
        on_main(move |_| {
            if state(|state| state.task.as_deref() == Some(check.as_str())) {
                stop_control(Some(&message));
            }
        });
        return image;
    }
    let bounds = CGDisplayBounds(display);
    json!({
        "image": image, "desktop": true, "taskID": owner, "displayID": display,
        "foregroundPID": foreground,
        "frame": [bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height],
    })
}

/// Rust validates the task, operation grant, one-use snapshot and action first.
/// Main-queue dispatch rechecks native Stop and display geometry before acting.
pub(crate) fn action(input: &Value) -> Value {
    let (stopped, controlling, lease_until) =
        state(|state| (state.stopped, state.controlling, state.lease_until));
    if stopped || !controlling || lease_until <= uptime() {
        return error_json("Desktop control stopped. You have control.");
    }
    if state(|state| state.task.clone()).as_deref() != input["taskID"].as_str() {
        return error_json("Desktop task changed.");
    }
    let display = input["displayID"].as_u64().unwrap_or(0) as u32;
    let bounds: NSRect = CGDisplayBounds(display);
    let frame: Vec<f64> = input["frame"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|value| value.as_f64().unwrap_or(0.0))
                .collect()
        })
        .unwrap_or_default();
    if frame.len() != 4
        || !CGDisplayIsActive(display)
        || !(bounds.origin.x == frame[0]
            && bounds.origin.y == frame[1]
            && bounds.size.width == frame[2]
            && bounds.size.height == frame[3])
    {
        return error_json("browser_snapshot_stale: display geometry changed; inspect again");
    }
    // The person may keep working in other apps, so the foreground app can
    // change; Accessibility targets the control under Misty's own cursor.
    let action = &input["action"];
    let (x, y) = (
        action["x"].as_f64().unwrap_or(0.0),
        action["y"].as_f64().unwrap_or(0.0),
    );
    let point = (
        bounds.origin.x + x * bounds.size.width,
        bounds.origin.y + y * bounds.size.height,
    );
    let result = desktop_action(action, point.0, point.1);
    if let Some(message) = result["error"].as_str() {
        return error_json(message);
    }
    state(|state| state.last_action_at = epoch());
    let mut output = json!({
        "attempted": true, "verified": false, "input": "accessibility",
        "effect": result["effect"].as_str().unwrap_or(""),
    });
    if let Some(role) = result["role"].as_str() {
        output["target"] = json!({"role": role, "title": result["title"].as_str().unwrap_or("")});
    }
    if matches!(action["kind"].as_str(), Some("point" | "scroll")) {
        output["cursor"] = json!({"x": x, "y": y});
    }
    output
}
