use super::*;
use tempfile::tempdir;

#[test]
fn command_file_preserves_explicit_unbound_slots() {
    let mut overrides = BTreeMap::new();
    overrides.insert(
        "workspace.new_tab".to_owned(),
        ShortcutOverride {
            command_id: "workspace.new_tab".to_owned(),
            primary: Some(None),
            alternate: Some(Some("Ctrl+N".to_owned())),
        },
    );
    let output = command_file(&overrides);
    assert!(output.contains("primary = \"\""));
    assert!(output.contains("alternate = \"Ctrl+N\""));
}

#[test]
fn invalid_command_ids_are_rejected() {
    assert!(validate_command_id("code.harpoon").is_ok());
    assert!(validate_command_id("code.harpoon\nother").is_err());
}

#[test]
fn legacy_defaults_are_removed_but_custom_values_survive() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("commands.msy");
    let old_default = default_command_entries()
        .iter()
        .find(|entry| entry.id == "code.harpoon")
        .unwrap()
        .shortcut;
    fs::write(
        &path,
        format!(
            "code.harpoon {{\n  key = \"{old_default}\"\n}}\ncode.quick_open {{\n  key = \"F8\"\n}}\n"
        ),
    )
    .unwrap();

    let snapshot = load_shortcuts(path.clone()).unwrap();
    assert!(snapshot
        .overrides
        .iter()
        .all(|entry| entry.command_id != "code.harpoon"));
    assert_eq!(
        snapshot
            .overrides
            .iter()
            .find(|entry| entry.command_id == "code.quick_open")
            .and_then(|entry| entry.primary.clone())
            .flatten()
            .as_deref(),
        Some("F8")
    );
    assert!(!fs::read_to_string(path).unwrap().contains("key ="));
}

#[test]
fn update_and_reset_preserve_slot_source_semantics() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("commands.msy");
    let updated = update_shortcut(
        path.clone(),
        UpdateShortcutRequest {
            command_id: "workspace.new_tab".to_owned(),
            slot: ShortcutSlot::Primary,
            value: None,
        },
    )
    .unwrap();
    assert!(matches!(updated.overrides[0].primary, Some(None)));

    let reset = reset_shortcuts(
        path,
        ResetShortcutRequest {
            command_id: Some("workspace.new_tab".to_owned()),
            command_ids: Vec::new(),
        },
    )
    .unwrap();
    assert!(reset.overrides.is_empty());
}

#[test]
fn reassign_atomically_unbinds_the_conflict_and_preserves_plugin_overrides() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("commands.msy");
    update_shortcut(
        path.clone(),
        UpdateShortcutRequest {
            command_id: "plugin.example.convert".to_owned(),
            slot: ShortcutSlot::Primary,
            value: Some("Ctrl+K".to_owned()),
        },
    )
    .unwrap();

    let snapshot = reassign_shortcut(
        path,
        ReassignShortcutRequest {
            command_id: "workspace.new_tab".to_owned(),
            slot: ShortcutSlot::Alternate,
            value: Some("Ctrl+K".to_owned()),
            conflicting_command_id: "plugin.example.convert".to_owned(),
            conflicting_slot: ShortcutSlot::Primary,
        },
    )
    .unwrap();

    let plugin = snapshot
        .overrides
        .iter()
        .find(|entry| entry.command_id == "plugin.example.convert")
        .unwrap();
    assert!(matches!(plugin.primary, Some(None)));
    let target = snapshot
        .overrides
        .iter()
        .find(|entry| entry.command_id == "workspace.new_tab")
        .unwrap();
    assert_eq!(
        target.alternate.as_ref().and_then(|value| value.as_deref()),
        Some("Ctrl+K")
    );
}
