//! Grant-owned encrypted backup repositories and jobs.
use super::{
    backup_archive::{Report, Source},
    backup_identity::{self, OsVault, RepositoryIdentity},
    backup_repository::RepositoryServer,
    backup_stream, PermissionSet,
};
use cap_std::fs::Dir;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tokio::sync::OwnedSemaphorePermit;
use zeroize::Zeroizing;

pub struct BackupRepository {
    folder_handle: String,
    directory: Arc<Dir>,
    name: String,
    password: Arc<Zeroizing<String>>,
    server: RepositoryServer,
}
impl BackupRepository {
    pub(super) fn uses_handle(&self, handle: &str) -> bool {
        self.folder_handle == handle
    }
    pub(super) fn name(&self) -> &str {
        &self.name
    }
}

pub struct BackupJob {
    state: Arc<Mutex<Value>>,
    cancel: Arc<AtomicBool>,
    repository: String,
    handles: Vec<String>,
}
impl BackupJob {
    pub(super) fn uses_handle(&self, handle: &str) -> bool {
        self.handles.iter().any(|value| value == handle)
    }
}
impl Drop for BackupJob {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}

fn tool() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("Isolated backups are not implemented on this platform yet.".into());
    }
    if !Path::new("/usr/bin/sandbox-exec").is_file() {
        return Err("The native backup sandbox is unavailable.".into());
    }
    crate::infra::system_dependencies::resolve_executable("restic", None)
        .ok_or("Install Restic on this device to use encrypted backups.".into())
}

pub fn availability() -> Value {
    match tool() {
        Ok(_) => json!({"available":true,"format":"misty-tar-v1"}),
        Err(message) => json!({"available":false,"format":"misty-tar-v1","message":message}),
    }
}

pub async fn open(
    directory: Arc<Dir>,
    owner: String,
    create: bool,
    name: String,
    cancel: Arc<AtomicBool>,
) -> Result<BackupRepository, String> {
    let executable = tool()?;
    if create {
        let identity_dir = directory.clone();
        let pending = tokio::task::spawn_blocking(move || {
            backup_identity::pending(&identity_dir, &owner, &name)
        })
        .await
        .map_err(|_| "Repository setup stopped unexpectedly.")??;
        let password = pending.password.clone();
        let server = RepositoryServer::start(directory.clone()).await?;
        let endpoint = server.endpoint().to_owned();
        let init_tool = executable.clone();
        let init_password = password.clone();
        let init_cancel = cancel.clone();
        tokio::task::spawn_blocking(move || {
            backup_stream::initialize(&init_tool, &endpoint, &init_password, init_cancel)
        })
        .await
        .map_err(|_| "Repository initialization stopped unexpectedly.")??;
        if cancel.load(Ordering::Acquire) {
            return Err("Backup permission was revoked during repository setup.".into());
        }
        let commit_dir = directory.clone();
        let identity = tokio::task::spawn_blocking(move || {
            backup_identity::commit(&commit_dir, pending, &OsVault)
        })
        .await
        .map_err(|_| "Repository identity setup stopped unexpectedly.")??;
        Ok(repository("", directory, identity, server))
    } else {
        let identity_dir = directory.clone();
        let identity = tokio::task::spawn_blocking(move || {
            backup_identity::prepare(&identity_dir, &owner, false, "", &OsVault)
        })
        .await
        .map_err(|_| "Repository opening stopped unexpectedly.")??;
        let server = RepositoryServer::start(directory.clone()).await?;
        // Validate the repository and credential before returning a live handle.
        let endpoint = server.endpoint().to_owned();
        let password = identity.password.clone();
        let validation_cancel = cancel.clone();
        tokio::task::spawn_blocking(move || {
            backup_stream::snapshots(&executable, &endpoint, &password, validation_cancel)
        })
        .await
        .map_err(|_| "Repository validation stopped unexpectedly.")??;
        if cancel.load(Ordering::Acquire) {
            return Err("Backup permission was revoked while opening the repository.".into());
        }
        Ok(repository("", directory, identity, server))
    }
}

fn repository(
    folder_handle: &str,
    directory: Arc<Dir>,
    identity: RepositoryIdentity,
    server: RepositoryServer,
) -> BackupRepository {
    BackupRepository {
        folder_handle: folder_handle.into(),
        directory,
        name: identity.name,
        password: Arc::new(identity.password),
        server,
    }
}

pub fn assign_folder(repository: &mut BackupRepository, handle: String) {
    repository.folder_handle = handle;
}

fn text<'a>(params: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= max)
        .ok_or_else(|| format!("Missing or invalid {key}."))
}

fn worker() -> Result<OwnedSemaphorePermit, String> {
    static WORKERS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    WORKERS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Two backup operations are already running. Try again shortly.".into())
}

