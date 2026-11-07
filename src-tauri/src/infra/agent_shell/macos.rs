//! Commands under Seatbelt, through the system's `sandbox-exec`, the way the document worker runs. The
//! shell and its tools are the program in `tools`, and that's the only program the profile can start.
use std::{
    path::Path,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use tokio::{io::AsyncReadExt, process::Command};

use super::{
    exit_watcher::ExitWatcher, output::CappedOutput, process_tree::Tree, tools, ShellOutcome,
    ShellRequest,
};

const BASE_PROFILE: &str = include_str!("../../../sandbox/permissions/agent-shell.sb");

/// Files that hold secrets stay unreadable, even in a shared folder, because a command's output
/// reaches the model.
const SECRET_FILES: &str = r#"
(deny file-read* file-write*
  (regex #"/\.env(\.[^/]*)?$")
  (regex #"/\.(ssh|aws|gnupg|kube|docker)(/|$)")
  (regex #"/(id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials|\.netrc|\.npmrc|\.pypirc)$")
  (regex #"\.(pem|key|p12|pfx|keystore|env)$"))
"#;

/// A shared folder's rules. The refusals come after the write rule, so they win:
/// - `rm -rf`, `rmdir` and `mv` are refused however they're called, and only overwriting can lose data.
/// - A hard link would keep write access to a file after the grant is taken back.
/// - Removing the quarantine flag would let a planted program skip Gatekeeper's check.
/// - Files that run by themselves stay read-only, because they'd later run outside the sandbox.
fn folder_rules(writable: bool) -> String {
    let mut rules = String::from("(allow file-read* (subpath (param \"FOLDER\")))\n");
    if writable {
        rules.push_str(
            "(allow file-write* (subpath (param \"FOLDER\")))\n\
             (deny file-write-unlink file-link file-write-xattr (subpath (param \"FOLDER\")))\n\
             (deny file-write* (require-all (subpath (param \"FOLDER\")) (regex #\"/\\.(git|githooks|husky|envrc)(/|$)\")))\n",
        );
    }
    rules
}

/// From `<sys/proc_info.h>`; the libc crate doesn't name it.
const PROC_UID_ONLY: u32 = 4;

/// How many processes this person is running now, since the system's limit counts all of them.
fn running_processes() -> u64 {
    // SAFETY: a null buffer only asks for the size the list would take.
    let bytes = unsafe {
        libc::proc_listpids(PROC_UID_ONLY, libc::getuid(), std::ptr::null_mut(), 0)
    };
    (bytes.max(0) as u64) / std::mem::size_of::<libc::pid_t>() as u64
}

/// A command may start this many processes beyond those, so a fork bomb stops there rather than at
/// the system's limit, where the person couldn't start anything either.
const EXTRA_PROCESSES: u64 = 512;

/// How many open files are closed off before a command starts.
const MAX_INHERITED_FILES: u64 = 1 << 20;

/// Marks the files a command added or edited in a shared folder, which it can't do for itself.
fn mark_changed_files(root: &Path, since: std::time::SystemTime) {
    use crate::infra::file_access::{fs, quarantine};
    let mut queue = vec![root.to_path_buf()];
    let mut seen = 0;
    while let Some(folder) = queue.pop() {
        for entry in fs::read_dir(&folder).into_iter().flatten().flatten() {
            seen += 1;
            if seen > MAX_MARKED_ENTRIES {
                return;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                queue.push(entry.path());
            } else if kind.is_file()
                && entry
                    .metadata()
                    .and_then(|metadata| metadata.modified())
                    .is_ok_and(|modified| modified >= since)
            {
                quarantine::mark_from_agent(&entry.path());
            }
        }
    }
}

/// How many entries of a shared folder are looked through after a command that can write to it.
const MAX_MARKED_ENTRIES: usize = 200_000;

pub(super) async fn run(
    workspace: &Path,
    request: &ShellRequest,
    timeout: Duration,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    // File times can be a little behind the clock.
    let started_at = std::time::SystemTime::now() - Duration::from_secs(2);
    let mut marked_folder = None;
    let max_processes = running_processes() + EXTRA_PROCESSES;
    let tools = tools::ready()?;
    let mut profile = BASE_PROFILE.to_owned();
    let mut command = Command::new("/usr/bin/sandbox-exec");
    if let Some(folder) = &request.folder {
        let root = crate::infra::file_access::fs::canonicalize(&folder.root)
            .map_err(|_| "shell_folder_unavailable".to_owned())?;
        profile.push_str(&folder_rules(folder.writable));
        command.arg("-D").arg(format!("FOLDER={}", root.display()));
        if folder.writable {
            marked_folder = Some(root);
        }
    }
    profile.push_str(SECRET_FILES);
    command
        .arg("-p")
        .arg(profile)
        .arg("-D")
        .arg(format!("WORKSPACE={}", workspace.display()))
        .arg("-D")
        .arg(format!("TOOLS={}", tools.folder.display()))
        .arg("-D")
        .arg(format!("TOOL={}", tools.program.display()))
        .arg(tools.folder.join("sh"))
        .arg("-c")
        .arg(&request.command)
        .current_dir(workspace)
        .env_clear()
        .env("PATH", &tools.folder)
        .env("HOME", workspace)
        .env("TMPDIR", workspace.join(".tmp"))
        .env("LANG", "en_US.UTF-8")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    // Only async-signal-safe resource-limit calls run between fork and exec.
    unsafe {
        command.pre_exec(move || {
            // Native libraries in Misty's process can leave a file open across exec, and a command
            // would then hold whatever that file is. The runner's own pipes are already marked.
            let mut open_limit: libc::rlimit = std::mem::zeroed();
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut open_limit) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            for file in 3..open_limit.rlim_cur.min(MAX_INHERITED_FILES) as libc::c_int {
                libc::fcntl(file, libc::F_SETFD, libc::FD_CLOEXEC);
            }
            for (resource, value) in [
                (libc::RLIMIT_CPU, 600),
                (libc::RLIMIT_FSIZE, 1024 * 1024 * 1024),
                (libc::RLIMIT_NOFILE, 1024),
                (libc::RLIMIT_CORE, 0),
                (libc::RLIMIT_NPROC, max_processes),
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
    let mut child = command
        .spawn()
        .map_err(|_| "shell_start_failed".to_owned())?;
    let pid = child.id().ok_or("shell_start_failed")? as i32;
    // A command that couldn't be stopped after a crash doesn't run at all.
    let Ok(exit_watcher) = ExitWatcher::start(pid) else {
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
        let _ = child.wait().await;
        return Err("shell_start_failed".to_owned());
    };
    let tree = Tree::watch(child.id());
    let stdout = read_capped(child.stdout.take());
    let stderr = read_capped(child.stderr.take());
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if stop.load(Ordering::Acquire) {
            break None;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            break None;
        }
        tokio::select! {
            status = child.wait() => break status.ok(),
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
    };
    // Whatever way it ended, nothing it started outlives it.
    tree.kill_all();
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
    }
    let _ = child.wait().await;
    exit_watcher.stop().await;
    let (stdout, cut_out) = finished(stdout).await;
    let (stderr, cut_err) = finished(stderr).await;
    if let Some(root) = marked_folder {
        let _ = tokio::task::spawn_blocking(move || mark_changed_files(&root, started_at)).await;
    }
    Ok(ShellOutcome {
        exit_code: status.and_then(|status| status.code()),
        stdout,
        stderr,
        timed_out,
        truncated: cut_out || cut_err,
        shared_folder: None,
    })
}

fn read_capped<R>(pipe: Option<R>) -> tokio::task::JoinHandle<CappedOutput>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut output = CappedOutput::default();
        let Some(mut pipe) = pipe else {
            return output;
        };
        let mut buffer = [0u8; 8192];
        while let Ok(read) = pipe.read(&mut buffer).await {
            if read == 0 {
                break;
            }
            output.push(&buffer[..read]);
        }
        output
    })
}

/// A process that escaped the group could hold a pipe open forever, so reading has a deadline.
async fn finished(reader: tokio::task::JoinHandle<CappedOutput>) -> (String, bool) {
    let abort = reader.abort_handle();
    match tokio::time::timeout(Duration::from_secs(2), reader).await {
        Ok(Ok(output)) => output.finish(),
        _ => {
            abort.abort();
            (String::new(), true)
        }
    }
}
