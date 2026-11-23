use std::{ffi::OsString, path::Path};

pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

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
