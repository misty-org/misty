//! Hold-to-talk on Linux reads the X server's keyboard state every few milliseconds, the way a key
//! viewer does. It grabs nothing, so every key still reaches the app in front. Wayland compositors
//! show global keys to no app, so there the chords work while an X11 (XWayland) window is in front.
use super::{Input, Modifiers};
use crate::voice::linux::Display;
use std::time::Duration;

/// Often enough that a quick tap still counts as a hold and release.
const POLL: Duration = Duration::from_millis(15);
/// How long to wait before reconnecting after the display goes away.
const RETRY: Duration = Duration::from_secs(2);

pub(crate) fn current_modifiers() -> Modifiers {
    crate::voice::linux::current_modifiers()
}

pub(crate) fn run(dispatch: fn(Input)) {
    let mut reported = false;
    loop {
        let Some(display) = Display::open() else {
            if !reported {
                reported = true;
                dispatch(Input::Error(
                    "Voice shortcuts need an X11 display. Use the microphone button instead."
                        .into(),
                ));
            }
            std::thread::sleep(RETRY);
            continue;
        };
        let codes = display.modifier_codes();
        let mut held = Modifiers::default();
        let mut pressed = false;
        loop {
            let Some(modifiers) = display.modifiers(&codes) else {
                break;
            };
            if modifiers != held {
                held = modifiers;
                dispatch(Input::Modifiers(held));
            }
            if let Some((x, y, down)) = display.pointer_and_button() {
                if down && !pressed {
                    dispatch(Input::Click(f64::from(x), f64::from(y)));
                }
                pressed = down;
            }
            std::thread::sleep(POLL);
        }
        // The display went away with keys possibly held: let every chord go.
        if held.any() {
            dispatch(Input::Modifiers(Modifiers::default()));
        }
        std::thread::sleep(RETRY);
    }
}
