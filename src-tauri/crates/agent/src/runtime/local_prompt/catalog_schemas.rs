//! The tool schemas that name the person's folders and computers (`device_agent_tools.go`). The
//! catalog holds them with one stand-in folder and one computer; a run writes its own in.
use crate::runtime::{
    js_json::JsValue,
    tool_transport::{object, string},
};

const DEVICE_FIELD: &str = "device";

/// `{...value, property: next}` inside `properties`, keeping Go's sorted keys.
fn with_property(schema: &JsValue, name: &str, next: JsValue) -> JsValue {
    let Some(JsValue::Object(properties)) = schema.get("properties") else {
        return schema.clone();
    };
    let mut properties = properties.clone();
    match properties.iter_mut().find(|(key, _)| key == name) {
        Some((_, slot)) => *slot = next,
        None => {
            let at = properties.iter().position(|(key, _)| key.as_str() > name).unwrap_or(properties.len());
            properties.insert(at, (name.to_owned(), next));
        }
    }
    schema.with_field("properties", JsValue::Object(properties))
}

/// A folder tool's schema naming the run's shared folders.
pub(super) fn with_folder_names(schema: &JsValue, labels: &[String]) -> JsValue {
    let folder = schema.get("properties").and_then(|properties| properties.get("folder"));
    let Some(folder) = folder else {
        return schema.clone();
    };
    with_property(schema, "folder", folder.with_field("description", string(format!("Shared folder name: {}", labels.join(", ")))))
}

/// The tool's schema with the `device` choice a run on several computers needs. `lead` is the words
/// before the names, which differ between the browser tools and the shell.
pub(super) fn with_device_choice(schema: &JsValue, lead: &str, names: &[String]) -> JsValue {
    let device = object([
        ("description", string(format!("{lead}: {}", names.join(", ")))),
        ("maxLength", JsValue::Number(100.0)),
        ("type", string("string")),
    ]);
    with_property(schema, DEVICE_FIELD, device)
}
