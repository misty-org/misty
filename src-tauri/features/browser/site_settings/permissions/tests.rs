// Decision rules are tested in Kiri (features/kiri/src/permissions.rs); this covers Misty's
// profile keys.
use super::*;

#[test]
fn profile_keys_match_webkit_store_identifiers() {
    let key = store_key(Some(&"ab".repeat(32))).unwrap();
    assert_eq!(key, key.to_uppercase());
    assert_eq!(key.len(), 36);
    assert!(store_key(Some("not-a-profile")).is_err());
}
