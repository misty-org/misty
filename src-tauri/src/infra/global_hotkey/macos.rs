//! Listen-only CGEventTap. Needs Input Monitoring, which macOS asks for the
//! first time a chord is registered.
use super::{Input, Modifiers};
use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
use core_graphics::event::*;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
    fn CGEventSourceFlagsState(state: i32) -> u64;
}

// Device-dependent bits (IOKit's NX_DEVICE*KEYMASK) tell the sides apart.
const LEFT_CONTROL: u64 = 0x0000_0001;
const LEFT_COMMAND: u64 = 0x0000_0008;
const RIGHT_COMMAND: u64 = 0x0000_0010;
const LEFT_OPTION: u64 = 0x0000_0020;
const RIGHT_OPTION: u64 = 0x0000_0040;
const RIGHT_CONTROL: u64 = 0x0000_2000;

/// Reads modifier flags. When a synthetic event carries no side bits, the
/// generic flag counts as the left key.
pub(crate) fn modifiers_from_flags(flags: u64) -> Modifiers {
    let has = |flag: CGEventFlags| flags & flag.bits() != 0;
    let side = |generic: bool, left: u64, right: u64| {
        let (l, r) = (flags & left != 0, flags & right != 0);
        (generic && (l || !r), generic && r)
    };
    let (left_control, right_control) = side(
        has(CGEventFlags::CGEventFlagControl),
        LEFT_CONTROL,
        RIGHT_CONTROL,
    );
    let (left_option, right_option) = side(
        has(CGEventFlags::CGEventFlagAlternate),
        LEFT_OPTION,
        RIGHT_OPTION,
    );
    let (left_command, right_command) = side(
        has(CGEventFlags::CGEventFlagCommand),
        LEFT_COMMAND,
        RIGHT_COMMAND,
    );
    Modifiers {
        left_control,
        right_control,
        left_option,
        right_option,
        left_command,
        right_command,
        shift: has(CGEventFlags::CGEventFlagShift),
        function: has(CGEventFlags::CGEventFlagSecondaryFn),
    }
}

pub(crate) fn current_modifiers() -> Modifiers {
    // kCGEventSourceStateCombinedSessionState
    modifiers_from_flags(unsafe { CGEventSourceFlagsState(0) })
}

pub(crate) fn run(dispatch: fn(Input)) {
    unsafe {
        if !CGPreflightListenEventAccess() {
            CGRequestListenEventAccess();
        }
    }
    loop {
        let tap = CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![
                CGEventType::FlagsChanged,
                CGEventType::KeyDown,
                CGEventType::LeftMouseDown,
            ],
            move |_, kind, event| {
                match kind {
                    CGEventType::KeyDown => dispatch(Input::KeyboardActivity),
                    CGEventType::LeftMouseDown => {
                        let p = event.location();
                        dispatch(Input::Click(p.x, p.y));
                    }
                    // Only modifier changes move chords: arrow keys also carry
                    // the Fn flag, but on KeyDown, never on FlagsChanged.
                    CGEventType::FlagsChanged => dispatch(Input::Modifiers(modifiers_from_flags(
                        event.get_flags().bits(),
                    ))),
                    _ => {}
                }
                None // Listen-only taps always preserve the original event.
            },
        );
        match tap {
            Ok(tap) => unsafe {
                if let Ok(source) = tap.mach_port.create_runloop_source(0) {
                    CFRunLoop::get_current().add_source(&source, kCFRunLoopCommonModes);
                    // Re-enable after OS tap timeouts; the monitor never consumes input.
                    loop {
                        tap.enable();
                        CFRunLoop::run_in_mode(kCFRunLoopDefaultMode, std::time::Duration::from_secs(1), false);
                    }
                }
            },
            Err(_) => dispatch(Input::Error(
                "Allow Misty in System Settings → Privacy & Security → Input Monitoring to use voice shortcuts.".into(),
            )),
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
}
