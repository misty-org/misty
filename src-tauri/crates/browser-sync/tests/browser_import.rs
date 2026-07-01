use misty_browser_sync::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{self, Document},
    protocol::{DeviceGrant, Event},
    store::Store,
    Error,
};
use serde_json::json;
use uuid::Uuid;

struct Fixture {
    directory: tempfile::TempDir,
    root: VaultRoot,
    scope: VaultScope,
    device: DeviceKey,
    grant: DeviceGrant,
    store: Store,
}

fn profile() -> String {
    "a".repeat(64)
}
fn id() -> String {
    Uuid::new_v4().to_string()
}

fn cookie(domain: &str) -> serde_json::Value {
    json!({"name":"session","value":"synthetic-import-secret", "domain":domain,
        "path":"/","host_only":!domain.starts_with('.'),"secure":true,"http_only":true,
        "same_site":"lax","expires_unix_seconds":null,"partition_key":null})
}

impl Fixture {
    fn new(deployment: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = VaultRoot::generate();
        let device = DeviceKey::generate();
        let scope = VaultScope {
            deployment: deployment.into(),
            account_id: "import-fixture".into(),
            workspace_id: id(),
        };
        let grant = root.grant(&scope, &id(), 1, &device).unwrap();
        let store = Store::initialize(
            &directory.path().join("sync.sqlite"),
            scope.clone(),
            grant.clone(),
            &root,
            &device,
            &Document::default().encode().unwrap(),
        )
        .unwrap();
        let mut fixture = Self {
            directory,
            root,
            scope,
            device,
            grant,
            store,
        };
        fixture.commit(json!([
            {"area":{"kind":"cookies"},"base_sequence":0,"payload":[cookie("example.test"),cookie(".example.test")]},
            {"area":{"kind":"local_storage","origin":"https://example.test"},"base_sequence":0,"payload":{"token":"synthetic-storage-secret"}}
        ]));
        fixture
    }

    fn commit(&mut self, updates: serde_json::Value) {
        let payload = serde_json::to_vec(&json!({"kind":"credentials","version":1,
            "batch":{"profile_id":profile(),"updates":updates}}))
        .unwrap();
        let mutation = self
            .store
            .enqueue(&self.root, &self.device, &payload)
            .unwrap();
        let sequence = self.store.applied_sequence().unwrap() + 1;
        self.store
            .apply_events(
                &self.root,
                &[(Event { mutation, sequence }, self.grant.clone())],
                document::reduce,
            )
            .unwrap();
    }
}

#[test]
fn restart_recovers_the_exact_import_and_only_complete_native_readback_finishes_it() {
    let mut f = Fixture::new("https://sync.example.test");
    assert!(!f.store.browser_imports_verified(&f.root).unwrap());
    let import_id = id();
    let first = f
        .store
        .begin_browser_import(&f.root, &profile(), 0, &import_id, 1)
        .unwrap();
    assert_eq!(first.revision, 1);
    assert!(f.store.browser_imports_pending(&f.root).unwrap());
    let target = first.pending.unwrap().credentials;
    let path = f.directory.path().join("sync.sqlite");
    drop(f.store);
    let (mut store, _) = Store::unlock(&path, f.scope.clone(), &f.root).unwrap();
    let recovered = store
        .begin_browser_import(&f.root, &profile(), 0, &import_id, 1)
        .unwrap();
    assert_eq!(
        recovered.revision, 1,
        "lost response must not create new work"
    );
    assert_eq!(recovered.pending.unwrap().id, import_id);
    assert!(store
        .begin_browser_import(&f.root, &profile(), 1, &id(), 1)
        .is_err());
    assert!(
        store
            .finish_browser_import(&f.root, &profile(), 1, &import_id, &target[..1])
            .is_err(),
        "missing storage must not be called restored"
    );
    let mut changed = target.clone();
    let cookies = changed
        .iter_mut()
        .find(|r| matches!(r.area, document::credentials::Area::Cookies))
        .unwrap();
    cookies.payload[0]["http_only"] = json!(false);
    assert!(store
        .finish_browser_import(&f.root, &profile(), 1, &import_id, &changed)
        .is_err());
    let mut observed = target.clone();
    observed.reverse();
    let cookies = observed
        .iter_mut()
        .find(|r| matches!(r.area, document::credentials::Area::Cookies))
        .unwrap();
    cookies.payload.as_array_mut().unwrap().reverse();
    cookies.payload[0]["domain"] = json!("example.test"); // Domain-scope alias, not a host-only cookie.
    let done = store
        .finish_browser_import(&f.root, &profile(), 1, &import_id, &observed)
        .unwrap();
    assert_eq!(done.revision, 2);
    assert!(done.pending.is_none());
    assert!(store.browser_imports_verified(&f.root).unwrap());
    assert_eq!(
        store
            .finish_browser_import(&f.root, &profile(), 1, &import_id, &observed)
            .unwrap()
            .revision,
        2
    );
    drop(store);
    let (store, _) = Store::unlock(&path, f.scope, &f.root).unwrap();
    assert_eq!(
        store
            .browser_import_journal(&f.root, &profile())
            .unwrap()
            .applied
            .unwrap()
            .id,
        import_id
    );
    for name in ["sync.sqlite", "sync.sqlite-wal", "sync.sqlite-shm"] {
        if let Ok(bytes) = std::fs::read(f.directory.path().join(name)) {
            for secret in [
                b"synthetic-import-secret".as_slice(),
                b"synthetic-storage-secret".as_slice(),
            ] {
                assert!(!bytes.windows(secret.len()).any(|window| window == secret));
            }
        }
    }
}

