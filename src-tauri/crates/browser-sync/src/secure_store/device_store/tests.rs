use super::*;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
};

#[derive(Default)]
struct FakeKeychain {
    entries: RefCell<HashMap<String, Zeroizing<Vec<u8>>>>,
    reads: RefCell<Vec<String>>,
    writes: RefCell<Vec<String>>,
    deny_read: RefCell<Option<String>>,
    deny_delete: Cell<bool>,
    deny_write: Cell<bool>,
}

impl Backend for FakeKeychain {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        self.reads.borrow_mut().push(name.into());
        if self.deny_read.borrow().as_deref() == Some(name) {
            return Err(Error::SecureStorage);
        }
        Ok(self.entries.borrow().get(name).cloned())
    }
    fn write(&self, name: &str, value: &[u8]) -> Result<()> {
        if self.deny_write.get() {
            return Err(Error::SecureStorage);
        }
        self.writes.borrow_mut().push(name.into());
        self.entries
            .borrow_mut()
            .insert(name.into(), Zeroizing::new(value.to_vec()));
        Ok(())
    }
    fn delete(&self, name: &str) -> Result<()> {
        if self.deny_delete.get() {
            return Err(Error::SecureStorage);
        }
        self.entries.borrow_mut().remove(name);
        Ok(())
    }
    fn legacy_accounts(&self) -> Result<Vec<String>> {
        Ok(self.entries.borrow().keys().cloned().collect())
    }
}

fn names() -> (String, String) {
    (
        "a".repeat(64),
        format!("workspace-recovery:v1:{}", "b".repeat(64)),
    )
}

#[test]
fn migrates_both_roots_to_one_key_and_reads_keychain_only_at_unlock() {
    let directory = tempfile::tempdir().unwrap();
    let backend = FakeKeychain::default();
    let (sync, recovery) = names();
    let sync_key = random_root();
    let recovery_key = random_root();
    backend
        .entries
        .borrow_mut()
        .insert(sync.clone(), sync_key.clone());
    backend
        .entries
        .borrow_mut()
        .insert(recovery.clone(), recovery_key.clone());
    let mut store = DeviceStore::open(directory.path(), &backend).unwrap();
    assert_eq!(backend.entries.borrow().len(), 1);
    assert_eq!(*backend.writes.borrow(), [DEVICE_ACCOUNT]);
    let reads_after_unlock = backend.reads.borrow().len();
    assert_eq!(*store.get(&sync).unwrap().unwrap(), *sync_key);
    assert_eq!(*store.recovery(&recovery, false).unwrap(), *recovery_key);
    store.put(&"c".repeat(64), &random_root()).unwrap();
    store.delete(&sync).unwrap();
    assert_eq!(*store.recovery(&recovery, false).unwrap(), *recovery_key);
    assert_eq!(backend.reads.borrow().len(), reads_after_unlock);
    drop(store);
    backend.reads.borrow_mut().clear();
    let store = DeviceStore::open(directory.path(), &backend).unwrap();
    assert_eq!(*backend.reads.borrow(), [DEVICE_ACCOUNT]);
    assert!(store.get(&sync).unwrap().is_none());
    assert_eq!(*store.get(&recovery).unwrap().unwrap(), *recovery_key);
    let disk = fs::read(directory.path().join("keys.sqlite")).unwrap();
    assert!(!disk.windows(32).any(|bytes| bytes == &recovery_key[1..]));
    let master = backend.entries.borrow()[DEVICE_ACCOUNT].clone();
    assert!(!disk.windows(32).any(|bytes| bytes == &master[1..]));
}

#[test]
fn failed_migration_leaves_all_legacy_keys_recoverable() {
    let directory = tempfile::tempdir().unwrap();
    let backend = FakeKeychain::default();
    let (sync, recovery) = names();
    backend
        .entries
        .borrow_mut()
        .insert(sync.clone(), random_root());
    backend
        .entries
        .borrow_mut()
        .insert(recovery.clone(), random_root());
    *backend.deny_read.borrow_mut() = Some(recovery.clone());
    assert!(DeviceStore::open(directory.path(), &backend).is_err());
    assert!(backend.entries.borrow().contains_key(&sync));
    assert!(backend.entries.borrow().contains_key(&recovery));
    *backend.deny_read.borrow_mut() = None;
    let store = DeviceStore::open(directory.path(), &backend).unwrap();
    assert!(store.get(&sync).unwrap().is_some());
    assert!(store.get(&recovery).unwrap().is_some());
    assert_eq!(backend.entries.borrow().len(), 1);
}

