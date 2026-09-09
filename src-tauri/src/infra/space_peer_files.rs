//! Files protocol handlers use retained grants; neither network input nor app
//! paths can expand local authority. Disk operations run off the async executor.
use super::{
    peer_transport_worker::SendStream,
    space_peer_roots::Roots,
    space_peer_session::{write_frame, AuthorizedPeer},
};
use crate::domain::connected_devices::{
    PeerError, PeerErrorCode, PeerRequest, PeerResponse, PeerResponseEnvelope,
};
use std::{sync::Arc, time::Duration};

pub(crate) async fn serve_one(peer: &AuthorizedPeer, roots: Arc<Roots>) -> Result<(), String> {
    serve_received(peer, roots, peer.accept_request().await?).await
}
pub(crate) async fn serve_received(
    peer: &AuthorizedPeer,
    roots: Arc<Roots>,
    accepted: (
        crate::domain::connected_devices::PeerRequestEnvelope,
        SendStream,
        super::peer_transport_worker::RecvStream,
    ),
) -> Result<(), String> {
    let (request, mut send, _receive) = accepted;
    let id = request.request_id;
    match request.request {
        PeerRequest::ReadFile {
            path,
            offset,
            length,
            expected_snapshot,
        } => {
            let result =
                disk(move || roots.open(&path, offset, length, expected_snapshot.as_deref())).await;
            peer.check()?;
            let mut range = match result {
                Ok(range) => range,
                Err(error) => return reply(&mut send, &id, Err(error), true).await,
            };
            reply(
                &mut send,
                &id,
                Ok(PeerResponse::FileRange {
                    snapshot: range.snapshot.clone(),
                    offset,
                    length: range.length,
                }),
                false,
            )
            .await?;
            loop {
                peer.check()?;
                let (next, bytes) = disk(move || {
                    let mut bytes = vec![0; 64 * 1024];
                    let count = range.read(&mut bytes)?;
                    bytes.truncate(count);
                    Ok((range, bytes))
                })
                .await?;
                range = next;
                peer.check()?;
                if bytes.is_empty() {
                    break;
                }
                send.write_all(&bytes).await?;
            }
            send.finish().await
        }
        PeerRequest::SubscribeDirectory { path } => {
            let directory = roots.clone();
            let requested = path.clone();
            let result = disk(move || directory.directory(&requested, true)).await;
            peer.check()?;
            let (_, mut snapshot) = match result {
                Ok(value) => value,
                Err(error) => return reply(&mut send, &id, Err(error), true).await,
            };
            let subscription_id = uuid::Uuid::new_v4().to_string();
            reply(
                &mut send,
                &id,
                Ok(PeerResponse::Subscribed {
                    subscription_id: subscription_id.clone(),
                }),
                false,
            )
            .await?;
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                peer.check()?;
                let directory = roots.clone();
                let requested = path.clone();
                let (_, current) = disk(move || directory.directory(&requested, true)).await?;
                peer.check()?;
                if current != snapshot {
                    snapshot = current;
                    reply(
                        &mut send,
                        &id,
                        Ok(PeerResponse::DirectoryInvalidated {
                            subscription_id: subscription_id.clone(),
                            path: path.clone(),
                        }),
                        false,
                    )
                    .await?;
                }
            }
        }
        request => {
            let result = disk(move || match request {
                PeerRequest::GetRoots => Ok(PeerResponse::Roots {
                    roots: roots.list(),
                }),
                PeerRequest::ListDirectory { path, show_hidden } => {
                    let (entries, snapshot) = roots.directory(&path, show_hidden)?;
                    Ok(PeerResponse::Directory {
                        path,
                        entries,
                        snapshot,
                    })
                }
                PeerRequest::ReadLink {
                    path,
                    expected_snapshot,
                } => {
                    let (target, snapshot) =
                        roots.read_link(&path, expected_snapshot.as_deref())?;
                    Ok(PeerResponse::Symlink { target, snapshot })
                }
                PeerRequest::Stat { path } => Ok(PeerResponse::Stat {
                    entry: roots.stat(&path)?,
                }),
                PeerRequest::Ping { nonce } => Ok(PeerResponse::Pong { nonce }),
                _ => Err("Unsupported Files request.".into()),
            })
            .await;
            peer.check()?;
            reply(&mut send, &id, result, true).await
        }
    }
}
async fn disk<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|_| "Peer filesystem task stopped.".to_owned())?
}
async fn reply(
    send: &mut SendStream,
    id: &str,
    result: Result<PeerResponse, String>,
    finish: bool,
) -> Result<(), String> {
    let response = result.map_err(|message| PeerError {
        code: if message.contains("source changed") {
            PeerErrorCode::SourceChanged
        } else if message.contains("released") {
            PeerErrorCode::Revoked
        } else {
            PeerErrorCode::ForbiddenPath
        },
        message,
        retry_after_ms: None,
    });
    write_frame(
        send,
        &PeerResponseEnvelope {
            request_id: id.into(),
            response,
        },
        finish,
    )
    .await
}
