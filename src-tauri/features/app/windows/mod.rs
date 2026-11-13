//! Shared Win32 helpers for Misty's Windows integrations.
pub mod automation;
pub mod registry;

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
