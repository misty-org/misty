//! Bounded lifetime of the restricted Restic process and its native data stream.
#![allow(dead_code)] // Awaiting the grant-owned Backups job dispatcher.
use super::{
    backup_archive::{self, Report, Source, ARCHIVE_NAME},
    backup_process,
    backup_repository::SnapshotCommitPermit,
};
use cap_std::fs::Dir;
use std::{
    io::{self, Read},
    path::Path,
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};

fn output(
    tool: &Path,
    endpoint: &str,
    password: &str,
    arguments: &[&str],
    cancel: Arc<AtomicBool>,
) -> Result<Vec<u8>, String> {
    let work = tempfile::Builder::new()
        .prefix("misty-backup-command-")
        .tempdir()
        .map_err(|_| "Could not prepare backup work.")?;
    let mut command = backup_process::command(tool, work.path(), endpoint, password)?;
    command
        .args(arguments)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = ChildGuard {
        child: command
            .spawn()
            .map_err(|_| "Could not start the restricted backup worker.")?,
        active: true,
    };
    let stdout = child
        .child
        .stdout
        .take()
        .ok_or("Backup output pipe unavailable.")?;
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(8_388_609)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = send.send(result);
    });
    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Acquire) || started.elapsed() > Duration::from_secs(86_400) {
            child.stop();
            return Err("Backup operation cancelled or exceeded its time limit.".into());
        }
        match child.child.try_wait() {
            Ok(Some(status)) => {
                child.active = false;
                let bytes = receive
                    .recv_timeout(Duration::from_secs(2))
                    .map_err(|_| "Backup output did not close.")?
                    .map_err(|_| "Could not read backup output.")?;
                if !status.success() {
                    return Err("The restricted backup worker failed. Verify the repository and its credentials.".into());
                }
                if bytes.len() > 8_388_608 {
                    return Err("Backup output exceeds 8 MiB.".into());
                }
                return Ok(bytes);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                child.stop();
                return Err("Could not observe the backup worker.".into());
            }
        }
    }
}

pub(super) fn initialize(
    tool: &Path,
    endpoint: &str,
    password: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    output(tool, endpoint, password, &["init"], cancel).map(|_| ())
}

