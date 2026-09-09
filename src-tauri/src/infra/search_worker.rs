//! Downloaded Files index execution. Only host-selected private index storage is
//! accessible to the worker; source folders and credentials are never mounted.
use crate::infra::document_intelligence::ServiceLease;
use serde_json::Value;
use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    process::Stdio,
    time::{Duration, Instant},
};

pub(crate) fn execute(
    lease: &ServiceLease,
    index: &Path,
    request: Value,
    mutations: Option<&Path>,
) -> Result<Value, String> {
    use std::os::unix::fs::PermissionsExt;
    static SLOTS: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    let _slot = SLOTS
        .get_or_init(|| tokio::sync::Semaphore::new(4))
        .try_acquire()
        .map_err(|_| "Files search is busy. Try again shortly.")?;
    if lease.cancelled() {
        return Err("Files search access changed.".into());
    }
    std::fs::create_dir_all(index).map_err(|e| e.to_string())?;
    let work = tempfile::Builder::new()
        .prefix("misty-search-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let executable = work.path().join("worker");
    std::fs::write(&executable, &lease.worker).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o500))
        .map_err(|e| e.to_string())?;
    if let Some(path) = mutations {
        std::fs::copy(path, work.path().join("mutations.jsonl")).map_err(|e| e.to_string())?;
    }
    let mut output = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut command =
        crate::platform::mini_app::search_process_command(&executable, work.path(), index)
            .map_err(|e| e.to_string())?;
    command
        .env(
            "MISTY_SEARCH_INDEX",
            index.canonicalize().map_err(|e| e.to_string())?,
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::from(output.try_clone().map_err(|e| e.to_string())?));
    struct Child(std::process::Child, bool);
    impl Drop for Child {
        fn drop(&mut self) {
            if self.1 {
                unsafe {
                    libc::kill(-(self.0.id() as i32), libc::SIGKILL);
                }
                let _ = self.0.wait();
            }
        }
    }
    let mut child = Child(command.spawn().map_err(|e| e.to_string())?, true);
    child
        .0
        .stdin
        .take()
        .ok_or("Missing search input")?
        .write_all(&serde_json::to_vec(&request).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        if lease.cancelled() {
            return Err("Files search access changed.".into());
        }
        if started.elapsed() > Duration::from_secs(300) {
            return Err("Files search timed out. Retry the operation.".into());
        }
        if output.metadata().map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 {
            return Err("Search response exceeds its limit.".into());
        }
        if let Some(status) = child.0.try_wait().map_err(|e| e.to_string())? {
            child.1 = false;
            if !status.success() {
                return Err("Files search worker failed.".into());
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    output.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    output
        .take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("Search response exceeds its limit.".into());
    }
    if lease.cancelled() {
        return Err("Files search access changed.".into());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if value["protocol"].as_u64() != Some(1) {
        return Err("Incompatible search worker.".into());
    }
    if let Some(error) = value["error"].as_str() {
        return Err(error.chars().take(2000).collect());
    }
    value
        .get("data")
        .cloned()
        .ok_or("Missing search result.".into())
}
