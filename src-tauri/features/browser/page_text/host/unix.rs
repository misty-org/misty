//! The page reader on macOS, under `sandbox-exec`, and on Linux, under Landlock, seccomp and
//! namespaces (`sandbox::linux`). A worker written to a fresh file took about 160 ms per call on
//! macOS in testing and one kept on disk about 9 ms, nearly all of the difference being the system
//! checking a binary it hasn't seen, so one staged copy lasts the app's lifetime. That copy is checked
//! against the bytes in the signed app before each use, and replaced if anything changed it.
use std::{
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use page_text::protocol::{MAX_ANSWER_BYTES, PROTOCOL};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

use file_access::fs;

#[cfg(target_os = "macos")]
const PROFILE: &str = include_str!("../../../../tauri-permissions/permissions/page-reader.sb");

/// What has to stay alive until the worker has started.
#[cfg(target_os = "macos")]
type Keep = ();
#[cfg(target_os = "linux")]
type Keep = sandbox::linux::Confinement;

struct Staged {
    /// Holds the private folder for as long as a read may use it.
    _folder: tempfile::TempDir,
    folder_path: PathBuf,
    executable: PathBuf,
}

static STAGED: Mutex<Option<Arc<Staged>>> = Mutex::new(None);

fn worker() -> Result<&'static [u8], String> {
    crate::app::embedded_workers::builtin_worker("page-reader", PROTOCOL)
}

/// Not a link, private to this user, and exactly the bytes the app was signed with.
fn still_intact(executable: &Path, bytes: &[u8]) -> bool {
    let Ok(metadata) = fs::symlink_metadata(executable) else {
        return false;
    };
    let private = metadata.file_type().is_file()
        && metadata.mode() & 0o777 == 0o500
        && metadata.uid() == unsafe { libc::getuid() };
    private && fs::read(executable).is_ok_and(|found| found == bytes)
}

fn stage(bytes: &[u8]) -> Result<Staged, String> {
    let folder = tempfile::Builder::new()
        .prefix("misty-page-reader-")
        .tempdir()
        .map_err(|_| "the reader's folder couldn't be made")?;
    let executable = folder.path().join("worker");
    fs::write(&executable, bytes).map_err(|_| "the reader couldn't be staged")?;
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o500))
        .map_err(|_| "the reader couldn't be staged")?;
    // Seatbelt matches real paths, and the temp folder's own path goes through a link.
    let executable = fs::canonicalize(&executable).map_err(|_| "the reader couldn't be staged")?;
    let folder_path =
        fs::canonicalize(folder.path()).map_err(|_| "the reader couldn't be staged")?;
    Ok(Staged {
        _folder: folder,
        folder_path,
        executable,
    })
}

/// The staged worker, staged now if it's the first read or the copy on disk has changed.
fn staged() -> Result<Arc<Staged>, String> {
    let bytes = worker()?;
    let mut slot = STAGED.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(current) = slot.as_ref() {
        if still_intact(&current.executable, bytes) {
            return Ok(current.clone());
        }
    }
    let fresh = Arc::new(stage(bytes)?);
    *slot = Some(fresh.clone());
    Ok(fresh)
}

#[cfg(target_os = "macos")]
fn command(worker: &Staged) -> Result<(Command, Keep), String> {
    let mut command = Command::new(sandbox::macos::SANDBOX_EXEC);
    command
        .args(sandbox::macos::arguments(
            PROFILE,
            &[("TOOL", &worker.executable), ("WORK", &worker.folder_path)],
        ))
        .arg(&worker.executable)
        .process_group(0);
    plain(&mut command, worker);
    // Only async-signal-safe resource-limit calls run between fork and exec. It has no file to write,
    // so no size is allowed, which doesn't touch the pipes it answers on.
    unsafe {
        command.pre_exec(|| sandbox::macos::set_limits(&LIMITS));
    }
    Ok((command, ()))
}

/// The same walls on Linux: it reads only itself and its folder, writes nothing, has no network
/// and dies with Misty. Without Landlock no page is read.
#[cfg(target_os = "linux")]
fn command(worker: &Staged) -> Result<(Command, Keep), String> {
    use sandbox::linux::{Access, Confinement, Policy};
    let confinement = Confinement::new(&Policy {
        program: worker.executable.clone(),
        required: vec![(worker.folder_path.clone(), Access::Read)],
        optional: Vec::new(),
        forks: false,
        limits: LIMITS.to_vec(),
    })?;
    let mut command = Command::new(&worker.executable);
    plain(&mut command, worker);
    // The hook starts the worker's own session, which is its process group too.
    unsafe {
        command.pre_exec(confinement.hook());
    }
    Ok((command, confinement))
}

#[cfg(target_os = "macos")]
type Resource = libc::c_int;
#[cfg(target_os = "linux")]
type Resource = libc::__rlimit_resource_t;

const LIMITS: [(Resource, libc::rlim_t); 4] = [
    (libc::RLIMIT_CPU, super::TIME_LIMIT_SECONDS),
    (libc::RLIMIT_FSIZE, 0),
    (libc::RLIMIT_NOFILE, 32),
    (libc::RLIMIT_CORE, 0),
];

/// Nothing of Misty's environment, pipes for the page and the answer, and an end with the read.
fn plain(command: &mut Command, worker: &Staged) {
    command
        .current_dir(&worker.folder_path)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &worker.folder_path)
        .env("TMPDIR", &worker.folder_path)
        .env("LANG", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // Dropping the read, when its run is cancelled, ends the worker too.
        .kill_on_drop(true);
}

async fn run_in(worker: &Staged, input: Vec<u8>) -> Result<Vec<u8>, String> {
    let (mut command, _keep) = command(worker)?;
    let mut child = command
        .spawn()
        .map_err(|_| "the reader didn't start".to_owned())?;
    let mut stdin = child.stdin.take().ok_or("the reader has no input")?;
    let stdout = child.stdout.take().ok_or("the reader has no output")?;
    let finished = tokio::time::timeout(Duration::from_secs(super::TIME_LIMIT_SECONDS), async {
        // Writing and reading together: a worker that stops reading must not stall this.
        let send = async move {
            // A worker gone early shows in its exit status.
            let _ = stdin.write_all(&input).await;
        };
        let mut output = Vec::new();
        let mut limited = stdout.take(MAX_ANSWER_BYTES as u64 + 1);
        let receive = limited.read_to_end(&mut output);
        let (_, received) = tokio::join!(send, receive);
        received.map_err(|_| "the reader's answer didn't arrive")?;
        if output.len() > MAX_ANSWER_BYTES {
            return Err("the reader's answer is over its limit");
        }
        let status = child.wait().await.map_err(|_| "the reader was lost")?;
        if status.success() {
            Ok(output)
        } else {
            Err("the reader failed")
        }
    })
    .await;
    match finished {
        Ok(answer) => answer.map_err(str::to_owned),
        Err(_) => Err("the reader ran out of time".to_owned()),
    }
}

/// The worker's whole output for this input. There's no permissive fallback: any failure is the error.
pub(super) async fn run(input: Vec<u8>) -> Result<Vec<u8>, String> {
    let worker = tokio::task::spawn_blocking(staged)
        .await
        .map_err(|_| "the reader couldn't be staged")??;
    run_in(&worker, input).await
}

pub(super) fn clean_up() {
    STAGED.lock().unwrap_or_else(PoisonError::into_inner).take();
}

#[cfg(all(test, target_os = "macos"))]
#[path = "macos_tests.rs"]
mod tests;
