//! Confined processes on macOS: Seatbelt through the system's `sandbox-exec`, with resource limits set
//! between fork and exec. The agent shell, the document worker and the page reader each have their
//! own profile and limits; what they share is here.
use std::{
    ffi::OsString,
    path::Path,
};

/// The system's Seatbelt launcher.
pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

/// The arguments that run a program under `profile`, up to the program itself. Each `define` is a
/// `-D NAME=value` the profile reads as `(param "NAME")`.
pub fn arguments(profile: &str, defines: &[(&str, &Path)]) -> Vec<OsString> {
    let mut arguments: Vec<OsString> = vec!["-p".into(), profile.into()];
    for (name, value) in defines {
        arguments.push("-D".into());
        let mut define = OsString::from(format!("{name}="));
        define.push(value.as_os_str());
        arguments.push(define);
    }
    arguments
}

/// Sets each limit for the calling process. Meant for a `pre_exec` hook, so it allocates nothing and
/// only makes async-signal-safe calls.
pub fn set_limits(limits: &[(libc::c_int, libc::rlim_t)]) -> std::io::Result<()> {
    for &(resource, value) in limits {
        let limit = libc::rlimit {
            rlim_cur: value,
            rlim_max: value,
        };
        // SAFETY: setrlimit reads the struct it is given and touches nothing else.
        if unsafe { libc::setrlimit(resource, &limit) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}
