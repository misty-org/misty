//! Two vaults, personal and one Space: one unlock, one lock, separate stores.
use super::*;

/// A vault session over a local store, its worker pointed at an unreachable
/// server.
fn vault_session(
    directory: &std::path::Path,
    scope: &VaultScope,
    root: &VaultRoot,
    device: &DeviceKey,
    device_id: &str,
    space_id: Option<&str>,
    cached: Option<CachedVault>,
) -> (Session, WorkerHandle) {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = SyncApi::new("http://127.0.0.1:9", reqwest::Client::new()).unwrap();
    let api = match space_id {
        Some(_) => api.for_vault(&scope.vault_id),
        None => api,
    };
    let path = directory.join(format!("{}.sqlite", scope.vault_id));
    let grant = root.grant(scope, device_id, 1, device).unwrap();
    let initial = Document::default();
    let store = Store::initialize_vault(
        &path,
        scope.clone(),
        grant,
        root,
        device,
        &initial.encode().unwrap(),
        cached.as_ref(),
    )
    .unwrap();
    let (worker, handle) = Worker::new(
        api.clone(),
        scope.clone(),
        root.duplicate(),
        device.clone(),
        store,
        document::reduce,
    )
    .unwrap();
    let session = Session {
        id: uuid::Uuid::new_v4().to_string(),
        scope: scope.clone(),
        device_id: device_id.into(),
        api,
        _database_lock: lock_database(&path).unwrap(),
        cached_workspace: initial.workspace_view().unwrap(),
        cached_pending: vec![],
        workspace_projection: Default::default(),
        handle: handle.clone(),
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
        admission_root: root.duplicate(),
        device_key: device.clone(),
        space_id: space_id.map(str::to_owned),
    };
    (session, handle)
}

/// A personal vault and one Space vault, the Space's root sealed to the
/// personal root and this device in both under one key.
struct TwoVaults {
    personal: (Session, WorkerHandle),
    space: (Session, WorkerHandle),
    _directory: tempfile::TempDir,
}

fn two_vaults() -> TwoVaults {
    let directory = tempfile::tempdir().unwrap();
    let scope = |vault: String| VaultScope {
        deployment: "http://127.0.0.1:9".into(),
        account_id: "two-vault-fixture".into(),
        vault_id: vault,
    };
    let personal_scope = scope(uuid::Uuid::new_v4().to_string());
    let space_scope = scope(uuid::Uuid::new_v4().to_string());
    let personal_root = VaultRoot::generate();
    let space_root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let device_id = uuid::Uuid::new_v4().to_string();
    let sealed = personal_root
        .seal_space_root(&personal_scope, &space_scope, &space_root)
        .unwrap();
    let public = space_root.public_key().unwrap();
    // What unlock does with the listed vault: one sync password opens it.
    let opened = personal_root
        .open_space_root(&personal_scope, &space_scope, &sealed, &public)
        .unwrap();
    let cached = CachedVault {
        vault: Vault {
            vault_id: space_scope.vault_id.clone(),
            key_epoch: 1,
            head_sequence: 0,
            root_public_key: public,
            key_envelope: None,
            space_key_envelope: Some(sealed),
        },
        bootstrap_pending: false,
        enrollment_pending: true,
    };
    TwoVaults {
        personal: vault_session(
            directory.path(),
            &personal_scope,
            &personal_root,
            &device,
            &device_id,
            None,
            None,
        ),
        space: vault_session(
            directory.path(),
            &space_scope,
            &opened,
            &device,
            &device_id,
            Some("space-a"),
            Some(cached),
        ),
        _directory: directory,
    }
}

