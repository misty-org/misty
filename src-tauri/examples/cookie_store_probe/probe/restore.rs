//! The journalled import path driven by a real worker, with no network.
use super::*;

mod import;
mod logout;

pub(super) async fn staged_restore(a: &Webview, b: &Webview, a_id: &str, b_id: &str) -> Result<()> {
    use misty_browser_sync::{
        crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
        document::{self, Document},
        protocol::Event,
        store::Store,
        transport::SyncApi,
        worker::Worker,
    };
    // No sockets are accepted and no network pages are loaded. This drives
    // the real worker/SQLite import path while its transport is offline.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "probe listener")?;
    let base = format!(
        "http://{}",
        listener.local_addr().map_err(|_| "probe address")?
    );
    let directory = tempfile::tempdir().map_err(|_| "probe directory")?;
    let path = directory.path().join("sync.sqlite");
    let scope = VaultScope {
        deployment: base.clone(),
        account_id: "synthetic-probe".into(),
        vault_id: uuid::Uuid::new_v4().to_string(),
    };
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let grant = root
        .grant(&scope, &uuid::Uuid::new_v4().to_string(), 1, &device)
        .map_err(|_| "probe grant")?;
    let secret = generate_sync_secret();
    let wrapped = root
        .wrap(&scope, "synthetic-probe-password", &secret)
        .map_err(|_| "probe wrapper")?;
    let public = root.public_key().map_err(|_| "probe public identity")?;
    let mut store = Store::initialize(
        &path,
        scope.clone(),
        grant.clone(),
        &root,
        &device,
        &Document::default().encode().map_err(|_| "probe document")?,
    )
    .map_err(|_| "probe database")?;
    let target = serde_json::json!([fixture()]);
    let commit = |store: &mut Store,
                  root: &VaultRoot,
                  device: &DeviceKey,
                  sequence: u64,
                  payload: serde_json::Value|
     -> Result<()> {
        let bytes = serde_json::to_vec(&serde_json::json!({"kind":"credentials", "version":1, "batch":{"profile_id":a_id, "updates":[{"area":{"kind":"cookies"}, "base_sequence":sequence-1, "payload":payload}]}})).map_err(|_| "probe payload")?;
        let mutation = store
            .enqueue(root, device, &bytes)
            .map_err(|_| "probe enqueue")?;
        store
            .apply_events(
                root,
                &[(Event { mutation, sequence }, grant.clone())],
                document::reduce,
            )
            .map_err(|_| "probe replay")?;
        Ok(())
    };
    let mut expired = fixture();
    expired.name = "expired-synthetic-token".into();
    expired.expires_unix_seconds = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "probe clock")?
            .as_secs() as i64
            - 60,
    );
    commit(
        &mut store,
        &root,
        &device,
        1,
        serde_json::json!([fixture(), expired]),
    )?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = || SyncApi::new(&base, reqwest::Client::new()).map_err(|_| "probe API");
    let (worker, handle) =
        Worker::new(api()?, scope.clone(), root, device, store, document::reduce)
            .map_err(|_| "probe worker")?;
    let task = tokio::spawn(worker.run());
    let mut generation_views = Vec::new();
    let first = import::run(&handle, a, b, a_id, b_id, &target, &mut generation_views).await;
    handle.stop();
    task.await
        .map_err(|_| "first worker join")?
        .map_err(|_| "first worker shutdown")?;
    first?;
    let root = VaultRoot::unlock(
        &scope,
        &wrapped,
        "synthetic-probe-password",
        &secret,
        &public,
    )
    .map_err(|_| "probe unlock")?;
    let (mut store, device) =
        Store::unlock(&path, scope.clone(), &root).map_err(|_| "probe reopen")?;
    if store
        .browser_import_journal(&root, a_id)
        .map_err(|_| "probe receipt")?
        .applied
        .is_none()
    {
        return Err("verified receipt lost on restart");
    }
    commit(&mut store, &root, &device, 2, serde_json::json!([]))?;
    let (worker, handle) = Worker::new(api()?, scope, root, device, store, document::reduce)
        .map_err(|_| "second worker")?;
    let task = tokio::spawn(worker.run());
    let second = logout::run(&handle, a, b, a_id, b_id, &mut generation_views).await;
    handle.stop();
    task.await
        .map_err(|_| "second worker join")?
        .map_err(|_| "second worker shutdown")?;
    for view in generation_views {
        let _ = view.close();
    }
    second?;
    println!("PASS: encrypted worker journal drives native cookie replacement, profile isolation, restart receipt recovery, and explicit logout");
    println!("PASS: active profile verification uses actual cookie readback and preserves changed native values on mismatch");
    println!("PASS: native-allocated generations restore and activate after verification, recover mappings after worker restart, and preserve predecessor cookies during logout");
    println!("PASS: actual native cookie observations enter the encrypted worker outbox and coalesce while offline without replacing an unacknowledged operation");
    Ok(())
}
