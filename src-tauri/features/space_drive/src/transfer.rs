//! Moving content: uploads streamed from disk to the server's presigned addresses (one `PUT` up
//! to 100 MiB, S3 multipart above, resumable after a restart) and downloads checked against
//! their SHA-256 in a temporary file, then moved into place whole.
//!
//! The streamed file body and the header filter moved here from `spaces_folders/upload.rs`, and
//! the verified download from `spaces_folders/download.rs`; shared folders use them from here.
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use bytes::Bytes;
use futures_util::{stream, StreamExt};
use sha2::{Digest as _, Sha256};

use crate::api::{Api, ApiError, ByteStream, DonePart, Multipart, PartUrl};
use crate::model::{now_ms, ItemId, SpaceId};
use crate::store::{Store, TransferRow};
use crate::DriveError;

/// One request carries a file up to this size; above it, multipart.
pub const SINGLE_LIMIT: u64 = 100 * 1024 * 1024;
const CHUNK: usize = 256 * 1024;
/// The SHA-256 of nothing: an empty file has no blob to fetch.
pub const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// Headers Misty sets itself, or that a request can't carry.
pub fn skipped_header(name: &str) -> bool {
    ["host", "content-length", "connection", "transfer-encoding"]
        .iter()
        .any(|skip| name.eq_ignore_ascii_case(skip))
}

/// `length` bytes of the file at `path` from `offset`, read on a blocking thread and handed over a
/// few chunks at a time; `read` hears each chunk's length as it is read.
pub fn file_chunks(
    path: PathBuf,
    offset: u64,
    length: u64,
    read: impl Fn(u64) + Send + 'static,
) -> ByteStream {
    let (sender, receiver) = tokio::sync::mpsc::channel::<std::io::Result<Bytes>>(4);
    tokio::task::spawn_blocking(move || {
        let mut file = match file_access::fs::File::open(&path) {
            Ok(file) => file,
            Err(error) => {
                let _ = sender.blocking_send(Err(error));
                return;
            }
        };
        if offset > 0 {
            if let Err(error) = file.seek(SeekFrom::Start(offset)) {
                let _ = sender.blocking_send(Err(error));
                return;
            }
        }
        let mut left = length;
        let mut buffer = vec![0u8; CHUNK];
        while left > 0 {
            let want = (left as usize).min(CHUNK);
            match file.read(&mut buffer[..want]) {
                Ok(0) => {
                    let _ = sender.blocking_send(Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "The file got shorter while it was sent.",
                    )));
                    return;
                }
                Ok(count) => {
                    left -= count as u64;
                    if sender
                        .blocking_send(Ok(Bytes::copy_from_slice(&buffer[..count])))
                        .is_err()
                    {
                        return;
                    }
                    read(count as u64);
                }
                Err(error) => {
                    let _ = sender.blocking_send(Err(error));
                    return;
                }
            }
        }
    });
    Box::pin(stream::unfold(receiver, |mut receiver| async move {
        receiver.recv().await.map(|chunk| (chunk, receiver))
    }))
}

/// Writes `body` to `temp`, checking it is `size` bytes hashing to `sha256`, then moves it to
/// `target`. Nothing half-written ever reaches `target`. `read` hears each chunk's length.
pub async fn write_verified(
    mut body: ByteStream,
    temp: &Path,
    target: &Path,
    size: u64,
    sha256: &str,
    read: impl Fn(u64),
) -> Result<(), DriveError> {
    let written = async {
        if let Some(parent) = temp.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        let mut out = file_access::fs::File::create(temp).map_err(DriveError::io)?;
        let mut hasher = Sha256::new();
        let mut received = 0u64;
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(|_| DriveError::Offline)?;
            received += chunk.len() as u64;
            if received > size {
                return Err(DriveError::Corrupt);
            }
            hasher.update(&chunk);
            out.write_all(&chunk).map_err(DriveError::io)?;
            read(chunk.len() as u64);
        }
        out.flush().map_err(DriveError::io)?;
        out.sync_all().map_err(DriveError::io)?;
        if received != size || hex::encode(hasher.finalize()) != sha256 {
            return Err(DriveError::Corrupt);
        }
        Ok(())
    }
    .await;
    if let Err(error) = written {
        let _ = file_access::fs::remove_file(temp);
        return Err(error);
    }
    if let Some(parent) = target.parent() {
        file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
    }
    file_access::fs::rename(temp, target).map_err(DriveError::io)
}

/// Downloads an item's content to `target` through `temp`. An empty file needs no fetch.
pub async fn download(
    api: &Api,
    space: &SpaceId,
    id: &ItemId,
    sha256: &str,
    size: u64,
    temp: &Path,
    target: &Path,
) -> Result<(), DriveError> {
    if size == 0 || sha256 == EMPTY_SHA256 {
        if let Some(parent) = target.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        file_access::fs::File::create(temp).map_err(DriveError::io)?;
        return file_access::fs::rename(temp, target).map_err(DriveError::io);
    }
    let link = api.content_url(space, id).await.map_err(DriveError::from)?;
    if link.url.is_empty() {
        // The server's word for an empty file; anything else is out of step.
        return Err(DriveError::Corrupt);
    }
    let (status, body) = api
        .http()
        .get_blob(link.url)
        .await
        .map_err(|_| DriveError::Offline)?;
    if !(200..300).contains(&status) {
        return Err(DriveError::Api(ApiError::Server {
            status,
            message: "The download was refused.".to_owned(),
        }));
    }
    write_verified(body, temp, target, size, sha256, |_| ()).await
}

