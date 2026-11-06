use super::*;

#[test]
fn clips_round_trip_and_stay_bound_to_their_slot() {
    let root = VaultRoot::generate();
    let vault = "00000000-0000-0000-0000-000000000001";
    let key = root.vault_clipboard_key(vault).unwrap();
    let sealed = key.seal(3, b"copied text").unwrap();
    assert_eq!(&**key.open(3, &sealed).unwrap(), b"copied text");
    assert!(key.open(4, &sealed).is_err());
    assert!(key.seal(crate::collections::CLIPBOARD_SLOTS, b"x").is_err());
    assert!(key.seal(0, &vec![0; ClipboardKey::capacity() + 1]).is_err());
    assert!(
        key.seal(0, &vec![0; ClipboardKey::capacity()])
            .unwrap()
            .len()
            <= MAX_SEALED_CLIP_BYTES
    );
    // Another session with the same root derives the same key.
    let same = VaultRoot::from_protected(root.protected_bytes())
        .unwrap()
        .vault_clipboard_key(vault)
        .unwrap();
    assert!(same.open(3, &sealed).is_ok());
    // Another vault, or another root, cannot read it.
    let other_vault = root
        .vault_clipboard_key("00000000-0000-0000-0000-000000000002")
        .unwrap();
    assert!(other_vault.open(3, &sealed).is_err());
    let other_root = VaultRoot::generate().vault_clipboard_key(vault).unwrap();
    assert!(other_root.open(3, &sealed).is_err());
}
