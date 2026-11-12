//! Untrusted documents are parsed on macOS and Linux by the bundled document worker, confined to a
//! private working folder: by `sandbox-exec` on macOS, and by Landlock, seccomp and namespaces on
//! Linux (`sandbox::linux`). Misty's own process never parses them. Windows uses the same worker in
//! an AppContainer (see `windows.rs`).
use file_access::fs;
use file_access::fs::File;
use std::{
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::{FileExt, PermissionsExt},
    path::Path,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use serde_json::{json, Value};

const PROTOCOL: u32 = 6;
/// The largest response the worker may return.
const MAX_RESPONSE: u64 = 4 * 1024 * 1024;
const STAGING_TIMEOUT: Duration = Duration::from_secs(60);
const PROCESSING_TIMEOUT: Duration = Duration::from_secs(120);

#[cfg(target_os = "macos")]
const PROFILE: &str = include_str!("../../tauri-permissions/permissions/document-worker.sb");

/// What has to stay alive until the worker has started.
#[cfg(target_os = "macos")]
type Keep = ();
#[cfg(target_os = "linux")]
type Keep = sandbox::linux::Confinement;

/// The environment the worker gets: nothing of Misty's own.
fn plain_environment(command: &mut Command, work: &Path) {
    command
        .current_dir(work)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", work)
        .env("TMPDIR", work)
        .env("LANG", "C");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
}

/// Builds the sandboxed command that runs `executable` with `work` as its only
/// writable folder and tight resource limits. There is no permissive fallback.
#[cfg(target_os = "macos")]
fn sandboxed_command(executable: &Path, work: &Path) -> Result<(Command, Keep), String> {
    use std::os::unix::process::CommandExt;
    let failed = |_| "Could not confine document processor.".to_owned();
    let executable = fs::canonicalize(executable).map_err(failed)?;
    let work = fs::canonicalize(work).map_err(failed)?;
    let mut command = Command::new(sandbox::macos::SANDBOX_EXEC);
    command
        .args(sandbox::macos::arguments(
            PROFILE,
            &[("TOOL", &executable), ("WORK", &work)],
        ))
        .arg(&executable);
    plain_environment(&mut command, &work);
    command.process_group(0);
    // Only async-signal-safe resource-limit calls run between fork and exec.
    unsafe {
        command.pre_exec(|| {
            sandbox::macos::set_limits(&[
                (libc::RLIMIT_CPU, 300),
                (libc::RLIMIT_FSIZE, 268_435_456),
                (libc::RLIMIT_NOFILE, 128),
                (libc::RLIMIT_CORE, 0),
            ])
        });
    }
    Ok((command, ()))
}

/// The same on Linux: the worker reads and writes only `work`, runs only itself, has no network
/// and dies with Misty. Without Landlock it doesn't start.
#[cfg(target_os = "linux")]
fn sandboxed_command(executable: &Path, work: &Path) -> Result<(Command, Keep), String> {
    use sandbox::linux::{Access, Confinement, Policy};
    use std::os::unix::process::CommandExt;
    let failed = |_| "Could not confine document processor.".to_owned();
    let executable = fs::canonicalize(executable).map_err(failed)?;
    let work = fs::canonicalize(work).map_err(failed)?;
    let confinement = Confinement::new(&Policy {
        program: executable.clone(),
        required: vec![(work.clone(), Access::Private)],
        optional: Vec::new(),
        forks: false,
        limits: vec![
            (libc::RLIMIT_CPU, 300),
            (libc::RLIMIT_FSIZE, 268_435_456),
            (libc::RLIMIT_NOFILE, 128),
            (libc::RLIMIT_CORE, 0),
        ],
    })?;
    let mut command = Command::new(&executable);
    plain_environment(&mut command, &work);
    // The hook starts the worker's own session, which is its process group too.
    unsafe {
        command.pre_exec(confinement.hook());
    }
    Ok((command, confinement))
}

/// Kills the worker's whole process group if it is dropped while still running.
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

/// Parses the document at `path` in the confined worker. `stop` cancels it.
pub fn process(path: &Path, stop: &AtomicBool, worker: super::WorkerBytes) -> Result<Value, String> {
    let display_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid document name.")?
        .to_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("txt")
        .to_ascii_lowercase();
    if extension.len() > 16 || !extension.bytes().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid document extension.".into());
    }
    let input = File::open(path).map_err(|_| "Selected document is unavailable.")?;
    if !input
        .metadata()
        .map_err(|_| "Document unavailable.")?
        .is_file()
    {
        return Err("Choose a regular file.".into());
    }
    let work = tempfile::Builder::new()
        .prefix("misty-document-")
        .tempdir()
        .map_err(|_| "Could not create document workspace.")?;
    let executable = work.path().join("worker");
    fs::write(&executable, worker("document-processing", PROTOCOL)?).map_err(|_| "Could not stage document processor.")?;
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o500))
        .map_err(|_| "Could not prepare processor permissions.")?;
    let started = Instant::now();
    stage_input(
        &input,
        &work.path().join(format!("input.{extension}")),
        stop,
        started,
    )?;

    let mut output = File::unnamed_temp().map_err(|_| "Could not receive document output.")?;
    let (mut command, _keep) = sandboxed_command(&executable, work.path())?;
    command.stdin(Stdio::piped()).stdout(Stdio::from(
        output
            .try_clone()
            .map_err(|_| "Could not receive document output.")?,
    ));
    let mut child = Child(
        command
            .spawn()
            .map_err(|_| "Could not start document processor.")?,
        true,
    );
    let body = serde_json::to_vec(&json!({
        "protocol": PROTOCOL,
        "displayName": display_name,
        "extension": extension,
        "operation": "document",
    }))
    .map_err(|_| "Invalid document request.")?;
    child
        .0
        .stdin
        .take()
        .ok_or("Processor input unavailable.")?
        .write_all(&body)
        .map_err(|_| "Could not send document request.")?;
    wait_for_exit(&mut child, &output, stop, started)?;

    output
        .seek(SeekFrom::Start(0))
        .map_err(|_| "Could not read document output.")?;
    let mut bytes = Vec::new();
    output
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read document output.")?;
    if bytes.len() as u64 > MAX_RESPONSE {
        return Err("Processor response exceeded its limit.".into());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid document processor response.")?;
    if value.get("protocol").and_then(Value::as_u64) != Some(u64::from(PROTOCOL)) {
        return Err("Incompatible document processor response.".into());
    }
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.chars().take(2000).collect());
    }
    Ok(value)
}

