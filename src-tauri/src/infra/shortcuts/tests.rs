use super::*;
use tempfile::tempdir;

fn test_store(directory: &tempfile::TempDir) -> Store {
    Store::at(directory.path().join("misty.db"))
}

#[test]
fn explicit_unbound_slots_survive_a_round_trip() {
    let directory = tempdir().unwrap();
    let store = test_store(&directory);
    let mut overrides = BTreeMap::new();
    overrides.insert(
        "workspace.new_tab".to_owned(),
        ShortcutOverride {
            command_id: "workspace.new_tab".to_owned(),
            primary: Some(None),
            alternate: Some(Some("Ctrl+N".to_owned())),
        },
    );
    write_overrides(&store, &overrides).unwrap();
    let read = read_overrides(&store).unwrap();
    let entry = &read["workspace.new_tab"];
    assert!(matches!(entry.primary, Some(None)));
    assert_eq!(entry.alternate, Some(Some("Ctrl+N".to_owned())));
}

#[test]
fn invalid_command_ids_are_rejected() {
    assert!(validate_command_id("code.harpoon").is_ok());
    assert!(validate_command_id("code.harpoon\nother").is_err());
}

#[test]
fn an_earlier_commands_file_is_imported_once() {
    let directory = tempdir().unwrap();
    let store = test_store(&directory);
    let legacy = directory.path().join("commands.msy");
    fs::write(
        &legacy,
        "# Misty keyboard command overrides\nworkspace.new_tab {\n  primary = \"\"\n  alternate = \"Ctrl+N\"\n}\n",
    )
    .unwrap();
    let snapshot = load_shortcuts(store.clone(), &legacy).unwrap();
    assert!(matches!(snapshot.overrides[0].primary, Some(None)));
    assert_eq!(
        snapshot.overrides[0].alternate,
        Some(Some("Ctrl+N".to_owned()))
    );
    // Resetting does not bring the old file's values back.
    write_overrides(&store, &BTreeMap::new()).unwrap();
    assert!(load_shortcuts(store, &legacy).unwrap().overrides.is_empty());
}

#[tokio::test]
async fn shared_shortcut_replacement_preserves_unbound_slots_and_resets_removed_entries() {
    let directory = tempdir().unwrap();
    let service = ShortcutService {
        store: test_store(&directory),
        legacy_path: directory.path().join("commands.msy"),
    };
    let entries: Vec<ShortcutOverride> = serde_json::from_str(
        r#"[{"commandId":"workspace.new_tab","primary":null,"alternate":"Ctrl+N"}]"#,
    )
    .unwrap();
    let applied = service.replace(entries).await.unwrap();
    assert!(matches!(applied.overrides[0].primary, Some(None)));
    assert_eq!(
        applied.overrides[0].alternate,
        Some(Some("Ctrl+N".to_owned()))
    );
    let reloaded = service.snapshot().await.unwrap();
    assert!(matches!(reloaded.overrides[0].primary, Some(None)));
    assert!(service.replace(vec![]).await.unwrap().overrides.is_empty());
}