/// Sends the content at `path` (`sha256`, `size`) for item `id`, and answers the upload id to
/// name in the create or change. Asking the server again for the same content renews the same
/// upload with fresh addresses, so a multipart upload carries on after a restart with only the
/// parts `drive.db` hasn't recorded as sent. Whatever the server already has isn't sent again.
pub async fn upload(
    api: &Api,
    store: &Store,
    space: &SpaceId,
    id: &ItemId,
    path: &Path,
    sha256: &str,
    size: u64,
) -> Result<String, DriveError> {
    let earlier = store
        .transfer(space, id)?
        .filter(|row| row.sha256 == sha256 && row.size == size);
    if earlier.is_none() {
        store.delete_transfer(space, id)?;
    }
    let start = api
        .start_upload(space, sha256, size)
        .await
        .map_err(DriveError::from)?;
    if start.present {
        store.delete_transfer(space, id)?;
        return Ok(start.upload_id);
    }
    if let Some(single) = start.single {
        let response = api
            .http()
            .put_blob(
                single.url,
                single.method.unwrap_or_else(|| "PUT".to_owned()),
                single
                    .headers
                    .into_iter()
                    .filter(|(name, _)| !skipped_header(name))
                    .collect(),
                size,
                file_chunks(path.to_path_buf(), 0, size, |_| ()),
            )
            .await
            .map_err(|_| DriveError::Offline)?;
        if !(200..300).contains(&response.status) {
            return Err(DriveError::Api(ApiError::Server {
                status: response.status,
                message: "The upload was refused.".to_owned(),
            }));
        }
        // A single upload is checked by the server's HEAD when it is completed.
        api.complete_upload(space, &start.upload_id, &[])
            .await
            .map_err(DriveError::from)?;
        return Ok(start.upload_id);
    }
    let Some(Multipart { part_size, parts }) = start.multipart else {
        return Err(DriveError::Api(ApiError::Server {
            status: 200,
            message: "The server didn't say where to upload.".to_owned(),
        }));
    };
    // The parts already sent count only for the same upload at the same part size.
    let done = earlier
        .filter(|row| row.upload_id == start.upload_id && row.part_size == part_size)
        .map(|row| row.done)
        .unwrap_or_else(|| "[]".to_owned());
    let row = TransferRow {
        space: space.clone(),
        id: id.clone(),
        sha256: sha256.to_owned(),
        size,
        upload_id: start.upload_id,
        mode: "multipart".to_owned(),
        part_size,
        parts: serde_json::to_string(&parts).unwrap_or_else(|_| "[]".to_owned()),
        done,
        started_ms: now_ms(),
        attempts: 0,
        last_error: None,
    };
    store.put_transfer(&row)?;
    resume_multipart(api, store, &row, path).await
}

async fn resume_multipart(
    api: &Api,
    store: &Store,
    row: &TransferRow,
    path: &Path,
) -> Result<String, DriveError> {
    let parts: Vec<PartUrl> = serde_json::from_str(&row.parts).unwrap_or_default();
    let mut done: Vec<DonePart> = serde_json::from_str(&row.done).unwrap_or_default();
    if row.part_size == 0 || parts.is_empty() {
        return Err(DriveError::Corrupt);
    }
    let mut row = row.clone();
    for part in &parts {
        if done.iter().any(|sent| sent.number == part.number) {
            continue;
        }
        let offset = (u64::from(part.number).saturating_sub(1)) * row.part_size;
        if offset >= row.size {
            continue;
        }
        let length = row.part_size.min(row.size - offset);
        let response = api
            .http()
            .put_blob(
                part.url.clone(),
                "PUT".to_owned(),
                Vec::new(),
                length,
                file_chunks(path.to_path_buf(), offset, length, |_| ()),
            )
            .await
            .map_err(|_| DriveError::Offline)?;
        if !(200..300).contains(&response.status) {
            row.attempts += 1;
            row.last_error = Some(format!("part {} answered {}", part.number, response.status));
            store.put_transfer(&row)?;
            return Err(DriveError::Api(ApiError::Server {
                status: response.status,
                message: "A part of the upload was refused.".to_owned(),
            }));
        }
        let etag = response
            .header("etag")
            .unwrap_or_default()
            .trim()
            .to_owned();
        done.push(DonePart {
            number: part.number,
            etag,
        });
        row.done = serde_json::to_string(&done).unwrap_or_else(|_| "[]".to_owned());
        store.put_transfer(&row)?;
    }
    done.sort_by_key(|part| part.number);
    api.complete_upload(&row.space, &row.upload_id, &done)
        .await
        .map_err(DriveError::from)?;
    store.delete_transfer(&row.space, &row.id)?;
    Ok(row.upload_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_empty_hash_is_sha256_of_nothing() {
        assert_eq!(hex::encode(Sha256::digest(b"")), EMPTY_SHA256);
        assert!(skipped_header("Content-Length"));
        assert!(!skipped_header("x-amz-meta"));
    }
}