/// Copies the selected document into the worker's private folder.
fn stage_input(
    input: &File,
    destination: &Path,
    stop: &AtomicBool,
    started: Instant,
) -> Result<(), String> {
    let mut staged = File::create(destination).map_err(|_| "Could not stage document.")?;
    let limit = crate::MAX_AGENT_DOCUMENT_BYTES;
    let mut offset = 0;
    let mut buffer = [0; 65536];
    loop {
        if stop.load(Ordering::Acquire) {
            return Err("Document processing cancelled.".into());
        }
        if started.elapsed() > STAGING_TIMEOUT {
            return Err("Document staging timed out.".into());
        }
        let length = input
            .read_at(&mut buffer, offset)
            .map_err(|_| "Could not read selected document.")?;
        if length == 0 {
            return Ok(());
        }
        offset += length as u64;
        if offset > limit {
            return Err("Input exceeds this operation's size limit.".into());
        }
        staged
            .write_all(&buffer[..length])
            .map_err(|_| "Could not stage document.")?;
    }
}

/// Waits for the worker to finish, enforcing cancellation, time and output limits.
fn wait_for_exit(
    child: &mut Child,
    output: &File,
    stop: &AtomicBool,
    started: Instant,
) -> Result<(), String> {
    loop {
        if stop.load(Ordering::Acquire) {
            return Err("Document processing cancelled.".into());
        }
        if started.elapsed() > PROCESSING_TIMEOUT {
            return Err("Document processing timed out.".into());
        }
        if output
            .metadata()
            .map_err(|_| "Processor output unavailable.")?
            .len()
            > MAX_RESPONSE
        {
            return Err("Processor response exceeded its limit.".into());
        }
        if let Some(status) = child
            .0
            .try_wait()
            .map_err(|_| "Could not monitor document processor.")?
        {
            child.1 = false;
            if !status.success() {
                return Err("Document processor failed safely.".into());
            }
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
