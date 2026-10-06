use super::*;
use crate::infra::device_records::ListMember;
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
fn the_server_admits_peers_only_remove_and_a_forged_peer_list_loses() {
    let directory = tempfile::tempdir().unwrap();
    set_storage_root(directory.path().to_path_buf());
    open("https://misty.test", "acct-trust", "device_trust_test").unwrap();
    set_server_device_id(&member('s', 9).device_id).unwrap();
    let root = VaultRoot::generate();
    let (a, b, c) = (member('a', 1), member('b', 2), member('c', 3));
    // Nothing is trusted before this device pins the root it holds.
    assert!(apply_server_list(Some(&record(&root, 1, &[a.clone(), b.clone()], &[]))).is_err());
    pin_root(&root.public_key().unwrap(), "vault").unwrap();
    assert!(pin_root(&VaultRoot::generate().public_key().unwrap(), "vault").is_err());
    assert_eq!(
        apply_server_list(Some(&record(&root, 1, &[a.clone(), b.clone()], &[]))).unwrap(),
        ListOutcome::Adopted
    );
    let b_endpoint = hex::encode([2u8; 32]);
    assert_eq!(trusted_peer(&b_endpoint), Some(b.device_id.clone()));
    // A peer cannot add a device over the LAN.
    assert!(!apply_peer_list(&record(&root, 2, &[a.clone(), b.clone(), c.clone()], &[])).unwrap());
    // A peer can spread a removal the server has not delivered yet.
    assert!(apply_peer_list(&record(&root, 2, &[a.clone()], &[b.clone()])).unwrap());
    assert_eq!(trusted_peer(&b_endpoint), None);
    // A server that withholds that removal does not bring B back.
    assert_eq!(
        apply_server_list(Some(&record(&root, 1, &[a.clone(), b.clone()], &[]))).unwrap(),
        ListOutcome::ServerBehind
    );
    assert_eq!(trusted_peer(&b_endpoint), None);
    // Another root's list is refused outright.
    assert!(
        apply_server_list(Some(&record(&VaultRoot::generate(), 3, &[a.clone()], &[]))).is_err()
    );
    close();
}
