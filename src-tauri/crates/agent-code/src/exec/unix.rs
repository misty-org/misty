//! Unix: the command runs in its own process group, with kernel limits on
//! file size, CPU time and process count; [`Tree`] stops what leaves the group.
use std::sync::{Arc, Mutex};

use tokio::io::AsyncReadExt;

pub use crate::tree::Tree;
use crate::{output::Capped, sandbox::Setup, CodeError};

pub type Child = tokio::process::Child;

/// Larger files written by one command are cut off by the kernel.
const MAX_FILE_SIZE: libc::rlim_t = 1 << 30;
/// CPU seconds any one process may use: a backstop for anything that
/// escapes being stopped (see `tree`).
const MAX_CPU_SECONDS: libc::rlim_t = 30 * 60;

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
fn spawn(setup: &Setup) -> Result<Child, CodeError> {
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

/// Starts the command and begins watching everything it starts.
pub fn start(setup: &Setup) -> Result<(Child, Tree), CodeError> {
    let child = spawn(setup)?;
    let tree = Tree::watch(child.id());
    Ok((child, tree))
}

/// The signal that ended a command, if one did.
pub fn signal(status: &std::process::ExitStatus) -> Option<i32> {
    std::os::unix::process::ExitStatusExt::signal(status)
}
