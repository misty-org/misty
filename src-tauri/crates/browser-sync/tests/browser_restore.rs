use misty_browser_sync::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{self, CredentialRecord, Document},
    protocol::Event,
    restore::{
        restore_profile, restore_staged_profile, EngineError, QuiescentProfile, RestoreError,
        RestoreOutcome, StagedProfile,
    },
    store::Store,
    worker::{Worker, WorkerHandle},
};
use serde_json::json;
use uuid::Uuid;

struct Engine {
    physical: String,
    values: Vec<CredentialRecord>,
    unsupported: bool,
    timeout: bool,
    wrong_readback: bool,
    writes: usize,
}
impl Engine {
    fn new() -> Self {
        Self {
            physical: String::new(),
            values: vec![],
            unsupported: false,
            timeout: false,
            wrong_readback: false,
            writes: 0,
        }
    }
}
impl QuiescentProfile for Engine {
    async fn preflight(&mut self, _: &[CredentialRecord]) -> Result<(), EngineError> {
        if self.unsupported {
            Err(EngineError::Unsupported)
        } else {
            Ok(())
        }
    }
    async fn apply(&mut self, target: &[CredentialRecord]) -> Result<(), EngineError> {
        self.writes += 1;
        self.values = target.to_vec();
        if self.timeout {
            Err(EngineError::Timeout)
        } else {
            Ok(())
        }
    }
    async fn readback(
        &mut self,
        _: &[CredentialRecord],
    ) -> Result<Vec<CredentialRecord>, EngineError> {
        let mut result = self.values.clone();
        if self.wrong_readback {
            result[0].payload = json!([]);
        }
        Ok(result)
    }
}

