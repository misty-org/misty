//! Signed app workers receive retained descriptors, never app-supplied native paths.
use super::document_processing::ServiceLease;
use serde_json::Value;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    os::{
        fd::{AsRawFd, FromRawFd, RawFd},
        unix::{ffi::OsStrExt, fs::PermissionsExt, process::CommandExt},
    },
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub(super) fn run(
    lease: &ServiceLease,
    request: Value,
    descriptors: &[RawFd],
    roots: &[(RawFd, bool)],
    cancelled: impl Fn() -> bool,
) -> Result<Value, String> {
    run_with_progress(lease, request, descriptors, roots, cancelled, |_| {})
}
pub(super) fn run_with_progress(
    lease: &ServiceLease,
    request: Value,
    descriptors: &[RawFd],
    roots: &[(RawFd, bool)],
    cancelled: impl Fn() -> bool,
    progress: impl Fn(&Value),
) -> Result<Value, String> {
    if lease.cancelled() || cancelled() {
        return Err("App operation cancelled.".into());
    }
    let work = tempfile::Builder::new()
        .prefix("misty-app-work-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let work_path = work.path().canonicalize().map_err(|e| e.to_string())?;
    let executable = work_path.join("worker");
    std::fs::write(&executable, &lease.worker).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o500))
        .map_err(|e| e.to_string())?;
    let mut profile = String::from(
        r#"(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow file-read* (literal (param "TOOL")) (subpath (param "WORK"))
 (subpath "/System/Library") (subpath "/usr/lib")
 (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
 (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
 (literal "/") (literal "/dev/null") (literal "/dev/urandom"))
(allow file-write* (subpath (param "WORK")) (literal "/dev/null"))
(allow file-read-metadata)
(allow sysctl-read)
"#,
    );
    let mut command = Command::new("/usr/bin/sandbox-exec");
    let mut backup_listener = None;
    if request["repository"] == true {
        if !lease.is_backup_runtime() {
            return Err("This service cannot run backups.".into());
        }
        let tool = request["restic"]
            .as_str()
            .ok_or("Missing backup executable.")?;
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        command
            .arg("-D")
            .arg(format!("RESTIC={tool}"))
            .arg("-D")
            .arg(format!("SERVER=localhost:{port}"));
        backup_listener = Some(listener);
        profile.push_str(
            r#"
(allow process-fork)
(allow process-exec (literal (param "RESTIC")))
(allow file-read* (literal (param "RESTIC")))
(allow network-inbound (local tcp (param "SERVER")))
(allow network-outbound (remote tcp (param "SERVER")))
(allow signal)
"#,
        );
    }
    for (index, (fd, writable)) in roots.iter().enumerate() {
        let path = descriptor_path(*fd)?;
        let permissions = if *writable {
            "file-read* file-write*"
        } else {
            "file-read*"
        };
        profile.push_str(&format!(
            "(allow {permissions} (subpath (param \"ROOT{index}\")))\n"
        ));
        command
            .arg("-D")
            .arg(format!("ROOT{index}={}", path.display()));
    }
    let request = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    if request.len() > 32768 {
        return Err("App worker request exceeds its limit.".into());
    }
    // Duplicate above the destination range before fork, avoiding dup2 collisions.
    let mut retained = Vec::new();
    for fd in descriptors {
        let duplicate = unsafe { libc::fcntl(*fd, libc::F_DUPFD_CLOEXEC, 256) };
        if duplicate < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        retained.push(unsafe { File::from_raw_fd(duplicate) });
    }
    let backup_fd = backup_listener.as_ref().map(AsRawFd::as_raw_fd);
    let mapped: Vec<_> = retained.iter().map(AsRawFd::as_raw_fd).collect();
    let mut output = tempfile::tempfile().map_err(|e| e.to_string())?;
    command
        .args(["-p", &profile, "-D"])
        .arg(format!("TOOL={}", executable.display()))
        .arg("-D")
        .arg(format!("WORK={}", work_path.display()))
        .arg(&executable)
        .env_clear()
        .env("MISTY_WORK_REQUEST", request)
        .env("HOME", work.path())
        .env("TMPDIR", work.path())
        .current_dir(work.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::from(output.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::null())
        .process_group(0);
    unsafe {
        command.pre_exec(move || {
            if let Some(fd) = backup_fd {
                if libc::dup2(fd, 99) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            for (index, fd) in mapped.iter().enumerate() {
                if libc::dup2(*fd, 100 + index as i32) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    struct Child(std::process::Child, bool);
    impl Drop for Child {
        fn drop(&mut self) {
            if self.1 {
                unsafe {
                    libc::kill(-(self.0.id() as i32), libc::SIGKILL);
                }
                let _ = self.0.wait();
            }
        }
    }
    let mut child = Child(command.spawn().map_err(|e| e.to_string())?, true);
    let started = Instant::now();
    let mut stopped = None;
    loop {
        if lease.cancelled() || cancelled() || started.elapsed() > Duration::from_secs(86400) {
            // EOF asks the engine to unwind and clean its staging directory.
            if stopped.is_none() {
                child.0.stdin.take();
                stopped = Some(Instant::now());
            }
            if stopped.is_some_and(|at| at.elapsed() > Duration::from_secs(2)) {
                return Err("App operation cancelled.".into());
            }
        }
        if stopped.is_none() {
            if let Ok(file) = File::open(work_path.join("progress.json")) {
                let mut bytes = Vec::new();
                if file.take(32769).read_to_end(&mut bytes).is_ok() && bytes.len() <= 32768 {
                    if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                        progress(&value);
                    }
                }
            }
        }
        if output.metadata().map_err(|e| e.to_string())?.len() > 8_388_608 {
            return Err("App worker response exceeds its limit.".into());
        }
        if let Some(status) = child.0.try_wait().map_err(|e| e.to_string())? {
            child.1 = false;
            if !status.success() {
                return Err("App worker failed.".into());
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    if stopped.is_some() || lease.cancelled() || cancelled() {
        return Err("App operation cancelled.".into());
    }
    output.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    output
        .take(8_388_609)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8_388_608 {
        return Err("App worker response exceeds its limit.".into());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid app worker response.")?;
    if value["protocol"] != 1 {
        return Err("Incompatible app worker.".into());
    }
    if let Some(error) = value["error"].as_str() {
        return Err(error.chars().take(2048).collect());
    }
    value
        .get("data")
        .cloned()
        .ok_or("Missing app worker result.".into())
}
fn descriptor_path(fd: RawFd) -> Result<PathBuf, String> {
    let mut bytes = [0 as libc::c_char; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(fd, libc::F_GETPATH, bytes.as_mut_ptr()) } < 0 {
        return Err("Granted folder is no longer available.".into());
    }
    let path = unsafe { std::ffi::CStr::from_ptr(bytes.as_ptr()) };
    let path = PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes()));
    if path.to_str().is_none() {
        return Err("This folder name is not supported by the native sandbox.".into());
    }
    Ok(path)
}
