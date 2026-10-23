//! Untrusted documents are parsed on macOS by the bundled document worker,
//! confined by `sandbox-exec` to a private working folder. Misty's own
//! process never parses them. Windows uses the same worker in an
//! AppContainer (see `document_worker_windows`).
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    os::unix::{
        fs::{FileExt, PermissionsExt},
        process::CommandExt,
    },
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

const PROFILE: &str = r#"(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow file-read* (literal (param "TOOL")) (subpath (param "WORK"))
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
  (literal "/") (literal "/dev/null") (literal "/dev/urandom")
  (regex #"^/(opt/homebrew|usr/local)/(Cellar|opt)/.*[.]dylib$")
  (regex #"^/(opt/homebrew|usr/local)/(Cellar|opt)/.*/lib$"))
(allow file-write* (subpath (param "WORK")))
(allow sysctl-read)
(allow file-read-metadata)
"#;

fn worker() -> Result<&'static [u8], String> {
    builtin_worker("document-processing", PROTOCOL)
}

fn builtin_worker(service: &str, protocol: u32) -> Result<&'static [u8], String> {
    // Executable bytes are part of the signed Misty binary, never downloaded or
    // resolved from a user-controlled directory.
    include!(concat!(env!("OUT_DIR"), "/builtin_workers.rs"))
}

/// Builds the sandboxed command that runs `executable` with `work` as its only
/// writable folder and tight resource limits. There is no permissive fallback.
fn sandboxed_command(executable: &Path, work: &Path) -> std::io::Result<Command> {
    let executable = executable.canonicalize()?;
    let work = work.canonicalize()?;
    let mut command = Command::new("/usr/bin/sandbox-exec");
    command
        .args(["-p", PROFILE, "-D"])
        .arg(format!("TOOL={}", executable.display()))
        .arg("-D")
        .arg(format!("WORK={}", work.display()))
        .arg(executable);
    command
        .current_dir(&work)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &work)
        .env("TMPDIR", &work)
        .env("LANG", "C");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.process_group(0);
    // Only async-signal-safe resource-limit calls run between fork and exec.
    unsafe {
        command.pre_exec(|| {
            for (resource, value) in [
                (libc::RLIMIT_CPU, 300),
                (libc::RLIMIT_FSIZE, 268_435_456),
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
pub(crate) fn process(path: &Path, stop: &AtomicBool) -> Result<Value, String> {
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
    std::fs::write(&executable, worker()?).map_err(|_| "Could not stage document processor.")?;
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o500))
        .map_err(|_| "Could not prepare processor permissions.")?;
    let started = Instant::now();
    stage_input(
        &input,
        &work.path().join(format!("input.{extension}")),
        stop,
        started,
    )?;

    let mut output = tempfile::tempfile().map_err(|_| "Could not receive document output.")?;
    let mut command = sandboxed_command(&executable, work.path())
        .map_err(|_| "Could not confine document processor.")?;
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
    let limit = crate::infra::documents::MAX_AGENT_DOCUMENT_BYTES;
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
