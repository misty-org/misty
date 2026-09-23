use misty_browser_sync::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{self, credentials::Area, Document, Payload},
    protocol::{DeviceGrant, Event},
    store::{BrowserCaptureState as State, BrowserObservation, Store},
};
use serde_json::{json, Value};
use uuid::Uuid;
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn profile() -> String {
    "a".repeat(64)
}
fn cookies(value: &str) -> Value {
    json!([{"name":"session","value":value,"domain":"example.test","path":"/","host_only":true,"secure":true,"http_only":true,"same_site":"lax","expires_unix_seconds":null,"partition_key":null}])
}
fn observed(value: Value) -> Vec<BrowserObservation> {
    vec![BrowserObservation {
        area: Area::Cookies,
        payload: value,
    }]
}
struct Fixture {
    dir: tempfile::TempDir,
    root: VaultRoot,
    device: DeviceKey,
    grant: DeviceGrant,
    scope: VaultScope,
    store: Store,
    generation: String,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = VaultRoot::generate();
        let device = DeviceKey::generate();
        let scope = VaultScope {
            deployment: "https://sync.example.test".into(),
            account_id: "owner".into(),
            workspace_id: id(),
        };
        let grant = root.grant(&scope, &id(), 1, &device).unwrap();
        let mut store = Store::initialize(
            &dir.path().join("sync.sqlite"),
            scope.clone(),
            grant.clone(),
            &root,
            &device,
            &Document::default().encode().unwrap(),
        )
        .unwrap();
        let payload=serde_json::to_vec(&json!({"kind":"credentials","version":1,"batch":{"profile_id":profile(),"updates":[{"area":{"kind":"cookies"},"base_sequence":0,"payload":cookies("initial-secret")}]}})).unwrap();
        let mutation = store.enqueue(&root, &device, &payload).unwrap();
        store
            .apply_events(
                &root,
                &[(
                    Event {
                        mutation,
                        sequence: 1,
                    },
                    grant.clone(),
                )],
                document::reduce,
            )
            .unwrap();
        let generation = id();
        let binding = store
            .stage_browser_profile(&root, &profile(), 0, &generation)
            .unwrap();
        let journal = store
            .begin_browser_import(&root, &profile(), 0, &generation, 1)
            .unwrap();
        store
            .finish_browser_import(
                &root,
                &profile(),
                journal.revision,
                &generation,
                &journal.pending.unwrap().credentials,
            )
            .unwrap();
        store
            .activate_browser_profile(&root, &profile(), binding.revision, &generation)
            .unwrap();
        Self {
            dir,
            root,
            device,
            grant,
            scope,
            store,
            generation,
        }
    }
    fn observe(&mut self, value: Value) -> State {
        self.store
            .observe_browser_profile(
                &self.root,
                &self.device,
                &profile(),
                &self.generation,
                observed(value),
            )
            .unwrap()
    }
    fn accept(&mut self) {
        let mutation = self.store.pending(false, 1).unwrap().remove(0);
        let sequence = self.store.applied_sequence().unwrap() + 1;
        self.store
            .apply_events(
                &self.root,
                &[(Event { mutation, sequence }, self.grant.clone())],
                document::reduce,
            )
            .unwrap();
        self.store
            .resume_browser_captures(&self.root, &self.device)
            .unwrap();
    }
    fn payload(&self) -> Value {
        let d: Document =
            serde_json::from_slice(&self.store.committed_snapshot(&self.root).unwrap()).unwrap();
        d.credentials.values().next().unwrap().payload.clone()
    }
}
#[test]
fn coalesces_offline_observations_and_recovers_stable_outbox_intent() {
    let mut f = Fixture::new();
    assert_eq!(f.observe(cookies("first-secret")), State::Queued);
    let first = f.store.pending(false, 10).unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(f.observe(cookies("latest-secret")), State::Queued);
    assert_eq!(f.store.pending_count().unwrap(), 1);
    let path = f.dir.path().join("sync.sqlite");
    drop(f.store);
    let (store, _) = Store::unlock(&path, f.scope.clone(), &f.root).unwrap();
    f.store = store;
    f.store.resume_browser_captures(&f.root, &f.device).unwrap();
    assert_eq!(
        f.store.pending(false, 10).unwrap()[0].operation_id,
        first[0].operation_id
    );
    f.accept();
    assert_eq!(f.payload(), cookies("first-secret"));
    let second = f.store.pending(false, 10).unwrap();
    assert_eq!(second.len(), 1);
    let raw = f
        .root
        .open_mutation(&f.scope, &f.grant, &second[0])
        .unwrap();
    let payload: Payload = serde_json::from_slice(&raw).unwrap();
    let Payload::Credentials { batch, .. } = payload else {
        panic!()
    };
    assert_eq!(batch.updates[0].base_sequence, 2);
    assert_eq!(batch.updates[0].payload, cookies("latest-secret"));
    f.accept();
    assert_eq!(f.payload(), cookies("latest-secret"));
    assert_eq!(f.store.pending_count().unwrap(), 0);
    assert!(
        !f.store.browser_imports_verified(&f.root).unwrap(),
        "server ACK is not fresh native observation"
    );
    assert_eq!(f.observe(cookies("latest-secret")), State::Clean);
    assert!(f.store.browser_imports_verified(&f.root).unwrap());
    for name in ["sync.sqlite", "sync.sqlite-wal"] {
        if let Ok(bytes) = std::fs::read(f.dir.path().join(name)) {
            for secret in ["first-secret", "latest-secret", "initial-secret"] {
                assert!(!bytes
                    .windows(secret.len())
                    .any(|part| part == secret.as_bytes()));
            }
        }
    }
}
#[test]
fn remote_logout_does_not_rebase_stale_local_tokens() {
    let mut f = Fixture::new();
    f.observe(cookies("local-secret"));
    let peer = DeviceKey::generate();
    let grant = f.root.grant(&f.scope, &id(), 1, &peer).unwrap();
    let payload=serde_json::to_vec(&json!({"kind":"credentials","version":1,"batch":{"profile_id":profile(),"updates":[{"area":{"kind":"cookies"},"base_sequence":1,"payload":[]}]}})).unwrap();
    let mutation = f
        .root
        .seal_mutation(&f.scope, &grant, &peer, &id(), 1, &payload)
        .unwrap();
    f.store
        .apply_events(
            &f.root,
            &[(
                Event {
                    mutation,
                    sequence: 2,
                },
                grant,
            )],
            document::reduce,
        )
        .unwrap();
    f.accept();
    assert_eq!(f.payload(), json!([]));
    assert_eq!(f.store.pending_count().unwrap(), 0);
    assert_eq!(f.observe(cookies("local-secret")), State::NeedsImport);
    assert_eq!(
        f.store.pending_count().unwrap(),
        0,
        "stale credentials must not be republished against a newer base"
    );
}
#[test]
fn pending_capture_blocks_profile_replacement_and_partial_observations() {
    let mut f = Fixture::new();
    f.observe(cookies("local-secret"));
    let binding = f
        .store
        .browser_profile_binding(&f.root, &profile())
        .unwrap();
    assert!(f
        .store
        .stage_browser_profile(&f.root, &profile(), binding.revision, &id())
        .is_err());
    assert!(f
        .store
        .observe_browser_profile(&f.root, &f.device, &profile(), &f.generation, vec![])
        .is_err());
    assert!(f
        .store
        .observe_browser_profile(
            &f.root,
            &f.device,
            &profile(),
            &id(),
            observed(cookies("wrong"))
        )
        .is_err());
    f.accept();
    f.observe(cookies("local-secret"));
    assert!(f
        .store
        .stage_browser_profile(&f.root, &profile(), binding.revision, &id())
        .is_ok());
}
#[test]
fn failed_outbox_insert_recovers_the_durable_observation_without_duplicate_counter() {
    let mut f = Fixture::new();
    let db = rusqlite::Connection::open(f.dir.path().join("sync.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER capture_failure BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(FAIL,'fixture failure'); END;").unwrap();
    assert!(f
        .store
        .observe_browser_profile(
            &f.root,
            &f.device,
            &profile(),
            &f.generation,
            observed(cookies("preserved-secret"))
        )
        .is_err());
    assert_eq!(f.store.pending_count().unwrap(), 0);
    db.execute_batch("DROP TRIGGER capture_failure;").unwrap();
    let path = f.dir.path().join("sync.sqlite");
    drop(f.store);
    let (store, _) = Store::unlock(&path, f.scope.clone(), &f.root).unwrap();
    f.store = store;
    f.store.resume_browser_captures(&f.root, &f.device).unwrap();
    f.store.resume_browser_captures(&f.root, &f.device).unwrap();
    let queued = f.store.pending(false, 10).unwrap();
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].device_counter, 2);
    f.accept();
    assert_eq!(f.payload(), cookies("preserved-secret"));
}

