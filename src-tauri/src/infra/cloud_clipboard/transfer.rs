//! Opening clips from other devices and publishing clips copied here.

use super::*;

pub(super) async fn hydrate(
    inner: &Inner,
    session: &Session,
    summary: &ClipSummary,
    manifest: &Manifest,
) -> Result<ClipboardPayload, String> {
    let mut payload = ClipboardPayload {
        kind: manifest.kind,
        payload_id: summary.clip_id.clone(),
        source_device_id: summary.device_id.clone(),
        source_device_name: manifest.device_name.clone(),
        revision: manifest.revision,
        created_unix_ms: manifest.created_unix_ms,
        text: manifest.text.clone(),
        html: manifest.html.clone(),
        ..ClipboardPayload::default()
    };
    if let Some(image) = &manifest.image {
        let bytes = download(session, &summary.clip_id, &image.blob).await?;
        payload.images.push(ClipboardImage {
            mime_type: image.mime_type.clone(),
            blob_id: image.blob.sha256.clone(),
            checksum: image.blob.sha256.clone(),
            size_bytes: bytes.len() as u64,
            width: image.width,
            height: image.height,
            bytes,
        });
    }
    if !manifest.files.is_empty() {
        let directory = inner.cache_dir().join(&summary.clip_id);
        prune_cache(&inner.cache_dir());
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        for file in &manifest.files {
            let name = safe_file_name(&file.name);
            let bytes = download(session, &summary.clip_id, &file.blob).await?;
            let target = directory.join(&name);
            if file.zipped_folder {
                let folder = directory.join(name.trim_end_matches(".zip"));
                unzip_folder(&bytes, &folder)?;
                payload.file_refs.push(local_ref(&folder, true));
            } else {
                std::fs::write(&target, &bytes).map_err(|error| error.to_string())?;
                payload.file_refs.push(local_ref(&target, false));
            }
        }
    }
    Ok(payload)
}

pub(super) async fn download(
    session: &Session,
    clip_id: &str,
    blob: &BlobRef,
) -> Result<Vec<u8>, String> {
    let ticket = session
        .ticket()
        .await
        .map_err(|_| "The shared clipboard isn't available.".to_owned())?;
    let response = session
        .client
        .get(Session::room_url(
            &ticket,
            &format!("blobs/{}", blob.sha256),
        ))
        .bearer_auth(&ticket.ticket)
        .send()
        .await
        .map_err(|_| "Couldn't download the clip.".to_owned())?;
    if !response.status().is_success() {
        return Err("That clip expired.".into());
    }
    let sealed = response
        .bytes()
        .await
        .map_err(|_| "Couldn't download the clip.".to_owned())?;
    if hex::encode(Sha256::digest(&sealed)) != blob.sha256 {
        return Err("The clip was damaged in transit.".into());
    }
    let plain = session
        .key
        .open(clip_id, blob.part, &sealed)
        .map_err(|_| "This clip can't be opened on this device.".to_owned())?;
    Ok(plain.to_vec())
}

pub(super) async fn publish(
    inner: &Inner,
    session: &Session,
    payload: ClipboardPayload,
) -> Result<(), String> {
    let clip_id = format!("clip_{}", uuid::Uuid::new_v4().simple());
    let mut manifest = Manifest {
        v: 1,
        kind: payload.kind,
        revision: payload.revision,
        created_unix_ms: payload.created_unix_ms,
        device_name: session.device_name.clone(),
        text: truncate_utf8(&payload.text, MAX_TEXT_BYTES),
        html: truncate_utf8(&payload.html, MAX_TEXT_BYTES),
        image: None,
        files: Vec::new(),
    };
    let mut parts: Vec<(BlobRef, Vec<u8>)> = Vec::new();
    let mut part = 1u32;
    let mut total = 0u64;
    let seal =
        |bytes: Vec<u8>, total: &mut u64, part: &mut u32| -> Result<(BlobRef, Vec<u8>), String> {
            let size = bytes.len() as u64;
            let sealed = session
                .key
                .seal(&clip_id, *part, &bytes)
                .map_err(|_| "Couldn't seal the clip.".to_owned())?;
            *total += sealed.len() as u64;
            let blob = BlobRef {
                sha256: hex::encode(Sha256::digest(&sealed)),
                part: *part,
                size,
            };
            *part += 1;
            Ok((blob, sealed))
        };
    match payload.kind {
        ClipboardPayloadKind::Image => {
            let Some(image) = payload
                .images
                .first()
                .filter(|image| !image.bytes.is_empty())
            else {
                return Ok(());
            };
            let (blob, sealed) = seal(image.bytes.clone(), &mut total, &mut part)?;
            manifest.image = Some(ImagePart {
                mime_type: image.mime_type.clone(),
                width: image.width,
                height: image.height,
                blob: blob.clone(),
            });
            parts.push((blob, sealed));
        }
        ClipboardPayloadKind::FileRefs => {
            if let Some(files) = read_files(&payload.file_refs)? {
                for (name, zipped_folder, bytes) in files {
                    let (blob, sealed) = seal(bytes, &mut total, &mut part)?;
                    manifest.files.push(FilePart {
                        name,
                        zipped_folder,
                        blob: blob.clone(),
                    });
                    parts.push((blob, sealed));
                }
            } else {
                // Over the cap: the names travel as text, as the brief says.
                manifest.kind = ClipboardPayloadKind::Text;
                manifest.text = payload
                    .file_refs
                    .iter()
                    .map(|file| file.display_name.clone())
                    .collect::<Vec<_>>()
                    .join("\n");
            }
        }
        ClipboardPayloadKind::Text | ClipboardPayloadKind::Html => {}
        ClipboardPayloadKind::Empty => return Ok(()),
    }
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(|error| error.to_string())?;
    let sealed_manifest = session
        .key
        .seal(&clip_id, 0, &manifest_bytes)
        .map_err(|_| "Couldn't seal the clip.".to_owned())?;
    total += sealed_manifest.len() as u64;
    let ticket = session
        .ticket()
        .await
        .map_err(|_| "The shared clipboard isn't available.".to_owned())?;
    for (blob, sealed) in &parts {
        let response = session
            .client
            .put(Session::room_url(
                &ticket,
                &format!("blobs/{}", blob.sha256),
            ))
            .bearer_auth(&ticket.ticket)
            .header(reqwest::header::CONTENT_LENGTH, sealed.len())
            .body(sealed.clone())
            .send()
            .await
            .map_err(|_| "Couldn't upload the clip.".to_owned())?;
        if !response.status().is_success() {
            return Err(format!(
                "The clipboard refused the upload ({}).",
                response.status()
            ));
        }
    }
    let body = serde_json::json!({
        "clip_id": clip_id,
        "revision": manifest.revision,
        "size": total,
        "blobs": parts.iter().map(|(blob, _)| blob.sha256.clone()).collect::<Vec<_>>(),
        "manifest": STANDARD.encode(&sealed_manifest),
    });
    let response = session
        .client
        .post(Session::room_url(&ticket, "clips"))
        .bearer_auth(&ticket.ticket)
        .json(&body)
        .send()
        .await
        .map_err(|_| "Couldn't share the clip.".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "The clipboard refused the clip ({}).",
            response.status()
        ));
    }
    Ok(())
}