fn insert_job(
    permissions: &mut PermissionSet,
    repository: &str,
    handles: Vec<String>,
    initial: &str,
) -> Result<(String, Arc<Mutex<Value>>, Arc<AtomicBool>), String> {
    if permissions.backup_jobs.len() >= 8 {
        return Err("Close an earlier backup operation before starting another.".into());
    }
    if permissions
        .backup_jobs
        .values()
        .any(|job| job.repository == repository)
    {
        return Err("Finish and close the repository's current operation first.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let state = Arc::new(Mutex::new(
        json!({"id":id,"status":"running","message":initial,"result":null}),
    ));
    let cancel = Arc::new(AtomicBool::new(false));
    permissions.backup_jobs.insert(
        id.clone(),
        BackupJob {
            state: state.clone(),
            cancel: cancel.clone(),
            repository: repository.into(),
            handles,
        },
    );
    Ok((id, state, cancel))
}

fn finish(state: &Mutex<Value>, cancel: &AtomicBool, result: Result<Value, String>) {
    if let Ok(mut state) = state.lock() {
        *state = if cancel.load(Ordering::Acquire) {
            json!({"status":"cancelled","message":"Backup operation cancelled.","result":null})
        } else {
            match result {
                Ok(result) => {
                    json!({"status":"completed","message":"Backup operation completed.","result":result})
                }
                Err(message) => json!({"status":"failed","message":message,"result":null}),
            }
        };
    }
}

fn report(report: Report) -> Value {
    json!({"files":report.files,"directories":report.directories,"links":report.links,"bytes":report.bytes})
}

fn snapshots(bytes: &[u8]) -> Result<Value, String> {
    let rows: Value =
        serde_json::from_slice(bytes).map_err(|_| "Restic returned invalid snapshot data.")?;
    let rows = rows
        .as_array()
        .filter(|rows| rows.len() <= 10_000)
        .ok_or("Restic returned too many or invalid snapshots.")?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let id = row.get("id").and_then(Value::as_str).unwrap_or("");
        let time = row.get("time").and_then(Value::as_str).unwrap_or("");
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || time.is_empty()
            || time.len() > 80
        {
            return Err("Restic returned invalid snapshot identity data.".into());
        }
        result.push(json!({"id":id,"time":time}));
    }
    Ok(Value::Array(result))
}

