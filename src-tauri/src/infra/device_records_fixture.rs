//! Writes records signed by this app's own code for the server's parsers to
//! check (`server/test/contract/http/api/testdata/device_records.json`), so
//! the two sides cannot drift. Regenerate with
//! MISTY_WRITE_DEVICE_FIXTURE=<path> cargo test --lib device_record_fixture.
use serde_json::json;

use super::{
    device_identity::{canonical_request, DeviceIdentity, ADMISSION_DOMAIN},
    device_records::{
        grant_payload, DeviceList, DevicePolicy, ListMember, RunGrant, SharedFolder, SignedRecord,
    },
};
use misty_browser_sync::crypto::VaultRoot;

const ISSUED_AT: i64 = 1_900_000_000;

#[test]
fn device_record_fixture() {
    let Some(path) = std::env::var_os("MISTY_WRITE_DEVICE_FIXTURE") else {
        return;
    };
    let credentials = tempfile::tempdir().unwrap();
    let _ = misty_credential_store::configure_root(credentials.path().to_path_buf());
    let account = "user_fixture";
    let vault = "00000000-0000-4000-8000-000000000001";
    let device = "device_00000000-0000-4000-8000-000000000002";
    let target = "device_00000000-0000-4000-8000-000000000003";
    let identity = DeviceIdentity::load(account, "device_aaaaaaaaaaaa").unwrap();
    let root = VaultRoot::generate();
    let record = |payload: Vec<u8>, signature: String| SignedRecord::new(&payload, signature);
    let grant = grant_payload(
        account,
        vault,
        device,
        1,
        &identity.public_key(),
        "",
        ISSUED_AT,
        "",
    )
    .unwrap();
    let grant = record(grant.clone(), root.sign_device_record(&grant).unwrap());
    let member = ListMember {
        device_id: device.into(),
        public_key: identity.public_key(),
    };
    let list = DeviceList::next_payload(account, vault, 1, 1, &[member], &[], ISSUED_AT).unwrap();
    let list = record(list.clone(), root.sign_device_record(&list).unwrap());
    let policy = DevicePolicy {
        version: 7,
        files: "view".into(),
        clipboard: false,
        agent_surfaces: vec!["folders".into(), "browser".into()],
        shared_folders: vec![SharedFolder {
            scope_id: "scope-1".into(),
            name: "Reports “2026”".into(),
        }],
    }
    .payload(account, device, ISSUED_AT)
    .unwrap();
    let policy = record(policy.clone(), identity.sign_record(&policy).unwrap());
    let run = RunGrant {
        account_id: account.into(),
        grant_id: "rungrant_00000000-0000-4000-8000-000000000004".into(),
        requester_device_id: device.into(),
        target_device_id: target.into(),
        agent_id: String::new(),
        capabilities: vec!["files.list".into(), "files.read".into()],
        scopes: vec!["scope-1".into()],
        issued_at: ISSUED_AT,
        expires_at: ISSUED_AT + 3600,
    }
    .payload()
    .unwrap();
    let run = record(run.clone(), identity.sign_record(&run).unwrap());
    let admission = serde_json::to_vec(&(
        ADMISSION_DOMAIN,
        account,
        device,
        identity.public_key(),
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "0000000000000000000000000000000000000000000000000000000000000000",
        ISSUED_AT,
    ))
    .unwrap();
    let admission = record(admission.clone(), identity.sign_record(&admission).unwrap());
    let canonical = canonical_request(
        "POST",
        "/api/devices/x/admit",
        "1900000000",
        "bm9uY2U=",
        &"ab".repeat(32),
    );
    let fixture = json!({
        "accountId": account, "vaultId": vault, "rootPublicKey": root.public_key().unwrap(),
        "deviceId": device, "devicePublicKey": identity.public_key(), "targetDeviceId": target, "issuedAt": ISSUED_AT,
        "grant": grant, "list": list, "policy": policy, "runGrant": run, "admission": admission,
        "registration": {"endpointId": identity.endpoint_id(), "proof": identity.registration_proof(account, ISSUED_AT).unwrap()},
        "channel": {"instance": "instance-1", "challenge": "challenge-1",
            "signature": identity.channel_proof(account, device, "instance-1", "challenge-1").unwrap()},
        "request": {"canonical": canonical, "signature": identity.sign_request(&canonical)},
    });
    std::fs::write(path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();
}
