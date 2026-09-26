use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    protocol::{DeviceGrant, Envelope, Event, KeyEnvelope, Mutation, MAX_EVENT_BYTES},
};
use uuid::Uuid;

fn scope() -> VaultScope {
    VaultScope {
        deployment: "https://sync.example.test".into(),
        account_id: "fixture".into(),
        workspace_id: Uuid::new_v4().to_string(),
    }
}

#[test]
fn wrapped_root_requires_both_secrets_and_original_account_identity() {
    let root = VaultRoot::generate();
    let scope = scope();
    let secret = generate_sync_secret();
    let public = root.public_key().unwrap();
    let wrapper = root
        .wrap(&scope, "test password for fixture", &secret)
        .unwrap();
    let restored = VaultRoot::unlock(
        &scope,
        &wrapper,
        "test password for fixture",
        &secret,
        &public,
    )
    .unwrap();
    assert_eq!(restored.public_key().unwrap(), public);
    assert!(VaultRoot::unlock(&scope, &wrapper, "incorrect password", &secret, &public).is_err());
    assert!(VaultRoot::unlock(
        &scope,
        &wrapper,
        "test password for fixture",
        &generate_sync_secret(),
        &public
    )
    .is_err());
    let mut other = scope.clone();
    other.account_id = "other".into();
    assert!(VaultRoot::unlock(
        &other,
        &wrapper,
        "test password for fixture",
        &secret,
        &public
    )
    .is_err());
    let replacement = VaultRoot::generate().public_key().unwrap();
    assert!(VaultRoot::unlock(
        &scope,
        &wrapper,
        "test password for fixture",
        &secret,
        &replacement
    )
    .is_err());
    let unsupported = KeyEnvelope {
        kdf: "argon2id-m1-t1-p1".into(),
        ..wrapper
    };
    assert!(VaultRoot::unlock(
        &scope,
        &unsupported,
        "test password for fixture",
        &secret,
        &public
    )
    .is_err());
}

#[test]
fn signed_mutations_bind_device_operation_epoch_and_account() {
    let root = VaultRoot::generate();
    let scope = scope();
    let device = DeviceKey::generate();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let operation = Uuid::new_v4().to_string();
    let a = root
        .seal_mutation(&scope, &grant, &device, &operation, 1, b"cookie-fixture")
        .unwrap();
    let b = root
        .seal_mutation(&scope, &grant, &device, &operation, 1, b"cookie-fixture")
        .unwrap();
    assert_ne!(a.envelope.nonce, b.envelope.nonce);
    assert_eq!(
        &**root.open_mutation(&scope, &grant, &a).unwrap(),
        b"cookie-fixture"
    );
    let mut other = scope.clone();
    other.deployment = "https://other.example.test".into();
    assert!(root.open_mutation(&other, &grant, &a).is_err());
    for variant in 0..5 {
        let mut changed = a.clone();
        match variant {
            0 => changed.operation_id = Uuid::new_v4().to_string(),
            1 => changed.device_counter = 2,
            2 => changed.key_epoch = 2,
            3 => changed.envelope = b.envelope.clone(),
            _ => changed.device_id = Uuid::new_v4().to_string(),
        }
        assert!(root.open_mutation(&scope, &grant, &changed).is_err());
    }
    assert!(root
        .seal_mutation(
            &scope,
            &grant,
            &device,
            &operation,
            2,
            &vec![0; MAX_EVENT_BYTES]
        )
        .is_err());
    let serialized = serde_json::to_string(&Event {
        mutation: a.clone(),
        sequence: 1,
    })
    .unwrap();
    let decoded: Event = serde_json::from_str(&serialized).unwrap();
    assert_eq!(decoded.sequence, 1);
    assert_eq!(
        decoded.mutation.signing_bytes().unwrap(),
        a.signing_bytes().unwrap()
    );
    let fractional = serde_json::to_string(&a)
        .unwrap()
        .replace("\"device_counter\":1", "\"device_counter\":1.5");
    assert!(serde_json::from_str::<Mutation>(&fractional).is_err());
}

#[test]
fn shared_rust_go_protocol_fixture_stays_compatible() {
    #[derive(serde::Deserialize)]
    struct Fixture {
        deployment: String,
        account_id: String,
        workspace_id: String,
        password: String,
        sync_secret: String,
        root_public_key: String,
        key_envelope: KeyEnvelope,
        device_key: Envelope,
        grant: DeviceGrant,
        mutation: Mutation,
        grant_signing_bytes: String,
        mutation_signing_bytes: String,
        challenge: String,
        connection_signature: String,
        plaintext: String,
    }
    let f: Fixture = serde_json::from_str(include_str!("fixtures/protocol-v1.json")).unwrap();
    let scope = VaultScope {
        deployment: f.deployment,
        account_id: f.account_id,
        workspace_id: f.workspace_id,
    };
    let root = VaultRoot::unlock(
        &scope,
        &f.key_envelope,
        &f.password,
        &f.sync_secret,
        &f.root_public_key,
    )
    .unwrap();
    root.verify_grant(&scope, &f.grant).unwrap();
    let device = DeviceKey::restore(&root, &scope, &f.grant.device_id, &f.device_key).unwrap();
    assert_eq!(device.public_key(), f.grant.public_key);
    assert_eq!(
        f.grant.signing_bytes().unwrap(),
        f.grant_signing_bytes.as_bytes()
    );
    assert_eq!(
        f.mutation.signing_bytes().unwrap(),
        f.mutation_signing_bytes.as_bytes()
    );
    assert_eq!(
        &**root.open_mutation(&scope, &f.grant, &f.mutation).unwrap(),
        f.plaintext.as_bytes()
    );
    assert_eq!(
        device
            .connection_proof(&scope, &f.grant.device_id, &f.challenge)
            .unwrap(),
        f.connection_signature
    );
}
