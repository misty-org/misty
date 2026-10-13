//! Native opening accepts an opaque grant, never a caller-supplied local path.
use super::PermissionSet;
use serde_json::Value;

pub(super) fn execute(permissions: &PermissionSet, params: &Value) -> Result<Value, String> {
    let handle = params
        .get("handle")
        .and_then(Value::as_str)
        .ok_or("Missing file handle.")?;
    let file = &permissions
        .files
        .get(handle)
        .ok_or("This file is not granted to this App.")?
        .file;
    #[cfg(target_os = "macos")]
    {
        let path = granted_path(file)?;
        // Arguments are passed directly; no shell parses filenames. Keep the
        // registration lock until LaunchServices accepts or rejects the request.
        let status = std::process::Command::new("/usr/bin/open")
            .arg(path)
            .status()
            .map_err(|_| "The native application could not be opened.")?;
        if !status.success() {
            return Err("The native application could not open this file.".into());
        }
        Ok(Value::Null)
    }
    #[cfg(windows)]
    {
        let path = granted_path(file)?;
        // The shell opens it with the file's default app; no command line is
        // built, so no shell parses the file name.
        crate::platform::windows::with_com(|| open_with_default_app(&path))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = file;
        Err("Native file opening is not implemented on this platform yet.".into())
    }
}

#[cfg(windows)]
pub(super) fn granted_path(file: &std::fs::File) -> Result<std::path::PathBuf, String> {
    crate::platform::windows::verified_path(file, false)
        .map_err(|_| "The chosen file moved or was replaced. Choose it again.".into())
}

#[cfg(windows)]
fn open_with_default_app(path: &std::path::Path) -> Result<Value, String> {
    use crate::platform::windows::wide;
    use windows_sys::Win32::UI::{
        Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
        WindowsAndMessaging::SW_SHOWNORMAL,
    };
    let verb = wide("open");
    let file = wide(path);
    // SAFETY: an all-zero SHELLEXECUTEINFOW is valid before its fields are set.
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.nShow = SW_SHOWNORMAL;
    // SAFETY: the strings outlive the call; a returned process handle is closed.
    unsafe {
        if ShellExecuteExW(&mut info) == 0 {
            return Err("The native application could not open this file.".into());
        }
        if !info.hProcess.is_null() {
            windows_sys::Win32::Foundation::CloseHandle(info.hProcess);
        }
    }
    Ok(Value::Null)
}

#[cfg(target_os = "macos")]
pub(super) fn granted_path(file: &std::fs::File) -> Result<std::path::PathBuf, String> {
    use std::{
        ffi::{CStr, OsStr},
        os::{
            fd::AsRawFd,
            unix::{ffi::OsStrExt, fs::MetadataExt},
        },
    };
    let mut bytes = [0 as libc::c_char; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, bytes.as_mut_ptr()) } == -1 {
        return Err("The chosen file's location is unavailable.".into());
    }
    let path = std::path::PathBuf::from(OsStr::from_bytes(
        unsafe { CStr::from_ptr(bytes.as_ptr()) }.to_bytes(),
    ));
    let owned = file
        .metadata()
        .map_err(|_| "The chosen file is unavailable.")?;
    let current =
        std::fs::symlink_metadata(&path).map_err(|_| "The chosen file moved or was removed.")?;
    if !path.is_absolute()
        || !current.is_file()
        || (owned.dev(), owned.ino()) != (current.dev(), current.ino())
    {
        return Err("The chosen file moved or was replaced. Choose it again.".into());
    }
    Ok(path)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn native_open_resolves_the_retained_file_after_a_rename_and_rejects_removal() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("日本語.txt");
        let renamed = root.path().join("moved.txt");
        std::fs::write(&original, "chosen").unwrap();
        let file = std::fs::File::open(&original).unwrap();
        std::fs::rename(&original, &renamed).unwrap();
        std::fs::write(&original, "replacement").unwrap();
        assert_eq!(
            granted_path(&file).unwrap(),
            renamed.canonicalize().unwrap()
        );
        std::fs::remove_file(&renamed).unwrap();
        assert!(granted_path(&file).is_err());
    }
}
