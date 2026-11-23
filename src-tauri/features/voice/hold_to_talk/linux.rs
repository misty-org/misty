use super::{Input, Modifiers};
use crate::voice::linux::Display;
use std::time::Duration;

const POLL: Duration = Duration::from_millis(15);
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
        if held.any() {
            dispatch(Input::Modifiers(Modifiers::default()));
        }
        std::thread::sleep(RETRY);
    }
}
