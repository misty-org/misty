use super::*;
use crate::infra::devices::identity::DeviceIdentity;

fn device(id: char) -> String {
    format!("device_00000000-0000-0000-0000-00000000000{id}")
}

#[test]
fn run_grants_verify_their_signer_and_expire() {
    let credentials = tempfile::tempdir().unwrap();
    let _ = misty_credential_store::configure_root(credentials.path().to_path_buf());
    let identity = DeviceIdentity::load("acct-grant", "device_aaaaaaaaaaaa").unwrap();
    let grant = RunGrant {
        account_id: "acct-grant".into(),
        grant_id: "rungrant_1".into(),
        requester_device_id: device('a'),
        target_device_id: device('b'),
        agent_id: String::new(),
        chat_key: "chat-1".to_owned(),
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
}
