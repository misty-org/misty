//! Capability IPC for the packaged Backups runtime.
use super::{
    backup_archive::{Report, Source},
    document_processing::ServiceLease,
};
use cap_std::fs::Dir;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
fn run(
    lease: &ServiceLease,
    tool: &Path,
    repository: &Dir,
    password: &str,
    mut request: Value,
    sources: &[Source],
    destination: Option<&Dir>,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    #[cfg(not(target_os = "macos"))]
    return Err("Backups is unavailable on this device.".into());
    #[cfg(target_os = "macos")]
    {
        use std::{
            io::{Seek, Write},
            os::fd::AsRawFd,
        };
        let mut secret = tempfile::tempfile().map_err(|e| e.to_string())?;
        secret
            .write_all(password.as_bytes())
            .map_err(|e| e.to_string())?;
        secret.rewind().map_err(|e| e.to_string())?;
        let mut descriptors = vec![repository.as_raw_fd(), secret.as_raw_fd()];
        let mut roots = vec![(repository.as_raw_fd(), true)];
        for source in sources {
            descriptors.push(source.directory.as_raw_fd());
            roots.push((source.directory.as_raw_fd(), false));
        }
        if let Some(destination) = destination {
            descriptors.push(destination.as_raw_fd());
            roots.push((destination.as_raw_fd(), true));
        }
        request["repository"] = json!(true);
        request["restic"] = json!(tool.canonicalize().map_err(|e| e.to_string())?);
        super::capability_worker::run(lease, request, &descriptors, &roots, || {
            cancel.load(Ordering::Acquire)
        })
    }
}
pub fn initialize(
    lease: &ServiceLease,
    tool: &Path,
    repository: &Dir,
    password: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    run(
        lease,
        tool,
        repository,
        password,
        json!({"operation":"init"}),
        &[],
        None,
        cancel,
    )
    .map(|_| ())
}
pub fn snapshots(
    lease: &ServiceLease,
    tool: &Path,
    repository: &Dir,
    password: &str,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<u8>, String> {
    let data = run(
        lease,
        tool,
        repository,
        password,
        json!({"operation":"snapshots"}),
        &[],
        None,
        cancel,
    )?;
    serde_json::to_vec(&data).map_err(|e| e.to_string())
}
pub fn check_repository(
    lease: &ServiceLease,
    tool: &Path,
    repository: &Dir,
    password: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    run(
        lease,
        tool,
        repository,
        password,
        json!({"operation":"check"}),
        &[],
        None,
        cancel,
    )
    .map(|_| ())
}
pub fn backup(
    lease: Arc<ServiceLease>,
    tool: &Path,
    repository: &Dir,
    password: &str,
    sources: Vec<Source>,
    cancel: Arc<AtomicBool>,
    _lifetime: Option<Box<dyn Send>>,
) -> Result<Report, String> {
    let data = run(
        &lease,
        tool,
        repository,
        password,
        json!({"operation":"backup","names":sources.iter().map(|s| &s.name).collect::<Vec<_>>()}),
        &sources,
        None,
        cancel,
    )?;
    serde_json::from_value(data).map_err(|e| e.to_string())
}
pub fn restore(
    lease: Arc<ServiceLease>,
    tool: &Path,
    repository: &Dir,
    password: &str,
    snapshot: &str,
    destination: Arc<Dir>,
    cancel: Arc<AtomicBool>,
    _lifetime: Option<Box<dyn Send>>,
) -> Result<Report, String> {
    let data = run(
        &lease,
        tool,
        repository,
        password,
        json!({"operation":"restore","snapshot":snapshot}),
        &[],
        Some(&destination),
        cancel,
    )?;
    serde_json::from_value(data).map_err(|e| e.to_string())
}
