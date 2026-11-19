//! Sends the files the server lacks straight to their presigned addresses, each streamed from
//! disk, a few at a time.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{stream, TryStreamExt};
use reqwest::header::CONTENT_LENGTH;
use serde::Deserialize;

use super::paths;
use super::progress::Progress;

const AT_ONCE: usize = 4;
const CHUNK: usize = 256 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// One file to send: its path in the folder, where to and how.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderUpload {
    pub path: String,
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

/// A client for big transfers, through the proxy from Settings: a cap on connecting, none on the
/// whole request.
pub(crate) fn transfer_client() -> Result<reqwest::Client, String> {
    // Misty's builds carry rustls without a default provider; the app installs ring at launch.
    let _ = rustls::crypto::ring::default_provider().install_default();
    crate::engine_config::proxy::apply_to_client(
        reqwest::Client::builder()
            .user_agent(concat!("Misty/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT),
    )
    .build()
    .map_err(|error| error.to_string())
}

/// Headers Misty sets itself, or that a request can't carry.
pub(crate) fn skipped_header(name: &str) -> bool {
    ["host", "content-length", "connection", "transfer-encoding"]
        .iter()
        .any(|skip| name.eq_ignore_ascii_case(skip))
}

struct Job {
    upload: FolderUpload,
    absolute: PathBuf,
    size: u64,
}

/// What `uploads` will send from `root`, checked before anything goes: each path inside the
/// folder, and each a plain file.
fn jobs(root: &Path, uploads: Vec<FolderUpload>) -> Result<Vec<Job>, String> {
    uploads
        .into_iter()
        .map(|upload| {
            let absolute = paths::inside(root, &upload.path)?;
            let meta = file_access::fs::symlink_metadata(&absolute)
                .map_err(|_| format!("{} is gone from the folder.", upload.path))?;
            if !meta.is_file() {
                return Err(format!("{} isn't a file.", upload.path));
            }
            paths::http_url(&upload.url)?;
            Ok(Job {
                size: meta.len(),
                upload,
                absolute,
            })
        })
        .collect()
}

pub(crate) async fn put_all(
    root: &Path,
    uploads: Vec<FolderUpload>,
    progress: impl FnOnce(usize, u64) -> Progress,
) -> Result<(), String> {
    let jobs = jobs(root, uploads)?;
    let progress = Arc::new(progress(
        jobs.len(),
        jobs.iter().map(|job| job.size).sum(),
    ));
    progress.send(true);
    let client = transfer_client()?;
    stream::iter(jobs.into_iter().map(Ok::<_, String>))
        .try_for_each_concurrent(AT_ONCE, |job| {
            let client = client.clone();
            let progress = progress.clone();
            async move { put_one(&client, job, &progress).await }
        })
        .await?;
    progress.send(true);
    Ok(())
}

async fn put_one(client: &reqwest::Client, job: Job, progress: &Arc<Progress>) -> Result<(), String> {
    let Job {
        upload,
        absolute,
        size,
    } = job;
    let url = paths::http_url(&upload.url)?;
    let method = upload.method.as_deref().unwrap_or("PUT").to_ascii_uppercase();
    let method = match method.as_str() {
        "PUT" => reqwest::Method::PUT,
        "POST" => reqwest::Method::POST,
        _ => return Err("The server asked for an upload Misty can't make.".into()),
    };
    // The file is read on a blocking thread and handed over a few chunks at a time.
    let (sender, receiver) = tokio::sync::mpsc::channel::<Result<Vec<u8>, std::io::Error>>(4);
    let reader_progress = progress.clone();
    tokio::task::spawn_blocking(move || {
        let mut file = match file_access::fs::File::open(&absolute) {
            Ok(file) => file,
            Err(error) => {
                let _ = sender.blocking_send(Err(error));
                return;
            }
        };
        let mut buffer = vec![0u8; CHUNK];
        loop {
            match file.read(&mut buffer) {
                Ok(0) => return,
                Ok(count) => {
                    if sender.blocking_send(Ok(buffer[..count].to_vec())).is_err() {
                        return;
                    }
                    reader_progress.bytes(count as u64);
                }
                Err(error) => {
                    let _ = sender.blocking_send(Err(error));
                    return;
                }
            }
        }
    });
    let body = stream::unfold(receiver, |mut receiver| async move {
        receiver.recv().await.map(|chunk| (chunk, receiver))
    });
    // Object storage wants the length up front rather than a chunked body.
    let mut request = client
        .request(method, url)
        .header(CONTENT_LENGTH, size.to_string())
        .body(reqwest::Body::wrap_stream(body));
    for (name, value) in &upload.headers {
        if !skipped_header(name) {
            request = request.header(name.as_str(), value.as_str());
        }
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Couldn't upload {}: {error}", upload.path))?;
    if !response.status().is_success() {
        return Err(format!(
            "Couldn't upload {} ({}).",
            upload.path,
            response.status().as_u16()
        ));
    }
    progress.file_done();
    Ok(())
}
