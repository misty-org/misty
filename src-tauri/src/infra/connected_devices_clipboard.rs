//! The shared clipboard between paired devices: publishing this device's
//! clipboard and converting offers to and from clipboard payloads.

use super::*;

impl SharedClipboardClient for ConnectedDevicesService {
    fn publish(&self, payload: &ClipboardPayload) -> bool {
        let Ok(local_device_id) = self.network_device_id() else {
            return false;
        };
        let (source_endpoint_id, roots, peers) = {
            let Ok(guard) = self.state.read() else {
                return false;
            };
            let Some(state) = guard.as_ref() else {
                return false;
            };
            let Ok(connections) = state.connections.read() else {
                return false;
            };
            // Each device decides on its own whether it shares its clipboard.
            let peers = connections
                .iter()
                .filter(|(device_id, peer)| {
                    peer.claims.exp > unix_now()
                        && !connection_closed(&peer.connection)
                        && self.local.consent(device_id).shares_clipboard
                })
                .map(|(_, peer)| peer.connection.clone())
                .collect::<Vec<_>>();
            (state.endpoint.id().to_string(), state.roots.clone(), peers)
        };
        if peers.is_empty() {
            return false;
        }
        let Some(mut kind) = clipboard_payload_to_offer_kind(payload, &local_device_id, &roots)
        else {
            return false;
        };
        if let ClipboardOfferKind::Image { blob_id, png_bytes } = &mut kind {
            if blob_id.is_empty() {
                *blob_id = format!("clipboard_{}", hex::encode(Sha256::digest(&png_bytes)));
            }
            if let Ok(mut blobs) = self.clipboard_blobs.lock() {
                blobs.retain(|_, blob| blob.expires_at > unix_now());
                blobs.insert(
                    blob_id.clone(),
                    ClipboardBlobRecord {
                        bytes: Arc::new(png_bytes.clone()),
                        expires_at: unix_now() + 600,
                    },
                );
            }
        }
        let offer = ClipboardOffer {
            source_endpoint_id,
            revision: payload.revision,
            kind,
        };
        if validate_clipboard_offer(&offer).is_err() {
            return false;
        }
        for connection in peers {
            let offer = offer.clone();
            tauri::async_runtime::spawn(async move {
                let _ =
                    exchange_control(&connection, PeerRequest::ClipboardOffer { payload: offer })
                        .await;
            });
        }
        true
    }

    fn hydrate_payload(&self, _payload: &mut ClipboardPayload) -> bool {
        // Remote file references intentionally stay lazy. Native applications get
        // their readable fallback until Misty explicitly materializes the files.
        true
    }
}

pub(super) fn clipboard_payload_to_offer_kind(
    payload: &ClipboardPayload,
    local_device_id: &str,
    roots: &PeerRootRegistry,
) -> Option<ClipboardOfferKind> {
    match payload.kind {
        ClipboardPayloadKind::Text => Some(ClipboardOfferKind::Text {
            text: payload.text.clone(),
            html: None,
        }),
        ClipboardPayloadKind::Html => Some(ClipboardOfferKind::Text {
            text: payload.text.clone(),
            html: (!payload.html.is_empty()).then(|| payload.html.clone()),
        }),
        ClipboardPayloadKind::Image => {
            payload
                .images
                .first()
                .map(|image| ClipboardOfferKind::Image {
                    blob_id: image.blob_id.clone(),
                    png_bytes: image.bytes.clone(),
                })
        }
        ClipboardPayloadKind::FileRefs => {
            let files = payload
                .file_refs
                .iter()
                .filter_map(|item| {
                    if item.local_path.is_empty() || !item.provider_type.is_empty() {
                        return None;
                    }
                    let (root_id, relative_path) =
                        roots.reference_for_local_path(Path::new(&item.local_path))?;
                    if relative_path.as_os_str().is_empty() {
                        return None;
                    }
                    let virtual_path = crate::infra::peer_files::PeerVirtualPath::format(
                        local_device_id,
                        &root_id,
                        &relative_path,
                    )
                    .ok()?;
                    let snapshot = roots
                        .stat(local_device_id, &root_id, &relative_path)
                        .ok()?
                        .snapshot;
                    let parsed =
                        crate::infra::peer_files::PeerVirtualPath::parse(&virtual_path).ok()?;
                    Some(PeerFileReference {
                        device_id: local_device_id.to_owned(),
                        root_id,
                        relative_path: parsed.relative_path.to_string_lossy().replace('\\', "/"),
                        is_directory: item.is_dir,
                        snapshot,
                    })
                })
                .take(100)
                .collect::<Vec<_>>();
            if files.is_empty() {
                return None;
            }
            let fallback_text = if payload.text.is_empty() {
                payload
                    .file_refs
                    .iter()
                    .map(|item| item.display_name.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                payload.text.clone()
            };
            Some(ClipboardOfferKind::FileReferences {
                files,
                fallback_text,
            })
        }
        ClipboardPayloadKind::Empty => None,
    }
}

pub(super) fn clipboard_offer_to_payload(
    source_device_id: &str,
    offer: ClipboardOffer,
) -> ClipboardPayload {
    let mut payload = ClipboardPayload {
        source_device_id: offer.source_endpoint_id,
        source_device_name: source_device_id.to_owned(),
        revision: offer.revision,
        ..ClipboardPayload::default()
    };
    match offer.kind {
        ClipboardOfferKind::Text { text, html } => {
            payload.text = text;
            payload.html = html.unwrap_or_default();
            payload.kind = if payload.html.is_empty() {
                ClipboardPayloadKind::Text
            } else {
                ClipboardPayloadKind::Html
            };
        }
        ClipboardOfferKind::Image { blob_id, png_bytes } => {
            let checksum = hex::encode(Sha256::digest(&png_bytes));
            payload.kind = ClipboardPayloadKind::Image;
            payload.images.push(ClipboardImage {
                mime_type: "image/png".to_owned(),
                blob_id,
                checksum,
                size_bytes: png_bytes.len() as u64,
                bytes: png_bytes,
                ..ClipboardImage::default()
            });
        }
        ClipboardOfferKind::FileReferences {
            files,
            fallback_text,
        } => {
            payload.kind = ClipboardPayloadKind::FileRefs;
            payload.text = fallback_text;
            payload.file_refs = files
                .into_iter()
                .filter_map(|file| {
                    let relative = PathBuf::from(&file.relative_path);
                    let remote_path = crate::infra::peer_files::PeerVirtualPath::format(
                        &file.device_id,
                        &file.root_id,
                        &relative,
                    )
                    .ok()?;
                    Some(ClipboardFileRef {
                        display_name: relative
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "Remote file".to_owned()),
                        provider_type: "misty_peer".to_owned(),
                        remote_name: source_device_id.to_owned(),
                        remote_path,
                        is_dir: file.is_directory,
                        ..ClipboardFileRef::default()
                    })
                })
                .collect();
        }
    }
    payload
}