async fn fixture(
    has_credentials: bool,
) -> (
    tempfile::TempDir,
    tokio::net::TcpListener,
    WorkerHandle,
    tokio::task::JoinHandle<misty_browser_sync::Result<()>>,
) {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let scope = VaultScope {
        deployment: base.clone(),
        account_id: "native-restore-test".into(),
        workspace_id: Uuid::new_v4().to_string(),
    };
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let mut store = Store::initialize(
        &dir.path().join("sync.sqlite"),
        scope.clone(),
        grant.clone(),
        &root,
        &device,
        &Document::default().encode().unwrap(),
    )
    .unwrap();
    if has_credentials {
        let payload = serde_json::to_vec(&json!({"kind":"credentials", "version":1, "batch":{"profile_id":"a".repeat(64), "updates":[{"area":{"kind":"cookies"}, "base_sequence":0, "payload":[{"name":"token", "value":"synthetic-secret", "domain":"example.test", "path":"/", "host_only":true, "secure":true, "http_only":true, "same_site":"lax", "expires_unix_seconds":null,"partition_key":null}]}]}})).unwrap();
        let mutation = store.enqueue(&root, &device, &payload).unwrap();
        store
            .apply_events(
                &root,
                &[(
                    Event {
                        mutation,
                        sequence: 1,
                    },
                    grant,
                )],
                document::reduce,
            )
            .unwrap();
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = misty_browser_sync::transport::SyncApi::new(&base, reqwest::Client::new()).unwrap();
    let (worker, handle) = Worker::new(api, scope, root, device, store, document::reduce).unwrap();
    let task = tokio::spawn(worker.run());
    (dir, listener, handle, task)
}

#[tokio::test]
async fn successful_readback_finishes_the_real_encrypted_journal() {
    let (_dir, _listener, worker, task) = fixture(true).await;
    let mut engine = Engine::new();
    let profile = "a".repeat(64);
    assert!(worker.imports_applied(1).await.is_err());
    assert!(matches!(
        restore_profile(&worker, &profile, &mut engine)
            .await
            .unwrap(),
        RestoreOutcome::Applied { sequence: 1 }
    ));
    let journal = worker.browser_import_journal(profile).await.unwrap();
    assert!(journal.pending.is_none());
    assert_eq!(journal.applied.unwrap().snapshot_sequence, 1);
    worker.imports_applied(1).await.unwrap();
    worker.stop();
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn unsupported_preflight_never_starts_a_restore_or_changes_browser_data() {
    let (_dir, _listener, worker, task) = fixture(true).await;
    let mut engine = Engine::new();
    engine.unsupported = true;
    let profile = "a".repeat(64);
    assert!(matches!(
        restore_profile(&worker, &profile, &mut engine).await,
        Err(RestoreError::Engine(EngineError::Unsupported))
    ));
    assert_eq!(engine.writes, 0);
    assert_eq!(
        worker
            .browser_import_journal(profile)
            .await
            .unwrap()
            .revision,
        0
    );
    worker.stop();
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn timed_out_or_mismatched_native_writes_quarantine_the_profile_and_block_retry() {
    for timeout in [true, false] {
        let (_dir, _listener, worker, task) = fixture(true).await;
        let mut engine = Engine::new();
        engine.timeout = timeout;
        engine.wrong_readback = !timeout;
        let profile = "a".repeat(64);
        assert!(restore_profile(&worker, &profile, &mut engine)
            .await
            .is_err());
        let journal = worker
            .browser_import_journal(profile.clone())
            .await
            .unwrap();
        assert!(journal.quarantined && journal.pending.is_some());
        assert!(worker.imports_applied(1).await.is_err());
        engine.timeout = false;
        engine.wrong_readback = false;
        assert!(matches!(
            restore_profile(&worker, &profile, &mut engine).await,
            Err(RestoreError::Quarantined)
        ));
        assert_eq!(engine.writes, 1);
        worker.stop();
        task.await.unwrap().unwrap();
    }
}

#[tokio::test]
async fn a_missing_area_does_not_mean_logout_and_pending_imports_resume_the_same_receipt() {
    let (_dir, _listener, worker, task) = fixture(false).await;
    let mut engine = Engine::new();
    assert!(matches!(
        restore_profile(&worker, &"a".repeat(64), &mut engine)
            .await
            .unwrap(),
        RestoreOutcome::NoCredentials { sequence: 0 }
    ));
    assert_eq!(engine.writes, 0);
    worker.stop();
    task.await.unwrap().unwrap();
    let (_dir, _listener, worker, task) = fixture(true).await;
    let profile = "a".repeat(64);
    let id = Uuid::new_v4().to_string();
    worker
        .begin_browser_import(profile.clone(), 0, id.clone(), 1)
        .await
        .unwrap();
    restore_profile(&worker, &profile, &mut engine)
        .await
        .unwrap();
    assert_eq!(
        worker
            .browser_import_journal(profile)
            .await
            .unwrap()
            .applied
            .unwrap()
            .id,
        id
    );
    worker.stop();
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn canceling_a_native_write_quarantines_before_another_import_can_read_the_journal() {
    struct BlockedEngine(Option<tokio::sync::oneshot::Sender<()>>);
    impl QuiescentProfile for BlockedEngine {
        async fn preflight(&mut self, _: &[CredentialRecord]) -> Result<(), EngineError> {
            Ok(())
        }
        async fn apply(&mut self, _: &[CredentialRecord]) -> Result<(), EngineError> {
            self.0.take().unwrap().send(()).unwrap();
            std::future::pending().await
        }
        async fn readback(
            &mut self,
            _: &[CredentialRecord],
        ) -> Result<Vec<CredentialRecord>, EngineError> {
            unreachable!()
        }
    }
    let (_dir, _listener, worker, task) = fixture(true).await;
    let (started, entered) = tokio::sync::oneshot::channel();
    let clone = worker.clone();
    let import = tokio::spawn(async move {
        restore_profile(&clone, &"a".repeat(64), &mut BlockedEngine(Some(started))).await
    });
    entered.await.unwrap();
    import.abort();
    assert!(import.await.unwrap_err().is_cancelled());
    let journal = worker.browser_import_journal("a".repeat(64)).await.unwrap();
    assert!(journal.quarantined && journal.pending.is_some());
    assert!(matches!(
        restore_profile(&worker, &"a".repeat(64), &mut Engine::new()).await,
        Err(RestoreError::Quarantined)
    ));
    assert!(worker.imports_applied(1).await.is_err());
    worker.stop();
    task.await.unwrap().unwrap();
}

impl StagedProfile for Engine {
    fn physical_id(&self) -> &str {
        &self.physical
    }
}

#[tokio::test]
async fn staged_restore_gates_capture_and_readiness_until_verified_activation() {
    let (_dir, _listener, worker, task) = fixture(true).await;
    let profile = "a".repeat(64);
    let id = Uuid::new_v4().to_string();
    let stage = worker
        .stage_browser_profile(profile.clone(), 0, id.clone())
        .await
        .unwrap();
    let capture = || {
        zeroize::Zeroizing::new(serde_json::to_vec(&json!({"kind":"credentials", "version":1,"batch":{"profile_id":profile,"updates":[{"area":{"kind":"cookies"},"base_sequence":1,"payload":[]}]}})).unwrap())
    };
    assert!(worker.enqueue(capture()).await.is_err());
    let mut engine = Engine::new();
    // Logical ID, retired stage, or arbitrary backend cannot consume the stage.
    assert!(restore_staged_profile(&worker, &profile, &id, &mut engine)
        .await
        .is_err());
    engine.physical = stage.staged.unwrap().physical_id;
    assert!(restore_profile(&worker, &profile, &mut engine)
        .await
        .is_err());
    assert_eq!(engine.writes, 0);
    restore_staged_profile(&worker, &profile, &id, &mut engine)
        .await
        .unwrap();
    assert!(worker.imports_applied(1).await.is_err());
    assert!(worker.enqueue(capture()).await.is_err());
    // Lost successful restore response re-verifies actual values without writes.
    restore_staged_profile(&worker, &profile, &id, &mut engine)
        .await
        .unwrap();
    assert_eq!(engine.writes, 1);
    worker
        .activate_browser_profile(profile.clone(), stage.revision, id)
        .await
        .unwrap();
    worker.imports_applied(1).await.unwrap();
    worker.enqueue(capture()).await.unwrap();
    worker.stop();
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn quarantined_restore_recovery_uses_a_fresh_physical_store() {
    let (_dir, _listener, worker, task) = fixture(true).await;
    let profile = "a".repeat(64);
    let old = Uuid::new_v4().to_string();
    let stage = worker
        .stage_browser_profile(profile.clone(), 0, old.clone())
        .await
        .unwrap();
    let mut failed = Engine::new();
    failed.physical = stage.staged.unwrap().physical_id;
    failed.timeout = true;
    assert!(restore_staged_profile(&worker, &profile, &old, &mut failed)
        .await
        .is_err());
    let fresh = Uuid::new_v4().to_string();
    let stage = worker
        .stage_browser_profile(profile.clone(), 1, fresh.clone())
        .await
        .unwrap();
    assert!(
        restore_staged_profile(&worker, &profile, &fresh, &mut failed)
            .await
            .is_err()
    );
    let mut recovered = Engine::new();
    recovered.physical = stage.staged.unwrap().physical_id;
    assert_ne!(recovered.physical, failed.physical);
    restore_staged_profile(&worker, &profile, &fresh, &mut recovered)
        .await
        .unwrap();
    worker
        .activate_browser_profile(profile, stage.revision, fresh)
        .await
        .unwrap();
    worker.imports_applied(1).await.unwrap();
    worker.stop();
    task.await.unwrap().unwrap();
}
