//! Restricted Restic process construction. The capability layer selects operations;
//! no executable, environment, endpoint, or command line comes from an App.
#![allow(dead_code)] // Used by repository integration checks until the job API is wired.
use std::{path::Path, process::Command};

pub fn command(
    tool: &Path,
    work: &Path,
    endpoint: &str,
    password: &str,
) -> Result<Command, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (tool, work, endpoint, password);
        Err("Isolated backups are not implemented on this platform yet.".into())
    }
    #[cfg(target_os = "macos")]
    {
        let endpoint_url = url::Url::parse(
            endpoint
                .strip_prefix("rest:")
                .ok_or("Invalid native repository connection.")?,
        )
        .map_err(|_| "Invalid native repository connection.")?;
        if endpoint_url.scheme() != "http"
            || endpoint_url.host_str() != Some("127.0.0.1")
            || endpoint_url.path() != "/"
            || endpoint_url.query().is_some()
            || endpoint_url.fragment().is_some()
            || endpoint_url.username() != "misty"
            || endpoint_url.password().is_none_or(str::is_empty)
        {
            return Err(
                "Backup workers require their private native repository connection.".into(),
            );
        }
        let port = endpoint_url
            .port()
            .ok_or("Missing native repository port.")?;
        if port == 0 {
            return Err("Invalid native repository port.".into());
        }
        let mut command = confined_command(tool, work, port, password)?;
        command.args(["--no-cache", "-r", endpoint, "-o", "rest.connections=2"]);
        Ok(command)
    }
}

#[cfg(target_os = "macos")]
fn confined_command(
    tool: &Path,
    work: &Path,
    _port: u16,
    password: &str,
) -> Result<Command, String> {
    use std::os::unix::process::CommandExt;
    let tool = tool.canonicalize().map_err(|_| "Restic is unavailable.")?;
    if let Some(home) = dirs::home_dir() {
        let root = home.join(".misty/plugins");
        if tool.starts_with(&root) || root.canonicalize().is_ok_and(|root| tool.starts_with(root)) {
            return Err("Backups requires a Host-installed Restic executable.".into());
        }
    }
    let work = work
        .canonicalize()
        .map_err(|_| "Backup working directory is unavailable.")?;
    // The host confines this entire service (including Restic) to the exact
    // selected folders and this repository's prebound loopback port.
    let mut command = Command::new(tool);
    command
        .current_dir(&work)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &work)
        .env("TMPDIR", &work)
        .env("LANG", "C")
        .env("RESTIC_PASSWORD", password)
        .env("GOMAXPROCS", "2")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    // Inherit the service group so host revocation also kills Restic.
    unsafe {
        command.pre_exec(|| {
            for (resource, value) in [
                (libc::RLIMIT_CPU, 86_400),
                (libc::RLIMIT_NOFILE, 128),
                (libc::RLIMIT_CORE, 0),
            ] {
                let limit = libc::rlimit {
                    rlim_cur: value,
                    rlim_max: value,
                };
                if libc::setrlimit(resource, &limit) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    Ok(command)
}
