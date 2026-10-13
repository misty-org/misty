//! Document processing runs in a confined worker bundled with Misty.
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    handle: String,
    display_name: String,
    extension: String,
}
fn verified_worker(root: &Path, app_id: &str, version: &str) -> Result<Vec<u8>, String> {
    verified_service(root, app_id, version, "document-processing", 5)
}

fn verified_service(
    _root: &Path,
    _tool: &str,
    _version: &str,
    service: &str,
    protocol: u32,
) -> Result<Vec<u8>, String> {
    #[cfg(test)]
    {
        let fixture = _root
            .join("native")
            .join(service)
            .join(format!(
                "{}-{}",
                std::env::consts::OS,
                std::env::consts::ARCH
            ))
            .join("worker");
        if fixture.is_file() {
            return std::fs::read(fixture).map_err(|error| error.to_string());
        }
    }
    #[cfg(any(target_os = "macos", windows))]
    return builtin_worker(service, protocol).map(|bytes| bytes.to_vec());
    #[cfg(not(any(target_os = "macos", windows)))]
    Err("Bundled workers are unavailable on this platform.".into())
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
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (state, instance, image_dimension);
        return Err("Isolated document processing is unavailable on this device.".into());
    }
    #[cfg(any(target_os = "macos", windows))]
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
            if p.owner_namespace.is_none() || !p.account_owned {
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
    let mut command = super::tool_sandbox::command(&executable, work.path())
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

/// Runs the worker on a private copy of `input`; Windows confines it in an
/// AppContainer (see `infra::document_worker_windows`).
#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
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
    use crate::infra::document_worker_windows::{run_file, Request};
    let (value, image) = run_file(
        worker,
        &input,
        &Request {
            display_name: &request.display_name,
            extension: &request.extension,
            operation,
            max_dimension,
            source_extension,
        },
        stop,
    )?;
    if let Some(image) = image {
        let target = png_output.ok_or("Missing image output receiver.")?;
        if stop.load(Ordering::Acquire) {
            return Err("Image processing cancelled.".into());
        }
        *target = image;
    }
    Ok(value)
}

