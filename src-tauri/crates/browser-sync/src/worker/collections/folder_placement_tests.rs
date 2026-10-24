use super::*;
use crate::document::entities::Kind;

fn folder(id: &str, parent: Option<&str>) -> ViewRecord {
    let mut fields = crate::document::entities::Fields::new();
    if let Some(parent) = parent {
        fields.insert("parent_id".into(), parent.into());
    }
    ViewRecord {
        kind: Kind::Folder,
        id: id.into(),
        fields,
    }
}

#[test]
fn rejects_folders_inside_themselves() {
    let mut shown = BTreeMap::new();
    shown.insert((Kind::Folder, "a".to_owned()), folder("a", None));
    shown.insert((Kind::Folder, "b".to_owned()), folder("b", Some("a")));
    assert!(folder_placement(&shown, "a", &folder("a", Some("b"))).is_err());
    assert!(folder_placement(&shown, "c", &folder("c", Some("b"))).is_ok());
    // A parent from another device that has not arrived yet ends the walk.
    assert!(folder_placement(&shown, "d", &folder("d", Some("missing"))).is_ok());
}
