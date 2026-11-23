use std::path::Path;

#[cfg(target_os = "macos")]
pub fn mark_from_internet(path: &Path) {
    if super::check(path, super::Access::Write).is_ok() {
        mark(path);
    }
}

#[cfg(target_os = "macos")]
pub fn mark_from_agent(path: &Path) {
    if super::check(path, super::Access::Read).is_ok() {
        mark(path);
    }
}

#[cfg(target_os = "macos")]
fn mark(path: &Path) {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};

    const NAME: &std::ffi::CStr = c"com.apple.quarantine";
    let Ok(file) = CString::new(path.as_os_str().as_bytes()) else {
        return;
    };
    // SAFETY: both are NUL-terminated, and a null buffer only asks for the value's size.
    let existing =
        unsafe { libc::getxattr(file.as_ptr(), NAME.as_ptr(), std::ptr::null_mut(), 0, 0, 0) };
    if existing >= 0 {
        return;
    }
    let value = quarantine_value(chrono::Utc::now().timestamp(), &uuid::Uuid::new_v4());
    // SAFETY: both names are NUL-terminated, and the value's pointer and length belong together.
    unsafe {
        libc::setxattr(
            file.as_ptr(),
            NAME.as_ptr(),
            value.as_ptr().cast(),
            value.len(),
            0,
            0,
        );
    }
}

#[cfg(not(target_os = "macos"))]
pub fn mark_from_internet(_path: &Path) {}

#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn quarantine_value(time: i64, id: &uuid::Uuid) -> String {
    format!(
        "0081;{time:08x};Misty;{}",
        id.hyphenated().to_string().to_uppercase()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_format_the_system_reads() {
        let value = quarantine_value(0x6000_0000, &uuid::Uuid::nil());
        assert_eq!(
            value,
            "0081;60000000;Misty;00000000-0000-0000-0000-000000000000"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn marks_a_file_once_and_keeps_the_mark() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("file.dmg");
        super::super::fs::write(&path, b"x").unwrap();
        mark_from_internet(&path);
        let first = read_mark(&path).expect("marked");
        assert!(first.starts_with("0081;"));
        mark_from_internet(&path);
        assert_eq!(read_mark(&path).as_deref(), Some(first.as_str()));
    }

    #[cfg(target_os = "macos")]
    fn read_mark(path: &Path) -> Option<String> {
        let output = std::process::Command::new("/usr/bin/xattr")
            .args(["-p", "com.apple.quarantine"])
            .arg(path)
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }
}
