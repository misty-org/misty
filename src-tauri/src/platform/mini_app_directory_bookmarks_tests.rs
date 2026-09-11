use super::*;
#[derive(Default)]
struct MemoryVault(Mutex<BTreeMap<String, String>>);
impl Vault for MemoryVault {
    fn load(&self, key: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(key).cloned())
    }
    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(key.into(), value.into());
        Ok(())
    }
}
fn permissions(owner: &str) -> PermissionSet {
    let mut p = PermissionSet::from_document(
        "code",
        &json!({"runtime_capabilities":["files.read","files.write"]}),
        None,
    )
    .unwrap();
    p.owner_namespace = Some(owner.into());
    p.decide("files.read", true).unwrap();
    p.decide("files.write", true).unwrap();
    p
}
fn fixture() -> (tempfile::TempDir, PermissionSet) {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("project")).unwrap();
    std::fs::write(root.path().join("project/file.txt"), "original").unwrap();
    let mut p = permissions(&"a".repeat(64));
    p.folders.insert(
        "folder".into(),
        FolderGrant {
            directory: Arc::new(
                Dir::open_ambient_dir(root.path().join("project"), cap_std::ambient_authority())
                    .unwrap(),
            ),
            name: "Project".into(),
            writable: true,
            released: Arc::new(AtomicBool::new(false)),
        },
    );
    (root, p)
}
fn call(
    p: &mut PermissionSet,
    v: &dyn Vault,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let r = prepare(p, method, &params)?;
    let output = r.run(v)?;
    r.commit(p, output)
}
#[test]
fn listing_is_private_owner_scoped_bounded_and_revocable() {
    let (_root, mut first) = fixture();
    let vault = MemoryVault::default();
    let saved = call(
        &mut first,
        &vault,
        "files.rememberDirectory",
        json!({"directory":"folder","write":false}),
    )
    .unwrap();
    assert_eq!(
        call(&mut first, &vault, "files.listSavedDirectories", json!({})).unwrap(),
        json!([saved])
    );
    let mut other = permissions(&"b".repeat(64));
    assert_eq!(
        call(&mut other, &vault, "files.listSavedDirectories", json!({})).unwrap(),
        json!([])
    );
    assert!(prepare(&first, "files.listSavedDirectories", &json!({"write":true})).is_err());
    assert!(prepare(&first, "files.listSavedDirectories", &Value::Null).is_err());
    let pending = prepare(&first, "files.listSavedDirectories", &json!({})).unwrap();
    let output = pending.run(&vault).unwrap();
    first.decide("files.read", false).unwrap();
    assert!(pending.commit(&mut first, output).is_err());
    assert!(prepare(&first, "files.listSavedDirectories", &json!({})).is_err());
    // Forget remains available after access is revoked, but cannot affect another owner.
    call(
        &mut first,
        &vault,
        "files.forgetDirectory",
        json!({"bookmarkId":saved["bookmarkId"]}),
    )
    .unwrap();
    first.decide("files.read", true).unwrap();
    assert_eq!(
        call(&mut first, &vault, "files.listSavedDirectories", json!({})).unwrap(),
        json!([])
    );
}
#[test]
fn persists_only_private_records_and_reopens_after_registration_closes() {
    let (root, mut first) = fixture();
    let vault = MemoryVault::default();
    let saved = call(
        &mut first,
        &vault,
        "files.rememberDirectory",
        json!({"directory":"folder","write":true}),
    )
    .unwrap();
    assert_eq!(saved.as_object().unwrap().len(), 3);
    assert!(saved.get("bookmark").is_none());
    drop(first);
    let mut next = permissions(&"a".repeat(64));
    let opened = call(
        &mut next,
        &vault,
        "files.reopenDirectory",
        json!({"bookmarkId":saved["bookmarkId"],"write":true}),
    )
    .unwrap();
    let grant = &next.folders[opened["handle"].as_str().unwrap()];
    grant.directory.write("file.txt", "restored").unwrap();
    assert_eq!(
        std::fs::read_to_string(root.path().join("project/file.txt")).unwrap(),
        "restored"
    );
    call(
        &mut next,
        &vault,
        "files.forgetDirectory",
        json!({"bookmarkId":saved["bookmarkId"]}),
    )
    .unwrap();
    assert!(call(
        &mut next,
        &vault,
        "files.reopenDirectory",
        json!({"bookmarkId":saved["bookmarkId"]})
    )
    .is_err());
    // Forget removes saved access; already-open independently owned grants survive.
    assert_eq!(
        next.folders[opened["handle"].as_str().unwrap()]
            .directory
            .read_to_string("file.txt")
            .unwrap(),
        "restored"
    );
}
#[test]
fn identity_access_and_store_limits_are_checked_without_ambient_paths() {
    let (_root, mut first) = fixture();
    let vault = MemoryVault::default();
    let saved = call(
        &mut first,
        &vault,
        "files.rememberDirectory",
        json!({"directory":"folder","write":false}),
    )
    .unwrap();
    let mut other = permissions(&"b".repeat(64));
    assert!(call(
        &mut other,
        &vault,
        "files.reopenDirectory",
        json!({"bookmarkId":saved["bookmarkId"]})
    )
    .is_err());
    call(
        &mut other,
        &vault,
        "files.forgetDirectory",
        json!({"bookmarkId":saved["bookmarkId"]}),
    )
    .unwrap();
    assert!(call(
        &mut first,
        &vault,
        "files.reopenDirectory",
        json!({"bookmarkId":saved["bookmarkId"],"write":true})
    )
    .is_err());
    assert!(call(
        &mut first,
        &vault,
        "files.reopenDirectory",
        json!({"bookmarkId":"/etc"})
    )
    .is_err());
    for _ in 1..MAX_RECORDS {
        call(
            &mut first,
            &vault,
            "files.rememberDirectory",
            json!({"directory":"folder"}),
        )
        .unwrap();
    }
    assert!(call(
        &mut first,
        &vault,
        "files.rememberDirectory",
        json!({"directory":"folder"})
    )
    .is_err());
    first.decide("files.read", false).unwrap();
    assert!(prepare(
        &first,
        "files.reopenDirectory",
        &json!({"bookmarkId":saved["bookmarkId"]})
    )
    .is_err());
}
#[test]
fn rejects_released_source_and_late_restoration_after_revocation() {
    let (_root, mut p) = fixture();
    let vault = MemoryVault::default();
    let saved = call(
        &mut p,
        &vault,
        "files.rememberDirectory",
        json!({"directory":"folder"}),
    )
    .unwrap();
    let request = prepare(
        &p,
        "files.rememberDirectory",
        &json!({"directory":"folder"}),
    )
    .unwrap();
    p.folders.remove("folder");
    assert!(request.run(&vault).is_err());
    let reopening = prepare(
        &p,
        "files.reopenDirectory",
        &json!({"bookmarkId":saved["bookmarkId"]}),
    )
    .unwrap();
    let output = reopening.run(&vault).unwrap();
    p.decide("files.read", false).unwrap();
    assert!(reopening.commit(&mut p, output).is_err());
    assert!(p.folders.is_empty());
}
#[test]
fn malformed_private_record_fails_closed() {
    let (_root, mut p) = fixture();
    let vault = MemoryVault::default();
    vault.store(&"a".repeat(64), "{not JSON").unwrap();
    assert!(call(
        &mut p,
        &vault,
        "files.reopenDirectory",
        json!({"bookmarkId":uuid::Uuid::new_v4().to_string()})
    )
    .is_err());
}
#[test]
#[ignore = "requires explicitly enabled disposable OS credential-vault verification"]
fn os_vault_reopens_the_native_bookmark_in_a_fresh_process() {
    assert_eq!(
        std::env::var("MISTY_SDK_BOOKMARK_VAULT_TEST").as_deref(),
        Ok("1")
    );
    let (root, mut p) = fixture();
    let owner = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    p.owner_namespace = Some(owner.clone());
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = crate::infra::credential_store::delete(SERVICE, &self.0);
        }
    }
    let _cleanup = Cleanup(owner.clone());
    let saved = call(
        &mut p,
        &OsVault,
        "files.rememberDirectory",
        json!({"directory":"folder","write":true}),
    )
    .unwrap();
    drop(p);
    std::fs::rename(root.path().join("project"), root.path().join("moved")).unwrap();
    std::fs::create_dir(root.path().join("project")).unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "platform::mini_app::permissions::directory_bookmarks::tests::bookmark_child_process",
            "--nocapture",
        ])
        .env("MISTY_SDK_BOOKMARK_CHILD_OWNER", &owner)
        .env(
            "MISTY_SDK_BOOKMARK_CHILD_ID",
            saved["bookmarkId"].as_str().unwrap(),
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("moved/restored-by-child.txt")).unwrap(),
        "original"
    );
    assert!(!root.path().join("project/restored-by-child.txt").exists());
    crate::infra::credential_store::delete(SERVICE, &owner).unwrap();
    assert!(crate::infra::credential_store::load(SERVICE, &owner)
        .unwrap()
        .is_none());
}
#[test]
fn bookmark_child_process() {
    let Ok(owner) = std::env::var("MISTY_SDK_BOOKMARK_CHILD_OWNER") else {
        return;
    };
    assert_eq!(
        std::env::var("MISTY_SDK_BOOKMARK_VAULT_TEST").as_deref(),
        Ok("1")
    );
    let id = std::env::var("MISTY_SDK_BOOKMARK_CHILD_ID").unwrap();
    let mut p = permissions(&owner);
    assert_eq!(
        call(&mut p, &OsVault, "files.listSavedDirectories", json!({})).unwrap(),
        json!([{"bookmarkId":id,"name":"Project","writable":true}])
    );
    let opened = call(
        &mut p,
        &OsVault,
        "files.reopenDirectory",
        json!({"bookmarkId":id,"write":true}),
    )
    .unwrap();
    let dir = &p.folders[opened["handle"].as_str().unwrap()].directory;
    let text = dir.read_to_string("file.txt").unwrap();
    dir.write("restored-by-child.txt", text).unwrap();
}
#[cfg(target_os = "macos")]
#[test]
fn migrates_identity_only_records_without_changing_saved_references() {
    let (_root, mut p) = fixture();
    let vault = MemoryVault::default();
    let saved = call(
        &mut p,
        &vault,
        "files.rememberDirectory",
        json!({"directory":"folder"}),
    )
    .unwrap();
    let owner = p.owner_namespace.clone().unwrap();
    let mut value: Value = serde_json::from_str(&vault.load(&owner).unwrap().unwrap()).unwrap();
    let id = saved["bookmarkId"].as_str().unwrap();
    value["records"][id]["identity"]
        .as_object_mut()
        .unwrap()
        .remove("bookmark");
    vault
        .store(&owner, &serde_json::to_string(&value).unwrap())
        .unwrap();
    let opened = call(
        &mut p,
        &vault,
        "files.reopenDirectory",
        json!({"bookmarkId":id}),
    )
    .unwrap();
    assert!(p.folders.contains_key(opened["handle"].as_str().unwrap()));
    let updated: Value = serde_json::from_str(&vault.load(&owner).unwrap().unwrap()).unwrap();
    assert!(updated["records"][id]["identity"]["bookmark"].is_string());
    // A second restoration now uses a retained security scope.
    let opened = call(
        &mut p,
        &vault,
        "files.reopenDirectory",
        json!({"bookmarkId":id}),
    )
    .unwrap();
    let handle = opened["handle"].as_str().unwrap();
    let weak = Arc::downgrade(&p.folder_security_scopes[handle]);
    super::super::binary_files::release(&mut p, handle);
    assert!(weak.upgrade().is_none());
}
