use super::*;
use crate::infra::devices::identity::DeviceIdentity;
use misty_browser_sync::crypto::VaultRoot;

fn member(id: char, key: u8) -> ListMember {
    ListMember {
        device_id: format!("device_00000000-0000-0000-0000-00000000000{id}"),
        public_key: STANDARD.encode([key; 32]),
    }
}

fn list(
    root: &VaultRoot,
    version: u64,
    admitted: &[ListMember],
    revoked: &[ListMember],
) -> DeviceList {
    let payload =
        DeviceList::next_payload("acct", "vault", version, 1, admitted, revoked, 1).unwrap();
    let record = SignedRecord::new(&payload, root.sign_device_record(&payload).unwrap());
    DeviceList::verify(&record, &root.public_key().unwrap()).unwrap()
}

#[test]
fn lists_verify_only_against_their_root_and_gossip_only_removes() {
    let root = VaultRoot::generate();
    let (a, b, c) = (member('a', 1), member('b', 2), member('c', 3));
    let first = list(&root, 1, &[a.clone(), b.clone()], &[]);
    assert!(first.admitted_key(&b.device_id).is_some());
    let other = VaultRoot::generate();
    assert!(DeviceList::verify(&first.record, &other.public_key().unwrap()).is_none());
    let mut tampered = first.record.clone();
    tampered.payload = STANDARD.encode(
        DeviceList::next_payload(
            "acct",
            "vault",
            1,
            1,
            &[a.clone(), b.clone(), c.clone()],
            &[],
            1,
        )
        .unwrap(),
    );
    assert!(DeviceList::verify(&tampered, &root.public_key().unwrap()).is_none());
    // Removing B is a removal-only extension; adding C is not; forgetting a
    // removal is not.
    let removal = list(&root, 2, &[a.clone()], &[b.clone()]);
    assert!(removal.is_removal_only_extension_of(&first));
    assert!(!list(&root, 2, &[a.clone(), b.clone(), c.clone()], &[])
        .is_removal_only_extension_of(&first));
    assert!(!list(&root, 3, &[a.clone()], &[]).is_removal_only_extension_of(&removal));
    assert!(!removal.is_removal_only_extension_of(&removal));
    // A key can't be both admitted and removed.
    let payload =
        DeviceList::next_payload("acct", "vault", 4, 1, &[a.clone()], &[a.clone()], 1).unwrap();
    let record = SignedRecord::new(&payload, root.sign_device_record(&payload).unwrap());
    assert!(DeviceList::verify(&record, &root.public_key().unwrap()).is_none());
}

#[test]
fn run_grants_verify_their_signer_and_expire() {
    let credentials = tempfile::tempdir().unwrap();
    let _ = misty_credential_store::configure_root(credentials.path().to_path_buf());
    let identity = DeviceIdentity::load("acct-grant", "device_aaaaaaaaaaaa").unwrap();
    let grant = RunGrant {
        account_id: "acct-grant".into(),
        grant_id: "rungrant_1".into(),
        requester_device_id: member('a', 1).device_id,
        target_device_id: member('b', 2).device_id,
        agent_id: String::new(),
        capabilities: vec!["folder.read".into()],
        scopes: vec!["scope-1".into()],
        issued_at: 1_000,
        expires_at: 2_000,
    };
    let payload = grant.payload().unwrap();
    let record = SignedRecord::new(&payload, identity.sign_record(&payload).unwrap());
    let verified = RunGrant::verify(&record, &identity.public_key(), 1_500).unwrap();
    assert!(verified.allows("scope-1", "folder.read"));
    assert!(!verified.allows("scope-1", "folder.send"));
    assert!(!verified.allows("scope-2", "folder.read"));
    assert!(RunGrant::verify(&record, &identity.public_key(), 2_000).is_none());
    assert!(RunGrant::verify(&record, &STANDARD.encode([9u8; 32]), 1_500).is_none());
    assert_eq!(
        RunGrant::claimed_requester(&record),
        Some(member('a', 1).device_id)
    );
}
