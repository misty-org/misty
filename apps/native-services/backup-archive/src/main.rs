mod archive;
use archive as backup_archive;
mod backup_process;
mod backup_repository;
mod backup_stream;
mod runtime;
use std::{os::fd::FromRawFd, sync::Arc};
#[tokio::main]
async fn main() {
    if let Ok(request) = runtime::request() {
        if request["repository"] == true {
            runtime::respond(repository_operation(request).await);
            return;
        }
    }
    runtime::respond((|| {
        let request = runtime::request()?;
        let cancel = runtime::cancellation();
        let mut stream = unsafe { std::fs::File::from_raw_fd(100) };
        let report = match request["operation"].as_str() {
            Some("backup") => {
                let names = request["names"]
                    .as_array()
                    .filter(|n| !n.is_empty() && n.len() <= 64)
                    .ok_or("Invalid backup sources.")?;
                let mut sources = Vec::new();
                for (i, name) in names.iter().enumerate() {
                    sources.push(archive::Source {
                        directory: Arc::new(unsafe { runtime::directory(101 + i as i32) }),
                        name: name.as_str().ok_or("Invalid source name.")?.into(),
                    });
                }
                archive::write_sources(&sources, &mut stream, cancel)
            }
            Some("restore") => {
                archive::restore(stream, &unsafe { runtime::directory(101) }, cancel)
            }
            _ => return Err("Unknown archive operation.".into()),
        }
        .map_err(|e| e.to_string())?;
        serde_json::to_value(report).map_err(|e| e.to_string())
    })());
}

async fn repository_operation(request: serde_json::Value) -> Result<serde_json::Value, String> {
    use std::io::Read;
    let cancel = runtime::cancellation();
    let repository = Arc::new(unsafe { runtime::directory(100) });
    let mut credential = unsafe { std::fs::File::from_raw_fd(101) };
    let mut password = zeroize::Zeroizing::new(String::new());
    credential
        .by_ref()
        .take(4097)
        .read_to_string(&mut password)
        .map_err(|e| e.to_string())?;
    if password.len() > 4096 {
        return Err("Invalid repository credential.".into());
    }
    drop(credential);
    let server = backup_repository::RepositoryServer::start(repository).await?;
    let endpoint = server.endpoint().to_owned();
    let tool = std::path::PathBuf::from(
        request["restic"]
            .as_str()
            .ok_or("Missing backup executable.")?,
    );
    let commit = server.snapshot_commit_permit();
    let result = tokio::task::spawn_blocking(move || match request["operation"].as_str() {
        Some("init") => backup_stream::initialize(&tool, &endpoint, &password, cancel)
            .map(|_| serde_json::Value::Null),
        Some("check") => backup_stream::check_repository(&tool, &endpoint, &password, cancel)
            .map(|_| serde_json::Value::Null),
        Some("snapshots") => backup_stream::snapshots(&tool, &endpoint, &password, cancel)
            .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string())),
        Some("backup") => {
            let names = request["names"]
                .as_array()
                .filter(|n| !n.is_empty() && n.len() <= 64)
                .ok_or("Invalid sources.")?;
            let mut sources = Vec::new();
            for (i, name) in names.iter().enumerate() {
                sources.push(archive::Source {
                    directory: Arc::new(unsafe { runtime::directory(102 + i as i32) }),
                    name: name.as_str().ok_or("Invalid source name.")?.into(),
                });
            }
            backup_stream::backup(&tool, &endpoint, &password, sources, cancel, commit, None)
                .and_then(|report| serde_json::to_value(report).map_err(|e| e.to_string()))
        }
        Some("restore") => {
            let target = Arc::new(unsafe { runtime::directory(102) });
            let snapshot = request["snapshot"].as_str().ok_or("Missing snapshot.")?;
            backup_stream::restore(&tool, &endpoint, &password, snapshot, target, cancel, None)
                .and_then(|report| serde_json::to_value(report).map_err(|e| e.to_string()))
        }
        _ => Err("Unknown backup operation.".into()),
    })
    .await
    .map_err(|_| "Backup worker stopped.")?;
    drop(server);
    result
}