#[test]
fn newer_logout_invalidates_an_old_verified_receipt_and_stale_snapshot_cannot_be_staged() {
    let mut f = Fixture::new("https://sync.example.test");
    let old_id = id();
    let first = f
        .store
        .begin_browser_import(&f.root, &profile(), 0, &old_id, 1)
        .unwrap();
    // A remote logout may commit while native writes from the older receipt run.
    f.commit(json!([{"area":{"kind":"cookies"},"base_sequence":1,"payload":[]}]));
    f.store
        .finish_browser_import(
            &f.root,
            &profile(),
            1,
            &old_id,
            &first.pending.unwrap().credentials,
        )
        .unwrap();
    assert!(!f.store.browser_imports_verified(&f.root).unwrap());
    assert!(f
        .store
        .begin_browser_import(&f.root, &profile(), 2, &id(), 1)
        .is_err());
    assert!(f
        .store
        .begin_browser_import(&f.root, &profile(), 1, &id(), 2)
        .is_err());
    let logout_id = id();
    let next = f
        .store
        .begin_browser_import(&f.root, &profile(), 2, &logout_id, 2)
        .unwrap();
    let target = next.pending.unwrap().credentials;
    assert!(target
        .iter()
        .find(|r| matches!(r.area, document::credentials::Area::Cookies))
        .unwrap()
        .payload
        .as_array()
        .unwrap()
        .is_empty());
    f.store
        .finish_browser_import(&f.root, &profile(), 3, &logout_id, &target)
        .unwrap();
    assert!(f.store.browser_imports_verified(&f.root).unwrap());
}

#[test]
fn expired_cookies_need_not_be_recreated_but_live_cookies_cannot_disappear() {
    let mut f = Fixture::new("https://sync.example.test");
    let mut expired = cookie("example.test");
    expired["expires_unix_seconds"] = json!(1);
    f.commit(json!([{"area":{"kind":"cookies"},"base_sequence":1,
        "payload":[expired,cookie(".example.test")]}]));
    let import_id = id();
    let staged = f
        .store
        .begin_browser_import(&f.root, &profile(), 0, &import_id, 2)
        .unwrap();
    let mut observed = staged.pending.unwrap().credentials;
    let cookies = observed
        .iter_mut()
        .find(|r| matches!(r.area, document::credentials::Area::Cookies))
        .unwrap();
    cookies.payload = json!([]);
    assert!(f
        .store
        .finish_browser_import(&f.root, &profile(), 1, &import_id, &observed)
        .is_err());
    let cookies = observed
        .iter_mut()
        .find(|r| matches!(r.area, document::credentials::Area::Cookies))
        .unwrap();
    cookies.payload = json!([cookie(".example.test")]);
    f.store
        .finish_browser_import(&f.root, &profile(), 1, &import_id, &observed)
        .unwrap();
    assert!(f.store.browser_imports_verified(&f.root).unwrap());
}

