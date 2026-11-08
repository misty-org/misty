use super::*;

const VAULT: &str = "01951d32-40ac-7000-8000-000000000001";

/// The cheapest parameters a sealed root may use, so tests stay quick.
fn light(root: &VaultRoot, password: &str) -> KeyEnvelope {
    let kdf = "argon2id-m65536-t2-p1.vault-v1".to_owned();
    let salt = [7u8; 32];
    let key = stretch(
        password,
        &salt,
        Params::new(65_536, 2, 1, Some(32)).unwrap(),
    )
    .unwrap();
    let nonce = [9u8; NONCE];
    let aad = root_aad(VAULT, &kdf).unwrap();
    let ciphertext = Aes256Gcm::new_from_slice(key.as_ref())
        .unwrap()
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: root.protected_bytes(),
                aad: &aad,
            },
        )
        .unwrap();
    KeyEnvelope {
        version: 1,
        kdf,
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    }
}

#[test]
fn the_right_password_opens_the_root_and_a_wrong_one_does_not() {
    let root = VaultRoot::generate();
    let public = public_key(&root).unwrap();
    let envelope = light(&root, "Correct1!horse");
    let opened = open_root(&envelope, VAULT, "Correct1!horse", &public).unwrap();
    assert_eq!(opened.protected_bytes(), root.protected_bytes());
    assert!(matches!(
        open_root(&envelope, VAULT, "Wrong1!horse", &public),
        Err(Error::Unlock)
    ));
}

#[test]
fn the_same_text_typed_on_another_keyboard_opens_it() {
    let root = VaultRoot::generate();
    let public = public_key(&root).unwrap();
    let composed = light(&root, "caf\u{e9}Secret1!");
    assert!(open_root(&composed, VAULT, "cafe\u{301}Secret1!", &public).is_ok());
}

#[test]
fn a_new_vault_uses_the_strong_parameters_and_they_open_it() {
    let root = VaultRoot::generate();
    let public = public_key(&root).unwrap();
    let envelope = seal_root(&root, VAULT, "Correct1!horse").unwrap();
    assert_eq!(envelope.kdf, "argon2id-m131072-t3-p1.vault-v1");
    assert_eq!(STANDARD.decode(&envelope.salt).unwrap().len(), 32);
    assert!(open_root(&envelope, VAULT, "Correct1!horse", &public).is_ok());
    let again = seal_root(&root, VAULT, "Correct1!horse").unwrap();
    assert_ne!(envelope.salt, again.salt, "every seal has its own salt");
}

#[test]
fn a_server_cannot_swap_the_root_or_weaken_the_derivation() {
    let root = VaultRoot::generate();
    let public = public_key(&root).unwrap();
    let envelope = light(&root, "Correct1!horse");
    // Sealed for another vault.
    assert!(matches!(
        open_root(
            &envelope,
            "01951d32-40ac-7000-8000-000000000002",
            "Correct1!horse",
            &public
        ),
        Err(Error::Unlock)
    ));
    // Another root, correctly sealed under the same password.
    let other = public_key(&VaultRoot::generate()).unwrap();
    assert!(matches!(
        open_root(&envelope, VAULT, "Correct1!horse", &other),
        Err(Error::Identity)
    ));
    for kdf in [
        "argon2id-m8-t1-p1.vault-v1",
        "argon2id-m65536-t1-p1.vault-v1",
        "argon2id-m99999999-t3-p1.vault-v1",
        "argon2id-m131072-t3-p1",
        "pbkdf2",
        "",
    ] {
        let weak = KeyEnvelope {
            kdf: kdf.into(),
            ..envelope.clone()
        };
        assert!(
            matches!(
                open_root(&weak, VAULT, "Correct1!horse", &public),
                Err(Error::Invalid)
            ),
            "{kdf}"
        );
    }
}

#[test]
fn transitions_verify_against_the_pinned_root_only() {
    let root = VaultRoot::generate();
    let public = public_key(&root).unwrap();
    let envelope = light(&root, "Correct1!horse");
    let signature = sign_transition(&root, VAULT, 2, &envelope).unwrap();
    assert!(verify_transition(&public, VAULT, 2, &envelope, &signature).is_ok());
    assert!(verify_transition(&public, VAULT, 3, &envelope, &signature).is_err());
    let other = light(&root, "Another1!pass");
    assert!(verify_transition(&public, VAULT, 2, &other, &signature).is_err());
    let forger = VaultRoot::generate();
    let forged = sign_transition(&forger, VAULT, 2, &envelope).unwrap();
    assert!(verify_transition(&public, VAULT, 2, &envelope, &forged).is_err());
}