#[cfg(any(target_os = "macos", windows))]
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
    fn service_receipt(root: &Path, bytes: &[u8], app_id: &str, service: &str, protocol: u32) {
        let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
        let directory = root.join("native").join(service).join(&platform);
        std::fs::create_dir_all(&directory).unwrap();
        let payload = serde_json::json!({"protocol":protocol,"service":service,"appId":app_id,"appVersion":"1","platform":platform,"sha256":format!("{:x}",Sha256::digest(bytes)),"bytes":bytes.len()}).to_string();
        // Deterministic fixture seed; never a development or release credential.
        let seed = [7u8; 32];
        let signature = SigningKey::from_bytes(&seed)
            .sign(format!("misty-native-service-v1\n{payload}").as_bytes());
        let envelope = serde_json::json!({"payload":payload,"signature":base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),"signatureKeyId":"misty-development-2026-01"});
        std::fs::write(directory.join("service.json"), envelope.to_string()).unwrap();
        std::fs::write(directory.join("worker"), bytes).unwrap();
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
        permissions.account_owned = true;
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
        // Workers are bundled with Misty, so the job may complete or fail on this
        // device; either way its read guard on the file must be released.
        let _ = execute(&state, "test", request.clone()).await;
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
            .account_owned = false;
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
            explorer_library::ExplorerLibraryService, transfers::TransferService,
        };
        let env = AppEnvironmentService::for_test_home(root.path().to_owned());
        let explorer = ExplorerService::new(
            env.clone(),
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
        state.0.lock().unwrap().remove("test");
        assert!(lease.validate(&state, "test").is_err());
        tokio::task::yield_now().await;
        assert!(lease
            .process(&input, "document")
            .unwrap_err()
            .contains("cancelled"));
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
    instance: String,
    app_id: String,
    version: String,
    native_owner: Option<super::super::NativeOwner>,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
impl ServiceLease {
    pub(crate) async fn acquire(
        state: &MiniAppState,
        instance: &str,
        expected_app: &str,
    ) -> Result<Self, String> {
        Self::acquire_service(state, instance, expected_app, "document-processing", 5).await
    }
    async fn acquire_service(
        state: &MiniAppState,
        instance: &str,
        expected_app: &str,
        service: &'static str,
        protocol: u32,
    ) -> Result<Self, String> {
        #[cfg(not(any(target_os = "macos", windows)))]
        return Err("Document services are unavailable on this device.".into());
        #[cfg(any(target_os = "macos", windows))]
        {
            static SLOTS: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> =
                std::sync::OnceLock::new();
            let slot = SLOTS
                .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
                .clone()
                .try_acquire_owned()
                .map_err(|_| "Document services are busy. Try again shortly.")?;
            let capability = match (service, expected_app) {
                ("document-processing", "files" | "library") => "files.read",
                _ => return Err("Invalid native service owner.".into()),
            };
            let (root, app_id, version, builtin, epoch, namespace, native_owner, mut changes) = {
                let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
                let app = registry.get(instance).ok_or("App is closed.")?;
                let p = &app.permissions;
                if !p.account_owned || p.owner_namespace.is_none() || p.app_id != expected_app {
                    return Err("The native service belongs to another app or Space.".into());
                }
                p.authorize(capability)?;
                (
                    app.root.clone(),
                    p.app_id.clone(),
                    p.version.clone(),
                    p.builtin,
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
                if builtin {
                    builtin_worker(service, protocol).map(|bytes| bytes.to_vec())
                } else {
                    verified_service(&root, &app_id, &version, service, protocol)
                }
            })
            .await
            .map_err(|_| "Processor verification failed.")??;
            let lease = Self {
                worker,
                namespace,
                cancel,
                epoch,
                capability,
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
    pub(crate) fn validate(&self, state: &MiniAppState, instance: &str) -> Result<(), String> {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &registry.get(instance).ok_or("App is closed.")?.permissions;
        p.authorize(self.capability)?;
        if self.cancel.flag.load(Ordering::Acquire)
            || p.epoch != self.epoch
            || instance != self.instance
            || p.app_id != self.app_id
            || p.version != self.version
            || p.native_owner != self.native_owner
            || !p.account_owned
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
        #[cfg(not(any(target_os = "macos", windows)))]
        return Err("Document services are unavailable on this device.".into());
        #[cfg(any(target_os = "macos", windows))]
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

#[cfg(any(target_os = "macos", windows))]
fn builtin_worker(service: &str, protocol: u32) -> Result<&'static [u8], String> {
    // Executable bytes are part of the signed Misty binary, never downloaded or
    // resolved from a user-controlled package directory.
    include!(concat!(env!("OUT_DIR"), "/builtin_workers.rs"))
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    fn input(name: &str, extension: &str) -> Input {
        Input {
            handle: String::new(),
            display_name: name.into(),
            extension: extension.into(),
        }
    }

    #[test]
    fn app_documents_and_previews_run_in_the_confined_worker() {
        let worker = builtin_worker("document-processing", 5).unwrap();
        let folder = tempfile::tempdir().unwrap();
        let stop = AtomicBool::new(false);
        let notes = folder.path().join("notes.txt");
        std::fs::write(&notes, "Quarterly notes\nRevenue grew.").unwrap();
        let document = run(
            worker,
            File::open(&notes).unwrap(),
            input("notes.txt", "txt"),
            &stop,
        )
        .unwrap();
        assert!(document.to_string().contains("Revenue grew."));
        let photo = folder.path().join("photo.png");
        image::RgbaImage::from_pixel(64, 48, image::Rgba([20, 40, 60, 255]))
            .save(&photo)
            .unwrap();
        let mut png = Vec::new();
        run_response(
            worker,
            File::open(&photo).unwrap(),
            input("photo.png", "png"),
            &stop,
            "explorerImage",
            Some(32),
            None,
            Some(&mut png),
        )
        .unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
    }
}
