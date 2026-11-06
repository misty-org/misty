//! Commands in an AppContainer with no capabilities, so no network and nothing but what's granted
//! here. A job bounds memory, CPU and process count, and ends everything when the command does. This
//! compiles from macOS, but only `windows-confine`'s tests on a Windows machine prove it holds.
use crate::infra::file_access::secrets::{is_secret_file, is_secret_folder};
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use misty_windows_confine::{
    environment_block, spawn, system_variables, Access, Container, Job, JobLimits, Launch,
};
use sha2::{Digest, Sha256};

use super::{output::CappedOutput, ShellOutcome, ShellRequest};

/// Files that hold secrets stay closed even in a shared folder, because a command's output reaches
/// the model. Windows has no rule by name, so they're found before a command runs.
/// How many entries of a shared folder are looked through for secrets and Git folders.
const MAX_SCANNED_ENTRIES: usize = 200_000;

#[derive(Default)]
struct Scanned {
    closed: Vec<PathBuf>,
    git_folders: Vec<PathBuf>,
}

fn scan(root: &Path) -> Scanned {
    let mut found = Scanned::default();
    let mut queue = vec![root.to_path_buf()];
    let mut seen = 0;
    while let Some(folder) = queue.pop() {
        for entry in crate::infra::file_access::fs::read_dir(&folder).into_iter().flatten().flatten() {
            seen += 1;
            if seen > MAX_SCANNED_ENTRIES {
                return found;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if is_secret_folder(&name) {
                    found.closed.push(path);
                } else if name.eq_ignore_ascii_case(".git") {
                    found.git_folders.push(path);
                } else {
                    queue.push(path);
                }
            } else if is_secret_file(&name) {
                found.closed.push(path);
            }
        }
    }
    found
}

/// Takes the grants back when the command ends, so a chat that changes folder loses the old one.
struct FolderGrant<'a> {
    container: &'a Container,
    root: PathBuf,
}

impl Drop for FolderGrant<'_> {
    fn drop(&mut self) {
        let _ = self.container.forget(&self.root);
    }
}

fn read_capped(file: &mut File) -> (String, bool) {
    let mut output = CappedOutput::default();
    if file.seek(SeekFrom::Start(0)).is_ok() {
        let mut buffer = [0u8; 8192];
        while let Ok(read) = file.read(&mut buffer) {
            if read == 0 {
                break;
            }
            output.push(&buffer[..read]);
        }
    }
    output.finish()
}

fn run_blocking(
    workspace: &Path,
    command: &str,
    folder: Option<(PathBuf, bool)>,
    timeout: Duration,
    stop: &AtomicBool,
) -> Result<ShellOutcome, String> {
    let digest = Sha256::digest(workspace.to_string_lossy().as_bytes());
    let container = Container::open(&format!("misty.shell.{}", &hex::encode(digest)[..32]))?;
    container.grant(workspace, Access::Inside)?;
    let mut grant = None;
    if let Some((root, writable)) = folder {
        let access = if writable { Access::AddEdit } else { Access::ReadExecute };
        container.grant(&root, access)?;
        let scanned = scan(&root);
        for path in &scanned.closed {
            container.limit(path, None)?;
        }
        // Hooks written to a Git folder would later run outside the sandbox.
        for path in &scanned.git_folders {
            container.limit(path, Some(Access::ReadExecute))?;
        }
        grant = Some(FolderGrant { container: &container, root });
    }
    let mut stdout = tempfile::tempfile().map_err(|_| "shell_start_failed".to_owned())?;
    let mut stderr = tempfile::tempfile().map_err(|_| "shell_start_failed".to_owned())?;
    let job = Job::new(&JobLimits {
        process_memory: 2 * 1024 * 1024 * 1024,
        process_cpu: Duration::from_secs(600),
        processes: 64,
    })?;
    let system_root = std::env::var_os("SystemRoot").ok_or("shell_start_failed")?;
    let shell = Path::new(&system_root).join("System32").join("cmd.exe");
    let mut line = OsString::from("cmd.exe /d /s /c \"");
    line.push(command);
    line.push("\"");
    let temp = workspace.join(".tmp");
    let mut variables = system_variables();
    for name in ["TEMP", "TMP", "USERPROFILE", "HOME"] {
        let value = if name.starts_with('T') { temp.as_os_str() } else { workspace.as_os_str() };
        variables.push((OsStr::new(name).to_owned(), value.to_owned()));
    }
    let process = spawn(&Launch {
        application: &shell,
        command_line: &line,
        environment: &environment_block(variables),
        directory: workspace,
        stdin: None,
        stdout: &stdout,
        stderr: &stderr,
        container: &container,
        capabilities: &[],
        job: &job,
    })?;
    let started = Instant::now();
    let mut timed_out = false;
    let code = loop {
        if let Some(code) = process.wait(Duration::from_millis(50)) {
            break Some(code);
        }
        if stop.load(Ordering::Acquire) {
            break None;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            break None;
        }
    };
    // Whatever way it ended, nothing it started outlives it.
    job.terminate();
    drop(grant);
    let (out, cut_out) = read_capped(&mut stdout);
    let (err, cut_err) = read_capped(&mut stderr);
    Ok(ShellOutcome {
        exit_code: code.map(|code| code as i32),
        stdout: out,
        stderr: err,
        timed_out,
        truncated: cut_out || cut_err,
        shared_folder: None,
    })
}

pub(super) async fn run(
    workspace: &Path,
    request: &ShellRequest,
    timeout: Duration,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    let workspace = workspace.to_path_buf();
    let command = request.command.clone();
    let folder = request.folder.as_ref().map(|folder| (folder.root.clone(), folder.writable));
    tauri::async_runtime::spawn_blocking(move || {
        run_blocking(&workspace, &command, folder, timeout, &stop)
    })
    .await
    .map_err(|_| "shell_start_failed".to_owned())?
}
