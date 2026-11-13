use super::*;

const ID: &str = "01951d32-40ac-7000-8000-000000000001";

fn window(profile: &str) -> WindowState {
    WindowState {
        profile: profile.into(),
        window_id: "w1".into(),
        space: None,
    }
}

#[test]
fn labels_name_a_window_and_its_profile_is_kept_natively() {
    let label = new_label();
    assert!(is_person_window(&label));
    // A window has no profile until it is given one.
    assert_eq!(profile_for_window(&label), None);
    set_current(&label, window(PERSONAL));
    assert_eq!(profile_for_window(&label).as_deref(), Some(PERSONAL));
    forget_current(&label);
    assert_eq!(profile_for_window(&label), None);

    for unknown in [
        "main",
        "window-",
        "window-0",
        "window-01",
        "window-x",
        "space-personal",
        "incognito-",
        "incognito-0",
        "misty-agent-01951d32-40ac-7000-8000-000000000001",
        "misty-dock-1",
        "browser-1",
    ] {
        assert_eq!(profile_for_window(unknown), None, "{unknown}");
        assert!(!is_app_window(unknown), "{unknown}");
    }
}

#[test]
fn the_original_store_belongs_to_the_first_account_to_ask() {
    let mut state = Registry {
        scope: "https://a|one".into(),
        ..Default::default()
    };
    assert_eq!(
        state.store(PERSONAL),
        None,
        "first account keeps its sign-ins"
    );
    assert_eq!(state.store(PERSONAL), None, "and keeps them every time");
    state.scope = "https://a|two".into();
    let second = state.store(PERSONAL).expect("a second account has its own");
    assert_eq!(second.len(), 64);
    assert!(crate::browser::site_data::profile_store::data_store_identifier(Some(&second)).is_ok());
    state.scope = "https://a|one".into();
    assert_eq!(state.store(PERSONAL), None);
}

#[test]
fn the_first_account_to_sign_in_takes_the_original_store_from_signed_out_browsing() {
    let mut state = Registry {
        scope: LOCAL_SCOPE.into(),
        ..Default::default()
    };
    assert_eq!(state.store(PERSONAL), None, "signed out at launch");
    state.scope = "https://a|one".into();
    assert_eq!(state.store(PERSONAL), None, "the sign-ins come along");
    state.scope = LOCAL_SCOPE.into();
    assert!(
        state.store(PERSONAL).is_some(),
        "signed out again: a new store"
    );
    state.scope = "https://a|two".into();
    assert!(
        state.store(PERSONAL).is_some(),
        "only the first account gets it"
    );
}

#[test]
fn a_profile_keeps_one_store_and_no_two_profiles_share_one() {
    let mut state = Registry {
        scope: "s".into(),
        ..Default::default()
    };
    let first = state.store(ID).unwrap();
    assert_eq!(state.store(ID).unwrap(), first);
    assert_ne!(
        state.store("01951d32-40ac-7000-8000-000000000002").unwrap(),
        first
    );
    state.scope = "other".into();
    assert_ne!(
        state.store(ID).unwrap(),
        first,
        "accounts never share a store"
    );
}

#[test]
fn every_account_always_has_its_first_profile() {
    let mut state = Registry {
        scope: "s".into(),
        ..Default::default()
    };
    assert!(state.current().contains_key(PERSONAL));
    assert!(state.current()[PERSONAL].color.is_some());
}
