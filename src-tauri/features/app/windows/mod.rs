pub mod automation;
pub mod registry;
pub mod window_icon;

use std::{
    ffi::{OsStr, OsString},
    os::windows::ffi::{OsStrExt, OsStringExt},
};

pub fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

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
