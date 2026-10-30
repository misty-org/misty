use misty_browser_sync::{
    crypto::{generate_sync_secret, AccountKeys, DeviceKey, VaultRoot, VaultScope},
    document::Document,
    protocol::{KeyEnvelope, KeyTransition, Vault},
    store::{CachedVault, Store},
    Error,
};
use uuid::Uuid;

const DEPLOYMENT: &str = "https://sync.example.test/v1";
const EMAIL: &str = "person@example.test";
const PASSWORD: &str = "a long public fixture password";

fn scope() -> VaultScope {
    VaultScope {
        deployment: "https://sync.example.test/v1".into(),
        account_id: "fixture".into(),
        vault_id: Uuid::new_v4().to_string(),
    }
}

fn keys() -> AccountKeys {
    AccountKeys::derive(DEPLOYMENT, EMAIL, PASSWORD).unwrap()
}

fn vault_with(scope: &VaultScope, root: &VaultRoot, envelope: KeyEnvelope) -> Vault {
    Vault {
        vault_id: scope.vault_id.clone(),
        key_epoch: 1,
        head_sequence: 0,
        root_public_key: root.public_key().unwrap(),
        key_envelope: Some(envelope),
        space_key_envelope: None,
        key_transition: None,
    }
}

fn cached(vault: Vault) -> CachedVault {
    CachedVault {
        vault,
        bootstrap_pending: false,
        enrollment_pending: false,
    }
}

#[test]
fn the_login_credential_is_stable_and_depends_on_the_whole_password() {
    let first = keys();
    assert_eq!(first.login_credential().len(), 43);
    assert_eq!(first.login_credential(), keys().login_credential());
    // The email is case and space insensitive, so a retyped address still works.
    let retyped = AccountKeys::derive(DEPLOYMENT, "  Person@Example.TEST ", PASSWORD).unwrap();
    assert_eq!(first.login_credential(), retyped.login_credential());
    for other in [
        AccountKeys::derive(DEPLOYMENT, EMAIL, "a long public fixture passworD").unwrap(),
        AccountKeys::derive(DEPLOYMENT, "someone@example.test", PASSWORD).unwrap(),
    ] {
        assert_ne!(first.login_credential(), other.login_credential());
    }
    assert!(AccountKeys::derive(DEPLOYMENT, "", PASSWORD).is_err());
    assert!(AccountKeys::derive("", EMAIL, PASSWORD).is_err());
    assert!(AccountKeys::derive(DEPLOYMENT, EMAIL, "").is_err());
}

#[test]
fn the_same_text_in_another_unicode_form_gives_the_same_keys() {
    let composed = AccountKeys::derive(
        DEPLOYMENT,
        "j\u{e9}r\u{f4}me@example.test",
        "caf\u{e9} au lait 2026",
    )
    .unwrap();
    let decomposed = AccountKeys::derive(
        DEPLOYMENT,
        "je\u{301}ro\u{302}me@example.test",
        "cafe\u{301} au lait 2026",
    )
    .unwrap();
    assert_eq!(composed.login_credential(), decomposed.login_credential());
    // Full-width forms fold to the ones they imitate.
    let fullwidth =
        AccountKeys::derive(DEPLOYMENT, EMAIL, "\u{ff41} long public fixture password").unwrap();
    let plain = AccountKeys::derive(DEPLOYMENT, EMAIL, "a long public fixture password").unwrap();
    assert_eq!(fullwidth.login_credential(), plain.login_credential());
}

#[test]
fn the_credential_is_bound_to_the_server_it_is_sent_to() {
    let here = keys();
    let elsewhere = AccountKeys::derive("https://other.example.test/v1", EMAIL, PASSWORD).unwrap();
    // The same email and password give another server another credential.
    assert_ne!(here.login_credential(), elsewhere.login_credential());
    // The address is compared without a trailing slash or letter case.
    let retyped = AccountKeys::derive("HTTPS://Sync.Example.Test/v1/", EMAIL, PASSWORD).unwrap();
    assert_eq!(here.login_credential(), retyped.login_credential());
}

