use base64::{engine::general_purpose::STANDARD, Engine};
use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    protocol::{DeviceGrant, Envelope, Event, KeyEnvelope, Mutation, MAX_EVENT_BYTES},
};
use uuid::Uuid;

fn scope() -> VaultScope {
    VaultScope {
        deployment: "https://sync.example.test".into(),
        account_id: "fixture".into(),
        vault_id: Uuid::new_v4().to_string(),
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
        #[serde(alias = "workspace_id")]
        vault_id: String,
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
        vault_id: f.vault_id,
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

fn space_scopes() -> (VaultScope, VaultScope) {
    let personal = scope();
    let space = VaultScope {
        vault_id: Uuid::new_v4().to_string(),
        ..personal.clone()
    };
    (personal, space)
}

#[test]
fn space_root_opens_with_only_the_personal_root_and_its_own_vault() {
    let personal_root = VaultRoot::generate();
    let space_root = VaultRoot::generate();
    let (personal, space) = space_scopes();
    let public = space_root.public_key().unwrap();
    let sealed = personal_root
        .seal_space_root(&personal, &space, &space_root)
        .unwrap();
    let opened = personal_root
        .open_space_root(&personal, &space, &sealed, &public)
        .unwrap();
    assert_eq!(opened.public_key().unwrap(), public);

    // A root sealed for one Space vault never opens as another's.
    let other_space = VaultScope {
        vault_id: Uuid::new_v4().to_string(),
        ..space.clone()
    };
    assert!(personal_root
        .open_space_root(&personal, &other_space, &sealed, &public)
        .is_err());
    // Only the personal root it was sealed to opens it, under its own vault and account.
    assert!(VaultRoot::generate()
        .open_space_root(&personal, &space, &sealed, &public)
        .is_err());
    let moved = VaultScope {
        vault_id: Uuid::new_v4().to_string(),
        ..personal.clone()
    };
    assert!(personal_root
        .open_space_root(&moved, &space, &sealed, &public)
        .is_err());
    let other_account = |s: &VaultScope| VaultScope {
        account_id: "other".into(),
        ..s.clone()
    };
    assert!(personal_root
        .open_space_root(
            &other_account(&personal),
            &other_account(&space),
            &sealed,
            &public
        )
        .is_err());
    // The opened root must be the vault's root.
    let replacement = VaultRoot::generate().public_key().unwrap();
    assert!(personal_root
        .open_space_root(&personal, &space, &sealed, &replacement)
        .is_err());
    let mut tampered = sealed.clone();
    tampered.nonce = "AAAAAAAAAAAAAAAA".into();
    assert!(personal_root
        .open_space_root(&personal, &space, &tampered, &public)
        .is_err());
}

#[test]
fn space_root_is_never_sealed_across_accounts_or_to_itself() {
    let personal_root = VaultRoot::generate();
    let space_root = VaultRoot::generate();
    let (personal, space) = space_scopes();
    assert!(personal_root
        .seal_space_root(&personal, &personal, &space_root)
        .is_err());
    let elsewhere = VaultScope {
        account_id: "other".into(),
        ..space.clone()
    };
    assert!(personal_root
        .seal_space_root(&personal, &elsewhere, &space_root)
        .is_err());
    let deployment = VaultScope {
        deployment: "https://other.example.test".into(),
        ..space
    };
    assert!(personal_root
        .seal_space_root(&personal, &deployment, &space_root)
        .is_err());
}

// A fixed vector: the seal's key derivation and associated data must not drift,
// or every device would lose every Space vault at once.
#[test]
fn space_root_vector() {
    let personal_root = VaultRoot::from_transfer(
        &STANDARD
            .decode("ujKawYH8gLBFC+EKjBiDUx62nmC1GnfxuorHtndGp9c=")
            .unwrap(),
        "91yTWU89oT3xzu7MxdiFnw/8ICdDibMcw88Zmgw4VU8=",
    )
    .unwrap();
    let personal = VaultScope {
        deployment: "https://sync.example.test".into(),
        account_id: "fixture".into(),
        vault_id: "6f1c1a52-3b51-4f0e-9a37-2d7c1f0b8e11".into(),
    };
    let space = VaultScope {
        vault_id: "0b5a3e9c-8d4f-4c21-b6e7-5a9d2c1f7e30".into(),
        ..personal.clone()
    };
    let sealed = Envelope {
        version: 1,
        nonce: "PFBqzO9tZAZ9cits".into(),
        ciphertext: "dJgopodGTYLd5x52v6FkXtoEvtaQV9y/DPx6/X4QW3fd14R4U9Pqw1sKpLzN/LW2".into(),
    };
    let opened = personal_root
        .open_space_root(
            &personal,
            &space,
            &sealed,
            "Ty5PxxOKOPLtzRIA8qV18YdzeIJJs1Nv4zL+W0VOACA=",
        )
        .unwrap();
    assert_eq!(
        STANDARD.encode(opened.transfer_bytes().as_ref()),
        "wRKX1PowMqVK7Qbh1aXGN6Dru13uxxeSJZStrl8smG0="
    );
}
