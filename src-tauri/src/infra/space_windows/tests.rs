use super::*;

const ID: &str = "01951d32-40ac-7000-8000-000000000001";

#[test]
fn labels_name_a_space_and_nothing_else() {
    let key = space_key(ID, false).unwrap();
    assert_eq!(key, "01951d3240ac70008000000000000001");
    assert_eq!(space_for_window(&space_label(&key)), Some(key.clone()));
    assert_eq!(space_for_window("space-personal").as_deref(), Some(PERSONAL));
    assert_eq!(space_id_for_key(&key).as_deref(), Some(ID));
    assert_eq!(space_id_for_key(PERSONAL), None);
    assert!(is_space_window("space-personal"));
    assert!(!is_incognito_window("space-personal"));
    for unknown in [
        "main",
        "space-",
        "space-Personal",
        "space-01951D3240AC70008000000000000001",
        "space-01951d32-40ac-7000-8000-000000000001",
        "space-personal-1",
        "incognito-personal",
        "incognito-personal-0",
        "incognito-personal-01",
        "incognito-unknown-1",
        "misty-agent-01951d32-40ac-7000-8000-000000000001",
        "misty-dock-1",
        "browser-1",
    ] {
        assert_eq!(space_for_window(unknown), None, "{unknown}");
        assert!(!is_app_window(unknown), "{unknown}");
    }
}

#[test]
fn incognito_windows_belong_to_their_space_without_its_trust() {
    let label = incognito_label(PERSONAL, 2);
    assert_eq!(label, "incognito-personal-2");
    assert_eq!(
        parse(&label),
        Some(SpaceWindow {
            space: PERSONAL.into(),
            incognito: Some(2)
        })
    );
    assert!(is_app_window(&label));
    assert!(is_incognito_window(&label));
    assert!(!is_space_window(&label));
}

#[test]
fn each_space_has_its_own_store_and_personal_keeps_the_vault_store() {
    let a = space_store_identity(&space_key(ID, false).unwrap()).unwrap();
    let b = space_store_identity(
        &space_key("01951d32-40ac-7000-8000-000000000002", false).unwrap(),
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
        },
    );
    assert_eq!(next_color(&spaces), "red");
}
