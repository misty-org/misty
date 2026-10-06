use super::*;
use std::time::Duration;

#[test]
fn retiring_a_rejected_database_keeps_its_files_out_of_account_lookup() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    for suffix in ["", "-wal", "-shm"] {
        std::fs::write(format!("{}{suffix}", path.display()), suffix).unwrap();
    }
    retire_database(&path).unwrap();
    assert!(!path.exists());
    let mut retired: Vec<_> = std::fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    retired.sort();
    assert_eq!(retired.len(), 3);
    assert!(retired[0].starts_with("workspace.retired-") && retired[0].ends_with(".sqlite"));
    assert_eq!(retired[1], format!("{}-shm", retired[0]));
    assert_eq!(retired[2], format!("{}-wal", retired[0]));
    // A missing database is already retired.
    retire_database(&path).unwrap();
}

#[test]
fn encrypted_binding_selects_only_activated_native_generations() {
    use misty_browser_sync::store::BrowserGeneration;
    let logical = "a".repeat(64);
    let physical = "b".repeat(64);
    let generation = BrowserGeneration {
        id: uuid::Uuid::new_v4().to_string(),
        physical_id: physical.clone(),
    };
    let mut binding = BrowserProfileBinding::default();
    assert_eq!(
        select_bound_profile(&logical, &binding, None).unwrap(),
        None
    );
    binding.revision = 1;
    binding.staged = Some(generation.clone());
    assert!(select_bound_profile(&logical, &binding, None).is_err());
    binding.staged = None;
    binding.active = Some(generation.clone());
    let selected = select_bound_profile(&logical, &binding, None)
        .unwrap()
        .unwrap();
    assert_eq!(selected.logical, logical);
    assert_eq!(selected.physical, physical);
    assert!(select_bound_profile(&"d".repeat(64), &binding, Some(&selected)).is_err());
    let mut replacement = binding.clone();
    replacement.active.as_mut().unwrap().physical_id = "e".repeat(64);
    assert!(select_bound_profile(&logical, &replacement, Some(&selected)).is_err());
    // Incomplete recovery cannot fall back to a different, empty store.
    assert!(
        select_bound_profile(&logical, &BrowserProfileBinding::default(), Some(&selected)).is_err()
    );
    binding.staged = Some(BrowserGeneration {
        id: uuid::Uuid::new_v4().to_string(),
        physical_id: "c".repeat(64),
    });
    // A failed incoming staging attempt must not block the authenticated
    // active local store or select the incomplete incoming generation.
    assert_eq!(
        select_bound_profile(&logical, &binding, Some(&selected)).unwrap(),
        Some(selected.clone())
    );
    assert_eq!(
        select_bound_profile(&logical, &binding, None).unwrap(),
        Some(selected)
    );
}

#[tokio::test]
async fn local_profile_survives_failed_sync_verification_and_stopped_worker() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = SyncApi::new("http://127.0.0.1:9", reqwest::Client::new()).unwrap();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "local-browser-fixture".into(),
        vault_id: uuid::Uuid::new_v4().to_string(),
    };
    let logical = default_profile_id(&scope).unwrap();
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let device_id = uuid::Uuid::new_v4().to_string();
    let grant = root.grant(&scope, &device_id, 1, &device).unwrap();
    let mut store = Store::initialize(
        &path,
        scope.clone(),
        grant.clone(),
        &root,
        &device,
        &Document::default().encode().unwrap(),
    )
    .unwrap();
    let payload = serde_json::to_vec(&serde_json::json!({
        "kind": "credentials", "version": 1,
        "batch": {"profile_id": logical, "updates": [{
            "area": {"kind": "cookies"}, "base_sequence": 0, "payload": []
        }]}
    }))
    .unwrap();
    let mutation = store.enqueue(&root, &device, &payload).unwrap();
    store
        .apply_events(
            &root,
            &[(
                misty_browser_sync::protocol::Event {
                    mutation,
                    sequence: 1,
                },
                grant,
            )],
            document::reduce,
        )
        .unwrap();
    let generation = uuid::Uuid::new_v4().to_string();
    let binding = store
        .stage_browser_profile(&root, &logical, 0, &generation)
        .unwrap();
    let physical = binding.staged.as_ref().unwrap().physical_id.clone();
    let journal = store
        .begin_browser_import(&root, &logical, 0, &generation, 1)
        .unwrap();
    store
        .finish_browser_import(
            &root,
            &logical,
            journal.revision,
            &generation,
            &journal.pending.unwrap().credentials,
        )
        .unwrap();
    store
        .activate_browser_profile(&root, &logical, binding.revision, &generation)
        .unwrap();
    let cached_workspace = Document::default().workspace_view().unwrap();
    let admission_root = root.duplicate();
    let (worker, handle) = Worker::new(
        api.clone(),
        scope.clone(),
        root,
        device,
        store,
        document::reduce,
    )
    .unwrap();
    let mut active = Session {
        id: uuid::Uuid::new_v4().to_string(),
        scope,
        device_id,
        api,
        _database_lock: lock_database(&path).unwrap(),
        cached_workspace,
        cached_pending: vec![],
        workspace_projection: Default::default(),
        handle,
        task: tokio::spawn(worker.run()),
        notifications: tokio::spawn(std::future::pending()),
        credential_task: None,
        history_task: None,
        credential_issue: Some("Website storage unavailable".into()),
        website_data: Default::default(),
        device_browser: None,
        baselines: Default::default(),
        held: Default::default(),
        #[cfg(any(target_os = "macos", windows))]
        capture_view: None,
        admission_root,
    };
    // A failed read-back must not revoke an activated local store. This is
    // the same journal failure that previously prevented native tab creation.
    let journal = active
        .handle
        .browser_import_journal(logical.clone())
        .await
        .unwrap();
    assert!(active
        .handle
        .finish_browser_import(logical.clone(), journal.revision, generation, vec![])
        .await
        .is_err());
    let selected = resolve_local_profile(&mut active, &logical, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(selected.physical, physical);
    let status = view(&mut active).await.unwrap();
    assert!(!status.0.browser_profile_ready);
    assert_eq!(
        status.0.browser_profile_issue.as_deref(),
        Some("Website storage unavailable")
    );

    active.handle.stop();
    (&mut active.task).await.unwrap().unwrap();
    let retained = resolve_local_profile(&mut active, &logical, Some(&selected))
        .await
        .unwrap();
    assert_eq!(retained, Some(selected.clone()));
    // A failed worker cannot justify switching accounts or inventing a new
    // store. Optional synced sessionStorage failure still permits browsing.
    assert!(
        resolve_local_profile(&mut active, &"f".repeat(64), Some(&selected))
            .await
            .is_err()
    );
    assert!(resolve_local_profile(&mut active, &logical, None)
        .await
        .is_err());
    assert!(local_tab_session(
        &mut active,
        &logical,
        &document::credentials::Area::SessionStorage {
            origin: "https://example.test".into(),
            view_id: uuid::Uuid::new_v4().to_string(),
        }
    )
    .await
    .is_none());
    assert!(active.credential_issue.is_some());
    active.notifications.abort();
}