fn unique_destination(parent: &Dir) -> Result<(Arc<Dir>, String), String> {
    for suffix in 1..10_000 {
        let name = if suffix == 1 {
            "Misty Restore".to_owned()
        } else {
            format!("Misty Restore {suffix}")
        };
        match parent.create_dir(&name) {
            Ok(()) => {
                let directory = parent
                    .open_dir(&name)
                    .map_err(|_| "Could not open the new restore folder.")?;
                return Ok((Arc::new(directory), name));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Could not create a new restore folder.".into()),
        }
    }
    Err("Could not choose a unique restore folder name.".into())
}

pub fn execute(
    permissions: &mut PermissionSet,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    let repository_id = params
        .get("repository")
        .and_then(Value::as_str)
        .unwrap_or("");
    match method {
        "backups.repositoryClose" => {
            permissions
                .backup_jobs
                .retain(|_, job| job.repository != repository_id);
            permissions
                .backup_repositories
                .remove(repository_id)
                .ok_or("This repository does not belong to this App instance.")?;
            Ok(Value::Null)
        }
        "backups.jobStatus" | "backups.jobCancel" | "backups.jobClose" => {
            let job_id = text(params, "jobId", 128)?;
            let job = permissions
                .backup_jobs
                .get(job_id)
                .ok_or("This backup operation does not belong to this App instance.")?;
            if method == "backups.jobStatus" {
                return job
                    .state
                    .lock()
                    .map_err(|_| "Backup operation unavailable.".to_owned())
                    .map(|state| state.clone());
            }
            if method == "backups.jobCancel" {
                job.cancel.store(true, Ordering::Release);
                return Ok(Value::Null);
            }
            permissions.backup_jobs.remove(job_id);
            Ok(Value::Null)
        }
        "backups.backupStart" => {
            permissions.authorize("files.read")?;
            let source_ids = params
                .get("sources")
                .and_then(Value::as_array)
                .filter(|values| !values.is_empty() && values.len() <= 64)
                .ok_or("Choose between one and 64 source folders.")?;
            let mut sources = Vec::with_capacity(source_ids.len());
            let mut handles = Vec::with_capacity(source_ids.len() + 1);
            for value in source_ids {
                let handle = value.as_str().ok_or("Invalid source folder handle.")?;
                let folder = permissions
                    .folders
                    .get(handle)
                    .ok_or("A chosen source folder is no longer available.")?;
                sources.push(Source {
                    directory: folder.directory.clone(),
                    name: folder.name.clone(),
                });
                handles.push(handle.into());
            }
            let permit = worker()?;
            let repository = permissions
                .backup_repositories
                .get(repository_id)
                .ok_or("Open a backup repository first.")?;
            handles.push(repository.folder_handle.clone());
            let endpoint = repository.server.endpoint().to_owned();
            let password = repository.password.clone();
            let commit = repository.server.snapshot_commit_permit();
            let executable = tool()?;
            let (id, state, cancel) = insert_job(
                permissions,
                repository_id,
                handles,
                "Creating encrypted backup…",
            )?;
            let flag = cancel.clone();
            tokio::task::spawn_blocking(move || {
                let result = backup_stream::backup(
                    &executable,
                    &endpoint,
                    &password,
                    sources,
                    flag.clone(),
                    commit,
                    Some(Box::new(permit)),
                )
                .map(report);
                finish(&state, &flag, result);
            });
            Ok(json!({"jobId":id}))
        }
        "backups.restoreStart" => {
            permissions.authorize("files.write")?;
            let snapshot = text(params, "snapshot", 128)?.to_owned();
            let destination_id = text(params, "destination", 128)?;
            let parent = permissions
                .folders
                .get(destination_id)
                .filter(|folder| folder.writable)
                .ok_or("Choose a writable restore destination first.")?
                .directory
                .clone();
            let permit = worker()?;
            let repository = permissions
                .backup_repositories
                .get(repository_id)
                .ok_or("Open a backup repository first.")?;
            let repository_folder = repository.folder_handle.clone();
            let endpoint = repository.server.endpoint().to_owned();
            let password = repository.password.clone();
            let executable = tool()?;
            let (destination, folder_name) = unique_destination(&parent)?;
            let (id, state, cancel) = insert_job(
                permissions,
                repository_id,
                vec![repository_folder, destination_id.into()],
                "Restoring into a new folder…",
            )?;
            let flag = cancel.clone();
            tokio::task::spawn_blocking(move || {
                let result = backup_stream::restore(
                    &executable,
                    &endpoint,
                    &password,
                    &snapshot,
                    destination,
                    flag.clone(),
                    Some(Box::new(permit)),
                )
                .map(|value| json!({"folder":folder_name,"report":report(value)}));
                finish(&state, &flag, result);
            });
            Ok(json!({"jobId":id}))
        }
        "backups.snapshotsStart" | "backups.checkStart" => {
            let permit = worker()?;
            let repository = permissions
                .backup_repositories
                .get(repository_id)
                .ok_or("Open a backup repository first.")?;
            let repository_folder = repository.folder_handle.clone();
            let endpoint = repository.server.endpoint().to_owned();
            let password = repository.password.clone();
            let executable = tool()?;
            let initial = if method == "backups.checkStart" {
                "Verifying encrypted backup data…"
            } else {
                "Loading snapshots…"
            };
            let check = method == "backups.checkStart";
            let (id, state, cancel) =
                insert_job(permissions, repository_id, vec![repository_folder], initial)?;
            let flag = cancel.clone();
            tokio::task::spawn_blocking(move || {
                let result = if check {
                    backup_stream::check_repository(&executable, &endpoint, &password, flag.clone())
                        .map(|_| json!({"verified":true}))
                } else {
                    backup_stream::snapshots(&executable, &endpoint, &password, flag.clone())
                        .and_then(|bytes| snapshots(&bytes))
                        .map(|rows| json!({"snapshots":rows}))
                };
                drop(permit);
                finish(&state, &flag, result);
            });
            Ok(json!({"jobId":id}))
        }
        _ => Err("Unsupported backup operation.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_results_expose_only_bounded_identity_fields() {
        let id = "ab".repeat(32);
        let value = serde_json::to_vec(&json!([{
            "id": id,
            "time": "2026-09-04T20:00:00Z",
            "hostname": "private-hostname",
            "paths": ["/private/source"]
        }]))
        .unwrap();
        let result = snapshots(&value).unwrap();
        assert_eq!(
            result,
            json!([{"id":"ab".repeat(32),"time":"2026-09-04T20:00:00Z"}])
        );
        assert!(snapshots(br#"[{"id":"ABC","time":"now"}]"#).is_err());
    }

    #[test]
    fn restore_destination_is_new_and_collision_safe() {
        let fixture = tempfile::tempdir().unwrap();
        std::fs::create_dir(fixture.path().join("Misty Restore")).unwrap();
        std::fs::write(fixture.path().join("Misty Restore/keep"), b"existing").unwrap();
        let parent = Dir::open_ambient_dir(fixture.path(), cap_std::ambient_authority()).unwrap();
        let (_directory, name) = unique_destination(&parent).unwrap();
        assert_eq!(name, "Misty Restore 2");
        assert_eq!(
            std::fs::read(fixture.path().join("Misty Restore/keep")).unwrap(),
            b"existing"
        );
    }

    #[test]
    fn revoking_a_required_file_grant_cancels_and_forgets_backup_jobs() {
        let mut permissions = PermissionSet::from_document(
            "backups",
            &json!({"runtime_capabilities":["files.read","files.write","backups.manage"]}),
            None,
        )
        .unwrap();
        permissions.decide("files.read", true).unwrap();
        permissions.decide("backups.manage", true).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        permissions.backup_jobs.insert(
            "job".into(),
            BackupJob {
                state: Arc::new(Mutex::new(json!({"status":"running"}))),
                cancel: cancelled.clone(),
                repository: "repository".into(),
                handles: vec!["source".into()],
            },
        );
        permissions.decide("files.read", false).unwrap();
        assert!(cancelled.load(Ordering::Acquire));
        assert!(permissions.backup_jobs.is_empty());
    }
}
