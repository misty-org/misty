//! Restic's repository protocol, backed only by a retained chosen-folder handle.
//! This is a native worker endpoint, never an App capability or public server.
//! The Backups capability migration will own the server and revoke it with its job.
#![allow(dead_code)] // Foundation for the in-progress Backups capability migration.
use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{header, Method, Request, StatusCode},
    response::Response,
    Router,
};
use base64::Engine;
use cap_std::fs::{Dir, OpenOptions};
use serde_json::json;
use std::{
    io::{Read, Seek, SeekFrom, Write},
    sync::{Arc, Mutex, RwLock},
};
use tokio::sync::{oneshot, Semaphore};

const MAX_BLOB: usize = 64 * 1024 * 1024;
const MAX_LIST: usize = 250_000;
const TYPES: &[&str] = &["data", "keys", "locks", "snapshots", "index"];
const V2: &str = "application/vnd.x.restic.rest.v2";

struct Repository {
    directory: Arc<Dir>,
    active: RwLock<bool>,
    authorization: String,
    slots: Arc<Semaphore>,
    snapshot: Mutex<Option<SnapshotTransaction>>,
}

#[derive(Default)]
struct SnapshotTransaction {
    input_complete: bool,
    pending: Option<(String, Vec<u8>)>,
}

#[derive(Clone)]
pub(super) struct SnapshotCommitPermit(Arc<Repository>);
impl SnapshotCommitPermit {
    pub(super) fn begin(&self) {
        if let Ok(mut transaction) = self.0.snapshot.lock() {
            *transaction = Some(SnapshotTransaction::default());
        }
    }
    pub(super) fn input_complete(&self) {
        if let Ok(mut transaction) = self.0.snapshot.lock() {
            if let Some(transaction) = transaction.as_mut() {
                transaction.input_complete = true;
            }
        }
    }
    pub(super) fn finalize(&self) -> Result<(), String> {
        let pending = self
            .0
            .snapshot
            .lock()
            .map_err(|_| "Snapshot transaction unavailable.")?
            .take()
            .and_then(|transaction| transaction.pending)
            .ok_or("Restic did not finish a snapshot transaction.")?;
        let status = execute(
            &self.0.directory,
            Method::POST,
            &format!("/snapshots/{}", pending.0),
            None,
            None,
            &pending.1,
        )
        .map_err(|_| "Could not publish the completed snapshot.")?
        .status();
        if status == StatusCode::OK {
            Ok(())
        } else {
            Err("Could not publish the completed snapshot.".into())
        }
    }
}

pub struct RepositoryServer {
    repository: Arc<Repository>,
    endpoint: String,
    stop: Option<oneshot::Sender<()>>,
}
impl RepositoryServer {
    pub(super) fn snapshot_commit_permit(&self) -> SnapshotCommitPermit {
        SnapshotCommitPermit(self.repository.clone())
    }
    /// Only the native owner may pass this URL to a restricted worker process.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
    pub async fn start(directory: Arc<Dir>) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "Could not start the private backup repository connection.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "Repository connection unavailable.")?
            .port();
        let password = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let authorization = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!("misty:{password}"))
        );
        let repository = Arc::new(Repository {
            directory,
            active: RwLock::new(true),
            authorization,
            slots: Arc::new(Semaphore::new(2)),
            snapshot: Mutex::new(None),
        });
        let router = Router::new()
            .fallback(request)
            .with_state(repository.clone());
        let (stop, stopped) = oneshot::channel();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await;
        });
        Ok(Self {
            repository,
            endpoint: format!("rest:http://misty:{password}@127.0.0.1:{port}/"),
            stop: Some(stop),
        })
    }
    /// Waits for current bounded filesystem operations, then denies queued work.
    /// Call off the UI thread. No repository credentials survive into another job.
    pub fn revoke(&mut self) {
        if let Ok(mut active) = self.repository.active.write() {
            *active = false;
        }
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}
impl Drop for RepositoryServer {
    fn drop(&mut self) {
        self.revoke();
    }
}

