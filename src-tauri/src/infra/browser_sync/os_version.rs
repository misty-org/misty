//! Best-effort OS version reported to the account's device list.
use super::*;

/// Best-effort OS version for the device list; empty when unknown.
pub(super) fn os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        let mut buffer = [0u8; 64];
        let mut size = buffer.len();
        let name = b"kern.osproductversion\0";
        // SAFETY: the name is NUL-terminated and size bounds the buffer.
        let ok = unsafe {
            libc::sysctlbyname(
                name.as_ptr().cast(),
                buffer.as_mut_ptr().cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        } == 0;
        if ok {
            let end = buffer[..size].iter().position(|b| *b == 0).unwrap_or(size);
            return String::from_utf8_lossy(&buffer[..end]).into_owned();
        }
        String::new()
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| {
                text.lines()
                    .find_map(|line| line.strip_prefix("PRETTY_NAME="))
                    .map(|v| v.trim_matches('"').to_owned())
            })
            .unwrap_or_default()
    }
    #[cfg(windows)]
    {
        // `ver` prints "Microsoft Windows [Version 10.0.22631.4317]"; build
        // 22000 and later is Windows 11 despite the 10.0 kernel version.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let output = std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let text = output
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        let version = text
            .split("Version")
            .nth(1)
            .map(|rest| rest.trim_matches(|c: char| c == ' ' || c == ']' || c == '\r' || c == '\n'))
            .unwrap_or("");
        let build = version
            .split('.')
            .nth(2)
            .and_then(|b| b.parse::<u32>().ok());
        match build {
            Some(build) if build >= 22000 => format!("11 ({version})"),
            Some(_) => format!("10 ({version})"),
            None => String::new(),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        String::new()
    }
}
