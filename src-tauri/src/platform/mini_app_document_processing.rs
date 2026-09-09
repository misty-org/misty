//! A document processor is executable package content, never a host-linked parser.
//! This endpoint accepts a retained file handle, not an ambient filesystem path.
use super::MiniAppState;
use serde::Deserialize;
use serde_json::Value;
use std::{
    fs::File,
    io::Read,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

const MAX_INPUT: u64 = 50 * 1024 * 1024;
const MAX_OUTPUT: u64 = 4 * 1024 * 1024;
const MAX_WORKER: u64 = 64 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    handle: String,
    display_name: String,
    extension: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    payload: String,
    signature: String,
    signature_key_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    protocol: u32,
    service: String,
    app_id: String,
    app_version: String,
    platform: String,
    sha256: String,
    bytes: u64,
}

fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| "Update this app to install its native service.")?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the processor package.")?;
    if bytes.len() as u64 > limit {
        return Err("Processor package exceeds its limits.".into());
    }
    Ok(bytes)
}

fn verified_worker(root: &Path, app_id: &str, version: &str) -> Result<Vec<u8>, String> {
    verified_service(root, app_id, version, "document-processing", 5)
}

pub(crate) fn verified_service(
    root: &Path,
    app_id: &str,
    version: &str,
    service: &str,
    protocol: u32,
) -> Result<Vec<u8>, String> {
    use sha2::{Digest, Sha256};
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let directory = root.join("native").join(service).join(&platform);
    let envelope: Envelope =
        serde_json::from_slice(&bounded_read(&directory.join("service.json"), 16384)?)
            .map_err(|_| "Invalid processor receipt.")?;
    let signed = format!("misty-native-service-v1\n{}", envelope.payload);
    crate::infra::misty::verify_official_app_signature(
        signed.as_bytes(),
        &envelope.signature,
        &envelope.signature_key_id,
    )?;
    let descriptor: Descriptor =
        serde_json::from_str(&envelope.payload).map_err(|_| "Invalid processor description.")?;
    if descriptor.protocol != protocol
        || descriptor.service != service
        || descriptor.app_id != app_id
        || descriptor.app_version != version
        || descriptor.platform != platform
        || descriptor.bytes == 0
        || descriptor.bytes > MAX_WORKER
    {
        return Err("The processor does not match this app release or device.".into());
    }
    // Copy and verify the exact bytes we will execute. A later package mutation
    // cannot substitute another executable between verification and launch.
    let bytes = bounded_read(&directory.join("worker"), MAX_WORKER)?;
    if bytes.len() as u64 != descriptor.bytes
        || format!("{:x}", Sha256::digest(&bytes)) != descriptor.sha256
    {
        return Err("Native service checksum verification failed.".into());
    }
    Ok(bytes)
}

struct Cancellation {
    flag: Arc<AtomicBool>,
    watcher: tokio::task::JoinHandle<()>,
}
impl Drop for Cancellation {
    fn drop(&mut self) {
        self.flag.store(true, Ordering::Release);
        self.watcher.abort();
    }
}

pub(super) async fn execute(
    state: &MiniAppState,
    instance: &str,
    params: Value,
) -> Result<Value, String> {
    execute_operation(state, instance, params, None).await
}

pub(super) async fn image_preview(
    state: &MiniAppState,
    instance: &str,
    mut params: Value,
) -> Result<Value, String> {
    let dimension = params
        .get("maxDimension")
        .and_then(Value::as_u64)
        .filter(|dimension| *dimension > 0 && *dimension <= 4096)
        .ok_or("Invalid image preview size.")? as u32;
    params
        .as_object_mut()
        .ok_or("Invalid image preview request.")?
        .remove("maxDimension");
    execute_operation(state, instance, params, Some(dimension)).await
}

async fn execute_operation(
    state: &MiniAppState,
    instance: &str,
    params: Value,
    image_dimension: Option<u32>,
) -> Result<Value, String> {
    let input: Input = serde_json::from_value(params).map_err(|_| "Invalid document request.")?;
    if input.extension.is_empty()
        || input.extension.len() > 16
        || !input.extension.bytes().all(|c| c.is_ascii_alphanumeric())
        || input.display_name.is_empty()
        || input.display_name.len() > 1024
        || input
            .display_name
            .chars()
            .any(|c| matches!(c, '/' | '\\' | '\0'))
    {
        return Err("Invalid document description.".into());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (state, instance, image_dimension);
        return Err("Isolated document processing is unavailable on this device.".into());
    }
    #[cfg(target_os = "macos")]
    {
        static SLOTS: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
        let slot = SLOTS
            .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Finish an earlier document before opening another.")?;
        let stop = Arc::new(AtomicBool::new(false));
        let read_id = uuid::Uuid::new_v4().to_string();
        let (root, app_id, version, file, epoch, mut cancellation) = {
            let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
            let app = registry.get_mut(instance).ok_or("App is closed.")?;
            let p = &mut app.permissions;
            p.authorize("files.read")?;
            if p.owner_namespace.is_none() || !p.space_owned {
                return Err("Open this app in a Space before processing a document.".into());
            }
            let file = p
                .files
                .get(&input.handle)
                .ok_or("Choose the document in this app first.")?
                .file
                .try_clone()
                .map_err(|_| "Document unavailable.")?;
            p.archive_reads.retain(|_, read| !read.cancelled());
            p.archive_reads.insert(
                read_id.clone(),
                super::file_preview::ReadGuard::new(input.handle.clone(), stop.clone()),
            );
            (
                app.root.clone(),
                p.app_id.clone(),
                p.version.clone(),
                file,
                p.epoch,
                p.cancellation.subscribe(),
            )
        };
        let flag = stop.clone();
        let _cancel = Cancellation {
            flag: stop.clone(),
            watcher: tokio::spawn(async move {
                let _ = cancellation.changed().await;
                flag.store(true, Ordering::Release);
            }),
        };
        let handle = input.handle.clone();
        let result = tokio::task::spawn_blocking(move || {
            let _slot = slot;
            let worker = verified_worker(&root, &app_id, &version)?;
            if let Some(dimension) = image_dimension {
                use base64::Engine;
                let mut png = Vec::new();
                run_response(&worker, file, input, &stop, "explorerImage", Some(dimension), None, Some(&mut png))?;
                Ok(serde_json::json!({"data":base64::engine::general_purpose::STANDARD.encode(png)}))
            } else {
                run(&worker, file, input, &stop)
            }
        })
        .await
        .map_err(|_| "Document worker stopped unexpectedly.");
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &mut registry
            .get_mut(instance)
            .ok_or("App is closed.")?
            .permissions;
        p.archive_reads.remove(&read_id);
        p.authorize("files.read")?;
        if p.epoch != epoch || !p.files.contains_key(&handle) {
            return Err("Document permission changed.".into());
        }
        result?
    }
}

