//! Compiled Host entry points for a mounted Files instance. Package RPCs cannot
//! supply owners, peers, device identities, or arbitrary local folder paths.
use super::{MiniAppState, PermissionSet};
use crate::domain::connected_devices::{
    PeerRequest, PeerResponse, PeerResponseEnvelope, MAX_CONTROL_FRAME_BYTES,
};
use crate::infra::{
    document_intelligence::ServiceLease,
    peer_transport_worker::Relay,
    space_peer_files::serve_received,
    space_peer_roots::{GrantedRoot, Roots},
    space_peer_session::{read_frame, AuthorizedPeer, Session},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
    time::Duration,
};
use tauri::{State, Webview};

pub struct Runtime {
    lease: Arc<ServiceLease>,
    session: Arc<Session>,
    peers: Arc<RwLock<HashMap<String, String>>>,
    listener: tokio::task::JoinHandle<()>,
    outgoing: RwLock<HashMap<String, (String, Arc<AuthorizedPeer>)>>,
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.session.close();
        self.listener.abort();
    }
}
#[tauri::command]
pub async fn space_peer_local_identity(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    device_id: String,
) -> Result<String, String> {
    super::super::require_host(&webview)?;
    let (owner, epoch) = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &registry.get(&instance).ok_or("App is closed.")?.permissions;
        p.authorize("files.read")?;
        p.authorize("connections.read")?;
        if p.app_id != "files" || !p.space_owned {
            return Err("Peer identity requires a Space Files instance.".into());
        }
        (
            p.native_owner.clone().ok_or("Missing native owner.")?,
            p.epoch,
        )
    };
    let account = owner.account_id.clone();
    let endpoint = tokio::task::spawn_blocking(move || {
        let secret = crate::infra::peer_identity::load_or_create(&account, &device_id)
            .map_err(|error| error.to_string())?;
        Ok::<_, String>(hex::encode(
            ed25519_dalek::SigningKey::from_bytes(&secret)
                .verifying_key()
                .to_bytes(),
        ))
    })
    .await
    .map_err(|_| "Peer identity task stopped.")??;
    let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let p = &registry.get(&instance).ok_or("App is closed.")?.permissions;
    p.authorize("files.read")?;
    p.authorize("connections.read")?;
    if p.epoch != epoch || p.native_owner.as_ref() != Some(&owner) {
        return Err("Peer identity authority changed.".into());
    }
    Ok(endpoint)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    local_device_id: String,
    server_device_id: String,
    folders: Vec<String>,
    #[serde(default)]
    development_ticket_keys: HashMap<String, String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Peer {
    endpoint_id: String,
    device_id: String,
}
fn owned(state: &MiniAppState, instance: &str) -> Result<Arc<Runtime>, String> {
    state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .get(instance)
        .ok_or("App is closed.")?
        .permissions
        .peer_runtime
        .clone()
        .ok_or("Space peers have not started.".into())
}
fn granted(
    registry: &HashMap<String, super::super::Instance>,
    p: &PermissionSet,
    requested: &[String],
) -> Result<Vec<GrantedRoot>, String> {
    if requested.len() > 64 || requested.iter().collect::<HashSet<_>>().len() != requested.len() {
        return Err("Invalid shared folder selection.".into());
    }
    p.authorize("files.read")?;
    p.authorize("connections.read")?;
    requested
        .iter()
        .map(|id| {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct SharedFolder {
                instance: String,
                handle: String,
            }
            let shared = id
                .strip_prefix('@')
                .map(|value| {
                    serde_json::from_str::<SharedFolder>(value)
                        .map_err(|_| "Invalid shared folder reference.")
                })
                .transpose()?;
            let (source, handle) = if let Some(shared) = &shared {
                let source = &registry
                    .get(&shared.instance)
                    .ok_or("The sharing view closed.")?
                    .permissions;
                if p.native_owner.is_none()
                    || source.native_owner != p.native_owner
                    || source.app_id != p.app_id
                    || source.version != p.version
                {
                    return Err(
                        "Shared folders must belong to the same Space app and member.".into(),
                    );
                }
                source.authorize("files.read")?;
                source.authorize("connections.read")?;
                (source, shared.handle.as_str())
            } else {
                (p, id.as_str())
            };
            let folder = source
                .folders
                .get(handle)
                .ok_or("Shared folder is not granted to this Files instance.")?;
            if folder.released.load(std::sync::atomic::Ordering::Acquire) {
                return Err("Shared folder was released.".into());
            }
            Ok(GrantedRoot {
                id: id.clone(),
                name: folder.name.clone(),
                directory: folder.directory.clone(),
                released: folder.released.clone(),
            })
        })
        .collect()
}
fn relay() -> Result<Relay, String> {
    let url = option_env!("MISTY_DEVICE_RELAY_URL").unwrap_or("").trim();
    if !url.is_empty() {
        return Ok(Relay::Managed { url: url.into() });
    }
    if cfg!(debug_assertions) {
        Ok(Relay::Default)
    } else {
        Err("A managed peer relay is required in production.".into())
    }
}
#[tauri::command]
pub async fn space_peer_start(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    request: Start,
) -> Result<Value, String> {
    super::super::require_host(&webview)?;
    start(&state, &instance, request).await
}
async fn start(state: &MiniAppState, instance: &str, request: Start) -> Result<Value, String> {
    let expired = {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &mut registry
            .get_mut(instance)
            .ok_or("App is closed.")?
            .permissions;
        if p.peer_runtime
            .as_ref()
            .is_some_and(|runtime| runtime.lease.cancelled() || runtime.session.is_closed())
        {
            p.peer_runtime.take()
        } else {
            None
        }
    };
    drop(expired);
    let lease = Arc::new(
        ServiceLease::acquire_service(state, instance, "files", "peer-transport", 2).await?,
    );
    let identity = lease.peer_identity(&request.local_device_id)?;
    let namespace = serde_json::to_string(&(
        identity.deployment,
        identity.account_id,
        identity.space_id,
        identity.installed_version,
        identity.authority_generation,
    ))
    .map_err(|_| "Invalid peer authority.")?;
    let roots = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &registry.get(instance).ok_or("App is closed.")?.permissions;
        if p.peer_runtime.is_some() {
            return Err("Stop this Space peer session before changing its shared folders.".into());
        }
        Arc::new(Roots::from_grants(
            &namespace,
            &request.server_device_id,
            granted(&registry, p, &request.folders)?,
        )?)
    };
    let keys =
        crate::infra::connected_devices::pinned_ticket_keys(&request.development_ticket_keys)
            .map_err(|error| error.to_string())?;
    let session = Arc::new(
        Session::start(
            lease.clone(),
            request.local_device_id,
            request.server_device_id,
            keys,
            relay()?,
        )
        .await?,
    );
    lease.validate(state, instance)?;
    let peers = Arc::new(RwLock::new(HashMap::new()));
    let listening = session.clone();
    let known = peers.clone();
    let authority = lease.clone();
    let listener = tokio::spawn(async move {
        let mut jobs = tokio::task::JoinSet::new();
        let mut incoming = Box::pin(listening.accept_current(&known));
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        loop {
            tokio::select! {
                _=tick.tick()=>if authority.cancelled() || listening.is_closed(){break;},
                _=jobs.join_next(),if !jobs.is_empty()=>{},
                result=&mut incoming,if jobs.len()<24=>{
                    incoming=Box::pin(listening.accept_current(&known));
                    let Ok(peer)=result else {if authority.cancelled() || listening.is_closed(){break;}continue;};
                    let roots=roots.clone();let current_peers=known.clone();
                    jobs.spawn(async move {
                        let peer=Arc::new(peer);let mut requests=tokio::task::JoinSet::new();
                        let mut incoming=Box::pin(peer.accept_request());
                        let mut tick=tokio::time::interval(Duration::from_millis(100));
                        loop {
                            tokio::select! {
                                _=tick.tick()=>if peer.check().is_err() || !current_peers.read().is_ok_and(|known| known.get(peer.incoming_identity().0).is_some_and(|device|device==peer.incoming_identity().1)){break;},
                                _=requests.join_next(),if !requests.is_empty()=>{},
                                result=&mut incoming,if requests.len()<16=>{
                                    let Ok(request)=result else {break;};
                                    incoming=Box::pin(peer.accept_request());
                                    let peer=peer.clone();let roots=roots.clone();
                                    requests.spawn(async move {let _=serve_received(&peer,roots,request).await;});
                                }
                            }
                        }
                    });
                }
            }
        }
        listening.close();
    });
    let runtime = Arc::new(Runtime {
        lease,
        session,
        peers,
        listener,
        outgoing: RwLock::new(HashMap::new()),
    });
    let snapshot = runtime.session.snapshot().await?;
    runtime.lease.validate(state, instance)?;
    {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &mut registry
            .get_mut(instance)
            .ok_or("App is closed.")?
            .permissions;
        if p.peer_runtime.is_some() {
            return Err("Space peer startup is already complete.".into());
        }
        p.peer_runtime = Some(runtime.clone());
    }
    if let Err(error) = runtime.lease.validate(state, instance) {
        runtime.session.close();
        return Err(error);
    }
    Ok(
        json!({"endpointId":snapshot.endpoint_id,"addressing":snapshot.address,"protocolVersion":"misty-device/2"}),
    )
}
#[tauri::command]
pub async fn space_peer_snapshot(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
) -> Result<Value, String> {
    super::super::require_host(&webview)?;
    let runtime = owned(&state, &instance)?;
    runtime.lease.validate(&state, &instance)?;
    let snapshot = runtime.session.snapshot().await?;
    runtime.lease.validate(&state, &instance)?;
    Ok(
        json!({"endpointId":snapshot.endpoint_id,"addressing":snapshot.address,"protocolVersion":"misty-device/2"}),
    )
}
#[tauri::command]
pub fn space_peer_set_peers(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    peers: Vec<Peer>,
) -> Result<(), String> {
    super::super::require_host(&webview)?;
    let runtime = owned(&state, &instance)?;
    runtime.lease.validate(&state, &instance)?;
    if peers.len() > 128 {
        return Err("Too many Space peers.".into());
    }
    let mut selected = HashMap::new();
    for peer in peers {
        if peer.endpoint_id.len() != 64
            || !peer.endpoint_id.bytes().all(|b| b.is_ascii_hexdigit())
            || peer.device_id.is_empty()
            || peer.device_id.len() > 128
            || selected.insert(peer.endpoint_id, peer.device_id).is_some()
        {
            return Err("Invalid Space peer identity.".into());
        }
    }
    // Publish the list and close removed connections under the same lock order
    // used by dialing. A late dial cannot restore a removed endpoint.
    let mut peers = runtime
        .peers
        .write()
        .map_err(|_| "Peer list unavailable.")?;
    let mut outgoing = runtime
        .outgoing
        .write()
        .map_err(|_| "Peer connections unavailable.")?;
    outgoing.retain(|device, (endpoint, peer)| {
        let keep = selected.get(endpoint) == Some(device);
        if !keep {
            peer.close();
        }
        keep
    });
    *peers = selected;
    Ok(())
}
#[tauri::command]
pub fn space_peer_stop(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
) -> Result<(), String> {
    super::super::require_host(&webview)?;
    let runtime = state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .get_mut(&instance)
        .ok_or("App is closed.")?
        .permissions
        .peer_runtime
        .take();
    if let Some(runtime) = runtime {
        runtime.session.close();
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connect {
    device_id: String,
    endpoint_id: String,
    address: Value,
    ticket: String,
}
#[tauri::command]
pub async fn space_peer_connect(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    request: Connect,
) -> Result<Value, String> {
    super::super::require_host(&webview)?;
    let runtime = owned(&state, &instance)?;
    runtime.lease.validate(&state, &instance)?;
    {
        let known = runtime.peers.read().map_err(|_| "Peer list unavailable.")?;
        if known.get(&request.endpoint_id) != Some(&request.device_id) {
            return Err("Peer is not selected in this Space.".into());
        }
    }
    let peer = Arc::new(
        runtime
            .session
            .connect(
                &request.device_id,
                &request.endpoint_id,
                request.address,
                &request.ticket,
            )
            .await?,
    );
    runtime.lease.validate(&state, &instance)?;
    let known = runtime.peers.read().map_err(|_| "Peer list unavailable.")?;
    if known.get(&request.endpoint_id) != Some(&request.device_id) {
        peer.close();
        return Err("Peer was removed while connecting.".into());
    }
    let expiry = peer.expires_at();
    let mut outgoing = runtime
        .outgoing
        .write()
        .map_err(|_| "Peer connections unavailable.")?;
    if let Some((_, previous)) =
        outgoing.insert(request.device_id.clone(), (request.endpoint_id, peer))
    {
        previous.close();
    }
    Ok(json!({"deviceId":request.device_id,"authorizationExpiresAt":expiry}))
}
fn connection(runtime: &Runtime, device: &str) -> Result<Arc<AuthorizedPeer>, String> {
    let known = runtime.peers.read().map_err(|_| "Peer list unavailable.")?;
    let outgoing = runtime
        .outgoing
        .read()
        .map_err(|_| "Peer connections unavailable.")?;
    let (endpoint, peer) = outgoing
        .get(device)
        .ok_or("Peer is not connected in this Files instance.")?;
    if known.get(endpoint).map(String::as_str) != Some(device) {
        return Err("Peer is unavailable in this Space.".into());
    }
    peer.check()?;
    Ok(peer.clone())
}
#[tauri::command]
pub async fn space_peer_request(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    device_id: String,
    request: PeerRequest,
) -> Result<PeerResponse, String> {
    super::super::require_host(&webview)?;
    if !matches!(
        request,
        PeerRequest::GetRoots
            | PeerRequest::ListDirectory { .. }
            | PeerRequest::Stat { .. }
            | PeerRequest::ReadLink { .. }
            | PeerRequest::Ping { .. }
    ) {
        return Err("Use the streaming API for this peer request.".into());
    }
    let runtime = owned(&state, &instance)?;
    runtime.lease.validate(&state, &instance)?;
    let peer = connection(&runtime, &device_id)?;
    let response = tokio::time::timeout(Duration::from_secs(15), async {
        let (id, _send, mut receive) = peer.request(request).await?;
        let reply: PeerResponseEnvelope = read_frame(&mut receive, MAX_CONTROL_FRAME_BYTES).await?;
        if reply.request_id != id {
            return Err("Peer response identity did not match.".into());
        }
        reply.response.map_err(|error| error.message)
    })
    .await
    .map_err(|_| "Peer request timed out.")??;
    runtime.lease.validate(&state, &instance)?;
    peer.check()?;
    connection(&runtime, &device_id)?;
    Ok(response)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadRequest {
    pub path: String,
    pub offset: u64,
    pub length: u64,
    pub expected_snapshot: Option<String>,
}
pub(crate) async fn read_range(
    peer: &AuthorizedPeer,
    request: ReadRequest,
) -> Result<Value, String> {
    if request.length > 256 * 1024 {
        return Err("Peer range exceeds the chunk limit.".into());
    }
    let (id, _send, mut receive) = peer
        .request(PeerRequest::ReadFile {
            path: request.path,
            offset: request.offset,
            length: Some(request.length),
            expected_snapshot: request.expected_snapshot.clone(),
        })
        .await?;
    let response: PeerResponseEnvelope = read_frame(&mut receive, 64 * 1024).await?;
    if response.request_id != id {
        return Err("Peer response identity did not match.".into());
    }
    let PeerResponse::FileRange {
        snapshot,
        offset,
        length,
    } = response.response.map_err(|error| error.message)?
    else {
        return Err("Peer returned an unexpected range response.".into());
    };
    if offset != request.offset
        || length > request.length
        || request
            .expected_snapshot
            .as_ref()
            .is_some_and(|expected| expected != &snapshot)
    {
        return Err("Peer file range did not match its request.".into());
    }
    let mut bytes = vec![0; length as usize];
    receive.read_exact(&mut bytes).await?;
    if receive.read(&mut [0]).await? != 0 {
        return Err("Peer returned data beyond the requested range.".into());
    }
    peer.check()?;
    Ok(json!({"snapshot":snapshot,"offset":offset,"data":STANDARD.encode(bytes)}))
}
#[tauri::command]
pub async fn space_peer_read(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    device_id: String,
    request: ReadRequest,
) -> Result<Value, String> {
    super::super::require_host(&webview)?;
    let parsed = crate::infra::peer_files::PeerVirtualPath::parse(&request.path)
        .map_err(|error| error.to_string())?;
    if parsed.device_id != device_id {
        return Err("Peer range targets another device.".into());
    }
    let runtime = owned(&state, &instance)?;
    runtime.lease.validate(&state, &instance)?;
    let peer = connection(&runtime, &device_id)?;
    let result = tokio::time::timeout(Duration::from_secs(15), read_range(&peer, request))
        .await
        .map_err(|_| "Peer read timed out.")??;
    runtime.lease.validate(&state, &instance)?;
    peer.check()?;
    connection(&runtime, &device_id)?;
    Ok(result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareRequest {
    path: String,
    max_bytes: u64,
    expected_snapshot: Option<String>,
}

// Poll authority while network IO is pending as well as between chunks. Dropping
// a pending transport operation releases its stream through the worker guard.
async fn while_authorized<T>(
    state: &MiniAppState,
    instance: &str,
    runtime: &Runtime,
    device: &str,
    peer: &Arc<AuthorizedPeer>,
    operation: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let check = || {
        runtime.lease.validate(state, instance)?;
        if !Arc::ptr_eq(peer, &connection(runtime, device)?) {
            return Err("The peer connection changed while preparing the file.".into());
        }
        peer.check()
    };
    let mut interval = tokio::time::interval(Duration::from_millis(100));
    tokio::pin!(operation);
    loop {
        check()?;
        tokio::select! {
            result = &mut operation => { check()?; return result; }
            _ = interval.tick() => {}
        }
    }
}

/// Materialize a remote regular file into an anonymous, instance-owned handle.
/// No shared cache path can later be reused to bypass the originating Space.
#[tauri::command]
pub async fn space_peer_prepare(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    device_id: String,
    request: PrepareRequest,
) -> Result<Value, String> {
    use crate::domain::connected_devices::PeerEntryKind;
    use tokio::io::{AsyncSeekExt, AsyncWriteExt};
    super::super::require_host(&webview)?;
    if request.max_bytes > 9_007_199_254_740_991 {
        return Err("Invalid prepared file size limit.".into());
    }
    let parsed = crate::infra::peer_files::PeerVirtualPath::parse(&request.path)
        .map_err(|error| error.to_string())?;
    if parsed.device_id != device_id {
        return Err("Prepared file targets another device.".into());
    }
    let runtime = owned(&state, &instance)?;
    runtime.lease.validate(&state, &instance)?;
    let peer = connection(&runtime, &device_id)?;
    let _slot = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &registry.get(&instance).ok_or("App is closed.")?.permissions;
        if p.files.len() >= 256 {
            return Err("Too many open files in this App.".into());
        }
        p.transfer_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Other file transfers are running. Try again shortly.")?
    };
    let operation = async {
        let (id, _send, mut receive) = peer
            .request(PeerRequest::Stat {
                path: request.path.clone(),
            })
            .await?;
        let reply: PeerResponseEnvelope = read_frame(&mut receive, MAX_CONTROL_FRAME_BYTES).await?;
        if reply.request_id != id {
            return Err("Peer response identity did not match.".into());
        }
        let PeerResponse::Stat { entry } = reply.response.map_err(|error| error.message)? else {
            return Err("Peer returned an unexpected file description.".into());
        };
        if entry.path != request.path || entry.kind != PeerEntryKind::File {
            return Err("Prepare a regular file from the selected peer.".into());
        }
        let size = entry.size_bytes.ok_or("Peer file size is unavailable.")?;
        if size > request.max_bytes
            || request
                .expected_snapshot
                .as_ref()
                .is_some_and(|expected| expected != &entry.snapshot)
        {
            return Err("Peer file changed or exceeds the preparation limit.".into());
        }
        drop(receive);
        let (id, _send, mut receive) = peer
            .request(PeerRequest::ReadFile {
                path: request.path,
                offset: 0,
                length: Some(size),
                expected_snapshot: Some(entry.snapshot.clone()),
            })
            .await?;
        let reply: PeerResponseEnvelope = read_frame(&mut receive, MAX_CONTROL_FRAME_BYTES).await?;
        if reply.request_id != id {
            return Err("Peer response identity did not match.".into());
        }
        let PeerResponse::FileRange {
            snapshot,
            offset,
            length,
        } = reply.response.map_err(|error| error.message)?
        else {
            return Err("Peer returned an unexpected file stream.".into());
        };
        if offset != 0 || length != size || snapshot != entry.snapshot {
            return Err("Peer file stream does not match its description.".into());
        }
        let temporary = tokio::task::spawn_blocking(tempfile::tempfile)
            .await
            .map_err(|_| "File preparation stopped.")?
            .map_err(|_| "Could not create a temporary file.")?;
        let mut output = tokio::fs::File::from_std(temporary);
        let mut bytes = vec![0; 64 * 1024];
        let mut remaining = size;
        while remaining > 0 {
            let count = bytes.len().min(remaining as usize);
            receive.read_exact(&mut bytes[..count]).await?;
            output
                .write_all(&bytes[..count])
                .await
                .map_err(|_| "Could not prepare the file.")?;
            remaining -= count as u64;
        }
        if receive.read(&mut [0]).await? != 0 {
            return Err("Peer sent data beyond the described file.".into());
        }
        output
            .flush()
            .await
            .map_err(|_| "Could not finish preparing the file.")?;
        output
            .seek(std::io::SeekFrom::Start(0))
            .await
            .map_err(|_| "Prepared file is unavailable.")?;
        Ok((output.into_std().await, entry.name, size, snapshot))
    };
    let (file, name, bytes, snapshot) =
        while_authorized(&state, &instance, &runtime, &device_id, &peer, async {
            tokio::time::timeout(Duration::from_secs(300), operation)
                .await
                .map_err(|_| "Peer file preparation timed out.")?
        })
        .await?;
    runtime.lease.validate(&state, &instance)?;
    let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let p = &mut registry
        .get_mut(&instance)
        .ok_or("App is closed.")?
        .permissions;
    p.authorize("files.read")?;
    p.authorize("connections.read")?;
    if !p
        .peer_runtime
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, &runtime))
        || p.files.len() >= 256
    {
        return Err("The Files instance changed while preparing the file.".into());
    }
    let handle = uuid::Uuid::new_v4().to_string();
    p.files.insert(
        handle.clone(),
        super::FileGrant {
            file,
            writable: false,
        },
    );
    Ok(json!({"handle":handle,"name":name,"bytes":bytes,"snapshot":snapshot,"writable":false}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sharing_requires_both_grants_and_only_owned_live_folder_ids() {
        let temporary = tempfile::tempdir().unwrap();
        let mut permissions = PermissionSet::from_document(
            "files",
            &json!({"version":"1","runtime_capabilities":["files.read","connections.read"]}),
            None,
        )
        .unwrap();
        permissions.decide("files.read", true).unwrap();
        let released = Arc::new(std::sync::atomic::AtomicBool::new(false));
        permissions.folders.insert(
            "chosen".into(),
            super::super::file_jobs::FolderGrant {
                directory: Arc::new(
                    cap_std::fs::Dir::open_ambient_dir(
                        temporary.path(),
                        cap_std::ambient_authority(),
                    )
                    .unwrap(),
                ),
                name: "Chosen".into(),
                released: released.clone(),
                writable: false,
            },
        );
        assert!(granted(&HashMap::new(), &permissions, &["chosen".into()]).is_err());
        permissions.decide("connections.read", true).unwrap();
        assert!(granted(&HashMap::new(), &permissions, &[]).unwrap().is_empty());
        assert_eq!(granted(&HashMap::new(), &permissions, &["chosen".into()]).unwrap().len(), 1);
        assert!(granted(&HashMap::new(), &permissions, &[temporary.path().display().to_string()]).is_err());
        assert!(granted(&HashMap::new(), &permissions, &["another-view".into()]).is_err());
        assert!(granted(&HashMap::new(), &permissions, &["chosen".into(), "chosen".into()]).is_err());
        released.store(true, std::sync::atomic::Ordering::Release);
        assert!(granted(&HashMap::new(), &permissions, &["chosen".into()]).is_err());
    }
}