#[test]
fn the_account_wrapper_opens_only_with_the_same_password_and_vault() {
    let scope = scope();
    let root = VaultRoot::generate();
    let wrapper = root.wrap_account(&scope, &keys()).unwrap();
    assert!(wrapper.is_account());
    let public = root.public_key().unwrap();

    let opened = VaultRoot::unlock_account(&scope, &wrapper, &keys(), &public).unwrap();
    assert_eq!(opened.public_key().unwrap(), public);

    let wrong = AccountKeys::derive(DEPLOYMENT, EMAIL, "a different public password").unwrap();
    assert!(matches!(
        VaultRoot::unlock_account(&scope, &wrapper, &wrong, &public),
        Err(Error::Unlock)
    ));
    // The pinned root public key must match what was unwrapped.
    let other = VaultRoot::generate().public_key().unwrap();
    assert!(matches!(
        VaultRoot::unlock_account(&scope, &wrapper, &keys(), &other),
        Err(Error::Identity)
    ));
    // A wrapper is bound to its vault: moved to another vault it does not open.
    let moved = VaultScope {
        vault_id: Uuid::new_v4().to_string(),
        ..scope.clone()
    };
    assert!(VaultRoot::unlock_account(&moved, &wrapper, &keys(), &public).is_err());
    // A legacy wrapper is not an account wrapper.
    let legacy = root
        .wrap(&scope, PASSWORD, &generate_sync_secret())
        .unwrap();
    assert!(!legacy.is_account());
    assert!(VaultRoot::unlock_account(&scope, &legacy, &keys(), &public).is_err());
}

#[test]
fn each_account_wrapper_uses_a_fresh_salt() {
    let scope = scope();
    let root = VaultRoot::generate();
    let a = root.wrap_account(&scope, &keys()).unwrap();
    let b = root.wrap_account(&scope, &keys()).unwrap();
    assert_ne!(a.salt, b.salt);
    assert_ne!(a.ciphertext, b.ciphertext);
}

#[test]
fn a_key_transition_covers_one_vault_one_wrapper_and_one_generation() {
    let scope = scope();
    let root = VaultRoot::generate();
    let public = root.public_key().unwrap();
    let wrapper = root.wrap_account(&scope, &keys()).unwrap();
    let transition = root.sign_key_transition(&scope, 1, &wrapper).unwrap();
    transition
        .verify(&public, &scope.vault_id, &wrapper)
        .unwrap();

    // Another wrapper, vault, generation or signer does not verify.
    let other_wrapper = root.wrap_account(&scope, &keys()).unwrap();
    assert!(transition
        .verify(&public, &scope.vault_id, &other_wrapper)
        .is_err());
    assert!(transition
        .verify(&public, &Uuid::new_v4().to_string(), &wrapper)
        .is_err());
    let raised = KeyTransition {
        generation: 2,
        signature: transition.signature.clone(),
    };
    assert!(raised.verify(&public, &scope.vault_id, &wrapper).is_err());
    let stranger = VaultRoot::generate().public_key().unwrap();
    assert!(transition
        .verify(&stranger, &scope.vault_id, &wrapper)
        .is_err());
}

