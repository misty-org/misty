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
    let label = new_label(false);
    assert!(is_person_window(&label));
    assert!(!is_incognito_window(&label));
    // A window has no profile until it is given one.
    assert_eq!(profile_for_window(&label), None);
    set_current(&label, window(PERSONAL));
    assert_eq!(profile_for_window(&label).as_deref(), Some(PERSONAL));
    assert!(profile_is_open(PERSONAL));
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
fn incognito_windows_belong_to_a_profile_without_its_trust() {
    let label = new_label(true);
    assert!(label.starts_with("incognito-"));
    set_current(&label, window(PERSONAL));
    assert_eq!(
        parse(&label),
        Some(ProfileWindow {
            profile: PERSONAL.into(),
            incognito: true
        })
    );
    assert!(is_app_window(&label));
    assert!(is_incognito_window(&label));
    assert!(!is_person_window(&label));
    forget_current(&label);
}

#[test]
fn a_profiles_incognito_windows_share_a_session_until_the_last_closes() {
    let mut state = Registry::default();
    join_incognito(&mut state, PERSONAL, "incognito-1");
    join_incognito(&mut state, PERSONAL, "incognito-2");
    let personal = state.incognito[PERSONAL].session.clone();
    assert_eq!(leave_incognito(&mut state, PERSONAL, "incognito-1"), None);
    join_incognito(&mut state, ID, "incognito-1");
    assert_ne!(state.incognito[ID].session, personal);
    assert_eq!(
        leave_incognito(&mut state, PERSONAL, "incognito-2"),
        Some(personal)
    );
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
    assert!(super::super::browser_profile::data_store_identifier(Some(&second)).is_ok());
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

#[test]
fn colors_are_the_palette_or_a_custom_hex() {
    assert!(valid_color("blue"));
    assert!(valid_color("#a1b2c3"));
    assert!(!valid_color("#A1B2C3"));
    assert!(!valid_color("teal"));
    let mut profiles = BTreeMap::new();
    assert_eq!(next_color(&profiles), "blue");
    profiles.insert(
        PERSONAL.into(),
        ProfileEntry {
            id: PERSONAL.into(),
            name: "Personal".into(),
            color: Some("blue".into()),
            ..Default::default()
        },
    );
    assert_eq!(next_color(&profiles), "red");
}
