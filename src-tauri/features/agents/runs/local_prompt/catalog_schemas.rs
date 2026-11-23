use crate::js_json::JsValue;
use crate::tool_transport::{object, string};

const DEVICE_FIELD: &str = "device";

fn with_property(schema: &JsValue, name: &str, next: JsValue) -> JsValue {
    let Some(JsValue::Object(properties)) = schema.get("properties") else {
        return schema.clone();
    };
    let mut properties = properties.clone();
    match properties.iter_mut().find(|(key, _)| key == name) {
        Some((_, slot)) => *slot = next,
        None => {
            let at = properties
                .iter()
                .position(|(key, _)| key.as_str() > name)
                .unwrap_or(properties.len());
            properties.insert(at, (name.to_owned(), next));
        }
    }
    schema.with_field("properties", JsValue::Object(properties))
}

pub(super) fn with_folder_names(schema: &JsValue, labels: &[String]) -> JsValue {
    let folder = schema
        .get("properties")
        .and_then(|properties| properties.get("folder"));
    let Some(folder) = folder else {
        return schema.clone();
    };
    with_property(
        schema,
        "folder",
        folder.with_field(
            "description",
            string(format!("Shared folder name: {}", labels.join(", "))),
        ),
    )
}

pub(super) fn with_device_choice(schema: &JsValue, lead: &str, names: &[String]) -> JsValue {
    let device = object([
        (
            "description",
            string(format!("{lead}: {}", names.join(", "))),
        ),
        ("maxLength", JsValue::Number(100.0)),
        ("type", string("string")),
    ]);
    with_property(schema, DEVICE_FIELD, device)
}
