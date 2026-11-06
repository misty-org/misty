//! Commands under Seatbelt, through the system's `sandbox-exec`, the way the document worker runs.
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

use super::{output::CappedOutput, process_tree::Tree, ShellOutcome, ShellRequest};

const BASE_PROFILE: &str = include_str!("../../../sandbox/permissions/agent-shell.sb");

/// Files that hold secrets stay unreadable, even in a shared folder, because a command's output
/// reaches the model.
const SECRET_FILES: &str = r#"
(deny file-read* file-write*
  (regex #"/\.env(\.[^/]*)?$")
  (regex #"/\.(ssh|aws|gnupg|kube|docker)(/|$)")
  (regex #"/(id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials|\.netrc|\.npmrc|\.pypirc)$")
  (regex #"\.(pem|key|p12|pfx|keystore)$"))
"#;

/// A shared folder's rules. Deleting comes after the write rule, so it wins: `rm -rf`, `rmdir` and
/// `mv` are refused however they're called, and only overwriting can still lose data. Git's folder
/// stays read-only, because hooks written there would later run outside the sandbox.
fn folder_rules(writable: bool) -> String {
    let mut rules = String::from("(allow file-read* (subpath (param \"FOLDER\")))\n");
    if writable {
        rules.push_str(
            "(allow file-write* (subpath (param \"FOLDER\")))\n\
             (deny file-write-unlink (subpath (param \"FOLDER\")))\n\
             (deny file-write* (regex #\"/\\.git(/|$)\"))\n",
        );
    }
    rules
}

/// Developer tools come first: `/usr/bin/git` and `/usr/bin/python3` are stubs that fail inside a
/// sandbox with a misleading Xcode license message, while the real copies work.
const TOOL_PATH: &str =
    "/opt/homebrew/bin:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin";

pub(super) async fn run(
    workspace: &Path,
    request: &ShellRequest,
    timeout: Duration,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    let mut profile = BASE_PROFILE.to_owned();
    let mut command = Command::new("/usr/bin/sandbox-exec");
    if let Some(folder) = &request.folder {
        let root = folder
            .root
            .canonicalize()
            .map_err(|_| "shell_folder_unavailable".to_owned())?;
        profile.push_str(&folder_rules(folder.writable));
        command.arg("-D").arg(format!("FOLDER={}", root.display()));
    }
    profile.push_str(SECRET_FILES);
    command
        .arg("-p")
        .arg(profile)
        .arg("-D")
        .arg(format!("WORKSPACE={}", workspace.display()))
        .args(["/bin/sh", "-c"])
        .arg(&request.command)
        .current_dir(workspace)
        .env_clear()
        .env("PATH", TOOL_PATH)
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
        command.pre_exec(|| {
            for (resource, value) in [
                (libc::RLIMIT_CPU, 600),
                (libc::RLIMIT_FSIZE, 1024 * 1024 * 1024),
                (libc::RLIMIT_NOFILE, 1024),
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
    let mut child = command
        .spawn()
        .map_err(|_| "shell_start_failed".to_owned())?;
    let pid = child.id().ok_or("shell_start_failed")? as i32;
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
    let (stdout, cut_out) = finished(stdout).await;
    let (stderr, cut_err) = finished(stderr).await;
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