pub(super) fn snapshots(
    tool: &Path,
    endpoint: &str,
    password: &str,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<u8>, String> {
    output(tool, endpoint, password, &["snapshots", "--json"], cancel)
}

pub(super) fn check_repository(
    tool: &Path,
    endpoint: &str,
    password: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    output(tool, endpoint, password, &["check", "--read-data"], cancel).map(|_| ())
}

struct ChildGuard {
    child: Child,
    active: bool,
}
impl ChildGuard {
    fn stop(&mut self) {
        if self.active {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
            #[cfg(not(unix))]
            {
                let _ = self.child.kill();
            }
            let _ = self.child.wait();
            self.active = false;
        }
    }
}
impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.stop();
    }
}
fn pump<T: Send + 'static>(
    child: Child,
    stream: T,
    cancel: Arc<AtomicBool>,
    operation: impl FnOnce(&mut T) -> io::Result<Report> + Send + 'static,
    commit: Option<SnapshotCommitPermit>,
    lifetime: Option<Box<dyn Send>>,
) -> Result<Report, String> {
    let mut child = ChildGuard {
        child,
        active: true,
    };
    let (send, receive) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let _lifetime = lifetime;
        let mut stream = stream;
        let result = operation(&mut stream);
        // Preserve the descriptor until the owner sees success or kills Restic.
        // In particular, a failed upload must not become a successful stdin EOF.
        let _ = send.send((result, stream));
    });
    let started = Instant::now();
    let mut result = None;
    let mut status = None;
    let answer = loop {
        if cancel.load(Ordering::Acquire) || started.elapsed() > Duration::from_secs(86_400) {
            break Err("Backup operation cancelled or exceeded its time limit.".into());
        }
        if result.is_none() {
            match receive.try_recv() {
                Ok((report, stream)) => match report {
                    Ok(report) => {
                        if let Some(permit) = &commit {
                            permit.input_complete();
                        }
                        result = Some(report);
                        drop(stream);
                    }
                    Err(error) => {
                        child.stop();
                        drop(stream);
                        break Err(format!("Backup data stream failed: {error}"));
                    }
                },
                Err(mpsc::TryRecvError::Empty) => {}
                Err(mpsc::TryRecvError::Disconnected) => {
                    break Err("Backup data stream stopped unexpectedly.".into())
                }
            }
        }
        if status.is_none() {
            match child.child.try_wait() {
                Ok(Some(exit)) => {
                    child.active = false;
                    status = Some(exit);
                }
                Ok(None) => {}
                Err(_) => break Err("Could not observe the backup worker.".into()),
            }
        }
        if let Some(status) = status {
            if !status.success() {
                break Err("The restricted backup worker failed. Verify the repository and its credentials.".into());
            }
            if let Some(report) = result.take() {
                if let Some(permit) = &commit {
                    if let Err(error) = permit.finalize() {
                        break Err(error);
                    }
                }
                break Ok(report);
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    if answer.is_err() {
        if let Some(permit) = &commit {
            permit.begin();
        }
        cancel.store(true, Ordering::Release);
        child.stop();
    }
    // A stalled filesystem read cannot be interrupted by killing Restic. Keep
    // errors responsive; the stream retains only its chosen handles and observes
    // cancellation before its next I/O. Job concurrency must include that worker.
    if answer.is_ok() {
        let _ = worker.join();
    }
    answer
}

pub(super) fn backup(
    tool: &Path,
    endpoint: &str,
    password: &str,
    sources: Vec<Source>,
    cancel: Arc<AtomicBool>,
    commit: SnapshotCommitPermit,
    lifetime: Option<Box<dyn Send>>,
) -> Result<Report, String> {
    commit.begin();
    if cancel.load(Ordering::Acquire) {
        return Err("Backup cancelled.".into());
    }
    let work = tempfile::Builder::new()
        .prefix("misty-backup-work-")
        .tempdir()
        .map_err(|_| "Could not prepare backup work.")?;
    let mut command = backup_process::command(tool, work.path(), endpoint, password)?;
    command
        .args([
            "backup",
            "--stdin",
            "--stdin-filename",
            ARCHIVE_NAME,
            "--host",
            "Misty",
            "--json",
        ])
        .stdin(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start the restricted backup worker.")?;
    let stdin = child.stdin.take().ok_or("Backup input pipe unavailable.")?;
    let flag = cancel.clone();
    pump(
        child,
        stdin,
        cancel,
        move |stdin| backup_archive::write_sources(&sources, stdin, flag),
        Some(commit),
        lifetime,
    )
}

pub(super) fn restore(
    tool: &Path,
    endpoint: &str,
    password: &str,
    snapshot: &str,
    destination: Arc<Dir>,
    cancel: Arc<AtomicBool>,
    lifetime: Option<Box<dyn Send>>,
) -> Result<Report, String> {
    if snapshot.len() != 64
        || !snapshot
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Choose a snapshot returned by this repository.".into());
    }
    if cancel.load(Ordering::Acquire) {
        return Err("Restore cancelled.".into());
    }
    let work = tempfile::Builder::new()
        .prefix("misty-restore-work-")
        .tempdir()
        .map_err(|_| "Could not prepare restore work.")?;
    let mut command = backup_process::command(tool, work.path(), endpoint, password)?;
    command
        .args(["dump", snapshot, &format!("/{ARCHIVE_NAME}")])
        .stdout(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "Could not start the restricted restore worker.")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Restore output pipe unavailable.")?;
    let flag = cancel.clone();
    pump(
        child,
        stdout,
        cancel,
        move |stdout| backup_archive::restore(stdout, &destination, flag),
        None,
        lifetime,
    )
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn chosen_folder_stream_round_trips_through_restic_and_failed_stream_creates_no_snapshot()
    {
        use super::super::backup_repository::RepositoryServer;
        let repository = tempfile::tempdir().unwrap();
        let handle = Arc::new(
            Dir::open_ambient_dir(repository.path(), cap_std::ambient_authority()).unwrap(),
        );
        let server = RepositoryServer::start(handle).await.unwrap();
        let endpoint = server.endpoint().to_owned();
        let commit = server.snapshot_commit_permit();
        tokio::task::spawn_blocking(move || {
            let tool = Path::new("/opt/homebrew/bin/restic")
                .canonicalize()
                .expect("Install Restic for the backup integration checks");
            let source = tempfile::tempdir().unwrap();
            let output = tempfile::tempdir().unwrap();
            let work = tempfile::tempdir().unwrap();
            std::fs::create_dir(source.path().join("nested")).unwrap();
            let content = vec![47u8; 1_048_576];
            std::fs::write(source.path().join("nested/report"), &content).unwrap();
            let directory = Arc::new(
                Dir::open_ambient_dir(source.path(), cap_std::ambient_authority()).unwrap(),
            );
            let destination = Arc::new(
                Dir::open_ambient_dir(output.path(), cap_std::ambient_authority()).unwrap(),
            );
            let control = |args: &[&str]| {
                let output =
                    backup_process::command(&tool, work.path(), &endpoint, "fixture-password")
                        .unwrap()
                        .args(args)
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .output()
                        .unwrap();
                assert!(
                    output.status.success(),
                    "Restic {:?}: {}",
                    args,
                    String::from_utf8_lossy(&output.stderr)
                );
                output.stdout
            };
            control(&["init"]);
            let backed_up = backup(
                &tool,
                &endpoint,
                "fixture-password",
                vec![Source {
                    directory: directory.clone(),
                    name: "Documents".into(),
                }],
                Arc::new(AtomicBool::new(false)),
                commit.clone(),
                None,
            )
            .unwrap();
            assert_eq!(backed_up.bytes, content.len() as u64);
            let snapshots: serde_json::Value =
                serde_json::from_slice(&control(&["snapshots", "--json"])).unwrap();
            assert_eq!(snapshots.as_array().unwrap().len(), 1);
            let snapshot = snapshots[0]["id"].as_str().unwrap();
            let restored = restore(
                &tool,
                &endpoint,
                "fixture-password",
                snapshot,
                destination,
                Arc::new(AtomicBool::new(false)),
                None,
            )
            .unwrap();
            assert_eq!(restored.bytes, backed_up.bytes);
            assert_eq!(
                std::fs::read(output.path().join("Documents/nested/report")).unwrap(),
                content
            );
            // Unsupported special files must not become a successful partial stdin snapshot.
            use std::os::unix::ffi::OsStrExt;
            let fifo = std::ffi::CString::new(
                source
                    .path()
                    .join("unsupported-pipe")
                    .as_os_str()
                    .as_bytes(),
            )
            .unwrap();
            assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
            assert!(backup(
                &tool,
                &endpoint,
                "fixture-password",
                vec![Source {
                    directory,
                    name: "Documents".into()
                }],
                Arc::new(AtomicBool::new(false)),
                commit.clone(),
                None,
            )
            .is_err());
            let snapshots: serde_json::Value =
                serde_json::from_slice(&control(&["snapshots", "--json"])).unwrap();
            assert_eq!(snapshots.as_array().unwrap().len(), 1);
        })
        .await
        .unwrap();
        drop(server);
    }

    #[test]
    fn failed_input_is_killed_before_eof_can_be_treated_as_success() {
        use std::os::unix::process::CommandExt;
        let work = tempfile::tempdir().unwrap();
        let marker = work.path().join("eof-was-accepted");
        let mut child = std::process::Command::new("/bin/sh")
            .args([
                "-c",
                "while read -r line; do :; done; printf committed > \"$1\"",
                "probe",
            ])
            .arg(&marker)
            .stdin(Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let result = pump(
            child,
            stdin,
            Arc::new(AtomicBool::new(false)),
            |_| Err(io::Error::other("fixture stream failure")),
            None,
            None,
        );
        assert!(result.is_err());
        assert!(!marker.exists());
    }
    #[test]
    fn cancellation_kills_the_worker_and_unblocks_its_pipe() {
        use std::os::unix::process::CommandExt;
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("60")
            .stdout(Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id();
        let stdout = child.stdout.take().unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            flag.store(true, Ordering::Release);
        });
        let start = Instant::now();
        let result = pump(
            child,
            stdout,
            cancel,
            |stdout| {
                io::copy(stdout, &mut io::sink())?;
                Ok(Report::default())
            },
            None,
            None,
        );
        assert!(result.is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
        let mut status = 0;
        assert_eq!(
            unsafe { libc::waitpid(pid as i32, &mut status, libc::WNOHANG) },
            -1
        );
        assert_eq!(
            io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }
}