#[test]
fn interrupted_cleanup_retries_without_reading_old_secrets_again() {
    let directory = tempfile::tempdir().unwrap();
    let backend = FakeKeychain::default();
    let (sync, _) = names();
    let root = random_root();
    backend
        .entries
        .borrow_mut()
        .insert(sync.clone(), root.clone());
    backend.deny_delete.set(true);
    assert!(DeviceStore::open(directory.path(), &backend).is_err());
    assert!(backend.entries.borrow().contains_key(&sync));
    backend.deny_delete.set(false);
    *backend.deny_read.borrow_mut() = Some(sync.clone());
    let store = DeviceStore::open(directory.path(), &backend).unwrap();
    assert_eq!(*store.get(&sync).unwrap().unwrap(), *root);
    assert_eq!(backend.entries.borrow().len(), 1);
}

#[test]
fn missing_or_replaced_master_never_resets_an_existing_store() {
    let directory = tempfile::tempdir().unwrap();
    let backend = FakeKeychain::default();
    let (sync, _) = names();
    let root = random_root();
    let store = DeviceStore::open(directory.path(), &backend).unwrap();
    store.put(&sync, &root).unwrap();
    drop(store);
    let master = backend.entries.borrow_mut().remove(DEVICE_ACCOUNT).unwrap();
    assert!(DeviceStore::open(directory.path(), &backend).is_err());
    assert_eq!(backend.writes.borrow().len(), 1);
    backend
        .entries
        .borrow_mut()
        .insert(DEVICE_ACCOUNT.into(), random_root());
    assert!(DeviceStore::open(directory.path(), &backend).is_err());
    backend
        .entries
        .borrow_mut()
        .insert(DEVICE_ACCOUNT.into(), master);
    let store = DeviceStore::open(directory.path(), &backend).unwrap();
    assert_eq!(*store.get(&sync).unwrap().unwrap(), *root);
}

#[test]
fn denied_master_creation_never_deletes_a_legacy_key() {
    let directory = tempfile::tempdir().unwrap();
    let backend = FakeKeychain::default();
    let (sync, _) = names();
    backend
        .entries
        .borrow_mut()
        .insert(sync.clone(), random_root());
    backend.deny_write.set(true);
    assert!(DeviceStore::open(directory.path(), &backend).is_err());
    assert!(backend.entries.borrow().contains_key(&sync));
}

#[test]
fn ciphertext_cannot_be_swapped_between_accounts_or_tampered_with() {
    let directory = tempfile::tempdir().unwrap();
    let backend = FakeKeychain::default();
    let (sync, recovery) = names();
    let mut store = DeviceStore::open(directory.path(), &backend).unwrap();
    store.put(&sync, &random_root()).unwrap();
    let root = store.recovery(&recovery, true).unwrap();
    assert_ne!(*root, *store.get(&sync).unwrap().unwrap());
    store.db.execute("UPDATE device_keys SET ciphertext = (SELECT ciphertext FROM device_keys WHERE name = ?1) WHERE name = ?2", params![sync, recovery]).unwrap();
    assert!(store.get(&recovery).is_err());
    assert!(store.recovery(&recovery, true).is_err());
    let mut ciphertext: Vec<u8> = store
        .db
        .query_row(
            "SELECT ciphertext FROM device_keys WHERE name = ?1",
            [&sync],
            |row| row.get(0),
        )
        .unwrap();
    *ciphertext.last_mut().unwrap() ^= 1;
    store
        .db
        .execute(
            "UPDATE device_keys SET ciphertext = ?1 WHERE name = ?2",
            params![ciphertext, sync],
        )
        .unwrap();
    assert!(store.get(&sync).is_err());
}

#[test]
fn two_store_handles_share_one_master_and_do_not_replace_recovery_roots() {
    let directory = tempfile::tempdir().unwrap();
    let backend = FakeKeychain::default();
    let (_, recovery) = names();
    let mut first = DeviceStore::open(directory.path(), &backend).unwrap();
    let mut second = DeviceStore::open(directory.path(), &backend).unwrap();
    assert!(first.recovery(&recovery, false).is_err());
    let root = first.recovery(&recovery, true).unwrap();
    assert_eq!(*second.recovery(&recovery, true).unwrap(), *root);
    first.delete(&recovery).unwrap();
    assert!(second.recovery(&recovery, false).is_err());
    assert_eq!(*backend.writes.borrow(), [DEVICE_ACCOUNT]);
}

#[test]
fn simultaneous_profiles_create_the_same_recovery_root() {
    let directory = tempfile::tempdir().unwrap();
    let backend = FakeKeychain::default();
    let (_, recovery) = names();
    let stores = [
        DeviceStore::open(directory.path(), &backend).unwrap(),
        DeviceStore::open(directory.path(), &backend).unwrap(),
    ];
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let workers = stores
        .into_iter()
        .map(|mut store| {
            let barrier = barrier.clone();
            let recovery = recovery.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store.recovery(&recovery, true).unwrap()
            })
        })
        .collect::<Vec<_>>();
    let roots = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(*roots[0], *roots[1]);
    assert_eq!(*backend.writes.borrow(), [DEVICE_ACCOUNT]);
}
