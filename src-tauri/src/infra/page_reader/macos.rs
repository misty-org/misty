//! The page reader on macOS, under `sandbox-exec`. A worker written to a fresh file took about 160 ms
//! per call in testing and one kept on disk about 9 ms, nearly all of the difference being the system
//! checking a binary it hasn't seen, so one staged copy lasts the app's lifetime. That copy is checked
//! against the bytes in the signed app before each use, and replaced if anything changed it.
use std::{
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use misty_page_reader::protocol::{MAX_ANSWER_BYTES, PROTOCOL};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

use crate::infra::file_access::fs;

const PROFILE: &str = include_str!("../../../sandbox/permissions/page-reader.sb");

struct Staged {
    /// Holds the private folder for as long as a read may use it.
    _folder: tempfile::TempDir,
    folder_path: PathBuf,
    executable: PathBuf,
}

static STAGED: Mutex<Option<Arc<Staged>>> = Mutex::new(None);

fn worker() -> Result<&'static [u8], String> {
    crate::infra::builtin_workers::builtin_worker("page-reader", PROTOCOL)
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

fn command(worker: &Staged) -> Command {
    let mut command = Command::new("/usr/bin/sandbox-exec");
    command
        .args(["-p", PROFILE, "-D"])
        .arg(format!("TOOL={}", worker.executable.display()))
        .arg("-D")
        .arg(format!("WORK={}", worker.folder_path.display()))
        .arg(&worker.executable)
        .current_dir(&worker.folder_path)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &worker.folder_path)
        .env("TMPDIR", &worker.folder_path)
        .env("LANG", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        // Dropping the read, when its run is cancelled, ends the worker too.
        .kill_on_drop(true);
    // Only async-signal-safe resource-limit calls run between fork and exec. It has no file to write,
    // so no size is allowed, which doesn't touch the pipes it answers on.
    unsafe {
        command.pre_exec(|| {
            for (resource, value) in [
                (libc::RLIMIT_CPU, super::TIME_LIMIT_SECONDS),
                (libc::RLIMIT_FSIZE, 0),
                (libc::RLIMIT_NOFILE, 32),
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
    command
}

async fn run_in(worker: &Staged, input: Vec<u8>) -> Result<Vec<u8>, String> {
    let mut child = command(worker)
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

#[cfg(test)]
#[path = "macos_tests.rs"]
mod tests;
