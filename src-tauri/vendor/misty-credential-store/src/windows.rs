//! Windows protection for credential files: DPAPI seals every file to the
//! signed-in Windows user, and the credential directories carry a protected
//! DACL that admits only their owner and SYSTEM.
use std::{io, path::Path, ptr};
use windows_sys::Win32::{
    Foundation::{LocalFree, ERROR_SUCCESS},
    Security::{
        Authorization::{
            ConvertSecurityDescriptorToStringSecurityDescriptorW,
            ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW,
            SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
        },
        Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
        GetSecurityDescriptorDacl, ACL, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    },
};
use zeroize::Zeroizing;

/// Marks a sealed file; anything else is a plaintext file from an older build.
pub(crate) const SEALED_PREFIX: &[u8] = b"MISTY-DPAPI-1\n";
/// Binds sealed files to this store, so another DPAPI user of the same
/// account cannot be tricked into unsealing them.
const ENTROPY: &[u8] = b"misty.credential-store.v1";
/// Full control for the directory's owner and SYSTEM, inherited by every file,
/// and nothing inherited from the parent.
const PRIVATE_DACL: &str = "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)";

fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr().cast_mut(),
    }
}

/// Copies a blob that DPAPI allocated and frees it.
unsafe fn take(output: CRYPT_INTEGER_BLOB) -> Zeroizing<Vec<u8>> {
    let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
    std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
    LocalFree(output.pbData.cast());
    Zeroizing::new(bytes)
}

pub(crate) fn seal(plaintext: &[u8]) -> io::Result<Vec<u8>> {
    let input = blob(plaintext);
    let entropy = blob(ENTROPY);
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    // SAFETY: every pointer refers to a live buffer for the duration of the call.
    let ok = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            &entropy,
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: DPAPI returned an allocation that `take` copies and frees once.
    let sealed = unsafe { take(output) };
    let mut file = Vec::with_capacity(SEALED_PREFIX.len() + sealed.len());
    file.extend_from_slice(SEALED_PREFIX);
    file.extend_from_slice(&sealed);
    Ok(file)
}

pub(crate) fn open(sealed: &[u8]) -> io::Result<Zeroizing<Vec<u8>>> {
    let input = blob(sealed);
    let entropy = blob(ENTROPY);
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    // SAFETY: every pointer refers to a live buffer for the duration of the call.
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            &entropy,
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(io::Error::other(
            "Credential file could not be unsealed for this Windows user",
        ));
    }
    // SAFETY: DPAPI returned an allocation that `take` copies and frees once.
    Ok(unsafe { take(output) })
}

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
        assert!(is_restricted(folder.path()), "the DACL reads back as written");
        restrict_directory(folder.path()).unwrap();
    }
}
