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

const BASE_PROFILE: &str = r#"
(version 1)
(deny default)
(allow process-fork)
(allow process-exec (literal (param "TOOL")))
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read*
  (literal (param "TOOL")) (subpath (param "TOOLS"))
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
  (subpath "/private/var/db/timezone") (literal "/private/etc/localtime")
  (literal "/") (literal "/etc") (literal "/var") (literal "/tmp") (literal "/private")
  (literal "/private/var") (literal "/dev") (literal "/dev/null") (literal "/dev/zero")
  (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/tty") (subpath "/dev/fd"))
(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (subpath "/dev/fd"))
(allow file-ioctl (literal "/dev/null") (literal "/dev/tty"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.logd")
  (global-name "com.apple.diagnosticd")
  (global-name "com.apple.system.notification_center"))
(allow ipc-posix-shm-read-data (ipc-posix-name "apple.shm.notification_center"))
(allow ipc-posix-shm-read-metadata)
(allow file-read* file-write* (subpath (param "WORKSPACE")))
(deny network*)
"#;

const SECRET_FILES: &str = r#"
(deny file-read* file-write*
  (regex #"/\.env(\.[^/]*)?$")
  (regex #"/\.(ssh|aws|gnupg|kube|docker)(/|$)")
  (regex #"/(id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials|\.netrc|\.npmrc|\.pypirc)$")
  (regex #"\.(pem|key|p12|pfx|keystore|env)$"))
"#;

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

const PROC_UID_ONLY: u32 = 4;

fn running_processes() -> u64 {
    // SAFETY: a null buffer only asks for the size the list would take.
    let bytes =
        unsafe { libc::proc_listpids(PROC_UID_ONLY, libc::getuid(), std::ptr::null_mut(), 0) };
    (bytes.max(0) as u64) / std::mem::size_of::<libc::pid_t>() as u64
}

const EXTRA_PROCESSES: u64 = 512;

const MAX_INHERITED_FILES: u64 = 1 << 20;

fn mark_changed_files(root: &Path, since: std::time::SystemTime) {
    use file_access::{fs, quarantine};
    let mut queue = vec![root.to_path_buf()];
    let mut seen = 0;
    while let Some(folder) = queue.pop() {
        for entry in fs::read_dir(&folder).into_iter().flatten().flatten() {
            seen += 1;
            if seen > MAX_MARKED_ENTRIES {
                return;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
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

const MAX_MARKED_ENTRIES: usize = 200_000;

pub(super) async fn run(
    workspace: &Path,
    request: &ShellRequest,
    timeout: Duration,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    let started_at = std::time::SystemTime::now() - Duration::from_secs(2);
    let mut marked_folder = None;
    let max_processes = running_processes() + EXTRA_PROCESSES;
    let tools = tools::ready()?;
    let mut profile = BASE_PROFILE.to_owned();
    let mut command = Command::new(sandbox::macos::SANDBOX_EXEC);
    let mut defines: Vec<(&str, &Path)> = Vec::new();
    if let Some(folder) = &request.folder {
        let root = file_access::fs::canonicalize(&folder.root)
            .map_err(|_| "shell_folder_unavailable".to_owned())?;
        profile.push_str(&folder_rules(folder.writable));
        marked_folder = Some(root);
    }
    profile.push_str(SECRET_FILES);
    if let Some(root) = &marked_folder {
        defines.push(("FOLDER", root));
    }
    defines.push(("WORKSPACE", workspace));
    defines.push(("TOOLS", &tools.folder));
    defines.push(("TOOL", &tools.program));
    command
        .args(sandbox::macos::arguments(&profile, &defines))
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
    unsafe {
        command.pre_exec(move || {
            let mut open_limit: libc::rlimit = std::mem::zeroed();
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut open_limit) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            for file in 3..open_limit.rlim_cur.min(MAX_INHERITED_FILES) as libc::c_int {
                libc::fcntl(file, libc::F_SETFD, libc::FD_CLOEXEC);
            }
            sandbox::macos::set_limits(&[
                (libc::RLIMIT_CPU, 600),
                (libc::RLIMIT_FSIZE, 1024 * 1024 * 1024),
                (libc::RLIMIT_NOFILE, 1024),
                (libc::RLIMIT_CORE, 0),
                (libc::RLIMIT_NPROC, max_processes),
            ])
        });
    }
    let mut child = command
        .spawn()
        .map_err(|_| "shell_start_failed".to_owned())?;
    let pid = child.id().ok_or("shell_start_failed")? as i32;
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
