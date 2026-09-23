//! Generates public TEST vectors, never production credentials. Redirect stdout
//! to tests/fixtures/protocol-v1.json and copy it to the backend's testdata.
use base64::{engine::general_purpose::STANDARD, Engine};
use misty_browser_sync::crypto::{DeviceKey, VaultRoot, VaultScope};
use serde_json::json;

fn main() {
    let scope = VaultScope {
        deployment: "https://sync.example.test".into(),
        account_id: "fixture-account".into(),
        workspace_id: "01951d32-40ac-7000-8000-000000000001".into(),
    };
    let device_id = "01951d32-40ac-7000-8000-000000000002";
    let operation_id = "01951d32-40ac-7000-8000-000000000003";
    let challenge = "test-challenge-0123456789-abcdefghij";
    let password = "public test password, never use this";
    let secret = STANDARD.encode([7u8; 32]);
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let grant = root.grant(&scope, device_id, 1, &device).unwrap();
    let plaintext = r#"{"kind":"fixture","cookie":"not-a-real-session"}"#;
    let mutation = root
        .seal_mutation(
            &scope,
            &grant,
            &device,
            operation_id,
            1,
            plaintext.as_bytes(),
        )
        .unwrap();
    let fixture = json!({
        "warning": "Public test credentials. Not a real account or session.",
        "deployment": scope.deployment,
        "account_id": scope.account_id,
        "workspace_id": scope.workspace_id,
        "password": password,
        "sync_secret": secret,
        "root_public_key": root.public_key().unwrap(),
        "key_envelope": root.wrap(&scope, password, &secret).unwrap(),
        "device_key": device.protect(&root, &scope, device_id).unwrap(),
        "grant_signing_bytes": String::from_utf8(grant.signing_bytes().unwrap()).unwrap(),
        "mutation_signing_bytes": String::from_utf8(mutation.signing_bytes().unwrap()).unwrap(),
        "grant": grant,
        "mutation": mutation,
        "plaintext": plaintext,
        "challenge": challenge,
        "connection_signing_bytes": serde_json::to_string(&("misty.sync.connect.v1", &scope.workspace_id, device_id, challenge)).unwrap(),
        "connection_signature": device.connection_proof(&scope, device_id, challenge).unwrap(),
    });
    println!("{}", serde_json::to_string_pretty(&fixture).unwrap());
}
