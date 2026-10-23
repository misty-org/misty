//! Shared Win32 helpers for Misty's Windows integrations.
pub mod automation;
pub mod registry;
pub mod sandbox;

use std::{
    ffi::{OsStr, OsString},
    os::windows::ffi::{OsStrExt, OsStringExt},
};

/// A NUL-terminated UTF-16 copy of `value` for Win32 calls.
pub fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

/// The text before the first NUL in a UTF-16 buffer that Win32 filled in.
pub fn from_wide(buffer: &[u16]) -> OsString {
    let end = buffer
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(buffer.len());
    OsString::from_wide(&buffer[..end])
}

/// Turns off the "There is no disk in the drive" dialog for this thread while
/// `body` runs, so probing empty card readers and optical drives stays silent.
pub fn without_error_dialogs<T>(body: impl FnOnce() -> T) -> T {
    use windows_sys::Win32::System::Diagnostics::Debug::{
        SetThreadErrorMode, SEM_FAILCRITICALERRORS, SEM_NOOPENFILEERRORBOX,
    };
    let mut previous = 0;
    // SAFETY: plain flag swap for the calling thread.
    let changed = unsafe {
        SetThreadErrorMode(
            SEM_FAILCRITICALERRORS | SEM_NOOPENFILEERRORBOX,
            &mut previous,
        )
    } != 0;
    let result = body();
    if changed {
        // SAFETY: restores the mode saved above.
        unsafe { SetThreadErrorMode(previous, std::ptr::null_mut()) };
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_round_trips() {
        let value = wide("C:\\Users\\Ünïcode");
        assert_eq!(value.last(), Some(&0));
        assert_eq!(from_wide(&value), OsString::from("C:\\Users\\Ünïcode"));
        assert_eq!(from_wide(&[0x41, 0, 0x42]), OsString::from("A"));
    }
}
