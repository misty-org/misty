use std::{
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use page_text::protocol::MAX_ANSWER_BYTES;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

use file_access::fs;

#[cfg(target_os = "macos")]
const PROFILE: &str = r#"
(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow file-read* (literal (param "TOOL")) (subpath (param "WORK"))
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
  (literal "/"))
(allow sysctl-read)
"#;

#[cfg(target_os = "macos")]
type Keep = ();
#[cfg(target_os = "linux")]
type Keep = sandbox::linux::Confinement;

struct Staged {
    _folder: tempfile::TempDir,
    folder_path: PathBuf,
    executable: PathBuf,
}

static STAGED: Mutex<Option<Arc<Staged>>> = Mutex::new(None);

fn stage(executable: PathBuf) -> Result<Staged, String> {
    let folder = tempfile::Builder::new()
        .prefix("misty-page-reader-")
        .tempdir()
        .map_err(|_| "the reader's folder couldn't be made")?;
    let folder_path =
        fs::canonicalize(folder.path()).map_err(|_| "the reader's folder couldn't be made")?;
    Ok(Staged {
        _folder: folder,
        folder_path,
        executable,
    })
}

fn staged() -> Result<Arc<Staged>, String> {
    let executable = crate::app::workers::program("page-reader")?;
    let mut slot = STAGED.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(current) = slot.as_ref() {
        if current.executable == executable && fs::is_dir(&current.folder_path) {
            return Ok(current.clone());
        }
    }
    let fresh = Arc::new(stage(executable)?);
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
    unsafe {
        command.pre_exec(|| sandbox::macos::set_limits(&LIMITS));
    }
    Ok((command, ()))
}

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
        let send = async move {
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
