//! The current user's registry (HKEY_CURRENT_USER), for the settings Windows
//! reads from there: launch at login, URL handlers and default-app capabilities.
use std::io;

use windows_sys::Win32::{
    Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
    System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteKeyValueW, RegGetValueW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
    },
};

use super::wide;

fn status(code: u32) -> io::Result<()> {
    if code == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(code as i32))
    }
}

/// Reads a string value; `None` when the key or value does not exist.
/// `value` of `""` reads the key's default value.
pub fn read_string(key: &str, value: &str) -> io::Result<Option<String>> {
    let key = wide(key);
    let value = wide(value);
    let mut bytes = 0u32;
    // SAFETY: a size query with no output buffer.
    let code = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut bytes,
        )
    };
    if code == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    status(code)?;
    let mut buffer = vec![0u16; (bytes as usize).div_ceil(2)];
    // SAFETY: `bytes` is the buffer's size in bytes.
    status(unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut bytes,
        )
    })?;
    Ok(Some(
        super::from_wide(&buffer).to_string_lossy().into_owned(),
    ))
}

/// Writes a string value, creating the key if needed. `value` of `""` writes
/// the key's default value.
pub fn write_string(key: &str, value: &str, data: &str) -> io::Result<()> {
    let key = wide(key);
    let value = wide(value);
    let data = wide(data);
    let mut handle: HKEY = std::ptr::null_mut();
    // SAFETY: NUL-terminated names; the created key is closed below.
    unsafe {
        status(RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            std::ptr::null(),
            &mut handle,
            std::ptr::null_mut(),
        ))?;
        let result = status(RegSetValueExW(
            handle,
            value.as_ptr(),
            0,
            REG_SZ,
            data.as_ptr().cast(),
            (data.len() * 2) as u32,
        ));
        RegCloseKey(handle);
        result
    }
}

/// Deletes a value; succeeds when it is already gone.
pub fn delete_value(key: &str, value: &str) -> io::Result<()> {
    let key = wide(key);
    let value = wide(value);
    // SAFETY: NUL-terminated names.
    let code = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), value.as_ptr()) };
    if code == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    status(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_round_trip_and_deletes_are_idempotent() {
        let key = format!(r"Software\MistyTests\{}", uuid::Uuid::new_v4());
        assert_eq!(read_string(&key, "Value").unwrap(), None);
        write_string(&key, "Value", r#""C:\Program Files\Misty\Misty.exe""#).unwrap();
        assert_eq!(
            read_string(&key, "Value").unwrap().as_deref(),
            Some(r#""C:\Program Files\Misty\Misty.exe""#)
        );
        delete_value(&key, "Value").unwrap();
        delete_value(&key, "Value").unwrap();
        assert_eq!(read_string(&key, "Value").unwrap(), None);
        // SAFETY: removes only the test keys created above; the parent goes
        // only when no other test still uses it.
        unsafe {
            use windows_sys::Win32::System::Registry::{RegDeleteKeyW, RegDeleteTreeW};
            RegDeleteTreeW(HKEY_CURRENT_USER, wide(&key).as_ptr());
            RegDeleteKeyW(HKEY_CURRENT_USER, wide(r"Software\MistyTests").as_ptr());
        }
    }
}