#[test]
fn failed_transactions_and_quarantine_keep_the_recovery_receipt() {
    let mut f = Fixture::new("https://sync.example.test");
    let connection = rusqlite::Connection::open(f.directory.path().join("sync.sqlite")).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON sync_browser_imports BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    let import_id = id();
    assert!(f
        .store
        .begin_browser_import(&f.root, &profile(), 0, &import_id, 1)
        .is_err());
    assert_eq!(
        f.store
            .browser_import_journal(&f.root, &profile())
            .unwrap()
            .revision,
        0
    );
    connection
        .execute_batch("DROP TRIGGER fail_import;")
        .unwrap();
    let staged = f
        .store
        .begin_browser_import(&f.root, &profile(), 0, &import_id, 1)
        .unwrap();
    connection.execute_batch("CREATE TRIGGER fail_finish BEFORE UPDATE ON sync_browser_imports BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    let target = staged.pending.unwrap().credentials;
    assert!(f
        .store
        .finish_browser_import(&f.root, &profile(), 1, &import_id, &target)
        .is_err());
    assert!(f.store.browser_imports_pending(&f.root).unwrap());
    connection
        .execute_batch("DROP TRIGGER fail_finish;")
        .unwrap();
    let state = f
        .store
        .quarantine_browser_import(&f.root, &profile(), 1, &import_id)
        .unwrap();
    assert_eq!(state.revision, 2);
    assert!(matches!(
        f.store
            .finish_browser_import(&f.root, &profile(), 2, &import_id, &target),
        Err(Error::Recovery)
    ));
    drop(f.store);
    let (store, _) =
        Store::unlock(&f.directory.path().join("sync.sqlite"), f.scope, &f.root).unwrap();
    let state = store.browser_import_journal(&f.root, &profile()).unwrap();
    assert!(state.quarantined);
    assert_eq!(state.pending.unwrap().id, import_id);
    assert!(!store.browser_imports_verified(&f.root).unwrap());
}

#[test]
fn journal_ciphertext_is_bound_to_profile_and_revision() {
    let mut f = Fixture::new("https://sync.example.test");
    f.store
        .begin_browser_import(&f.root, &profile(), 0, &id(), 1)
        .unwrap();
    let connection = rusqlite::Connection::open(f.directory.path().join("sync.sqlite")).unwrap();
    connection.execute("INSERT INTO sync_browser_imports SELECT ?1, revision, journal FROM sync_browser_imports WHERE profile_id=?2", [&"b".repeat(64), &profile()]).unwrap();
    assert!(f
        .store
        .browser_import_journal(&f.root, &"b".repeat(64))
        .is_err());
    assert!(f.store.browser_imports_pending(&f.root).is_err());
    connection
        .execute(
            "UPDATE sync_browser_imports SET revision=2 WHERE profile_id=?1",
            [profile()],
        )
        .unwrap();
    assert!(f.store.browser_import_journal(&f.root, &profile()).is_err());
}

#[tokio::test]
async fn worker_import_commands_work_offline_and_cannot_claim_pending_or_missing_imports_are_ready()
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let f = Fixture::new(&base);
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = misty_browser_sync::transport::SyncApi::new(&base, reqwest::Client::new()).unwrap();
    let (worker, handle) = misty_browser_sync::worker::Worker::new(
        api,
        f.scope,
        f.root,
        f.device,
        f.store,
        document::reduce,
    )
    .unwrap();
    let task = tokio::spawn(worker.run());
    let check = async {
        assert!(handle.imports_applied(1).await.is_err());
        let import_id = id();
        let staged = handle
            .begin_browser_import(profile(), 0, import_id.clone(), 1)
            .await
            .unwrap();
        assert!(handle.imports_applied(1).await.is_err());
        let recovered = handle.browser_import_journal(profile()).await.unwrap();
        assert_eq!(recovered.revision, staged.revision);
        let capture = || {
            zeroize::Zeroizing::new(
                serde_json::to_vec(&json!({
                    "kind":"credentials","version":1,"batch":{"profile_id":profile(),
                    "updates":[{"area":{"kind":"cookies"},"base_sequence":1,"payload":[]}]}
                }))
                .unwrap(),
            )
        };
        assert!(
            matches!(handle.enqueue(capture()).await, Err(Error::Recovery)),
            "partial native restore must not echo into the outbox"
        );
        assert!(handle
            .pending_snapshot()
            .await
            .unwrap()
            .operation_ids
            .is_empty());
        handle
            .finish_browser_import(profile(), 1, import_id, staged.pending.unwrap().credentials)
            .await
            .unwrap();
        handle.imports_applied(1).await.unwrap();
        handle.enqueue(capture()).await.unwrap();
        assert_eq!(
            handle.pending_snapshot().await.unwrap().operation_ids.len(),
            1
        );
    };
    tokio::time::timeout(std::time::Duration::from_secs(3), check)
        .await
        .unwrap();
    handle.stop();
    tokio::time::timeout(std::time::Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

fn verify_stage(f: &mut Fixture, generation: &str) {
    let revision = f
        .store
        .browser_import_journal(&f.root, &profile())
        .unwrap()
        .revision;
    let sequence = f.store.applied_sequence().unwrap();
    let journal = f
        .store
        .begin_browser_import(&f.root, &profile(), revision, generation, sequence)
        .unwrap();
    f.store
        .finish_browser_import(
            &f.root,
            &profile(),
            journal.revision,
            generation,
            &journal.pending.unwrap().credentials,
        )
        .unwrap();
}

#[test]
fn profile_activation_requires_verification_and_preserves_previous_stores_across_restart() {
    let mut f = Fixture::new("https://sync.example.test");
    let first = id();
    let stage = f
        .store
        .stage_browser_profile(&f.root, &profile(), 0, &first)
        .unwrap();
    let physical = stage.staged.unwrap().physical_id;
    assert_ne!(physical, profile());
    assert!(f
        .store
        .activate_browser_profile(&f.root, &profile(), 1, &first)
        .is_err());
    assert!(f
        .store
        .begin_browser_import(&f.root, &profile(), 0, &id(), 1)
        .is_err());
    assert_eq!(
        f.store
            .stage_browser_profile(&f.root, &profile(), 0, &first)
            .unwrap()
            .staged
            .unwrap()
            .physical_id,
        physical
    );
    verify_stage(&mut f, &first);
    let active = f
        .store
        .activate_browser_profile(&f.root, &profile(), 1, &first)
        .unwrap();
    assert_eq!(active.revision, 2);
    assert_eq!(active.active.unwrap().physical_id, physical);
    assert!(!f.store.browser_profiles_staged(&f.root).unwrap());
    assert_eq!(
        f.store
            .activate_browser_profile(&f.root, &profile(), 1, &first)
            .unwrap()
            .revision,
        2
    );
    let second = id();
    assert!(f
        .store
        .stage_browser_profile(&f.root, &profile(), 1, &second)
        .is_err());
    let stage = f
        .store
        .stage_browser_profile(&f.root, &profile(), 2, &second)
        .unwrap();
    let second_physical = stage.staged.unwrap().physical_id;
    assert_ne!(second_physical, physical);
    assert_eq!(stage.active.unwrap().id, first);
    verify_stage(&mut f, &second);
    let active = f
        .store
        .activate_browser_profile(&f.root, &profile(), 3, &second)
        .unwrap();
    assert_eq!(active.retired[0].physical_id, physical);
    assert!(f
        .store
        .forget_retired_browser_profile(&f.root, &profile(), 4, &second)
        .is_err());
    let path = f.directory.path().join("sync.sqlite");
    drop(f.store);
    let (mut store, _) = Store::unlock(&path, f.scope, &f.root).unwrap();
    let recovered = store.browser_profile_binding(&f.root, &profile()).unwrap();
    assert_eq!(recovered.active.unwrap().physical_id, second_physical);
    assert_eq!(recovered.retired[0].physical_id, physical);
    for name in ["sync.sqlite", "sync.sqlite-wal", "sync.sqlite-shm"] {
        if let Ok(bytes) = std::fs::read(f.directory.path().join(name)) {
            for secret in [&physical, &second_physical] {
                assert!(!bytes
                    .windows(secret.len())
                    .any(|window| window == secret.as_bytes()));
            }
        }
    }
    let cleaned = store
        .forget_retired_browser_profile(&f.root, &profile(), 4, &first)
        .unwrap();
    assert!(cleaned.retired.is_empty());
    assert_eq!(
        store
            .forget_retired_browser_profile(&f.root, &profile(), 4, &first)
            .unwrap()
            .revision,
        cleaned.revision
    );
}

#[test]
fn replacing_quarantined_stage_atomically_invalidates_late_callbacks() {
    let mut f = Fixture::new("https://sync.example.test");
    let old = id();
    let stage = f
        .store
        .stage_browser_profile(&f.root, &profile(), 0, &old)
        .unwrap();
    let old_physical = stage.staged.unwrap().physical_id;
    let journal = f
        .store
        .begin_browser_import(&f.root, &profile(), 0, &old, 1)
        .unwrap();
    let observed = journal.pending.unwrap().credentials;
    let quarantined = f
        .store
        .quarantine_browser_import(&f.root, &profile(), 1, &old)
        .unwrap();
    let sql = rusqlite::Connection::open(f.directory.path().join("sync.sqlite")).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_profile BEFORE UPDATE ON sync_browser_profiles BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    let fresh = id();
    assert!(f
        .store
        .stage_browser_profile(&f.root, &profile(), 1, &fresh)
        .is_err());
    let unchanged = f.store.browser_import_journal(&f.root, &profile()).unwrap();
    assert!(unchanged.quarantined);
    assert_eq!(unchanged.revision, quarantined.revision);
    assert_eq!(
        f.store
            .browser_profile_binding(&f.root, &profile())
            .unwrap()
            .staged
            .unwrap()
            .id,
        old
    );
    sql.execute_batch("DROP TRIGGER fail_profile").unwrap();
    let replaced = f
        .store
        .stage_browser_profile(&f.root, &profile(), 1, &fresh)
        .unwrap();
    assert_ne!(replaced.staged.unwrap().physical_id, old_physical);
    assert_eq!(replaced.retired[0].physical_id, old_physical);
    let journal = f.store.browser_import_journal(&f.root, &profile()).unwrap();
    assert!(journal.pending.is_none() && !journal.quarantined);
    assert_eq!(journal.revision, quarantined.revision + 1);
    assert!(f
        .store
        .finish_browser_import(&f.root, &profile(), quarantined.revision, &old, &observed)
        .is_err());
    assert!(f
        .store
        .begin_browser_import(&f.root, &profile(), journal.revision, &old, 1)
        .is_err());
    verify_stage(&mut f, &fresh);
    f.store
        .activate_browser_profile(&f.root, &profile(), replaced.revision, &fresh)
        .unwrap();
}

#[test]
fn a_verified_stage_cannot_activate_after_a_newer_logout_or_reuse_an_old_receipt() {
    let mut f = Fixture::new("https://sync.example.test");
    let old = id();
    verify_stage(&mut f, &old); // Unmapped legacy probe receipt.
    assert!(f
        .store
        .stage_browser_profile(&f.root, &profile(), 0, &old)
        .is_err());
    let fresh = id();
    f.store
        .stage_browser_profile(&f.root, &profile(), 0, &fresh)
        .unwrap();
    verify_stage(&mut f, &fresh);
    f.commit(json!([{"area":{"kind":"cookies"},"base_sequence":1,"payload":[]}]));
    assert!(matches!(
        f.store
            .activate_browser_profile(&f.root, &profile(), 1, &fresh),
        Err(Error::Recovery)
    ));
    let latest = id();
    f.store
        .stage_browser_profile(&f.root, &profile(), 1, &latest)
        .unwrap();
    verify_stage(&mut f, &latest);
    f.store
        .activate_browser_profile(&f.root, &profile(), 2, &latest)
        .unwrap();
}

#[test]
fn profile_mapping_ciphertext_is_bound_to_logical_identity_and_revision() {
    let mut f = Fixture::new("https://sync.example.test");
    f.store
        .stage_browser_profile(&f.root, &profile(), 0, &id())
        .unwrap();
    let sql = rusqlite::Connection::open(f.directory.path().join("sync.sqlite")).unwrap();
    sql.execute("INSERT INTO sync_browser_profiles SELECT ?1,revision,binding FROM sync_browser_profiles WHERE profile_id=?2", [&"b".repeat(64), &profile()]).unwrap();
    assert!(f
        .store
        .browser_profile_binding(&f.root, &"b".repeat(64))
        .is_err());
    assert!(f.store.browser_profiles_staged(&f.root).is_err());
    sql.execute(
        "UPDATE sync_browser_profiles SET revision=2 WHERE profile_id=?1",
        [profile()],
    )
    .unwrap();
    assert!(f
        .store
        .browser_profile_binding(&f.root, &profile())
        .is_err());
}

#[test]
fn workspace_only_replay_does_not_invalidate_verified_profile_activation() {
    let mut f = Fixture::new("https://sync.example.test");
    let generation = id();
    f.store
        .stage_browser_profile(&f.root, &profile(), 0, &generation)
        .unwrap();
    verify_stage(&mut f, &generation);
    let payload = serde_json::to_vec(&json!({"kind":"workspace","version":1,"changes":[{"action":"create","kind":"group","id":"websites","fields":{"label":"Websites","icon":"globe","order":0,"hidden":false}}]})).unwrap();
    let mutation = f.store.enqueue(&f.root, &f.device, &payload).unwrap();
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
    let binding = f
        .store
        .activate_browser_profile(&f.root, &profile(), 1, &generation)
        .unwrap();
    assert_eq!(binding.active.unwrap().id, generation);
}
