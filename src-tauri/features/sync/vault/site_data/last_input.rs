//! How long since anyone touched this computer, in any app. A window can stay focused for hours on
//! a computer nobody is at, so focus alone can't say which computer is in use.

/// Milliseconds since the last keyboard or mouse input, if the system says.
#[cfg(target_os = "macos")]
pub(super) fn ms_since_input() -> Option<u64> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event: u32) -> f64;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT: u32 = u32::MAX;
    // SAFETY: takes two plain values and only reads the session's event times.
    let seconds =
        unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) };
    (seconds.is_finite() && seconds >= 0.).then_some((seconds * 1000.) as u64)
}

/// Milliseconds since the last keyboard or mouse input, if the system says.
#[cfg(windows)]
pub(super) fn ms_since_input() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: `info` is a live struct with its size filled in, as the call requires.
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return None;
    }
    // Both are tick counts that wrap about every 49 days.
    Some(unsafe { GetTickCount() }.wrapping_sub(info.dwTime) as u64)
}
