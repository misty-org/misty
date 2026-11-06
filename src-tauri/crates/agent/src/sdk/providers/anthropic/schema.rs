//! Removes JSON Schema keywords Anthropic rejects in `output_config.format.schema`, moving the
//! constraints into the description. Ported from `sanitize-json-schema.ts`. Keys keep their order,
//! since the model reads this schema and a change would miss the prompt cache.
use crate::sdk::providers::ordered::Ordered;

const SUPPORTED_STRING_FORMATS: [&str; 10] = [
    "date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid",
];

const DESCRIPTION_CONSTRAINT_KEYS: [&str; 14] = [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minProperties",
    "maxProperties",
    "not",
];

pub(super) fn sanitize_json_schema(schema: &Ordered) -> Ordered {
    sanitize_definition(schema)
}

fn sanitize_definition(definition: &Ordered) -> Ordered {
    match definition {
        Ordered::Object(_) => sanitize_schema(definition),
        other => other.clone(),
    }
}

fn sanitize_list(list: &Ordered) -> Ordered {
    match list {
        Ordered::Array(items) => Ordered::Array(items.iter().map(sanitize_definition).collect()),
        other => other.clone(),
    }
}

fn sanitize_map(map: &Ordered) -> Ordered {
    match map {
        Ordered::Object(fields) => Ordered::Object(
            fields
                .iter()
                .map(|(name, definition)| (name.clone(), sanitize_definition(definition)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn sanitize_schema(schema: &Ordered) -> Ordered {
    let mut result: Vec<(String, Ordered)> = Vec::new();
    if let Some(reference) = schema.present("$ref") {
        return Ordered::Object(vec![("$ref".to_owned(), reference.clone())]);
    }
    for key in ["$schema", "$id", "title", "description"] {
        if let Some(value) = schema.present(key) {
            Ordered::set(&mut result, key, value.clone());
        }
    }
    // These two count even when null, which is a real value for them.
    for key in ["default", "const"] {
        if let Some(value) = schema.get(key) {
            Ordered::set(&mut result, key, value.clone());
        }
    }
    for key in ["enum", "type"] {
        if let Some(value) = schema.present(key) {
            Ordered::set(&mut result, key, value.clone());
        }
    }
    if let Some(any_of) = schema.present("anyOf").or_else(|| schema.present("oneOf")) {
        Ordered::set(&mut result, "anyOf", sanitize_list(any_of));
    }
    if let Some(all_of) = schema.present("allOf") {
        Ordered::set(&mut result, "allOf", sanitize_list(all_of));
    }
    for key in ["definitions", "$defs"] {
        if let Some(map) = schema.present(key) {
            Ordered::set(&mut result, key, sanitize_map(map));
        }
    }
    let is_object = schema.get("type").and_then(Ordered::as_str) == Some("object");
    if is_object || schema.present("properties").is_some() {
        if let Some(properties) = schema.present("properties") {
            Ordered::set(&mut result, "properties", sanitize_map(properties));
        }
        Ordered::set(&mut result, "additionalProperties", Ordered::Bool(false));
        if let Some(required) = schema.present("required") {
            Ordered::set(&mut result, "required", required.clone());
        }
    }
    if let Some(items) = schema.present("items") {
        let sanitized = match items {
            Ordered::Array(_) => sanitize_list(items),
            other => sanitize_definition(other),
        };
        Ordered::set(&mut result, "items", sanitized);
    }
    let format = schema.get("format").and_then(Ordered::as_str);
    if let Some(format) = format.filter(|format| SUPPORTED_STRING_FORMATS.contains(format)) {
        Ordered::set(&mut result, "format", Ordered::String(format.to_owned()));
    }
    if let Some(constraints) = constraint_description(schema, format) {
        let description = match result.iter().find(|(name, _)| name == "description") {
            Some((_, value)) => format!("{}\n{constraints}", javascript_text(value)),
            None => constraints,
        };
        Ordered::set(&mut result, "description", Ordered::String(description));
    }
    Ordered::Object(result)
}

fn constraint_description(schema: &Ordered, format: Option<&str>) -> Option<String> {
    let mut descriptions = Vec::new();
    for key in DESCRIPTION_CONSTRAINT_KEYS {
        match schema.present(key) {
            None | Some(Ordered::Bool(false)) => {}
            Some(value) => descriptions.push(format!("{}: {}", constraint_name(key), javascript_text(value))),
        }
    }
    if let Some(format) = format.filter(|format| !SUPPORTED_STRING_FORMATS.contains(format)) {
        descriptions.push(format!("format: {format}"));
    }
    (!descriptions.is_empty()).then(|| format!("{}.", descriptions.join("; ")))
}

/// `minLength` reads as `min length`.
fn constraint_name(key: &str) -> String {
    let mut name = String::with_capacity(key.len() + 2);
    for c in key.chars() {
        if c.is_ascii_uppercase() {
            name.push(' ');
            name.push(c.to_ascii_lowercase());
        } else {
            name.push(c);
        }
    }
    name
}

fn javascript_text(value: &Ordered) -> String {
    match value {
        Ordered::String(text) => text.clone(),
        other => other.to_text(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sanitized(text: &str) -> String {
        sanitize_json_schema(&Ordered::from_text(text).unwrap()).to_text()
    }

    #[test]
    fn constraints_move_into_the_description_and_objects_close() {
        assert_eq!(
            sanitized(r#"{"type":"object","properties":{"z":{"type":"string","minLength":2,"format":"slug"},"a":{"type":"integer","description":"Count","maximum":5,"exclusiveMinimum":0}},"required":["z"]}"#),
            r#"{"type":"object","properties":{"z":{"type":"string","description":"min length: 2; format: slug."},"a":{"description":"Count\nmaximum: 5; exclusive minimum: 0.","type":"integer"}},"additionalProperties":false,"required":["z"]}"#,
        );
    }

    #[test]
    fn references_win_and_one_of_becomes_any_of() {
        assert_eq!(sanitized(r##"{"$ref":"#/x","type":"string"}"##), r##"{"$ref":"#/x"}"##);
        assert_eq!(
            sanitized(r#"{"oneOf":[{"type":"string","format":"email"},true],"default":null}"#),
            r#"{"default":null,"anyOf":[{"type":"string","format":"email"},true]}"#,
        );
    }

    #[test]
    fn arrays_and_definitions_are_sanitized_too() {
        assert_eq!(
            sanitized(r#"{"type":"array","items":{"type":"object"},"minItems":1,"$defs":{"a":{"properties":{}}}}"#),
            r#"{"type":"array","$defs":{"a":{"properties":{},"additionalProperties":false}},"items":{"type":"object","additionalProperties":false},"description":"min items: 1."}"#,
        );
    }
}