#[tokio::test]
async fn account_replacement_waits_for_key_owner_and_releases_process_lock() {
    let directory =
        std::env::temp_dir().join(format!("misty-sync-owner-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(directory.clone());
    let path = directory.join("workspace.sqlite");
    let database_lock = lock_database(&path).unwrap();
    assert!(
        lock_database(&path).is_err(),
        "a second process/owner must not use this device identity"
    );
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = SyncApi::new(
        "http://127.0.0.1:9",
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap(),
    )
    .unwrap();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "fixture".into(),
        vault_id: uuid::Uuid::new_v4().to_string(),
    };
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let device_id = uuid::Uuid::new_v4().to_string();
    let grant = root.grant(&scope, &device_id, 1, &device).unwrap();
    let initial = Document::default();
    let store = Store::initialize(
        &path,
        scope.clone(),
        grant,
        &root,
        &device,
        &initial.encode().unwrap(),
    )
    .unwrap();
    let admission_root = root.duplicate();
    let (worker, handle) = Worker::new(
        api.clone(),
        scope.clone(),
        root,
        device,
        store,
        document::reduce,
    )
    .unwrap();
    let observer = handle.clone();
    let active = Session {
        id: uuid::Uuid::new_v4().to_string(),
        scope,
        device_id,
        api,
        _database_lock: database_lock,
        cached_workspace: initial.workspace_view().unwrap(),
        cached_pending: vec![],
        workspace_projection: Default::default(),
        handle,
        task: tokio::spawn(worker.run()),
        notifications: tokio::spawn(std::future::pending()),
        credential_task: None,
        history_task: None,
        credential_issue: None,
        website_data: Default::default(),
        device_browser: None,
        baselines: Default::default(),
        held: Default::default(),
        #[cfg(any(target_os = "macos", windows))]
        capture_view: None,
        admission_root,
    };
    *session().lock().await = Some(active);
    let epoch = BROWSER_ACCOUNT_EPOCH.load(Ordering::Acquire);
    change_account_if(None, |_| false, || Ok(())).await.unwrap();
    assert!(
        session().lock().await.is_some(),
        "forgetting another saved login must not stop this worker"
    );
    assert_eq!(epoch, BROWSER_ACCOUNT_EPOCH.load(Ordering::Acquire));
    let creation = browser_lifecycle().read().await;
    let change = change_account(None, || {
        assert!(observer.status.borrow().phase == misty_browser_sync::worker::Phase::Stopped);
        assert!(
            session().try_lock().is_err(),
            "jar replacement must remain serialized with unlock"
        );
        assert!(
            lock_database(&path).is_ok(),
            "old database lock is released only after its worker ends"
        );
        Ok(())
    });
    tokio::pin!(change);
    assert!(tokio::time::timeout(Duration::from_millis(20), &mut change)
        .await
        .is_err());
    assert!(
        session().lock().await.is_some(),
        "account shutdown must await the native creation lease"
    );
    let queued_creation = browser_profile_lease(None, None, None);
    tokio::pin!(queued_creation);
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut queued_creation)
            .await
            .is_err()
    );
    drop(creation);
    tokio::time::timeout(Duration::from_secs(3), &mut change)
        .await
        .unwrap()
        .unwrap();
    assert!(
        queued_creation.await.is_err(),
        "creation queued for the old account must not reopen it"
    );
    assert!(session().lock().await.is_none());
    assert!(
        observer.snapshot().await.is_err(),
        "old handles cannot read decrypted data after account replacement"
    );
}
