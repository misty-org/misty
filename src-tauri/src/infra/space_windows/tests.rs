use super::*;

const ID: &str = "space_01951d32-40ac-7000-8000-000000000001";

#[test]
fn labels_name_a_window_and_its_space_is_kept_natively() {
    let key = space_key(ID, false).unwrap();
    assert_eq!(key, ID);
    assert_eq!(space_id_for_key(&key).as_deref(), Some(ID));
    assert!(space_key("personal", false).is_err());
    assert!(space_key("space_1/..", false).is_err());
    assert_eq!(space_id_for_key(PERSONAL), None);

    let label = new_label(false);
    assert!(is_space_window(&label));
    assert!(!is_incognito_window(&label));
    // A window shows no Space until it is given one.
    assert_eq!(space_for_window(&label), None);
    set_current(&label, PERSONAL);
    assert_eq!(space_for_window(&label).as_deref(), Some(PERSONAL));
    // Switching changes the Space the same window shows.
    set_current(&label, &key);
    assert_eq!(space_for_window(&label), Some(key.clone()));
    assert!(space_is_open(&key));
    assert_eq!(forget_current(&label), Some(key.clone()));
    assert_eq!(space_for_window(&label), None);

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
        assert_eq!(space_for_window(unknown), None, "{unknown}");
        assert!(!is_app_window(unknown), "{unknown}");
    }
}

#[test]
fn incognito_windows_show_a_space_without_its_trust() {
    let label = new_label(true);
    assert!(label.starts_with("incognito-"));
    set_current(&label, PERSONAL);
    assert_eq!(
        parse(&label),
        Some(SpaceWindow {
            space: PERSONAL.into(),
            incognito: true
        })
    );
    assert!(is_app_window(&label));
    assert!(is_incognito_window(&label));
    assert!(!is_space_window(&label));
    forget_current(&label);
}

#[test]
fn incognito_sessions_follow_the_space_a_window_shows() {
    let mut state = Registry::default();
    join_incognito(&mut state, PERSONAL, "incognito-1");
    join_incognito(&mut state, PERSONAL, "incognito-2");
    let personal = state.incognito[PERSONAL].session.clone();
    // One window switching away leaves the Space's session to the other.
    assert_eq!(leave_incognito(&mut state, PERSONAL, "incognito-1"), None);
    join_incognito(&mut state, ID, "incognito-1");
    assert_ne!(state.incognito[ID].session, personal);
    // The last window leaving ends the session.
    assert_eq!(
        leave_incognito(&mut state, PERSONAL, "incognito-2"),
        Some(personal)
    );
}

#[test]
fn each_space_has_its_own_store_and_personal_keeps_the_vault_store() {
    let a = space_store_identity(&space_key(ID, false).unwrap()).unwrap();
    let b = space_store_identity(
        &space_key("space_01951d32-40ac-7000-8000-000000000002", false).unwrap(),
    )
    .unwrap();
    assert_eq!(a.len(), 64);
    assert_ne!(a, b);
    assert!(super::super::browser_profile::data_store_identifier(Some(&a)).is_ok());
    assert_eq!(space_store_identity(PERSONAL), None);
}

#[test]
fn colors_are_the_palette_or_a_custom_hex() {
    assert!(valid_color("blue"));
    assert!(valid_color("#a1b2c3"));
    assert!(!valid_color("#A1B2C3"));
    assert!(!valid_color("teal"));
    let mut spaces = BTreeMap::new();
    assert_eq!(next_color(&spaces), "blue");
    spaces.insert(
        "personal".into(),
        SpaceEntry {
            key: "personal".into(),
            space_id: None,
            name: "Personal".into(),
            color: Some("blue".into()),
            ..Default::default()
        },
    );
    assert_eq!(next_color(&spaces), "red");
}
