//! Record names at the renderer boundary. Stored records keep the kind and
//! field names they were written with (see `entities::Kind`); the renderer
//! uses the current ones: folder, bookmark, tab (was layout) and view (was
//! tab). Every record, change and focus record crossing to or from the
//! renderer goes through here.
use serde_json::{Map, Value};

/// `(stored, renderer)` record kinds.
const KINDS: [(&str, &str); 4] = [
    ("group", "folder"),
    ("website", "bookmark"),
    ("layout", "tab"),
    ("tab", "view"),
];

/// `(stored kind, stored field, renderer field)`.
const FIELDS: [(&str, &str, &str); 4] = [
    ("website", "group_id", "folder_id"),
    ("tab", "website_id", "bookmark_id"),
    ("tab_group", "layout_ids", "tab_ids"),
    ("saved_tab_group", "layouts", "tabs"),
];

/// A view's `placement` names its tab.
const PLACEMENT: (&str, &str) = ("layout_id", "tab_id");

/// Focus (resume) records.
const RESUME: [(&str, &str); 2] = [
    ("active_layout_id", "active_tab_id"),
    ("active_tab_by_pane", "active_view_by_pane"),
];

#[derive(Clone, Copy, PartialEq)]
enum Direction {
    ToRenderer,
    FromRenderer,
}

/// Rewrites stored names to renderer names, anywhere in `value`.
pub fn to_renderer(value: &mut Value) {
    walk(value, Direction::ToRenderer);
}

/// Rewrites renderer names back to stored names, anywhere in `value`.
pub fn from_renderer(value: &mut Value) {
    walk(value, Direction::FromRenderer);
}

fn rename(object: &mut Map<String, Value>, from: &str, to: &str) {
    if let Some(value) = object.remove(from) {
        object.insert(to.to_owned(), value);
    }
}

fn walk(value: &mut Value, direction: Direction) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(|item| walk(item, direction)),
        Value::Object(object) => {
            record(object, direction);
            for (stored, renderer) in RESUME {
                match direction {
                    Direction::ToRenderer => rename(object, stored, renderer),
                    Direction::FromRenderer => rename(object, renderer, stored),
                }
            }
            object.values_mut().for_each(|item| walk(item, direction));
        }
        _ => {}
    }
}

/// A record or change: `{kind, id, fields?}`.
fn record(object: &mut Map<String, Value>, direction: Direction) {
    if !object.get("id").is_some_and(Value::is_string) {
        return;
    }
    let Some(kind) = object.get("kind").and_then(Value::as_str) else {
        return;
    };
    let (stored_kind, new_kind) = match direction {
        Direction::ToRenderer => {
            let renderer = KINDS.iter().find(|(stored, _)| *stored == kind).map_or(kind, |(_, r)| *r);
            (kind.to_owned(), renderer.to_owned())
        }
        Direction::FromRenderer => {
            let stored = KINDS.iter().find(|(_, renderer)| *renderer == kind).map_or(kind, |(s, _)| *s);
            (stored.to_owned(), stored.to_owned())
        }
    };
    object.insert("kind".into(), Value::String(new_kind));
    let Some(Value::Object(fields)) = object.get_mut("fields") else {
        return;
    };
    for (kind, stored, renderer) in FIELDS {
        if kind == stored_kind {
            match direction {
                Direction::ToRenderer => rename(fields, stored, renderer),
                Direction::FromRenderer => rename(fields, renderer, stored),
            }
        }
    }
    if stored_kind == "tab" {
        if let Some(Value::Object(placement)) = fields.get_mut("placement") {
            match direction {
                Direction::ToRenderer => rename(placement, PLACEMENT.0, PLACEMENT.1),
                Direction::FromRenderer => rename(placement, PLACEMENT.1, PLACEMENT.0),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn records_round_trip_between_stored_and_renderer_names() {
        let stored = json!({
            "records": [
                {"kind": "layout", "id": "t1", "fields": {"window_id": "w1"}},
                {"kind": "tab", "id": "v1", "fields": {
                    "placement": {"layout_id": "t1", "pane_id": "p1", "order": 0},
                    "website_id": "b1"
                }},
                {"kind": "group", "id": "f1", "fields": {"label": "Work"}},
                {"kind": "website", "id": "b1", "fields": {"group_id": "f1"}},
                {"kind": "tab_group", "id": "g1", "fields": {"layout_ids": ["t1"]}},
                {"kind": "window", "id": "w1", "fields": {}}
            ],
            "resume": {"active_layout_id": "t1", "active_tab_by_pane": {"p1": "v1"}}
        });
        let mut renderer = stored.clone();
        to_renderer(&mut renderer);
        assert_eq!(
            renderer,
            json!({
                "records": [
                    {"kind": "tab", "id": "t1", "fields": {"window_id": "w1"}},
                    {"kind": "view", "id": "v1", "fields": {
                        "placement": {"tab_id": "t1", "pane_id": "p1", "order": 0},
                        "bookmark_id": "b1"
                    }},
                    {"kind": "folder", "id": "f1", "fields": {"label": "Work"}},
                    {"kind": "bookmark", "id": "b1", "fields": {"folder_id": "f1"}},
                    {"kind": "tab_group", "id": "g1", "fields": {"tab_ids": ["t1"]}},
                    {"kind": "window", "id": "w1", "fields": {}}
                ],
                "resume": {"active_tab_id": "t1", "active_view_by_pane": {"p1": "v1"}}
            })
        );
        from_renderer(&mut renderer);
        assert_eq!(renderer, stored);
    }

    #[test]
    fn deletes_and_unrelated_objects_are_left_alone() {
        let mut change = json!({"action": "delete", "kind": "view", "id": "v1"});
        from_renderer(&mut change);
        assert_eq!(change, json!({"action": "delete", "kind": "tab", "id": "v1"}));
        let mut area = json!({"kind": "session_storage", "origin": "https://a.test"});
        to_renderer(&mut area);
        assert_eq!(area, json!({"kind": "session_storage", "origin": "https://a.test"}));
    }
}
