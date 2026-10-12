//! Running one command to completion inside the sandbox.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::{io::AsyncReadExt, process::Child};

use crate::{output::Capped, sandbox::Setup, CodeError};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
/// Below the five minutes a device job may take, so a result always returns.
pub const MAX_TIMEOUT: Duration = Duration::from_secs(240);
const MAX_COMMAND_BYTES: usize = 16 * 1024;
/// Larger files written by one command are cut off by the kernel.
const MAX_FILE_SIZE: libc::rlim_t = 1 << 30;
/// CPU seconds any one process may use: a backstop for anything that
/// escapes being stopped (see `tree`).
const MAX_CPU_SECONDS: libc::rlim_t = 30 * 60;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub command: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}

pub fn check_command(command: &str) -> Result<(), CodeError> {
    if command.trim().is_empty() {
        return Err(CodeError::fix("The command is empty."));
    }
    if command.len() > MAX_COMMAND_BYTES {
        return Err(CodeError::fix(
            "That command is over 16 KB. Write a script file with code_write and run it.",
        ));
    }
    if command.contains('\0') {
        return Err(CodeError::fix("Commands can't contain NUL characters."));
    }
    Ok(())
}

/// Processes a command's whole tree may add on top of what the person
/// already runs. RLIMIT_NPROC counts every process of the user, so the limit
/// is set relative to the current count: a fork bomb hits it, the rest of the
/// Mac doesn't, since the limit applies only inside the command's tree.
const EXTRA_PROCESSES: libc::rlim_t = 256;

#[cfg(target_os = "macos")]
fn user_process_count() -> Option<libc::rlim_t> {
    const PROC_UID_ONLY: u32 = 4;
    let uid = unsafe { libc::getuid() };
    // With no buffer the call returns a padded estimate; the real count needs one.
    let estimate = unsafe { libc::proc_listpids(PROC_UID_ONLY, uid, std::ptr::null_mut(), 0) };
    if estimate <= 0 {
        return None;
    }
    let mut pids = vec![0 as libc::pid_t; estimate as usize / std::mem::size_of::<libc::pid_t>() + 64];
    let bytes = unsafe {
        libc::proc_listpids(
            PROC_UID_ONLY,
            uid,
            pids.as_mut_ptr() as *mut libc::c_void,
            (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
        )
    };
    (bytes > 0).then(|| {
        let listed = &pids[..(bytes as usize / std::mem::size_of::<libc::pid_t>()).min(pids.len())];
        listed.iter().filter(|pid| **pid > 0).count() as libc::rlim_t
    })
}

#[cfg(not(target_os = "macos"))]
fn user_process_count() -> Option<libc::rlim_t> {
    None
}

/// Starts the sandboxed process in its own process group, stdin closed,
/// output piped, environment replaced.
pub fn spawn(setup: &Setup) -> Result<Child, CodeError> {
    let process_limit = user_process_count().map(|count| count + EXTRA_PROCESSES);
    let mut command = tokio::process::Command::new(&setup.program);
    command
        .args(&setup.args)
        .env_clear()
        .envs(&setup.env)
        .current_dir(&setup.cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .process_group(0);
    unsafe {
        command.pre_exec(move || {
            let size = libc::rlimit {
                rlim_cur: MAX_FILE_SIZE,
                rlim_max: MAX_FILE_SIZE,
            };
            libc::setrlimit(libc::RLIMIT_FSIZE, &size);
            let cpu = libc::rlimit {
                rlim_cur: MAX_CPU_SECONDS,
                rlim_max: MAX_CPU_SECONDS,
            };
            libc::setrlimit(libc::RLIMIT_CPU, &cpu);
            if let Some(limit) = process_limit {
                let mut current = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
                libc::getrlimit(libc::RLIMIT_NPROC, &mut current);
                let limit = limit.min(current.rlim_max);
                let processes = libc::rlimit { rlim_cur: limit, rlim_max: limit };
                libc::setrlimit(libc::RLIMIT_NPROC, &processes);
            }
            let none = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            libc::setrlimit(libc::RLIMIT_CORE, &none);
            Ok(())
        });
    }
    command
        .spawn()
        .map_err(|error| CodeError::Unavailable(format!("The command could not start: {error}")))
}

/// Stops a process group and everything it started.
pub fn kill_group(pid: Option<u32>) {
    if let Some(pid) = pid {
        if pid > 1 {
            unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL) };
        }
    }
}

/// Copies a child's stdout and stderr into one capped buffer.
pub fn collect(child: &mut Child, sink: Arc<Mutex<Capped>>) -> Vec<tokio::task::JoinHandle<()>> {
    let mut tasks = Vec::new();
    if let Some(mut stdout) = child.stdout.take() {
        let sink = sink.clone();
        tasks.push(tokio::spawn(async move {
            let mut buffer = [0u8; 8192];
            while let Ok(read) = stdout.read(&mut buffer).await {
                if read == 0 {
                    break;
                }
                if let Ok(mut sink) = sink.lock() {
                    sink.push(&buffer[..read]);
                }
            }
        }));
    }
    if let Some(mut stderr) = child.stderr.take() {
        tasks.push(tokio::spawn(async move {
            let mut buffer = [0u8; 8192];
            while let Ok(read) = stderr.read(&mut buffer).await {
                if read == 0 {
                    break;
                }
                if let Ok(mut sink) = sink.lock() {
                    sink.push(&buffer[..read]);
                }
            }
        }));
    }
    tasks
}

/// Runs a command to completion or until its timeout. A non-zero exit is a
/// normal result the model reads, not an error.
pub async fn run(setup: Setup, timeout: Duration) -> Result<Value, CodeError> {
    let started = Instant::now();
    let mut child = spawn(&setup)?;
    let pid = child.id();
    let tree = crate::tree::Tree::watch(pid);
    let sink = Arc::new(Mutex::new(Capped::new(6 * 1024, 10 * 1024)));
    let readers = collect(&mut child, sink.clone());
    let status = tokio::time::timeout(timeout, child.wait()).await;
    // Background jobs a command left behind would hold the pipes open and
    // outlive the call; dev servers belong in code_start instead.
    kill_group(pid);
    tree.kill_all();
    let timed_out = status.is_err();
    if timed_out {
        let _ = child.kill().await;
    }
    drop(tree);
    for reader in readers {
        let _ = tokio::time::timeout(Duration::from_secs(2), reader).await;
    }
    let (output, bytes) = sink
        .lock()
        .map(|sink| (sink.render(), sink.total()))
        .unwrap_or_default();
    let exit_code = match &status {
        Ok(Ok(status)) => status.code(),
        _ => None,
    };
    let signal = match &status {
        Ok(Ok(status)) => std::os::unix::process::ExitStatusExt::signal(status),
        _ => None,
    };
    let mut result = json!({
        "exitCode": exit_code,
        "output": output,
        "outputBytes": bytes,
        "seconds": (started.elapsed().as_millis() as f64 / 1000.0),
    });
    if timed_out {
        result["timedOut"] = json!(true);
        result["note"] = json!(format!(
            "Stopped after {} seconds. Long-running servers belong in code_start.",
            timeout.as_secs()
        ));
    } else if let Some(signal) = signal {
        result["signal"] = json!(signal);
    }
    if output.contains("Operation not permitted") || output.contains("deny(1)") {
        result["sandboxNote"] = json!(
            "Some access was blocked by the sandbox: commands can use only the project folder, can't change .git or secret files, and reach the network only when package installs are allowed for this project."
        );
    }
    Ok(result)
}
