use super::*;
use crate::infra::devices::records::ListMember;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use misty_browser_sync::crypto::VaultRoot;

fn member(id: char, key: u8) -> ListMember {
    ListMember {
        device_id: format!("device_00000000-0000-0000-0000-00000000000{id}"),
        public_key: STANDARD.encode([key; 32]),
    }
}

fn record(
    root: &VaultRoot,
    version: u64,
    admitted: &[ListMember],
    revoked: &[ListMember],
) -> SignedRecord {
    let payload =
        DeviceList::next_payload("acct-trust", "vault", version, 1, admitted, revoked, now())
            .unwrap();
    SignedRecord::new(&payload, root.sign_device_record(&payload).unwrap())
}

#[test]
fn the_server_list_admits_and_removes_and_never_rolls_back() {
    let directory = tempfile::tempdir().unwrap();
    set_storage_root(directory.path().to_path_buf());
    open("https://misty.test", "acct-trust", "device_trust_test").unwrap();
    set_server_device_id(&member('s', 9).device_id).unwrap();
    let root = VaultRoot::generate();
    let (a, b) = (member('a', 1), member('b', 2));
    let admitted = |member: &ListMember| {
        current_list().is_some_and(|list| list.admitted_key(&member.device_id).is_some())
    };
    // Nothing is trusted before this device pins the root it holds.
    assert!(apply_server_list(Some(&record(&root, 1, &[a.clone(), b.clone()], &[]))).is_err());
    pin_root(&root.public_key().unwrap(), "vault").unwrap();
    assert!(pin_root(&VaultRoot::generate().public_key().unwrap(), "vault").is_err());
    assert_eq!(
        apply_server_list(Some(&record(&root, 1, &[a.clone(), b.clone()], &[]))).unwrap(),
        ListOutcome::Adopted
    );
    assert!(admitted(&b));
    // A removal takes effect...
    assert_eq!(
        apply_server_list(Some(&record(&root, 2, &[a.clone()], &[b.clone()]))).unwrap(),
        ListOutcome::Adopted
    );
    assert!(!admitted(&b));
    // ...and an older list the server sends again does not bring B back.
    assert_eq!(
        apply_server_list(Some(&record(&root, 1, &[a.clone(), b.clone()], &[]))).unwrap(),
        ListOutcome::ServerBehind
    );
    assert!(!admitted(&b));
    // Another root's list is refused outright.
    assert!(
        apply_server_list(Some(&record(&VaultRoot::generate(), 3, &[a.clone()], &[]))).is_err()
    );
    close();
}