#[cfg(target_os = "macos")]
fn run_response(
    worker: &[u8],
    input: File,
    request: Input,
    stop: &AtomicBool,
    operation: &str,
    max_dimension: Option<u32>,
    source_extension: Option<&str>,
    png_output: Option<&mut Vec<u8>>,
) -> Result<Value, String> {
    use std::{
        io::{Seek, SeekFrom, Write},
        os::unix::fs::{FileExt, PermissionsExt},
        process::Stdio,
        time::{Duration, Instant},
    };
    if !input
        .metadata()
        .map_err(|_| "Document unavailable.")?
        .is_file()
    {
        return Err("Choose a regular file.".into());
    }
    let work = tempfile::Builder::new()
        .prefix("misty-document-")
        .tempdir()
        .map_err(|_| "Could not create document workspace.")?;
    let executable = work.path().join("worker");
    std::fs::write(&executable, worker).map_err(|_| "Could not stage document processor.")?;
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o500))
        .map_err(|_| "Could not prepare processor permissions.")?;
    let mut staged = File::create(
        work.path()
            .join(format!("input.{}", request.extension.to_ascii_lowercase())),
    )
    .map_err(|_| "Could not stage document.")?;
    let started = Instant::now();
    let mut offset = 0;
    let mut buffer = [0; 65536];
    loop {
        if stop.load(Ordering::Acquire) {
            return Err("Document processing cancelled.".into());
        }
        if started.elapsed() > Duration::from_secs(60) {
            return Err("Document staging timed out.".into());
        }
        let length = input
            .read_at(&mut buffer, offset)
            .map_err(|_| "Could not read selected document.")?;
        if length == 0 {
            break;
        }
        offset += length as u64;
        if offset
            > if matches!(operation, "imagePreview" | "explorerImage") {
                256 * 1024 * 1024
            } else if operation.starts_with("semantic") {
                64 * 1024 * 1024
            } else {
                MAX_INPUT
            }
        {
            return Err("Input exceeds this operation's size limit.".into());
        }
        staged
            .write_all(&buffer[..length])
            .map_err(|_| "Could not stage document.")?;
    }
    drop(staged);
    let mut output = tempfile::tempfile().map_err(|_| "Could not receive document output.")?;
    let mut command = super::media::process::command(&executable, work.path())
        .map_err(|_| "Could not confine document processor.")?;
    command.stdin(Stdio::piped()).stdout(Stdio::from(
        output
            .try_clone()
            .map_err(|_| "Could not receive document output.")?,
    ));
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
    let mut child = Child(
        command
            .spawn()
            .map_err(|_| "Could not start document processor.")?,
        true,
    );
    let body = serde_json::to_vec(&serde_json::json!({"protocol":5,"displayName":request.display_name,"extension":request.extension,"operation":operation,"maxDimension":max_dimension,"sourceExtension":source_extension})).map_err(|_| "Invalid document request.")?;
    child
        .0
        .stdin
        .take()
        .ok_or("Processor input unavailable.")?
        .write_all(&body)
        .map_err(|_| "Could not send document request.")?;
    loop {
        if stop.load(Ordering::Acquire) {
            return Err("Document processing cancelled.".into());
        }
        if started.elapsed() > Duration::from_secs(120) {
            return Err("Document processing timed out.".into());
        }
        if output
            .metadata()
            .map_err(|_| "Processor output unavailable.")?
            .len()
            > MAX_OUTPUT
        {
            return Err("Processor response exceeded its limit.".into());
        }
        if let Some(status) = child
            .0
            .try_wait()
            .map_err(|_| "Could not monitor document processor.")?
        {
            child.1 = false;
            if !status.success() {
                return Err("Document processor failed safely.".into());
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    output
        .seek(SeekFrom::Start(0))
        .map_err(|_| "Could not read document output.")?;
    let mut bytes = Vec::new();
    output
        .take(MAX_OUTPUT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read document output.")?;
    if bytes.len() as u64 > MAX_OUTPUT {
        return Err("Processor response exceeded its limit.".into());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid document processor response.")?;
    if value.get("protocol").and_then(Value::as_u64) != Some(5) {
        return Err("Incompatible document processor response.".into());
    }
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.chars().take(2000).collect());
    }
    if operation == "explorerImage" {
        if stop.load(Ordering::Acquire) {
            return Err("Image processing cancelled.".into());
        }
        let path = work.path().join("preview.png");
        // A verified service is still treated as an untrusted output producer.
        // Open without following symlinks and bound the read independently of metadata.
        use std::os::unix::fs::OpenOptionsExt;
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&path)
            .map_err(|_| "Image output unavailable.")?;
        let metadata = file.metadata().map_err(|_| "Image output unavailable.")?;
        let length = value["image"]["byteLength"]
            .as_u64()
            .ok_or("Invalid PNG response.")?;
        if !metadata.is_file()
            || length > 16 * 1024 * 1024
            || metadata.len() != length
            || value["image"]["mimeType"] != "image/png"
        {
            return Err("Invalid PNG output.".into());
        }
        let target = png_output.ok_or("Missing image output receiver.")?;
        file.take(16 * 1024 * 1024 + 1)
            .read_to_end(target)
            .map_err(|_| "Could not read PNG output.")?;
        if target.len() as u64 != length
            || !target.starts_with(b"\x89PNG\r\n\x1a\n")
            || stop.load(Ordering::Acquire)
        {
            return Err("Invalid or cancelled PNG output.".into());
        }
    }
    Ok(value)
}

#[cfg(target_os = "macos")]
fn run(worker: &[u8], input: File, request: Input, stop: &AtomicBool) -> Result<Value, String> {
    let value = run_response(worker, input, request, stop, "document", None, None, None)?;
    let document = value
        .get("document")
        .ok_or("Processor returned no document.")?;
    serde_json::from_value::<crate::infra::document_intelligence::PreparedAgentDocument>(
        document.clone(),
    )
    .map_err(|_| "Invalid processed document.")?;
    Ok(document.clone())
}

#[cfg(all(test, target_os = "macos"))]
pub(super) mod tests {
    use super::*;
    use base64::Engine;
    use ed25519_dalek::{Signer, SigningKey};
    use sha2::{Digest, Sha256};
    fn receipt(root: &Path, bytes: &[u8]) {
        receipt_for(root, bytes, "files");
    }
    fn receipt_for(root: &Path, bytes: &[u8], app_id: &str) {
        service_receipt(root, bytes, app_id, "document-processing", 5);
    }
    pub(crate) fn service_receipt(
        root: &Path,
        bytes: &[u8],
        app_id: &str,
        service: &str,
        protocol: u32,
    ) {
        let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
        let directory = root.join("native").join(service).join(&platform);
        std::fs::create_dir_all(&directory).unwrap();
        let payload = serde_json::json!({"protocol":protocol,"service":service,"appId":app_id,"appVersion":"1","platform":platform,"sha256":format!("{:x}",Sha256::digest(bytes)),"bytes":bytes.len()}).to_string();
        let seed: [u8; 32] =
            hex::decode("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
                .unwrap()
                .try_into()
                .unwrap();
        let signature = SigningKey::from_bytes(&seed)
            .sign(format!("misty-native-service-v1\n{payload}").as_bytes());
        let envelope = serde_json::json!({"payload":payload,"signature":base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),"signatureKeyId":"misty-development-2026-01"});
        std::fs::write(directory.join("service.json"), envelope.to_string()).unwrap();
        std::fs::write(directory.join("worker"), bytes).unwrap();
    }
    #[test]
    fn signed_service_is_bound_to_app_release_and_bytes() {
        let root = tempfile::tempdir().unwrap();
        receipt(root.path(), b"test-worker");
        assert_eq!(
            verified_worker(root.path(), "files", "1").unwrap(),
            b"test-worker"
        );
        assert!(verified_worker(root.path(), "library", "1").is_err());
        assert!(verified_worker(root.path(), "files", "2").is_err());
        let directory = root.path().join(format!(
            "native/document-processing/{}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
        std::fs::write(directory.join("worker"), b"replacement").unwrap();
        assert!(verified_worker(root.path(), "files", "1")
            .unwrap_err()
            .contains("checksum"));
        let mut envelope: Value =
            serde_json::from_slice(&std::fs::read(directory.join("service.json")).unwrap())
                .unwrap();
        envelope["payload"] = Value::String(
            envelope["payload"]
                .as_str()
                .unwrap()
                .replace("files", "library"),
        );
        std::fs::write(directory.join("service.json"), envelope.to_string()).unwrap();
        assert!(verified_worker(root.path(), "library", "1")
            .unwrap_err()
            .contains("signature"));
    }
    pub(crate) fn fixture() -> (MiniAppState, tempfile::TempDir) {
        let root = tempfile::tempdir().unwrap();
        let mut permissions = super::super::PermissionSet::from_document(
            "files",
            &serde_json::json!({"version":"1","runtime_capabilities":["files.read"]}),
            None,
        )
        .unwrap();
        permissions.decide("files.read", true).unwrap();
        permissions.owner_namespace = Some("member-space".into());
        permissions.space_owned = true;
        permissions.files.insert(
            "owned".into(),
            super::super::FileGrant {
                file: tempfile::tempfile().unwrap(),
                writable: false,
            },
        );
        let state = MiniAppState::default();
        state.0.lock().unwrap().insert(
            "test".into(),
            super::super::super::Instance {
                root: root.path().into(),
                permissions,
                _profile: None,
                pending: Default::default(),
            },
        );
        (state, root)
    }
    #[tokio::test]
    async fn requires_owned_handle_space_and_permission_and_cleans_failed_jobs() {
        let (state, _root) = fixture();
        let request =
            serde_json::json!({"handle":"owned","displayName":"Notes.txt","extension":"txt"});
        assert!(execute(&state, "other", request.clone())
            .await
            .unwrap_err()
            .contains("closed"));
        let mut wrong = request.clone();
        wrong["handle"] = Value::String("foreign".into());
        assert!(execute(&state, "test", wrong)
            .await
            .unwrap_err()
            .contains("Choose"));
        assert!(execute(&state, "test", request.clone())
            .await
            .unwrap_err()
            .contains("Update"));
        assert!(state.0.lock().unwrap()["test"]
            .permissions
            .archive_reads
            .is_empty());
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .space_owned = false;
        assert!(execute(&state, "test", request.clone())
            .await
            .unwrap_err()
            .contains("Space"));
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("files.read", false)
            .unwrap();
        assert!(execute(&state, "test", request).await.is_err());
    }
    #[test]
    fn released_file_cancels_document_processing() {
        let (state, _root) = fixture();
        let mut registry = state.0.lock().unwrap();
        let permissions = &mut registry.get_mut("test").unwrap().permissions;
        let cancel = Arc::new(AtomicBool::new(false));
        permissions.archive_reads.insert(
            "document".into(),
            super::super::file_preview::ReadGuard::new("owned".into(), cancel.clone()),
        );
        super::super::binary_files::release(permissions, "owned");
        assert!(cancel.load(Ordering::Acquire));
    }
    #[tokio::test]
    async fn peer_identity_requires_captured_native_authority_and_rejects_rebinding() {
        let (state, root) = fixture();
        let mut permissions=super::super::PermissionSet::from_document("files",
            &serde_json::json!({"version":"1","runtime_capabilities":["files.read","connections.read"]}),None).unwrap();
        permissions.space_owned = true;
        permissions.owner_namespace = Some("alice-family".into());
        permissions.decide("files.read", true).unwrap();
        permissions.decide("connections.read", true).unwrap();
        state.0.lock().unwrap().get_mut("test").unwrap().permissions = permissions;
        service_receipt(root.path(), b"worker", "files", "peer-transport", 2);
        let incomplete =
            ServiceLease::acquire_service(&state, "test", "files", "peer-transport", 2)
                .await
                .unwrap();
        assert!(incomplete.peer_identity("device_12345678").is_err());
        let owner = super::super::super::NativeOwner {
            account_id: "alice".into(),
            space_id: Some("family".into()),
            deployment: Some("https://misty.example/v1".into()),
            authority_generation: Some(7),
        };
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .native_owner = Some(owner.clone());
        assert!(incomplete.validate(&state, "test").is_err());
        let lease = ServiceLease::acquire_service(&state, "test", "files", "peer-transport", 2)
            .await
            .unwrap();
        let identity = lease.peer_identity("device_12345678").unwrap();
        assert_eq!(
            (
                identity.account_id,
                identity.space_id,
                identity.installed_version,
                identity.authority_generation
            ),
            ("alice", "family", "1", 7)
        );
        for replacement in [
            super::super::super::NativeOwner {
                deployment: Some("https://other.example/v1".into()),
                ..owner.clone()
            },
            super::super::super::NativeOwner {
                authority_generation: Some(8),
                ..owner.clone()
            },
            super::super::super::NativeOwner {
                account_id: "bob".into(),
                ..owner.clone()
            },
            super::super::super::NativeOwner {
                space_id: Some("work".into()),
                ..owner.clone()
            },
        ] {
            state
                .0
                .lock()
                .unwrap()
                .get_mut("test")
                .unwrap()
                .permissions
                .native_owner = Some(replacement);
            assert!(lease.validate(&state, "test").is_err());
        }
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .native_owner = Some(owner);
        lease.validate(&state, "test").unwrap();
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .version = "2".into();
        assert!(lease.validate(&state, "test").is_err());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires the built peer transport worker"]
    async fn peer_adapter_transfers_chunks_and_cancels_streams_without_stopping_other_connections()
    {
        use crate::infra::peer_transport_worker::{Endpoint, Relay};
        use std::time::Duration;
        let bytes = std::fs::read(std::env::var("MISTY_TEST_PEER_WORKER").unwrap()).unwrap();
        async fn endpoint(
            bytes: &[u8],
            member: &str,
            seed: u8,
        ) -> (Arc<Endpoint>, MiniAppState, tempfile::TempDir) {
            let (state, root) = fixture();
            let mut permissions = super::super::PermissionSet::from_document("files",
                &serde_json::json!({"version":"1","runtime_capabilities":["files.read","connections.read"]}), None).unwrap();
            permissions.space_owned = true;
            permissions.owner_namespace = Some(format!("{member}-family"));
            permissions.decide("files.read", true).unwrap();
            permissions.decide("connections.read", true).unwrap();
            state.0.lock().unwrap().get_mut("test").unwrap().permissions = permissions;
            service_receipt(root.path(), bytes, "files", "peer-transport", 2);
            let lease = Arc::new(
                ServiceLease::acquire_service(&state, "test", "files", "peer-transport", 2)
                    .await
                    .unwrap(),
            );
            (
                Endpoint::initialize(lease, [seed; 32], Relay::Disabled)
                    .await
                    .unwrap(),
                state,
                root,
            )
        }
        let (left, _left_state, _left_root) = endpoint(&bytes, "alice", 31).await;
        let (right, _right_state, _right_root) = endpoint(&bytes, "bob", 32).await;
        let snapshot = right.snapshot().await.unwrap();
        let port = snapshot.address["addrs"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|value| value["Ip"].as_str()?.parse::<std::net::SocketAddr>().ok())
            .find(std::net::SocketAddr::is_ipv4)
            .unwrap()
            .port();
        let address =
            serde_json::json!({"id":right.id(),"addrs":[{"Ip":format!("127.0.0.1:{port}")}]});
        let (outgoing, incoming) = tokio::time::timeout(Duration::from_secs(10), async {
            tokio::join!(left.connect(address.clone(), right.id()), right.accept())
        })
        .await
        .unwrap();
        let outgoing = outgoing.unwrap();
        let incoming = incoming.unwrap();
        assert_eq!(incoming.remote_id(), left.id());
        let payload: Vec<u8> = (0..200_003).map(|n| (n % 251) as u8).collect();
        let (mut send, mut receive) = outgoing.open_bi().await.unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            tokio::join!(
                async {
                    send.write_all(&payload).await.unwrap();
                    send.finish().await.unwrap();
                    let mut reply = vec![0; payload.len()];
                    receive.read_exact(&mut reply).await.unwrap();
                    assert_eq!(reply, payload);
                    assert_eq!(receive.read(&mut [0]).await.unwrap(), 0);
                    assert!(send.write_all(b"late").await.is_err());
                },
                async {
                    let (mut send, mut receive) = incoming.accept_bi().await.unwrap();
                    let mut data = vec![0; payload.len()];
                    receive.read_exact(&mut data).await.unwrap();
                    assert_eq!(data, payload);
                    assert_eq!(receive.read(&mut [0]).await.unwrap(), 0);
                    send.write_all(&data).await.unwrap();
                    send.finish().await.unwrap();
                }
            );
        })
        .await
        .unwrap();
        // Dropping a timed-out read closes this stream; the connection remains usable.
        let (mut send, mut receive) = outgoing.open_bi().await.unwrap();
        send.write_all(b"x").await.unwrap();
        let (_remote_send, mut remote_receive) = incoming.accept_bi().await.unwrap();
        remote_receive.read_exact(&mut [0]).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), receive.read(&mut [0]))
                .await
                .is_err()
        );
        assert!(send.write_all(b"uncertain offset").await.is_err());
        let (_send, _receive) = outgoing.open_bi().await.unwrap();
        let (second_out, second_in) = tokio::time::timeout(Duration::from_secs(10), async {
            tokio::join!(left.connect(address, right.id()), right.accept())
        })
        .await
        .unwrap();
        let second_out = second_out.unwrap();
        let second_in = second_in.unwrap();
        outgoing.close();
        assert!(outgoing.open_bi().await.is_err());
        let (mut second_send, _second_receive) = second_out.open_bi().await.unwrap();
        second_send.write_all(b"independent").await.unwrap();
        let (_second_send, mut second_receive) = second_in.accept_bi().await.unwrap();
        let mut buffer = [0; 11];
        second_receive.read_exact(&mut buffer).await.unwrap();
        assert_eq!(&buffer, b"independent");
        left.snapshot().await.unwrap();
        right.snapshot().await.unwrap();
        use crate::domain::connected_devices::{PeerRequest, PeerResponse, PeerResponseEnvelope};
        use crate::infra::space_peer_session::{read_frame, write_frame, Session};
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        use ed25519_dalek::Signer;
        let signing = ed25519_dalek::SigningKey::from_bytes(&[91; 32]);
        let keys = std::collections::HashMap::from([("test".to_owned(), signing.verifying_key())]);
        let left_session = Session::fixture(left.clone(), "device-a", keys.clone());
        let right_session = Session::fixture(right.clone(), "device-b", keys);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let ticket = |space: &str| {
            let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA","kid":"test"}"#);
            let claims = serde_json::json!({"iss":"misty-api","aud":"misty-device/2","protocolVersion":"misty-device/2",
                "jti":"handshake-1","pairId":"pair-1","sourceDeviceId":"device-a","targetDeviceId":"device-b",
                "sourceEndpointId":left.id(),"targetEndpointId":right.id(),"spaceId":space,"appId":"files",
                "installedVersion":"1","authorityGeneration":7,"permissions":["files:read","directories:subscribe"],"iat":now,"exp":now+8});
            let body = format!(
                "{header}.{}",
                URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
            );
            format!(
                "{body}.{}",
                URL_SAFE_NO_PAD.encode(signing.sign(body.as_bytes()).to_bytes())
            )
        };
        let address =
            serde_json::json!({"id":right.id(),"addrs":[{"Ip":format!("127.0.0.1:{port}")}]});
        assert!(left_session
            .connect("device-b", right.id(), address.clone(), &ticket("work"))
            .await
            .is_err());
        let known =
            std::collections::HashMap::from([(left.id().to_owned(), "device-a".to_owned())]);
        let signed = ticket("family");
        let (authorized_left, authorized_right) =
            tokio::time::timeout(Duration::from_secs(10), async {
                tokio::join!(
                    left_session.connect("device-b", right.id(), address.clone(), &signed),
                    right_session.accept(&known)
                )
            })
            .await
            .unwrap();
        let authorized_left = authorized_left.unwrap();
        let authorized_right = authorized_right.unwrap();
        assert!(left_session
            .connect("device-b", right.id(), address, &signed)
            .await
            .is_err());
        assert!(authorized_left
            .request(PeerRequest::GetRoots)
            .await
            .is_err());
        assert!(authorized_left
            .request(PeerRequest::Hello { ticket: signed })
            .await
            .is_err());
        let (request_id, _send, mut receive) = authorized_left
            .request(PeerRequest::Ping { nonce: 42 })
            .await
            .unwrap();
        let (request, mut send, _receive) = authorized_right.accept_request().await.unwrap();
        assert_eq!(request.request, PeerRequest::Ping { nonce: 42 });
        write_frame(
            &mut send,
            &PeerResponseEnvelope {
                request_id: request.request_id,
                response: Ok(PeerResponse::Pong { nonce: 42 }),
            },
            true,
        )
        .await
        .unwrap();
        let reply: PeerResponseEnvelope = read_frame(&mut receive, 1024).await.unwrap();
        assert_eq!(reply.request_id, request_id);
        use crate::infra::space_peer_files::serve_one;
        use crate::infra::space_peer_roots::{GrantedRoot, Roots};
        let shared = tempfile::tempdir().unwrap();
        std::fs::write(shared.path().join("payload"), &payload).unwrap();
        let released = Arc::new(AtomicBool::new(false));
        let roots = Arc::new(
            Roots::from_grants(
                "bob-family",
                "device-b",
                vec![GrantedRoot {
                    id: "selected-folder".into(),
                    name: "Shared".into(),
                    directory: Arc::new(
                        cap_std::fs::Dir::open_ambient_dir(
                            shared.path(),
                            cap_std::ambient_authority(),
                        )
                        .unwrap(),
                    ),
                    released: released.clone(),
                }],
            )
            .unwrap(),
        );
        let base = format!("misty://device/device-b/{}", roots.list()[0].id);
        let path = format!("{base}/payload");
        use super::super::peer::{read_range, ReadRequest};
        assert!(read_range(
            &authorized_left,
            ReadRequest {
                path: path.clone(),
                offset: 0,
                length: 256 * 1024 + 1,
                expected_snapshot: None
            }
        )
        .await
        .is_err());
        tokio::time::timeout(Duration::from_secs(3), async {
            tokio::join!(
                async {
                    serve_one(&authorized_right, roots.clone()).await.unwrap();
                },
                async {
                    let response = read_range(
                        &authorized_left,
                        ReadRequest {
                            path: path.clone(),
                            offset: 17,
                            length: 150_000,
                            expected_snapshot: Some(roots.stat(&path).unwrap().snapshot),
                        },
                    )
                    .await
                    .unwrap();
                    assert_eq!(response["offset"], 17);
                    let data = base64::engine::general_purpose::STANDARD
                        .decode(response["data"].as_str().unwrap())
                        .unwrap();
                    assert_eq!(data, &payload[17..150_017]);
                }
            );
        })
        .await
        .unwrap();
        let (_id, _send, mut denied) = authorized_left
            .request(PeerRequest::Stat {
                path: path.replace("device-b", "device-other"),
            })
            .await
            .unwrap();
        serve_one(&authorized_right, roots.clone()).await.unwrap();
        let reply: PeerResponseEnvelope = read_frame(&mut denied, 1024).await.unwrap();
        assert!(reply.response.is_err());
        let (_id, _send, mut subscription) = authorized_left
            .request(PeerRequest::SubscribeDirectory { path: base })
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            tokio::join!(
                async {
                    assert!(serve_one(&authorized_right, roots.clone()).await.is_err());
                },
                async {
                    let reply: PeerResponseEnvelope =
                        read_frame(&mut subscription, 1024).await.unwrap();
                    assert!(matches!(
                        reply.response,
                        Ok(PeerResponse::Subscribed { .. })
                    ));
                    released.store(true, Ordering::Release);
                }
            );
        })
        .await
        .unwrap();

        assert!(
            tokio::time::timeout(Duration::from_secs(10), authorized_right.accept_request())
                .await
                .unwrap()
                .is_err()
        );
        assert!(authorized_left
            .request(PeerRequest::Ping { nonce: 43 })
            .await
            .is_err());
        left.close();
        right.close();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires the built peer transport worker"]
    async fn peer_supervisor_multiplexes_and_revokes_only_its_space() {
        use crate::infra::native_process_worker::ProcessWorker;
        use std::time::Duration;
        let bytes =
            std::fs::read(std::env::var("MISTY_TEST_PEER_WORKER").expect("peer worker")).unwrap();
        fn peer_state(namespace: &str) -> (MiniAppState, tempfile::TempDir) {
            let (state, root) = fixture();
            let mut permissions = super::super::PermissionSet::from_document("files",
                &serde_json::json!({"version":"1","runtime_capabilities":["files.read","connections.read"]}), None).unwrap();
            permissions.space_owned = true;
            permissions.owner_namespace = Some(namespace.into());
            permissions.decide("files.read", true).unwrap();
            state.0.lock().unwrap().get_mut("test").unwrap().permissions = permissions;
            (state, root)
        }
        let (state, root) = peer_state("member-family");
        service_receipt(root.path(), &bytes, "files", "peer-transport", 2);
        assert!(
            ServiceLease::acquire_service(&state, "test", "files", "peer-transport", 2)
                .await
                .is_err()
        );
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("connections.read", true)
            .unwrap();
        let lease = Arc::new(
            ServiceLease::acquire_service(&state, "test", "files", "peer-transport", 2)
                .await
                .unwrap(),
        );
        let worker = Arc::new(ProcessWorker::launch_peer(lease.clone()).unwrap());
        let (other_state, other_root) = peer_state("member-work");
        other_state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("connections.read", true)
            .unwrap();
        assert!(lease.validate(&other_state, "test").is_err());
        service_receipt(other_root.path(), &bytes, "files", "peer-transport", 2);
        let other_lease = Arc::new(
            ServiceLease::acquire_service(&other_state, "test", "files", "peer-transport", 2)
                .await
                .unwrap(),
        );
        let other = ProcessWorker::launch_peer(other_lease).unwrap();
        let first = worker.call(serde_json::json!({"operation":"initialize", "secret":vec![41u8;32], "relay":{"mode":"disabled"}})).unwrap();
        let second = other.call(serde_json::json!({"operation":"initialize", "secret":vec![42u8;32], "relay":{"mode":"disabled"}})).unwrap();
        assert_ne!(first, second);
        let waiting = worker.clone();
        let accept = tokio::task::spawn_blocking(move || {
            waiting.wait_peer(serde_json::json!({"operation":"accept"}))
        });
        // A pending network accept must not serialize the response channel.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!accept.is_finished());
        for _ in 0..40 {
            let service = worker.clone();
            let cancelled = tokio::spawn(async move {
                service
                    .peer_request(serde_json::json!({"operation":"accept"}))
                    .await
            });
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            while worker.pending_peer_operations() < 2 {
                assert!(std::time::Instant::now() < deadline);
                tokio::task::yield_now().await;
            }
            cancelled.abort();
            assert!(cancelled.await.unwrap_err().is_cancelled());
            worker
                .peer_request(serde_json::json!({"operation":"snapshot"}))
                .await
                .unwrap();
            assert!(
                !accept.is_finished(),
                "canceling one request stopped an unrelated accept"
            );
        }
        let mut requests = Vec::new();
        for _ in 0..16 {
            let worker = worker.clone();
            requests.push(tokio::task::spawn_blocking(move || {
                worker.call(serde_json::json!({"operation":"snapshot"}))
            }));
        }
        for request in requests {
            tokio::time::timeout(Duration::from_secs(3), request)
                .await
                .expect("snapshot blocked behind accept")
                .unwrap()
                .unwrap();
        }
        let mut blocked = Vec::new();
        for _ in 0..31 {
            let worker = worker.clone();
            blocked.push(tokio::task::spawn_blocking(move || {
                worker.wait_peer(serde_json::json!({"operation":"accept"}))
            }));
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while worker.pending_peer_operations() != 32 {
            assert!(
                std::time::Instant::now() < deadline,
                "pending operations did not reach their bound"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            worker
                .call(serde_json::json!({"operation":"accept"}))
                .unwrap_err(),
            "Peer transport is busy."
        );
        // Even with all network slots occupied, control requests still complete.
        worker
            .call(serde_json::json!({"operation":"snapshot"}))
            .unwrap();
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("connections.read", false)
            .unwrap();
        assert!(lease.validate(&state, "test").is_err());
        assert!(tokio::time::timeout(Duration::from_secs(3), accept)
            .await
            .expect("revocation did not cancel accept")
            .unwrap()
            .is_err());
        assert!(worker
            .call(serde_json::json!({"operation":"snapshot"}))
            .is_err());
        other
            .call(serde_json::json!({"operation":"snapshot"}))
            .unwrap();
        for request in blocked {
            assert!(tokio::time::timeout(Duration::from_secs(3), request)
                .await
                .expect("pending accept survived revocation")
                .unwrap()
                .is_err());
        }
        other.close();
    }

    #[tokio::test]
    async fn code_tools_require_matching_release_space_and_both_grants() {
        let (state, root) = fixture();
        let mut permissions = super::super::PermissionSet::from_document("code",
            &serde_json::json!({"version":"1","runtime_capabilities":["files.read","code.execute"]}), None).unwrap();
        permissions.space_owned = true;
        permissions.owner_namespace = Some("member-family".into());
        permissions.decide("code.execute", true).unwrap();
        state.0.lock().unwrap().get_mut("test").unwrap().permissions = permissions;
        service_receipt(root.path(), b"worker", "code", "code-tools", 1);
        assert!(ServiceLease::acquire_code_tools(&state, "test")
            .await
            .is_err());
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("files.read", true)
            .unwrap();
        let lease = ServiceLease::acquire_code_tools(&state, "test")
            .await
            .unwrap();
        assert!(lease.is_code_tools());
        service_receipt(root.path(), b"worker", "different-app", "code-tools", 1);
        assert!(ServiceLease::acquire_code_tools(&state, "test")
            .await
            .is_err());
        let mut registry = state.0.lock().unwrap();
        registry
            .get_mut("test")
            .unwrap()
            .permissions
            .owner_namespace = Some("member-work".into());
        drop(registry);
        assert!(lease.validate(&state, "test").is_err());
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .owner_namespace = Some("member-family".into());
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("files.read", false)
            .unwrap();
        assert!(lease.validate(&state, "test").is_err());
    }
    #[tokio::test]
    async fn terminal_service_uses_mounted_app_authority_and_matching_receipt() {
        let (state, root) = fixture();
        let mut permissions = super::super::PermissionSet::from_document(
            "sdk-shell",
            &serde_json::json!({"version":"1","runtime_capabilities":["terminal.execute"]}),
            None,
        )
        .unwrap();
        permissions.owner_namespace = Some("member-family".into());
        permissions.space_owned = true;
        state.0.lock().unwrap().get_mut("test").unwrap().permissions = permissions;
        service_receipt(root.path(), b"worker", "sdk-shell", "terminal", 1);
        assert!(ServiceLease::acquire_terminal(&state, "test")
            .await
            .is_err());
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("terminal.execute", true)
            .unwrap();
        let lease = ServiceLease::acquire_terminal(&state, "test")
            .await
            .unwrap();
        assert!(lease.is_terminal());
        // Installing Terminal's bytes does not authorize them for another app.
        service_receipt(root.path(), b"worker", "terminal", "terminal", 1);
        assert!(ServiceLease::acquire_terminal(&state, "test")
            .await
            .is_err());
        service_receipt(root.path(), b"worker", "sdk-shell", "terminal", 1);
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("terminal.execute", false)
            .unwrap();
        assert!(lease.validate(&state, "test").is_err());
        assert!(ServiceLease::acquire_terminal(&state, "test")
            .await
            .is_err());
    }
    #[tokio::test]
    #[ignore = "requires MISTY_TEST_TERMINAL_WORKER pointing to a built worker"]
    async fn terminal_supervisor_checks_owner_signature_and_revokes_live_processes() {
        use crate::infra::native_process_worker::ProcessWorker as TerminalWorker;
        use std::os::unix::fs::PermissionsExt;
        let bytes =
            std::fs::read(std::env::var("MISTY_TEST_TERMINAL_WORKER").expect("terminal worker"))
                .unwrap();
        fn terminal_state(namespace: &str) -> (MiniAppState, tempfile::TempDir) {
            let (state, root) = fixture();
            let mut permissions = super::super::PermissionSet::from_document(
                "terminal",
                &serde_json::json!({"version":"1","runtime_capabilities":["terminal.execute"]}),
                None,
            )
            .unwrap();
            permissions.owner_namespace = Some(namespace.into());
            permissions.space_owned = true;
            state.0.lock().unwrap().get_mut("test").unwrap().permissions = permissions;
            (state, root)
        }
        let (state, root) = terminal_state("member-family");
        service_receipt(root.path(), &bytes, "terminal", "terminal", 1);
        assert!(
            ServiceLease::acquire_service(&state, "test", "terminal", "terminal", 1)
                .await
                .is_err()
        );
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("terminal.execute", true)
            .unwrap();
        let lease = Arc::new(
            ServiceLease::acquire_service(&state, "test", "terminal", "terminal", 1)
                .await
                .unwrap(),
        );
        assert!(
            ServiceLease::acquire_service(&state, "test", "terminal", "file-search", 1)
                .await
                .is_err()
        );
        let (other_state, other_root) = terminal_state("member-work");
        other_state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("terminal.execute", true)
            .unwrap();
        assert!(lease.validate(&other_state, "test").is_err());
        service_receipt(other_root.path(), &bytes, "terminal", "terminal", 1);
        let other_lease = Arc::new(
            ServiceLease::acquire_service(&other_state, "test", "terminal", "terminal", 1)
                .await
                .unwrap(),
        );
        let shell = root.path().join("shell");
        std::fs::write(&shell, "#!/bin/sh\nexec /bin/sh -s\n").unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let worker = Arc::new(
            TerminalWorker::launch_test(
                lease.clone(),
                Arc::new(move |value| {
                    let _ = send.send(value);
                }),
                &shell,
            )
            .unwrap(),
        );
        let created = worker
            .call(serde_json::json!({"operation":"create","request":{"cwd":root.path(),"env":{}}}))
            .unwrap();
        let pid = created["processId"].as_u64().unwrap() as i32;
        let other_worker =
            TerminalWorker::launch_test(other_lease.clone(), Arc::new(|_| {}), &shell).unwrap();
        let other_created=other_worker.call(serde_json::json!({"operation":"create","request":{"cwd":other_root.path(),"env":{}}})).unwrap();
        let other_pid = other_created["processId"].as_u64().unwrap() as i32;
        worker.call(serde_json::json!({"operation":"write","data":"printf 'worker-ready\n'; exec sleep 30\n"})).unwrap();
        let mut output = String::new();
        while !output.contains("worker-ready") {
            let event = receive
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            if let Some(data) = event["data"].as_str() {
                output.push_str(data);
            }
        }
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("terminal.execute", false)
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while !lease.cancelled() || unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("revocation must stop the terminal process");
        assert!(worker
            .call(serde_json::json!({"operation":"write","data":"late"}))
            .is_err());
        other_worker
            .call(serde_json::json!({"operation":"write","data":"printf independent\n"}))
            .expect("another Space must remain usable");
        other_state.0.lock().unwrap().remove("test");
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while unsafe { libc::kill(other_pid, 0) } == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("closing the other instance must stop its own terminal");
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("terminal.execute", true)
            .unwrap();
        assert!(worker
            .call(serde_json::json!({"operation":"write","data":"must not restart"}))
            .is_err());
        // A raw PTY whose process never reads input forces write backpressure.
        let raw_shell = root.path().join("raw-shell");
        std::fs::write(
            &raw_shell,
            "#!/bin/sh\nstty -icanon -echo\nprintf raw-ready\nexec sleep 30\n",
        )
        .unwrap();
        std::fs::set_permissions(&raw_shell, std::fs::Permissions::from_mode(0o700)).unwrap();
        let raw_lease = Arc::new(
            ServiceLease::acquire_service(&state, "test", "terminal", "terminal", 1)
                .await
                .unwrap(),
        );
        let (events_send, events) = std::sync::mpsc::channel();
        let raw_worker = Arc::new(
            TerminalWorker::launch_test(
                raw_lease,
                Arc::new(move |event| {
                    let _ = events_send.send(event);
                }),
                &raw_shell,
            )
            .unwrap(),
        );
        let raw_created = raw_worker
            .call(serde_json::json!({"operation":"create","request":{"env":{}}}))
            .unwrap();
        let raw_pid = raw_created["processId"].as_u64().unwrap() as i32;
        loop {
            let event = events
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            if event["data"]
                .as_str()
                .is_some_and(|s| s.contains("raw-ready"))
            {
                break;
            }
        }
        let writing = raw_worker.clone();
        let (done_send, done) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result =
                writing.call(serde_json::json!({"operation":"write","data":"x".repeat(512*1024)}));
            let _ = done_send.send(result);
        });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(
            matches!(done.try_recv(), Err(std::sync::mpsc::TryRecvError::Empty)),
            "raw PTY write should be blocked"
        );
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("terminal.execute", false)
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while unsafe { libc::kill(raw_pid, 0) } == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("revocation must stop a blocked PTY write");
        assert!(done
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap()
            .is_err());
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("terminal.execute", true)
            .unwrap();
        let path = root
            .path()
            .join("native/terminal")
            .join(format!(
                "{}-{}",
                std::env::consts::OS,
                std::env::consts::ARCH
            ))
            .join("worker");
        std::fs::write(path, b"tampered").unwrap();
        assert!(
            ServiceLease::acquire_service(&state, "test", "terminal", "terminal", 1)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    #[ignore = "requires MISTY_TEST_DOCUMENT_WORKER pointing to a built worker"]
    async fn files_images_use_isolated_cache_and_revoke_cached_access() {
        let worker =
            std::fs::read(std::env::var("MISTY_TEST_DOCUMENT_WORKER").expect("worker path"))
                .unwrap();
        let (state, root) = fixture();
        receipt_for(root.path(), &worker, "files");
        let lease = Arc::new(
            ServiceLease::acquire(&state, "test", "files")
                .await
                .unwrap(),
        );
        use crate::infra::{
            environment::AppEnvironmentService, explorer::ExplorerService,
            explorer_library::ExplorerLibraryService, providers::ProviderService,
            storage::StorageService, transfers::TransferService,
        };
        let env = AppEnvironmentService::for_test_home(root.path().to_owned());
        let storage = StorageService::new(env.clone());
        let explorer = ExplorerService::new(
            env.clone(),
            storage.clone(),
            ProviderService::new(storage),
            TransferService::new(env.clone()),
            ExplorerLibraryService::new(env),
        );
        let path = root.path().join("alpha.png");
        image::RgbaImage::from_pixel(800, 400, image::Rgba([255, 0, 0, 100]))
            .save(&path)
            .unwrap();
        let path = path.to_str().unwrap();
        assert!(explorer.preview_item(path).await.is_err());
        let scoped = explorer.clone().with_image_service(lease.clone());
        let preview = scoped.preview_item(path).await.unwrap();
        let decoded = image::load_from_memory(&preview.bytes).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (1600, 800));
        assert_eq!(decoded.get_pixel(0, 0).0, [255, 0, 0, 100]);
        let first = scoped
            .generate_image_thumbnail(path, 384, None, None, None)
            .await
            .unwrap();
        let second = scoped
            .generate_image_thumbnail(path, 384, None, None, None)
            .await
            .unwrap();
        assert_eq!(first.path, second.path);
        assert!(first.path.contains("space-owned-v1"));
        assert_eq!(image::open(&first.path).unwrap().width(), 384);
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .owner_namespace = Some("other-member-space".into());
        let other = Arc::new(
            ServiceLease::acquire(&state, "test", "files")
                .await
                .unwrap(),
        );
        let other_explorer = explorer.with_image_service(other);
        let third = other_explorer
            .generate_image_thumbnail(path, 384, None, None, None)
            .await
            .unwrap();
        assert_ne!(first.path, third.path);
        state.0.lock().unwrap().remove("test");
        for _ in 0..50 {
            if lease.cancelled() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(scoped
            .generate_image_thumbnail(path, 384, None, None, None)
            .await
            .is_err());
        assert!(scoped.preview_item(path).await.is_err());
        assert!(Path::new(path).is_file());
    }

    #[tokio::test]
    #[ignore = "requires MISTY_TEST_DOCUMENT_WORKER pointing to a built worker"]
    async fn library_lease_requires_its_own_app_and_cancels_on_close() {
        let worker =
            std::fs::read(std::env::var("MISTY_TEST_DOCUMENT_WORKER").expect("worker path"))
                .unwrap();
        let (state, root) = fixture();
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .app_id = "library".into();
        receipt_for(root.path(), &worker, "library");
        assert!(ServiceLease::acquire(&state, "test", "files")
            .await
            .is_err());
        let lease = ServiceLease::acquire(&state, "test", "library")
            .await
            .unwrap();
        let input = root.path().join("totals.csv");
        std::fs::write(&input, "name,total\nAlpha,10\n").unwrap();
        let response = lease.process(&input, "document").unwrap();
        assert_eq!(
            response["document"]["sections"][0]["locator"],
            "Sheet1!A1:B2"
        );
        let image_folder = root.path().join("images");
        std::fs::create_dir(&image_folder).unwrap();
        let image_path = image_folder.join("photo.png");
        image::RgbImage::from_pixel(800, 400, image::Rgb([120, 50, 10]))
            .save(&image_path)
            .unwrap();
        let preview = lease.process_image(&image_path, 512).unwrap();
        assert_eq!(preview["image"]["width"], 512);
        assert_eq!(preview["image"]["height"], 256);
        let jpeg: Vec<u8> = serde_json::from_value(preview["image"]["bytes"].clone()).unwrap();
        assert_eq!(
            image::load_from_memory_with_format(&jpeg, image::ImageFormat::Jpeg)
                .unwrap()
                .width(),
            512
        );
        // Exercise the actual Library catalog -> preview path, not just the worker protocol.
        use crate::infra::{
            environment::AppEnvironmentService,
            explorer::ExplorerService,
            explorer_library::ExplorerLibraryService,
            providers::ProviderService,
            smart_library::{
                PrepareSmartLibraryPreviewsRequest, SmartLibraryScanRequest, SmartLibraryService,
            },
            storage::StorageService,
            transfers::TransferService,
        };
        let env = AppEnvironmentService::for_test_home(root.path().to_owned());
        let storage = StorageService::new(env.clone());
        let explorer = ExplorerService::new(
            env.clone(),
            storage.clone(),
            ProviderService::new(storage),
            TransferService::new(env.clone()),
            ExplorerLibraryService::new(env.clone()),
        );
        let library = SmartLibraryService::new(env, explorer);
        let scanned = library
            .scan(SmartLibraryScanRequest {
                root_path: image_folder.display().to_string(),
            })
            .await
            .unwrap();
        let lease = Arc::new(lease);
        let previews = library
            .prepare_previews(
                PrepareSmartLibraryPreviewsRequest {
                    asset_ids: vec![scanned.assets[0].asset_id.clone()],
                    max_dimension: Some(512),
                },
                lease.clone(),
            )
            .await
            .unwrap();
        assert_eq!(previews[0].width, 512);
        assert_eq!(previews[0].height, 256);
        assert_eq!(previews[0].mime_type, "image/jpeg");
        assert!(previews[0].bytes.starts_with(&[0xff, 0xd8]));
        assert!(!serde_json::to_string(&previews[0])
            .unwrap()
            .contains(&image_path.display().to_string()));
        let notes = image_folder.join("notes.txt");
        std::fs::write(&notes, "é".repeat(80_000)).unwrap();
        let archive_path = image_folder.join("documents.zip");
        {
            use std::io::Write;
            let mut archive = zip::ZipWriter::new(std::fs::File::create(&archive_path).unwrap());
            archive
                .start_file(
                    "private/nested/note.txt",
                    zip::write::SimpleFileOptions::default(),
                )
                .unwrap();
            archive
                .write_all(b"contents are not part of the archive summary")
                .unwrap();
            archive.finish().unwrap();
        }
        let scanned = library
            .scan(SmartLibraryScanRequest {
                root_path: image_folder.display().to_string(),
            })
            .await
            .unwrap();
        for (name, expected) in [("notes.txt", None), ("documents.zip", Some("note.txt"))] {
            let asset = scanned
                .assets
                .iter()
                .find(|asset| asset.name == name)
                .unwrap();
            let prepared = library
                .prepare_previews(
                    PrepareSmartLibraryPreviewsRequest {
                        asset_ids: vec![asset.asset_id.clone()],
                        max_dimension: None,
                    },
                    lease.clone(),
                )
                .await
                .unwrap();
            let text = prepared[0]
                .extracted_text
                .as_ref()
                .expect("extracted by the downloaded worker");
            if let Some(expected) = expected {
                assert_eq!(text, expected);
            } else {
                assert!(prepared[0].truncated);
                assert!(text.len() <= 64 * 1024);
                assert!(text.ends_with('é'));
            }
            assert!(!serde_json::to_string(&prepared[0])
                .unwrap()
                .contains(&image_folder.display().to_string()));
        }
        state.0.lock().unwrap().remove("test");
        assert!(lease.validate(&state, "test").is_err());
        tokio::task::yield_now().await;
        assert!(lease
            .process(&input, "document")
            .unwrap_err()
            .contains("cancelled"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires MISTY_TEST_SEARCH_WORKER pointing to a built worker"]
    async fn downloaded_search_preserves_incremental_results_scopes_and_revocation() {
        use crate::infra::{
            environment::AppEnvironmentService, providers::ProviderService, search::*,
            storage::StorageService,
        };
        let worker =
            std::fs::read(std::env::var("MISTY_TEST_SEARCH_WORKER").expect("worker path")).unwrap();
        let (state, root) = fixture();
        service_receipt(root.path(), &worker, "files", "file-search", 1);
        assert!(verified_service(root.path(), "library", "1", "file-search", 1).is_err());
        assert!(verified_service(root.path(), "files", "2", "file-search", 1).is_err());
        let env = AppEnvironmentService::for_test_home(root.path().to_owned());
        let proxy = StorageService::new(env.clone());
        let providers = ProviderService::new(proxy.clone());
        let base = SearchService::new(env, providers, proxy);
        let lease = ServiceLease::acquire_service(&state, "test", "files", "file-search", 1)
            .await
            .unwrap();
        let search = base.authorized(lease).unwrap();
        let folder = root.path().join("approved");
        std::fs::create_dir(&folder).unwrap();
        let file = folder.join("Pikachu.txt");
        std::fs::write(&file, "test").unwrap();
        let request:SearchScanRequest=serde_json::from_value(serde_json::json!({"roots":[folder],"includeLocal":true,"includeRemotes":false,"incremental":true})).unwrap();
        async fn finish(search: &SearchService) -> SearchStatus {
            for _ in 0..1000 {
                let status = search.status().await.unwrap();
                if !status.scan_in_progress {
                    assert_eq!(
                        status.last_scan_outcome,
                        Some(SearchScanOutcome::Completed),
                        "{:?}",
                        status
                    );
                    return status;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            panic!("scan did not finish")
        }
        search.start_scan(request.clone()).await.unwrap();
        assert_eq!(finish(&search).await.last_scan_added_item_count, 1);
        let query: SearchQueryRequest =
            serde_json::from_value(serde_json::json!({"query":"pikchu"})).unwrap();
        assert_eq!(search.query(query.clone()).await.unwrap().len(), 1);
        search.start_scan(request.clone()).await.unwrap();
        assert_eq!(finish(&search).await.last_scan_unchanged_item_count, 1);
        std::fs::write(&file, "updated contents").unwrap();
        search.start_scan(request.clone()).await.unwrap();
        assert_eq!(finish(&search).await.last_scan_updated_item_count, 1);
        state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .owner_namespace = Some("another-member-space".into());
        let other = base
            .authorized(
                ServiceLease::acquire_service(&state, "test", "files", "file-search", 1)
                    .await
                    .unwrap(),
            )
            .unwrap();
        assert!(other.query(query.clone()).await.unwrap().is_empty());
        std::fs::remove_file(&file).unwrap();
        search.start_scan(request.clone()).await.unwrap();
        assert_eq!(finish(&search).await.last_scan_removed_item_count, 1);
        assert!(search.query(query.clone()).await.unwrap().is_empty());
        search.start_scan(request).await.unwrap();
        state.0.lock().unwrap().remove("test");
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let status = search.status().await.unwrap();
                if !status.scan_in_progress {
                    assert_eq!(status.last_scan_outcome, Some(SearchScanOutcome::Canceled));
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("revocation should stop an active scan promptly");
        assert!(search.query(query).await.is_err());
    }

    /// Run explicitly against the release worker built by misty-apps.
    #[test]
    #[ignore = "requires MISTY_TEST_DOCUMENT_WORKER pointing to a built worker"]
    fn packaged_worker_runs_confined_and_preserves_citations() {
        let worker =
            std::fs::read(std::env::var("MISTY_TEST_DOCUMENT_WORKER").expect("worker path"))
                .unwrap();
        let mut input = tempfile::tempfile().unwrap();
        use std::io::Write;
        input.write_all(b"name,total\nAlpha,10\n").unwrap();
        let result = run(
            &worker,
            input,
            Input {
                handle: "owned".into(),
                display_name: "Totals.csv".into(),
                extension: "csv".into(),
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(result["displayName"], "Totals.csv");
        assert_eq!(result["sections"][0]["locator"], "Sheet1!A1:B2");
        assert!(result["sections"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Alpha\t10"));
    }
}

/// Host-only lease for files already approved through the device scope or Library
/// picker. It cannot be acquired by a package RPC with an arbitrary path.
pub(crate) struct ServiceLease {
    pub(crate) worker: Vec<u8>,
    cancel: Cancellation,
    pub(crate) namespace: String,
    epoch: u64,
    capability: &'static str,
    service: &'static str,
    instance: String,
    app_id: String,
    version: String,
    native_owner: Option<super::super::NativeOwner>,
    _slot: Option<tokio::sync::OwnedSemaphorePermit>,
}
impl ServiceLease {
    #[cfg(all(test, target_os = "macos"))]
    pub(super) fn fixture_worker(service: &'static str) -> Arc<Self> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../misty-apps/native-services")
            .join(service)
            .join("target/debug")
            .join(format!("misty-{service}"));
        Arc::new(Self {
            worker: std::fs::read(path)
                .expect("Build the app native-service fixtures before native integration tests"),
            cancel: Cancellation {
                flag: Arc::new(AtomicBool::new(false)),
                watcher: tokio::spawn(std::future::pending()),
            },
            namespace: "fixture".into(),
            epoch: 0,
            capability: "files.read",
            service,
            instance: "fixture".into(),
            app_id: "fixture".into(),
            version: "fixture".into(),
            native_owner: None,
            _slot: None,
        })
    }

    pub(crate) async fn acquire(
        state: &MiniAppState,
        instance: &str,
        expected_app: &str,
    ) -> Result<Self, String> {
        Self::acquire_service(state, instance, expected_app, "document-processing", 5).await
    }
    /// Resolve ownership from the mounted instance. The service receipt must be
    /// signed for this exact app and release, including for SDK component apps.
    pub(crate) async fn acquire_terminal(
        state: &MiniAppState,
        instance: &str,
    ) -> Result<Self, String> {
        let app_id = {
            let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
            registry
                .get(instance)
                .ok_or("App is closed.")?
                .permissions
                .app_id
                .clone()
        };
        Self::acquire_service(state, instance, &app_id, "terminal", 1).await
    }
    pub(crate) async fn acquire_code_tools(
        state: &MiniAppState,
        instance: &str,
    ) -> Result<Self, String> {
        let app_id = {
            let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
            registry
                .get(instance)
                .ok_or("App is closed.")?
                .permissions
                .app_id
                .clone()
        };
        Self::acquire_service(state, instance, &app_id, "code-tools", 1).await
    }
    pub(crate) async fn acquire_service(
        state: &MiniAppState,
        instance: &str,
        expected_app: &str,
        service: &'static str,
        protocol: u32,
    ) -> Result<Self, String> {
        #[cfg(not(target_os = "macos"))]
        return Err("Document services are unavailable on this device.".into());
        #[cfg(target_os = "macos")]
        {
            static SLOTS: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> =
                std::sync::OnceLock::new();
            let slot = if matches!(
                service,
                "file-search"
                    | "terminal"
                    | "code-tools"
                    | "peer-transport"
                    | "file-operations"
                    | "backup-archive"
            ) {
                None
            } else {
                Some(
                    SLOTS
                        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
                        .clone()
                        .try_acquire_owned()
                        .map_err(|_| "Document services are busy. Try again shortly.")?,
                )
            };
            let capability = match (service, expected_app) {
                ("document-processing", "files" | "library")
                | ("file-search" | "peer-transport", "files") => "files.read",
                ("file-operations", _) => "files.read",
                ("backup-archive", "backups") => "backups.manage",
                ("terminal", _) => "terminal.execute",
                ("code-tools", _) => "code.execute",
                _ => return Err("Invalid native service owner.".into()),
            };
            let (root, app_id, version, epoch, namespace, native_owner, mut changes) = {
                let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
                let app = registry.get(instance).ok_or("App is closed.")?;
                let p = &app.permissions;
                if !p.space_owned || p.owner_namespace.is_none() || p.app_id != expected_app {
                    return Err("The native service belongs to another app or Space.".into());
                }
                p.authorize(capability)?;
                if service == "peer-transport" {
                    p.authorize("connections.read")?;
                }
                if service == "code-tools" {
                    p.authorize("files.read")?;
                }
                (
                    app.root.clone(),
                    p.app_id.clone(),
                    p.version.clone(),
                    p.epoch,
                    p.owner_namespace.clone().ok_or("Missing app owner.")?,
                    p.native_owner.clone(),
                    p.cancellation.subscribe(),
                )
            };
            let flag = Arc::new(AtomicBool::new(false));
            let stop = flag.clone();
            let cancel = Cancellation {
                flag,
                watcher: tokio::spawn(async move {
                    let _ = changes.changed().await;
                    stop.store(true, Ordering::Release);
                }),
            };
            let installed_version = version.clone();
            let worker = tokio::task::spawn_blocking(move || {
                verified_service(&root, &app_id, &version, service, protocol)
            })
            .await
            .map_err(|_| "Processor verification failed.")??;
            let lease = Self {
                worker,
                namespace,
                cancel,
                epoch,
                capability,
                service,
                instance: instance.to_owned(),
                app_id: expected_app.to_owned(),
                version: installed_version,
                native_owner,
                _slot: slot,
            };
            lease.validate(state, instance)?;
            Ok(lease)
        }
    }
    #[cfg(any(desktop, target_os = "ios"))]
    pub(crate) fn peer_identity<'a>(
        &'a self,
        device_id: &'a str,
    ) -> Result<crate::infra::peer_identity::SpacePeerIdentity<'a>, String> {
        if !self.is_peer_transport() || self.cancelled() {
            return Err("Peer service access is unavailable.".into());
        }
        let owner = self
            .native_owner
            .as_ref()
            .ok_or("Missing native Space authority.")?;
        let generation = owner
            .authority_generation
            .filter(|value| *value > 0 && *value <= 9_007_199_254_740_991)
            .ok_or("Missing native authority generation.")?;
        Ok(crate::infra::peer_identity::SpacePeerIdentity {
            deployment: owner
                .deployment
                .as_deref()
                .filter(|v| !v.is_empty())
                .ok_or("Missing native deployment.")?,
            account_id: &owner.account_id,
            device_id,
            space_id: owner
                .space_id
                .as_deref()
                .filter(|v| !v.is_empty())
                .ok_or("Missing native Space.")?,
            installed_version: &self.version,
            authority_generation: generation as i64,
        })
    }
    pub(crate) fn is_peer_transport(&self) -> bool {
        self.service == "peer-transport"
            && self.app_id == "files"
            && self.capability == "files.read"
    }
    pub(crate) fn is_code_tools(&self) -> bool {
        self.service == "code-tools" && self.capability == "code.execute"
    }
    pub(crate) fn is_backup_runtime(&self) -> bool {
        self.service == "backup-archive"
    }
    pub(crate) fn is_terminal(&self) -> bool {
        self.service == "terminal" && self.capability == "terminal.execute"
    }
    pub(crate) fn validate(&self, state: &MiniAppState, instance: &str) -> Result<(), String> {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &registry.get(instance).ok_or("App is closed.")?.permissions;
        p.authorize(self.capability)?;
        if self.is_peer_transport() {
            p.authorize("connections.read")?;
        }
        if self.is_code_tools() {
            p.authorize("files.read")?;
        }
        if self.cancel.flag.load(Ordering::Acquire)
            || p.epoch != self.epoch
            || instance != self.instance
            || p.app_id != self.app_id
            || p.version != self.version
            || p.native_owner != self.native_owner
            || !p.space_owned
            || p.owner_namespace.as_deref() != Some(self.namespace.as_str())
        {
            return Err("Document service permission changed.".into());
        }
        Ok(())
    }
    pub(crate) fn cancel_operation(&self) {
        self.cancel.flag.store(true, Ordering::Release);
    }
    pub(crate) fn cancelled(&self) -> bool {
        self.cancel.flag.load(Ordering::Acquire)
    }
    pub(crate) fn cancel_on_drop(&self) -> CancelService {
        CancelService(self.cancel.flag.clone())
    }
    pub(crate) fn process(&self, path: &Path, operation: &str) -> Result<Value, String> {
        self.process_with_dimension(path, operation, None, None)
    }
    pub(crate) fn process_image(&self, path: &Path, dimension: u32) -> Result<Value, String> {
        self.process_with_dimension(path, "imagePreview", Some(dimension), None)
    }
    pub(crate) fn process_semantic(
        &self,
        path: &Path,
        operation: &str,
        extension: &str,
    ) -> Result<Value, String> {
        self.process_with_dimension(path, operation, None, Some(extension))
    }
    fn process_with_dimension(
        &self,
        path: &Path,
        operation: &str,
        max_dimension: Option<u32>,
        source_extension: Option<&str>,
    ) -> Result<Value, String> {
        self.process_with_output(path, operation, max_dimension, source_extension, None)
    }
    pub(crate) fn process_explorer_image(
        &self,
        path: &Path,
        dimension: u32,
    ) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        self.process_with_output(
            path,
            "explorerImage",
            Some(dimension),
            None,
            Some(&mut bytes),
        )?;
        Ok(bytes)
    }
    fn process_with_output(
        &self,
        path: &Path,
        operation: &str,
        max_dimension: Option<u32>,
        source_extension: Option<&str>,
        png_output: Option<&mut Vec<u8>>,
    ) -> Result<Value, String> {
        #[cfg(not(target_os = "macos"))]
        return Err("Document services are unavailable on this device.".into());
        #[cfg(target_os = "macos")]
        {
            if self.cancel.flag.load(Ordering::Acquire) {
                return Err("Document service cancelled.".into());
            }
            let display_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or("Invalid document name.")?
                .to_owned();
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("txt")
                .to_ascii_lowercase();
            if extension.len() > 16 || !extension.bytes().all(|c| c.is_ascii_alphanumeric()) {
                return Err("Invalid document extension.".into());
            }
            let file = File::open(path).map_err(|_| "Selected document is unavailable.")?;
            run_response(
                &self.worker,
                file,
                Input {
                    handle: String::new(),
                    display_name,
                    extension,
                },
                &self.cancel.flag,
                operation,
                max_dimension,
                source_extension,
                png_output,
            )
        }
    }
}

pub(crate) struct CancelService(Arc<AtomicBool>);
impl Drop for CancelService {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}
