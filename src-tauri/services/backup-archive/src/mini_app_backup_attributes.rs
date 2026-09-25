//! Bounded descriptor-based extended attributes for the backup stream.
use std::{fs::File, io};
const LIMIT: usize = 16 * 1024 * 1024;
const PREFIX: &str = "SCHILY.xattr.";
#[cfg(target_os = "macos")]
fn names(file: &File) -> io::Result<Vec<u8>> {
    use std::os::fd::AsRawFd;
    let size = unsafe { libc::flistxattr(file.as_raw_fd(), std::ptr::null_mut(), 0, 0) };
    if size < 0 {
        return Err(io::Error::last_os_error());
    }
    if size as usize > 65_536 {
        return Err(io::Error::other("Too many backup attributes."));
    }
    let mut bytes = vec![0u8; size as usize];
    if size == 0 {
        return Ok(bytes);
    }
    let length =
        unsafe { libc::flistxattr(file.as_raw_fd(), bytes.as_mut_ptr().cast(), bytes.len(), 0) };
    if length < 0 {
        return Err(io::Error::last_os_error());
    }
    bytes.truncate(length as usize);
    Ok(bytes)
}
pub fn read(file: &File) -> io::Result<Vec<(String, Vec<u8>)>> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = file;
        Err(io::Error::other(
            "Backup attribute preservation needs a platform adapter.",
        ))
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        let mut values = Vec::new();
        let mut total = 0usize;
        for name in names(file)?
            .split(|b| *b == 0)
            .filter(|name| !name.is_empty())
        {
            let label = std::str::from_utf8(name)
                .map_err(|_| io::Error::other("Unsupported backup attribute name."))?;
            if label.contains(['=', '\n', '\r']) {
                return Err(io::Error::other("Unsupported backup attribute name."));
            }
            let name = std::ffi::CString::new(name)?;
            let size = unsafe {
                libc::fgetxattr(
                    file.as_raw_fd(),
                    name.as_ptr(),
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                )
            };
            if size < 0 {
                return Err(io::Error::last_os_error());
            }
            total = total
                .checked_add(size as usize)
                .filter(|size| *size <= LIMIT)
                .ok_or_else(|| io::Error::other("Backup attributes exceed 16 MiB per entry."))?;
            let mut bytes = vec![0u8; size as usize];
            let length = unsafe {
                libc::fgetxattr(
                    file.as_raw_fd(),
                    name.as_ptr(),
                    bytes.as_mut_ptr().cast(),
                    bytes.len(),
                    0,
                    0,
                )
            };
            if length < 0 {
                return Err(io::Error::last_os_error());
            }
            if length as usize != bytes.len() {
                return Err(io::Error::other("Source attributes changed during backup."));
            }
            values.push((format!("{PREFIX}{label}"), bytes));
        }
        Ok(values)
    }
}
pub fn write(file: &File, values: &[(String, Vec<u8>)]) -> io::Result<()> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (file, values);
        Err(io::Error::other(
            "Backup attribute restoration needs a platform adapter.",
        ))
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        let mut total = 0usize;
        let mut seen = std::collections::HashSet::new();
        for (key, value) in values {
            let Some(name) = key.strip_prefix(PREFIX) else {
                continue;
            };
            if name.is_empty() || name.len() > 255 || !seen.insert(name) {
                return Err(io::Error::other("Invalid or repeated backup attribute."));
            }
            total = total
                .checked_add(value.len())
                .filter(|size| *size <= LIMIT)
                .ok_or_else(|| io::Error::other("Backup attributes exceed 16 MiB per entry."))?;
            let name = std::ffi::CString::new(name.as_bytes())?;
            let result = unsafe {
                libc::fsetxattr(
                    file.as_raw_fd(),
                    name.as_ptr(),
                    value.as_ptr().cast(),
                    value.len(),
                    0,
                    0,
                )
            };
            if result < 0 {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(())
    }
}
