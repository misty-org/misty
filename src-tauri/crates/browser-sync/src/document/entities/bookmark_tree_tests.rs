use super::*;

fn fields(value: Value) -> Fields {
    serde_json::from_value(value).unwrap()
}

#[test]
fn folders_without_a_parent_keep_the_shape_older_versions_accept() {
    let flat = fields(serde_json::json!({
        "label": "Work", "icon": "folder", "order": 1.0, "hidden": false
    }));
    validate(Kind::Folder, &flat).unwrap();
    let folder: Folder = serde_json::from_value(serde_json::to_value(&flat).unwrap()).unwrap();
    let written = serde_json::to_value(folder).unwrap();
    assert!(written.get("parent_id").is_none() && written.get("added_at").is_none());
}

#[test]
fn nested_folders_and_dates_validate() {
    let nested = fields(serde_json::json!({
        "label": "Clients", "icon": "folder", "order": 0.0, "hidden": false,
        "parent_id": "folder:work", "added_at": 1_700_000_000_000_i64
    }));
    validate(Kind::Folder, &nested).unwrap();
    let bad_parent = fields(serde_json::json!({
        "label": "Clients", "icon": "folder", "order": 0.0, "hidden": false,
        "parent_id": "folder/../x"
    }));
    assert!(validate(Kind::Folder, &bad_parent).is_err());
    let bad_date = fields(serde_json::json!({
        "group_id": "group:bookmarks", "title": "A", "url": "https://a.example/",
        "order": 0.0, "pinned": true, "added_at": -5
    }));
    assert!(validate(Kind::Bookmark, &bad_date).is_err());
}
