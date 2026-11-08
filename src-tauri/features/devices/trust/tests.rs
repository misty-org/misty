use super::*;

#[test]
fn a_session_is_trusted_once_registered_until_removed() {
    let directory = tempfile::tempdir().unwrap();
    set_storage_root(directory.path().to_path_buf());
    open("https://misty.test", "acct-trust", "device_trust_test").unwrap();
    assert!(!self_admitted());
    set_server_device_id("device_00000000-0000-0000-0000-00000000000a").unwrap();
    assert!(self_admitted());
    forget_after_removal();
    assert!(!self_admitted());
    close();
}