fn response(status: StatusCode, body: impl Into<Body>) -> Response {
    Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body.into())
        .unwrap()
}
fn error(status: StatusCode) -> Response {
    response(status, Body::empty())
}

async fn request(State(repository): State<Arc<Repository>>, request: Request<Body>) -> Response {
    if request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        != Some(repository.authorization.as_str())
    {
        return error(StatusCode::UNAUTHORIZED);
    }
    // Reject browser-originated fetches as well as requiring the per-job token.
    if request.headers().contains_key(header::ORIGIN) {
        return error(StatusCode::FORBIDDEN);
    }
    let slot = match repository.slots.clone().try_acquire_owned() {
        Ok(slot) => slot,
        Err(_) => return error(StatusCode::TOO_MANY_REQUESTS),
    };
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let query = request.uri().query().map(str::to_owned);
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let body = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        to_bytes(request.into_body(), MAX_BLOB),
    )
    .await
    {
        Ok(Ok(body)) => body,
        Ok(Err(_)) => return error(StatusCode::PAYLOAD_TOO_LARGE),
        Err(_) => return error(StatusCode::REQUEST_TIMEOUT),
    };
    tokio::task::spawn_blocking(move || {
        let _slot = slot;
        let active = match repository.active.read() {
            Ok(guard) => guard,
            Err(_) => return error(StatusCode::GONE),
        };
        if !*active {
            return error(StatusCode::GONE);
        }
        if method == Method::POST && path.starts_with("/snapshots/") {
            let Some(id) = path.strip_prefix("/snapshots/").filter(|id| valid_id(id)) else {
                return error(StatusCode::BAD_REQUEST);
            };
            if query.is_some() || range.is_some() || body.is_empty() {
                return error(StatusCode::BAD_REQUEST);
            }
            let Ok(mut transaction) = repository.snapshot.lock() else {
                return error(StatusCode::INTERNAL_SERVER_ERROR);
            };
            let Some(transaction) = transaction
                .as_mut()
                .filter(|transaction| transaction.input_complete)
            else {
                return error(StatusCode::FORBIDDEN);
            };
            return match &transaction.pending {
                None => {
                    transaction.pending = Some((id.to_owned(), body.to_vec()));
                    error(StatusCode::OK)
                }
                Some((existing_id, existing))
                    if existing_id == id && existing.as_slice() == body.as_ref() =>
                {
                    error(StatusCode::OK)
                }
                Some(_) => error(StatusCode::CONFLICT),
            };
        }
        execute(
            &repository.directory,
            method,
            &path,
            query.as_deref(),
            range.as_deref(),
            &body,
        )
        .unwrap_or_else(|_| error(StatusCode::INTERNAL_SERVER_ERROR))
    })
    .await
    .unwrap_or_else(|_| error(StatusCode::INTERNAL_SERVER_ERROR))
}

fn valid_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn io_status(cause: std::io::Error) -> Response {
    error(match cause.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::FORBIDDEN,
    })
}
fn directory(parent: &Dir, name: &str, create: bool) -> std::io::Result<Dir> {
    if create {
        match parent.create_dir(name) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
    }
    if !parent.symlink_metadata(name)?.is_dir() {
        return Err(std::io::ErrorKind::PermissionDenied.into());
    }
    parent.open_dir(name)
}
fn object_directory(root: &Dir, kind: &str, id: &str, create: bool) -> std::io::Result<Dir> {
    if kind == "config" {
        return root.try_clone();
    }
    let dir = directory(root, kind, create)?;
    if kind == "data" {
        directory(&dir, &id[..2], create)
    } else {
        Ok(dir)
    }
}
fn read_file(dir: &Dir, name: &str) -> std::io::Result<std::fs::File> {
    if !dir.symlink_metadata(name)?.is_file() {
        return Err(std::io::ErrorKind::PermissionDenied.into());
    }
    // cap-std keeps all path resolution within the retained directory even if
    // entries are replaced after the metadata check. Never open an ambient path.
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let file = dir.open_with(name, &options)?.into_std();
    if !file.metadata()?.is_file() {
        return Err(std::io::ErrorKind::PermissionDenied.into());
    }
    Ok(file)
}