fn keys() -> RecordKeys {
    RecordKeys::new(&VaultRoot::generate(), VAULT).unwrap()
}

#[test]
fn a_record_opens_to_exactly_what_was_sealed() {
    let keys = keys();
    let sealed = keys
        .seal("work", "bookmarks", "a", 1, 42, Some(b"{\"title\":\"x\"}"))
        .unwrap();
    let opened = keys
        .open(
            &keys.scope("work", "bookmarks").unwrap(),
            &keys.key("work", "bookmarks", "a").unwrap(),
            1,
            &sealed,
        )
        .unwrap();
    assert_eq!(
        opened,
        OpenedRecord {
            profile: "work".into(),
            collection: "bookmarks".into(),
            id: "a".into(),
            edited_at: 42,
            body: Some(b"{\"title\":\"x\"}".to_vec()),
        }
    );
}

#[test]
fn the_server_sees_no_names_and_no_plain_sizes() {
    let keys = keys();
    let scope = keys.scope("work", "bookmarks").unwrap();
    assert_eq!(scope.len(), 64);
    assert!(!scope.contains("work") && !scope.contains("bookmark"));
    assert_ne!(scope, keys.scope("school", "bookmarks").unwrap());
    assert_ne!(scope, keys.scope("work", "history").unwrap());
    assert_ne!(
        keys.key("work", "bookmarks", "a").unwrap(),
        keys.key("school", "bookmarks", "a").unwrap()
    );
    let another = RecordKeys::new(&VaultRoot::generate(), VAULT).unwrap();
    assert_ne!(scope, another.scope("work", "bookmarks").unwrap());
    let short = keys.seal("p", "c", "i", 1, 1, Some(b"x")).unwrap();
    let longer = keys.seal("p", "c", "i", 1, 1, Some(b"xxxx")).unwrap();
    assert_eq!(short.len(), longer.len(), "padding hides small differences");
    let sealed = keys
        .seal("work", "bookmarks", "secret-id", 1, 1, Some(b"secret"))
        .unwrap();
    assert!(!sealed.windows(6).any(|window| window == b"secret"));
}

#[test]
fn a_server_cannot_move_replay_or_alter_a_record() {
    let keys = keys();
    let (scope, key) = (
        keys.scope("p", "c").unwrap(),
        keys.key("p", "c", "a").unwrap(),
    );
    let sealed = keys.seal("p", "c", "a", 3, 1, Some(b"body")).unwrap();
    assert!(keys.open(&scope, &key, 3, &sealed).is_ok());
    // Served as an older or newer version.
    assert!(keys.open(&scope, &key, 2, &sealed).is_err());
    assert!(keys.open(&scope, &key, 4, &sealed).is_err());
    // Moved to another record or scope.
    let other_key = keys.key("p", "c", "b").unwrap();
    assert!(keys.open(&scope, &other_key, 3, &sealed).is_err());
    let other_scope = keys.scope("p", "d").unwrap();
    assert!(keys.open(&other_scope, &key, 3, &sealed).is_err());
    // Altered.
    let mut altered = sealed.clone();
    *altered.last_mut().unwrap() ^= 1;
    assert!(keys.open(&scope, &key, 3, &altered).is_err());
    // Too short to be anything.
    assert!(keys.open(&scope, &key, 3, &sealed[..10]).is_err());
}

#[test]
fn a_deletion_is_sealed_so_it_cannot_be_forged() {
    let keys = keys();
    let (scope, key) = (
        keys.scope("p", "c").unwrap(),
        keys.key("p", "c", "a").unwrap(),
    );
    let sealed = keys.seal("p", "c", "a", 2, 5, None).unwrap();
    let opened = keys.open(&scope, &key, 2, &sealed).unwrap();
    assert_eq!(opened.body, None);
    assert_eq!(opened.edited_at, 5);
    // Another vault's keys can't make or read one.
    let stranger = RecordKeys::new(&VaultRoot::generate(), VAULT).unwrap();
    let forged = stranger.seal("p", "c", "a", 2, 5, None).unwrap();
    assert!(keys.open(&scope, &key, 2, &forged).is_err());
}

#[test]
fn large_text_compresses_before_it_is_sealed() {
    let keys = keys();
    let text = "the same tab title again and again ".repeat(4000);
    let sealed = keys
        .seal("p", "c", "a", 1, 1, Some(text.as_bytes()))
        .unwrap();
    assert!(sealed.len() < text.len() / 4);
    let opened = keys
        .open(
            &keys.scope("p", "c").unwrap(),
            &keys.key("p", "c", "a").unwrap(),
            1,
            &sealed,
        )
        .unwrap();
    assert_eq!(opened.body.as_deref(), Some(text.as_bytes()));
}
