//! Windows protection for private folders and files: a protected DACL that admits
//! only the owner and SYSTEM (the counterpart of mode 0700 and 0600).
use std::{io, path::Path, ptr};
use windows_sys::Win32::{
    Foundation::{LocalFree, ERROR_SUCCESS},
    Security::{
        Authorization::{
            ConvertSecurityDescriptorToStringSecurityDescriptorW,
            ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW,
            SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
        },
        GetSecurityDescriptorDacl, ACL, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    },
};

/// Full control for the directory's owner and SYSTEM, inherited by every file,
/// and nothing inherited from the parent.
const PRIVATE_DACL: &str = "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)";

/// Whether the directory already carries exactly the private DACL. Setting
/// it again would recompute every file below, so callers skip that.
pub(crate) fn is_restricted(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    // SAFETY: `wide` is NUL-terminated; the descriptor is freed below.
    let status = unsafe {
        GetNamedSecurityInfoW(
            wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return false;
    }
    let mut text: *mut u16 = ptr::null_mut();
    // SAFETY: a valid descriptor; the string is LocalAlloc'd and freed below.
    let converted = unsafe {
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            descriptor,
            SDDL_REVISION_1,
            DACL_SECURITY_INFORMATION,
            &mut text,
            ptr::null_mut(),
        )
    } != 0;
    let current = if converted {
        // SAFETY: a NUL-terminated string from the conversion above.
        unsafe {
            let length = (0..).take_while(|&index| *text.add(index) != 0).count();
            let value = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
            LocalFree(text.cast());
            value
        }
    } else {
        String::new()
    };
    // SAFETY: allocated by GetNamedSecurityInfoW.
    unsafe { LocalFree(descriptor) };
    // Windows marks the DACL auto-inherited ("AI") when it stores it, and a
    // file, having nothing below it, keeps no inheritance flags.
    let expected = if path.is_dir() {
        PRIVATE_DACL.to_owned()
    } else {
        PRIVATE_DACL.replace(";OICI;", ";;")
    };
    current.replacen("D:PAI", "D:P", 1) == expected
}

/// Gives the directory a DACL that admits only its owner and SYSTEM,
/// inherited by everything inside. A no-op when it already has one.
pub(crate) fn restrict_directory(path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    if is_restricted(path) {
        return Ok(());
    }
    let sddl: Vec<u16> = PRIVATE_DACL.encode_utf16().chain(Some(0)).collect();
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    // SAFETY: `sddl` is NUL-terminated; the descriptor is freed below.
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let result = (|| {
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl: *mut ACL = ptr::null_mut();
        // SAFETY: `descriptor` is a valid descriptor from the conversion above.
        if unsafe { GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted) }
            == 0
            || present == 0
        {
            return Err(io::Error::other("Credential directory DACL is invalid"));
        }
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: `wide` is NUL-terminated and `dacl` lives inside `descriptor`.
        let status = unsafe {
            SetNamedSecurityInfoW(
                wide.as_mut_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                dacl,
                ptr::null(),
            )
        };
        if status == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(io::Error::from_raw_os_error(status as i32))
        }
    })();
    // SAFETY: the descriptor was allocated by the conversion with LocalAlloc.
    unsafe { LocalFree(descriptor) };
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restricted_directories_are_recognized_and_left_alone() {
        let folder = tempfile::tempdir().unwrap();
        assert!(!is_restricted(folder.path()));
        restrict_directory(folder.path()).unwrap();
        assert!(
            is_restricted(folder.path()),
            "the DACL reads back as written"
        );
        restrict_directory(folder.path()).unwrap();
    }
}