#[tokio::test]
async fn one_unlock_serves_every_vault_and_a_lock_closes_them_all() {
    let _registry = REGISTRY.lock().await;
    let TwoVaults {
        personal: (personal, personal_handle),
        space: (space, space_handle),
        _directory,
    } = two_vaults();
    let personal_id = personal.id.clone();
    let space_id = space.id.clone();
    let space_vault = space.scope.vault_id.clone();
    let space_logical = default_profile_id(&space.scope).unwrap();
    assert_ne!(
        default_profile_id(&personal.scope).unwrap(),
        space_logical,
        "each Space has its own browser profile"
    );
    install(personal, true).unwrap();
    install(space, false).unwrap();

    // Account-wide services use the personal vault; commands reach the
    // session they name.
    assert_eq!(personal_session().await.as_ref().unwrap().id, personal_id);
    assert_eq!(
        session_by_id(&space_id).await.as_ref().unwrap().id,
        space_id
    );
    assert_eq!(
        session_by_id("unknown").await.as_ref().unwrap().id,
        personal_id
    );
    assert_eq!(vault_of_session(&space_id), Some(space_vault.clone()));
    assert_eq!(
        vault_for_profile(&space_logical).map(|(vault, _)| vault),
        Some(space_vault.clone())
    );

    // Holding one Space's session never blocks another's.
    let held = session_by_id(&space_id).await;
    assert!(
        tokio::time::timeout(Duration::from_millis(50), personal_session())
            .await
            .is_ok()
    );
    drop(held);

    stop_all().await;
    assert!(personal_session().await.is_none());
    assert!(session_by_id(&space_id).await.is_none());
    for handle in [personal_handle, space_handle] {
        assert!(handle.status.borrow().phase == misty_browser_sync::worker::Phase::Stopped);
        assert!(handle.snapshot().await.is_err());
    }
}

#[tokio::test]
async fn each_vault_selects_its_own_store() {
    let _registry = REGISTRY.lock().await;
    let a = "space-a-vault".to_owned();
    let b = "space-b-vault".to_owned();
    let pick = |n: &str| SelectedProfile {
        logical: n.repeat(64),
        physical: n.repeat(32) + &n.repeat(32),
    };
    set_selected_profile(&a, Some(pick("a"))).unwrap();
    // A second Space opening its store is not a profile change for the first.
    set_selected_profile(&b, Some(pick("b"))).unwrap();
    assert_eq!(selected_profile(&a).unwrap(), Some(pick("a")));
    assert_eq!(selected_profile(&b).unwrap(), Some(pick("b")));
    let binding = BrowserProfileBinding {
        revision: 1,
        active: Some(misty_browser_sync::store::BrowserGeneration {
            id: uuid::Uuid::new_v4().to_string(),
            physical_id: pick("b").physical,
        }),
        ..Default::default()
    };
    assert!(select_bound_profile(
        &pick("b").logical,
        &binding,
        selected_profile(&b).unwrap().as_ref()
    )
    .is_ok());
    assert!(
        select_bound_profile(
            &pick("b").logical,
            &binding,
            selected_profile(&a).unwrap().as_ref()
        )
        .is_err(),
        "one Space's pages never open in another Space's store"
    );
    // Store locks are per vault: restoring one leaves the other's pages free.
    let restoring = store_lock(&a).write_owned().await;
    assert!(store_lock(&b).try_read_owned().is_ok());
    assert!(store_lock(&a).try_read_owned().is_err());
    drop(restoring);
    clear_selected_profiles().unwrap();
    assert_eq!(selected_profile(&a).unwrap(), None);
}

#[tokio::test]
async fn a_failed_space_vault_leaves_the_others_open() {
    let _registry = REGISTRY.lock().await;
    let TwoVaults {
        personal: (personal, _),
        space: (space, space_handle),
        _directory,
    } = two_vaults();
    let personal_id = personal.id.clone();
    install(personal, true).unwrap();
    space_failed("space-a", "Could not open this Space's sync vault.".into());
    assert!(sessions().failed.contains_key("space-a"));
    // A later open of that Space clears its failure.
    let space_id = space.id.clone();
    install(space, false).unwrap();
    assert!(!sessions().failed.contains_key("space-a"));
    // One vault's worker stopping leaves the account's other vaults working.
    space_handle.stop();
    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        while space_handle.status.borrow().phase != misty_browser_sync::worker::Phase::Stopped {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    assert_eq!(personal_session().await.as_ref().unwrap().id, personal_id);
    assert!(session_by_id(&space_id).await.is_some());
    stop_all().await;
}