#[test]
fn verified_replacement_recovers_acknowledged_capture_before_bookkeeping() {
    let mut f = Fixture::new();
    f.observe(cookies("acknowledged-secret"));
    let mutation = f.store.pending(false, 1).unwrap().remove(0);
    // Crash boundary: replay commits, but resume_browser_captures has not run.
    f.store
        .apply_events(
            &f.root,
            &[(
                Event {
                    mutation,
                    sequence: 2,
                },
                f.grant.clone(),
            )],
            document::reduce,
        )
        .unwrap();
    let before = f
        .store
        .browser_profile_binding(&f.root, &profile())
        .unwrap();
    let generation = id();
    let binding = f
        .store
        .stage_browser_profile(&f.root, &profile(), before.revision, &generation)
        .unwrap();
    let receipt = f.store.browser_import_journal(&f.root, &profile()).unwrap();
    let journal = f
        .store
        .begin_browser_import(&f.root, &profile(), receipt.revision, &generation, 2)
        .unwrap();
    f.store
        .finish_browser_import(
            &f.root,
            &profile(),
            journal.revision,
            &generation,
            &journal.pending.unwrap().credentials,
        )
        .unwrap();
    f.store
        .activate_browser_profile(&f.root, &profile(), binding.revision, &generation)
        .unwrap();
    f.generation = generation;
    assert_eq!(f.observe(cookies("acknowledged-secret")), State::Clean);
    assert_eq!(f.store.pending_count().unwrap(), 0);
    assert!(f.store.browser_imports_verified(&f.root).unwrap());
    // The replacement journal is durable, including the new generation ID.
    f.store.resume_browser_captures(&f.root, &f.device).unwrap();
    assert_eq!(f.observe(cookies("acknowledged-secret")), State::Clean);
}