fn execute(
    root: &Dir,
    method: Method,
    path: &str,
    query: Option<&str>,
    range: Option<&str>,
    body: &[u8],
) -> std::io::Result<Response> {
    if path == "/" {
        if method == Method::POST && query == Some("create=true") {
            for name in TYPES {
                directory(root, name, true)?;
            }
            return Ok(error(StatusCode::OK));
        }
        // App-facing operations do not include repository destruction or prune.
        return Ok(error(StatusCode::FORBIDDEN));
    }
    if query.is_some() {
        return Ok(error(StatusCode::BAD_REQUEST));
    }
    let parts: Vec<_> = path.strip_prefix('/').unwrap_or("").split('/').collect();
    let (kind, id) = match parts.as_slice() {
        ["config"] => ("config", "config"),
        [kind, ""] if TYPES.contains(kind) && method == Method::GET => return list(root, kind),
        [kind, id] if TYPES.contains(kind) && valid_id(id) => (*kind, *id),
        _ => return Ok(error(StatusCode::BAD_REQUEST)),
    };
    if ![Method::GET, Method::HEAD, Method::POST, Method::DELETE].contains(&method) {
        return Ok(error(StatusCode::METHOD_NOT_ALLOWED));
    }
    if method == Method::DELETE && kind != "locks" {
        return Ok(error(StatusCode::FORBIDDEN));
    }
    let dir = match object_directory(root, kind, id, method == Method::POST) {
        Ok(dir) => dir,
        Err(e) => return Ok(io_status(e)),
    };
    if method == Method::DELETE {
        return Ok(match dir.remove_file(id) {
            Ok(()) => error(StatusCode::OK),
            Err(e) => io_status(e),
        });
    }
    if method == Method::POST {
        if body.is_empty() || body.len() > MAX_BLOB {
            return Ok(error(StatusCode::PAYLOAD_TOO_LARGE));
        }
        let temp = format!(".misty-upload-{}", uuid::Uuid::new_v4().simple());
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let result = (|| {
            let mut file = dir.open_with(&temp, &options)?;
            file.write_all(body)?;
            file.sync_all()?;
            // Immutable publish: no overwrite of another object or a symlink.
            match dir.hard_link(&temp, &dir, id) {
                Ok(()) => Ok(error(StatusCode::OK)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let existing = read_file(&dir, id)?;
                    if existing.metadata()?.len() != body.len() as u64 {
                        return Ok(error(StatusCode::CONFLICT));
                    }
                    let mut bytes = Vec::new();
                    existing.take(MAX_BLOB as u64 + 1).read_to_end(&mut bytes)?;
                    Ok(error(if bytes == body {
                        StatusCode::OK
                    } else {
                        StatusCode::CONFLICT
                    }))
                }
                Err(e) => Err(e),
            }
        })();
        let _ = dir.remove_file(&temp);
        return result;
    }
    let mut file = match read_file(&dir, id) {
        Ok(file) => file,
        Err(e) => return Ok(io_status(e)),
    };
    let size = file.metadata()?.len();
    if size > MAX_BLOB as u64 {
        return Ok(error(StatusCode::PAYLOAD_TOO_LARGE));
    }
    if method == Method::HEAD {
        let mut response = error(StatusCode::OK);
        response
            .headers_mut()
            .insert(header::CONTENT_LENGTH, size.into());
        return Ok(response);
    }
    let (start, end, partial) = match range {
        None => (0, size, false),
        Some(range) => match byte_range(range, size) {
            Some((start, end)) => (start, end, true),
            None => return Ok(error(StatusCode::RANGE_NOT_SATISFIABLE)),
        },
    };
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::with_capacity((end - start) as usize);
    file.take(end - start).read_to_end(&mut bytes)?;
    if bytes.len() as u64 != end - start {
        return Ok(error(StatusCode::CONFLICT));
    }
    let mut result = response(
        if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        },
        bytes,
    );
    result.headers_mut().insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().unwrap(),
    );
    if partial {
        result.headers_mut().insert(
            header::CONTENT_RANGE,
            format!("bytes {start}-{}/{size}", end - 1).parse().unwrap(),
        );
    }
    Ok(result)
}
fn byte_range(range: &str, size: u64) -> Option<(u64, u64)> {
    let (start, end) = range.strip_prefix("bytes=")?.split_once('-')?;
    let start: u64 = start.parse().ok()?;
    let end = if end.is_empty() {
        size
    } else {
        end.parse::<u64>().ok()?.checked_add(1)?.min(size)
    };
    (start < end && end <= size).then_some((start, end))
}
fn list(root: &Dir, kind: &str) -> std::io::Result<Response> {
    let dir = match directory(root, kind, false) {
        Ok(dir) => dir,
        Err(e) => return Ok(io_status(e)),
    };
    let mut rows = Vec::new();
    let mut pending = vec![(dir, kind == "data")];
    let mut visited = 0usize;
    while let Some((dir, shards)) = pending.pop() {
        for entry in dir.entries()? {
            visited += 1;
            if visited > MAX_LIST {
                return Ok(error(StatusCode::PAYLOAD_TOO_LARGE));
            }
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let kind_of_file = entry.file_type()?;
            if shards
                && name.len() == 2
                && name.bytes().all(|b| b.is_ascii_hexdigit())
                && kind_of_file.is_dir()
            {
                pending.push((directory(&dir, name, false)?, false));
            } else if valid_id(name) && kind_of_file.is_file() {
                rows.push(json!({"name":name,"size":entry.metadata()?.len()}));
            }
        }
    }
    let mut result = response(StatusCode::OK, serde_json::to_vec(&rows)?);
    result
        .headers_mut()
        .insert(header::CONTENT_TYPE, V2.parse().unwrap());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn chosen(path: &std::path::Path) -> Arc<Dir> {
        Arc::new(Dir::open_ambient_dir(path, cap_std::ambient_authority()).unwrap())
    }
    fn call(root: &Dir, method: Method, path: &str, body: &[u8]) -> Response {
        execute(root, method, path, None, None, body).unwrap()
    }

    #[test]
    fn strict_object_paths_immutable_publish_and_non_destructive_operations() {
        let fixture = tempfile::tempdir().unwrap();
        let root = chosen(fixture.path());
        assert_eq!(
            execute(&root, Method::POST, "/", Some("create=true"), None, b"")
                .unwrap()
                .status(),
            StatusCode::OK
        );
        let id = "ab".repeat(32);
        let path = format!("/data/{id}");
        assert_eq!(
            call(&root, Method::POST, &path, b"encrypted fixture").status(),
            StatusCode::OK
        );
        assert_eq!(
            call(&root, Method::POST, &path, b"encrypted fixture").status(),
            StatusCode::OK
        );
        assert_eq!(
            call(&root, Method::POST, &path, b"replacement").status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            call(&root, Method::HEAD, &path, b"").headers()[header::CONTENT_LENGTH],
            "17"
        );
        for path in [
            "/data/../config",
            "/data/%2e%2e",
            "/data//config",
            "/outside/",
            "/keys/short",
        ] {
            assert_eq!(
                call(&root, Method::POST, path, b"x").status(),
                StatusCode::BAD_REQUEST,
                "{path}"
            );
        }
        assert_eq!(
            call(&root, Method::DELETE, &path, b"").status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(&root, Method::DELETE, "/", b"").status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(byte_range("bytes=2-4", 17), Some((2, 5)));
        assert_eq!(byte_range("bytes=14-", 17), Some((14, 17)));
        for range in [
            "bytes=17-",
            "bytes=-4",
            "bytes=4-2",
            "bytes=0-1,4-5",
            "bytes=0-18446744073709551615",
        ] {
            assert_eq!(byte_range(range, 17), None);
        }
        assert!(fixture.path().join(format!("data/ab/{id}")).exists());
    }

    #[cfg(unix)]
    #[test]
    fn retained_root_and_object_checks_resist_replacements_and_symlinks() {
        use std::os::unix::fs::symlink;
        let fixture = tempfile::tempdir().unwrap();
        let path = fixture.path().join("chosen");
        std::fs::create_dir(&path).unwrap();
        let root = chosen(&path);
        let moved = fixture.path().join("moved");
        std::fs::rename(&path, &moved).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert_eq!(
            call(&root, Method::POST, "/config", b"original choice").status(),
            StatusCode::OK
        );
        assert_eq!(
            std::fs::read(moved.join("config")).unwrap(),
            b"original choice"
        );
        assert!(!path.join("config").exists());
        let outside = fixture.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        symlink(&outside, moved.join("keys")).unwrap();
        assert!(call(
            &root,
            Method::POST,
            &format!("/keys/{}", "cd".repeat(32)),
            b"no"
        )
        .status()
        .is_client_error());
        std::fs::remove_file(moved.join("config")).unwrap();
        std::fs::write(outside.join("private"), b"ungranted").unwrap();
        symlink(outside.join("private"), moved.join("config")).unwrap();
        assert_eq!(
            call(&root, Method::GET, "/config", b"").status(),
            StatusCode::FORBIDDEN
        );
        assert!(execute(&root, Method::POST, "/config", None, None, b"overwrite").is_err());
        assert_eq!(
            std::fs::read(outside.join("private")).unwrap(),
            b"ungranted"
        );
    }

    #[tokio::test]
    async fn authentication_origin_checks_ranges_and_revocation() {
        let fixture = tempfile::tempdir().unwrap();
        let mut server = RepositoryServer::start(chosen(fixture.path()))
            .await
            .unwrap();
        let url = url::Url::parse(server.endpoint().strip_prefix("rest:").unwrap()).unwrap();
        let token = url.password().unwrap().to_owned();
        let clean = format!("http://127.0.0.1:{}/config", url.port().unwrap());
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert_eq!(
            client.get(&clean).send().await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .get(&clean)
                .basic_auth("misty", Some(&token))
                .header("Origin", "null")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            client
                .post(&clean)
                .basic_auth("misty", Some(&token))
                .body("encrypted")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        let partial = client
            .get(&clean)
            .basic_auth("misty", Some(&token))
            .header("Range", "bytes=2-4")
            .send()
            .await
            .unwrap();
        assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(partial.headers()[header::CONTENT_RANGE], "bytes 2-4/9");
        assert_eq!(partial.text().await.unwrap(), "cry");
        // Keep the listener alive to prove authority revocation, independent of TCP shutdown.
        *server.repository.active.write().unwrap() = false;
        assert_eq!(
            client
                .get(&clean)
                .basic_auth("misty", Some(&token))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::GONE
        );
        server.revoke();
    }

    #[tokio::test]
    async fn snapshots_require_native_confirmation_of_complete_input() {
        let fixture = tempfile::tempdir().unwrap();
        let server = RepositoryServer::start(chosen(fixture.path()))
            .await
            .unwrap();
        let permit = server.snapshot_commit_permit();
        let publish = |id: String| {
            let repository = server.repository.clone();
            let request = Request::builder()
                .method(Method::POST)
                .uri(format!("/snapshots/{id}"))
                .header(header::AUTHORIZATION, &repository.authorization)
                .body(Body::from("encrypted snapshot fixture"))
                .unwrap();
            async move { super::request(State(repository), request).await.status() }
        };
        assert_eq!(publish("aa".repeat(32)).await, StatusCode::FORBIDDEN);
        assert_eq!(std::fs::read_dir(fixture.path()).unwrap().count(), 0);
        permit.begin();
        permit.input_complete();
        assert_eq!(publish("aa".repeat(32)).await, StatusCode::OK);
        assert!(!fixture
            .path()
            .join("snapshots")
            .join("aa".repeat(32))
            .exists());
        permit.finalize().unwrap();
        assert!(fixture
            .path()
            .join("snapshots")
            .join("aa".repeat(32))
            .exists());
        permit.begin();
        assert_eq!(publish("bb".repeat(32)).await, StatusCode::FORBIDDEN);
        assert!(!fixture
            .path()
            .join("snapshots")
            .join("bb".repeat(32))
            .exists());
    }

    #[tokio::test]
    async fn revocation_during_upload_prevents_late_publication() {
        let fixture = tempfile::tempdir().unwrap();
        let mut server = RepositoryServer::start(chosen(fixture.path()))
            .await
            .unwrap();
        let (started, entered) = oneshot::channel();
        let (resume, resumed) = oneshot::channel();
        let body = Body::from_stream(async_stream::stream! {
            let _ = started.send(());
            yield Ok::<_,std::io::Error>("first bytes");
            let _ = resumed.await;
            yield Ok::<_,std::io::Error>("remaining bytes");
        });
        let pending = Request::builder()
            .method(Method::POST)
            .uri("/config")
            .header(header::AUTHORIZATION, &server.repository.authorization)
            .body(body)
            .unwrap();
        let owner = server.repository.clone();
        let result = tokio::spawn(async move { request(State(owner), pending).await });
        entered.await.unwrap();
        server.revoke();
        resume.send(()).unwrap();
        assert_eq!(result.await.unwrap().status(), StatusCode::GONE);
        assert!(!fixture.path().join("config").exists());
        assert_eq!(std::fs::read_dir(fixture.path()).unwrap().count(), 0);
    }

    #[cfg(target_os = "macos")]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_restic_repository_init_backup_list_check_and_restore() {
        let tool = std::path::Path::new("/opt/homebrew/bin/restic")
            .canonicalize()
            .expect("Install Restic to exercise the backup integration");
        let fixture = tempfile::tempdir().unwrap();
        let root = chosen(fixture.path());
        let server = RepositoryServer::start(root).await.unwrap();
        let endpoint = server.endpoint().to_owned();
        let commit = server.snapshot_commit_permit();
        let local_repository = fixture.path().to_owned();
        tokio::task::spawn_blocking(move || {
            let work = tempfile::tempdir().unwrap();
            let run = |args: &[&str], input: Option<&[u8]>| {
                let mut command = super::super::backup_process::command(
                    &tool,
                    work.path(),
                    &endpoint,
                    "test-fixture-password",
                )
                .unwrap();
                command
                    .args(args)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());
                let mut child = command.spawn().unwrap();
                if let Some(input) = input {
                    child.stdin.take().unwrap().write_all(input).unwrap();
                } else {
                    drop(child.stdin.take());
                }
                let output = child.wait_with_output().unwrap();
                assert!(
                    output.status.success(),
                    "Restic {:?}: {}",
                    args,
                    String::from_utf8_lossy(&output.stderr)
                );
                output.stdout
            };
            run(&["init"], None);
            // This fixture sends a complete, known byte slice. Production streaming
            // opens the gate only after validating and finishing its archive input.
            commit.begin();
            commit.input_complete();
            run(
                &[
                    "backup",
                    "--stdin",
                    "--stdin-filename",
                    "fixture.txt",
                    "--host",
                    "misty-test",
                    "--json",
                ],
                Some(b"backup round trip"),
            );
            commit.finalize().unwrap();
            let snapshots: serde_json::Value =
                serde_json::from_slice(&run(&["snapshots", "--json"], None)).unwrap();
            assert_eq!(snapshots.as_array().unwrap().len(), 1);
            run(&["check", "--read-data"], None);
            assert_eq!(
                run(&["dump", "latest", "/fixture.txt"], None),
                b"backup round trip"
            );
            // Independent compatibility control: standard local Restic must read
            // the repository produced through the retained-handle REST service.
            let local = std::process::Command::new(&tool)
                .env_clear()
                .env("HOME", work.path())
                .env("TMPDIR", work.path())
                .env("PATH", "/usr/bin:/bin")
                .env("RESTIC_PASSWORD", "test-fixture-password")
                .arg("--no-cache")
                .arg("-r")
                .arg(&local_repository)
                .args(["check", "--read-data"])
                .output()
                .unwrap();
            assert!(
                local.status.success(),
                "Local-format compatibility: {}",
                String::from_utf8_lossy(&local.stderr)
            );
        })
        .await
        .unwrap();
        drop(server);
    }
}
