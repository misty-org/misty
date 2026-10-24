use super::*;

fn scope(vault_id: &str) -> VaultScope {
    VaultScope {
        deployment: "https://misty.test".into(),
        account_id: "account".into(),
        vault_id: vault_id.into(),
    }
}

#[test]
fn clips_round_trip_and_stay_bound_to_their_slot() {
    let root = VaultRoot::generate();
    let vault = "00000000-0000-0000-0000-000000000001";
    let key = root.clipboard_key(&scope(vault)).unwrap();
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
    // Another device with the same root derives the same key.
    let same = VaultRoot::from_protected(root.protected_bytes())
        .unwrap()
        .clipboard_key(&scope(vault))
        .unwrap();
    assert!(same.open(3, &sealed).is_ok());
    // Another vault, or another root, cannot read it.
    let other_vault = root
        .clipboard_key(&scope("00000000-0000-0000-0000-000000000002"))
        .unwrap();
    assert!(other_vault.open(3, &sealed).is_err());
    let other_root = VaultRoot::generate().clipboard_key(&scope(vault)).unwrap();
    assert!(other_root.open(3, &sealed).is_err());
}