#[test]
fn a_device_adopts_a_new_wrapper_only_with_a_root_signed_higher_generation() {
    let scope = scope();
    let root = VaultRoot::generate();
    let legacy = root
        .wrap(&scope, PASSWORD, &generate_sync_secret())
        .unwrap();
    let pinned = cached(vault_with(&scope, &root, legacy));

    let account = root.wrap_account(&scope, &keys()).unwrap();
    let transition = root.sign_key_transition(&scope, 1, &account).unwrap();
    let rotated = Vault {
        key_envelope: Some(account.clone()),
        key_transition: Some(transition.clone()),
        ..pinned.vault.clone()
    };
    pinned.check_remote(&rotated).unwrap();
    assert!(pinned.is_rotation(&rotated));
    assert!(!pinned.is_rotation(&pinned.vault));

    // The server alone cannot swap the wrapper: no transition, a forged one,
    // one signed by another root, or one that is not newer is refused.
    let unsigned = Vault {
        key_envelope: Some(account.clone()),
        key_transition: None,
        ..pinned.vault.clone()
    };
    assert!(matches!(
        pinned.check_remote(&unsigned),
        Err(Error::Recovery)
    ));
    let forged = Vault {
        key_transition: Some(KeyTransition {
            generation: 1,
            signature: transition.signature.replace(['A', 'a'], "B"),
        }),
        ..rotated.clone()
    };
    assert!(pinned.check_remote(&forged).is_err());
    let stranger = VaultRoot::generate();
    let by_stranger = Vault {
        key_transition: Some(stranger.sign_key_transition(&scope, 1, &account).unwrap()),
        ..rotated.clone()
    };
    assert!(pinned.check_remote(&by_stranger).is_err());
    // Generation 0 is the original wrapper and cannot be signed.
    assert!(root.sign_key_transition(&scope, 0, &account).is_err());
    // Once a device has adopted generation 1, another wrapper at generation 1
    // (or lower) is not newer and is refused.
    let adopted = cached(rotated.clone());
    let same_generation = root.wrap_account(&scope, &keys()).unwrap();
    let replay = Vault {
        key_envelope: Some(same_generation.clone()),
        key_transition: Some(
            root.sign_key_transition(&scope, 1, &same_generation)
                .unwrap(),
        ),
        ..rotated.clone()
    };
    assert!(adopted.check_remote(&replay).is_err());
    // A rotation back to a legacy wrapper is not allowed either.
    let back = root
        .wrap(&scope, PASSWORD, &generate_sync_secret())
        .unwrap();
    let downgrade = Vault {
        key_envelope: Some(back.clone()),
        key_transition: Some(root.sign_key_transition(&scope, 1, &back).unwrap()),
        ..pinned.vault.clone()
    };
    assert!(pinned.check_remote(&downgrade).is_err());
}

#[test]
fn a_password_change_replaces_the_pinned_wrapper_and_blocks_replays() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    let scope = scope();
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let first = root.wrap_account(&scope, &keys()).unwrap();
    let pinned = cached(vault_with(&scope, &root, first.clone()));
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let mut store = Store::initialize_vault(
        &path,
        scope.clone(),
        grant,
        &root,
        &device,
        &Document::default().encode().unwrap(),
        Some(&pinned),
    )
    .unwrap();

    // Changing the password: a new wrapper under new keys, signed by the root.
    let changed = AccountKeys::derive(DEPLOYMENT, EMAIL, "a changed public password").unwrap();
    let second = root.wrap_account(&scope, &changed).unwrap();
    let transition = root.sign_key_transition(&scope, 1, &second).unwrap();
    let rotated = Vault {
        key_envelope: Some(second.clone()),
        key_transition: Some(transition),
        ..pinned.vault.clone()
    };
    store.adopt_rotated_vault(&rotated).unwrap();
    let saved = store.cached_vault().unwrap().unwrap();
    assert!(saved.vault.key_envelope.as_ref() == Some(&second));
    assert_eq!(saved.vault.key_generation(), 1);
    // The new password opens it; the old one no longer does.
    let public = root.public_key().unwrap();
    VaultRoot::unlock_account(&scope, &second, &changed, &public).unwrap();
    assert!(VaultRoot::unlock_account(&scope, &second, &keys(), &public).is_err());

    // A server replaying the first wrapper (generation 0) after the change is refused.
    assert!(saved.check_remote(&pinned.vault).is_err());
    assert!(store.adopt_rotated_vault(&pinned.vault).is_err());
}
