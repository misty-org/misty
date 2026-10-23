use super::*;

#[test]
fn both_devices_derive_the_same_code_and_seal_key_from_one_exchange() {
    let requester = StaticSecret::from(random32());
    let approver = StaticSecret::from(random32());
    let requester_public = *XPublic::from(&requester).as_bytes();
    let approver_public = *XPublic::from(&approver).as_bytes();
    let script = transcript(
        "acct",
        "admission_1",
        "payload",
        &STANDARD.encode(approver_public),
        "a",
        "r",
    );
    assert_eq!(
        seal_key(&approver, &requester_public, &script).as_ref(),
        seal_key(&requester, &approver_public, &script).as_ref()
    );
    let code = comparison_code(&script);
    assert_eq!(code.len(), 6);
    assert!(code.bytes().all(|b| b.is_ascii_digit()));
    // Any substituted part changes the code and the key.
    let swapped = transcript(
        "acct",
        "admission_1",
        "other payload",
        &STANDARD.encode(approver_public),
        "a",
        "r",
    );
    assert_ne!(
        seal_key(&approver, &requester_public, &script).as_ref(),
        seal_key(&approver, &requester_public, &swapped).as_ref()
    );
    let intruder = StaticSecret::from(random32());
    assert_ne!(
        seal_key(&intruder, &requester_public, &script).as_ref(),
        seal_key(&requester, &approver_public, &script).as_ref()
    );
}
