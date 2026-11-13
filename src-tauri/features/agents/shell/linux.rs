//! Commands on Linux under `sandbox::linux`: Landlock lets them read the shell tools Misty ships, the
//! system's libraries and, when granted, the shared folder, and change only the chat's workspace
//! (and, when allowed, the shared folder); seccomp leaves them no socket; namespaces, where the system
//! allows them, end every process with the command. The shell and its tools are the program in
//! `tools`, and that's the only program the rules let them start.
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use file_access::secrets::{is_secret_file, is_secret_folder};
use sandbox::linux::{Access, Confinement, Policy};
use tokio::{io::AsyncReadExt, process::Command};

use super::{
    exit_watcher::ExitWatcher, output::CappedOutput, process_tree::Tree, tools, ShellOutcome,
    ShellRequest,
};

/// A command may start this many processes beyond the person's own, so a fork bomb stops there
/// rather than at the system's limit, where the person couldn't start anything either.
const EXTRA_PROCESSES: u64 = 512;

/// How many entries of a shared folder are looked through for secrets and Git folders.
const MAX_SCANNED_ENTRIES: usize = 200_000;

/// System files the shell's tools read: time zones for `date`, and user and group names for `ls -l`.
const SHELL_FILES: &[&str] = &[
    "/usr/share/zoneinfo",
    "/etc/localtime",
    "/etc/passwd",
    "/etc/group",
    "/etc/nsswitch.conf",
];

/// How many processes this person is running now, since the system's limit counts all of them.
// `/proc` is the kernel's view of processes, not anyone's files, so the file gate has no say here.
#[allow(clippy::disallowed_methods)]
fn running_processes() -> u64 {
    use std::os::unix::fs::MetadataExt;
    // SAFETY: a plain getter.
    let uid = unsafe { libc::getuid() };
    std::fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .bytes()
                .all(|b| b.is_ascii_digit())
        })
        .filter(|entry| entry.metadata().is_ok_and(|metadata| metadata.uid() == uid))
        .count() as u64
}

/// Folders that run code by themselves later, outside the sandbox, so commands only read them.
fn runs_later(name: &str, is_dir: bool) -> bool {
    let name = name.to_ascii_lowercase();
    if is_dir {
        matches!(name.as_str(), ".git" | ".githooks" | ".husky")
    } else {
        name == ".envrc"
    }
}

/// What a scan found in a shared folder: entries closed to commands, and entries they only read.
#[derive(Default)]
struct Scanned {
    closed: Vec<PathBuf>,
    read_only: Vec<PathBuf>,
}

fn scan(root: &Path, writable: bool) -> Scanned {
    let mut found = Scanned::default();
    let mut queue = vec![root.to_path_buf()];
    let mut seen = 0;
    while let Some(folder) = queue.pop() {
        for entry in file_access::fs::read_dir(&folder)
            .into_iter()
            .flatten()
            .flatten()
        {
            seen += 1;
            if seen > MAX_SCANNED_ENTRIES {
                return found;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if kind.is_dir() {
                if is_secret_folder(&name) {
                    found.closed.push(path);
                } else if writable && runs_later(&name, true) {
                    found.read_only.push(path);
                } else {
                    queue.push(path);
                }
            } else if is_secret_file(&name) {
                found.closed.push(path);
            } else if writable && runs_later(&name, false) {
                found.read_only.push(path);
            }
        }
    }
    found
}

/// The rules for a shared folder. Landlock only adds, so a folder holding a secret can't be granted
/// whole: it gets its listing, and everything in it except the secret gets its own rule. Down the
/// rest of the tree, folders without anything special are granted whole. Files a command makes right
/// inside such a folder are refused; anywhere else they work as usual. A secret's name shows in a
/// listing; what's in it never does. The folder's own rule comes first.
fn folder_rules(root: &Path, writable: bool) -> Vec<(PathBuf, Access)> {
    let full = if writable {
        Access::AddEdit
    } else {
        Access::Read
    };
    let scanned = scan(root, writable);
    if scanned.closed.is_empty() && scanned.read_only.is_empty() {
        return vec![(root.to_path_buf(), full)];
    }
    // Every folder on the way to something special is split into its entries.
    let mut split = std::collections::HashSet::new();
    for path in scanned.closed.iter().chain(&scanned.read_only) {
        let mut parent = path.parent();
        while let Some(folder) = parent {
            if !folder.starts_with(root) || !split.insert(folder.to_path_buf()) {
                break;
            }
            parent = folder.parent();
        }
    }
    let mut rules = Vec::new();
    let mut queue = vec![root.to_path_buf()];
    while let Some(folder) = queue.pop() {
        rules.push((folder.clone(), Access::List));
        for entry in file_access::fs::read_dir(&folder)
            .into_iter()
            .flatten()
            .flatten()
        {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() || scanned.closed.contains(&path) {
                continue;
            }
            if scanned.read_only.contains(&path) {
                rules.push((path, Access::Read));
            } else if kind.is_dir() && split.contains(&path) {
                queue.push(path);
            } else {
                rules.push((path, full));
            }
        }
    }
    rules
}

fn policy(tools: &tools::Tools, workspace: &Path, folder: Option<(&Path, bool)>) -> Policy {
    let mut required = vec![
        (tools.folder.clone(), Access::Read),
        (workspace.to_path_buf(), Access::Private),
    ];
    let mut optional: Vec<(PathBuf, Access)> = SHELL_FILES
        .iter()
        .map(|path| (PathBuf::from(path), Access::Read))
        .collect();
    if let Some((root, writable)) = folder {
        // The folder itself must take its rule; an entry that went away since the scan needn't.
        let mut rules = folder_rules(root, writable).into_iter();
        required.extend(rules.next());
        optional.extend(rules);
    }
    Policy {
        program: tools.program.clone(),
        required,
        optional,
        forks: true,
        limits: vec![
            (libc::RLIMIT_CPU, 600),
            (libc::RLIMIT_FSIZE, 1024 * 1024 * 1024),
            (libc::RLIMIT_NOFILE, 1024),
            (libc::RLIMIT_CORE, 0),
            (libc::RLIMIT_NPROC, running_processes() + EXTRA_PROCESSES),
        ],
    }
}

pub(super) async fn run(
    workspace: &Path,
    request: &ShellRequest,
    timeout: Duration,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    let tools = tools::ready()?;
    let folder = match &request.folder {
        Some(folder) => Some((
            file_access::fs::canonicalize(&folder.root)
                .map_err(|_| "shell_folder_unavailable".to_owned())?,
            folder.writable,
        )),
        None => None,
    };
    let built = {
        let tools = tools.clone();
        let workspace = workspace.to_path_buf();
        let folder = folder.clone();
        tokio::task::spawn_blocking(move || {
            Confinement::new(&policy(
                &tools,
                &workspace,
                folder
                    .as_ref()
                    .map(|(root, writable)| (root.as_path(), *writable)),
            ))
        })
        .await
        .map_err(|_| "shell_start_failed".to_owned())?
    };
    let confinement = built?;
    let mut command = Command::new(tools.folder.join("sh"));
    command
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
        .stderr(Stdio::piped());
    // The hook starts the command's own session, which is its process group too.
    unsafe {
        command.pre_exec(confinement.hook());
    }
    let mut child = command
        .spawn()
        .map_err(|_| "shell_start_failed".to_owned())?;
    drop(confinement);
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
