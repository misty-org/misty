//! Tool and output schemas in the OpenAPI form Google takes. Ported from
//! `convertJSONSchemaToOpenAPISchema`, on a tree that keeps property order.
use std::collections::BTreeSet;

use super::schema_enum::add_enum;
use crate::model_calls::error::ModelError;
use crate::model_calls::providers::ordered::Ordered;
use crate::model_calls::providers::ordered_ext::OrderedExt;

struct Context<'a> {
    definitions: Option<&'a Ordered>,
    dollar_definitions: Option<&'a Ordered>,
}

/// The converted schema, or nothing for an empty root object, which Google wants left out.
pub(super) fn to_openapi(schema: &Ordered) -> Result<Option<Ordered>, ModelError> {
    let context = Context {
        definitions: schema.get("definitions"),
        dollar_definitions: schema.get("$defs"),
    };
    convert(Some(schema), true, &context, &BTreeSet::new())
}

fn unsupported(message: &str) -> ModelError {
    ModelError::Unsupported(message.to_owned())
}

fn is_empty_object_schema(schema: &Ordered) -> bool {
    schema.get("type").and_then(Ordered::as_str) == Some("object")
        && match schema.get("properties") {
            None | Some(Ordered::Null) => true,
            Some(Ordered::Object(fields)) => fields.is_empty(),
            _ => false,
        }
        && !schema.get("additionalProperties").is_some_and(Ordered::is_truthy)
}

/// `undefined` in an array reaches the wire as `null`.
fn convert_list(
    items: &[Ordered],
    context: &Context,
    resolving: &BTreeSet<String>,
) -> Result<Ordered, ModelError> {
    let mut converted = Vec::with_capacity(items.len());
    for item in items {
        converted.push(convert(Some(item), false, context, resolving)?.unwrap_or(Ordered::Null));
    }
    Ok(Ordered::Array(converted))
}

fn convert(
    schema: Option<&Ordered>,
    is_root: bool,
    context: &Context,
    resolving: &BTreeSet<String>,
) -> Result<Option<Ordered>, ModelError> {
    let schema = match schema {
        None | Some(Ordered::Null) => return Ok(None),
        Some(schema) => schema,
    };
    if matches!(schema, Ordered::Bool(_)) {
        let mut result = Ordered::empty_object();
        result.put("type", Ordered::text("boolean"));
        result.put("properties", Ordered::empty_object());
        return Ok(Some(result));
    }
    if let Some(reference) = schema.get("$ref").filter(|value| !matches!(value, Ordered::Null)) {
        return convert_reference(schema, reference, is_root, context, resolving);
    }
    if is_empty_object_schema(schema) {
        if is_root {
            return Ok(None);
        }
        let mut result = Ordered::empty_object();
        result.put("type", Ordered::text("object"));
        if let Some(description) = schema.get("description").filter(|value| value.is_truthy()) {
            result.put("description", description.clone());
        }
        return Ok(Some(result));
    }
    let mut result = Ordered::empty_object();
    for key in ["description", "required", "format"] {
        if let Some(value) = schema.get(key).filter(|value| value.is_truthy()) {
            result.put(key, value.clone());
        }
    }
    let kind = schema.get("type").filter(|value| value.is_truthy());
    match kind {
        Some(Ordered::Array(types)) => {
            let has_null = types.iter().any(|kind| kind.as_str() == Some("null"));
            let others: Vec<&Ordered> = types.iter().filter(|kind| kind.as_str() != Some("null")).collect();
            if others.is_empty() {
                result.put("type", Ordered::text("null"));
            } else {
                let any_of = others.into_iter().map(|kind| {
                    let mut entry = Ordered::empty_object();
                    entry.put("type", kind.clone());
                    entry
                });
                result.put("anyOf", Ordered::Array(any_of.collect()));
                if has_null {
                    result.put("nullable", Ordered::Bool(true));
                }
            }
        }
        Some(kind) => result.put("type", kind.clone()),
        None => {}
    }
    let values = match schema.get("enum") {
        Some(Ordered::Null) | None => schema.get("const").map(|value| vec![value.clone()]),
        Some(Ordered::Array(values)) => Some(values.clone()),
        Some(_) => Some(Vec::new()),
    };
    if let Some(values) = values {
        add_enum(&values, schema.get("type"), &mut result)?;
    }
    if let Some(Ordered::Object(properties)) = schema.get("properties") {
        let mut converted = Ordered::empty_object();
        for (key, value) in properties {
            if let Some(property) = convert(Some(value), false, context, resolving)? {
                converted.put(key, property);
            }
        }
        result.put("properties", converted);
    }
    if let Some(items) = schema.get("items").filter(|value| value.is_truthy()) {
        match items {
            Ordered::Array(list) => result.put("items", convert_list(list, context, resolving)?),
            single => {
                if let Some(item) = convert(Some(single), false, context, resolving)? {
                    result.put("items", item);
                }
            }
        }
    }
    if let Some(Ordered::Array(list)) = schema.get("allOf") {
        result.put("allOf", convert_list(list, context, resolving)?);
    }
    if let Some(Ordered::Array(list)) = schema.get("anyOf") {
        convert_any_of(list, &mut result, context, resolving)?;
    }
    if let Some(Ordered::Array(list)) = schema.get("oneOf") {
        result.put("oneOf", convert_list(list, context, resolving)?);
    }
    if let Some(min_length) = schema.get("minLength") {
        result.put("minLength", min_length.clone());
    }
    Ok(Some(result))
}

fn convert_any_of(
    list: &[Ordered],
    result: &mut Ordered,
    context: &Context,
    resolving: &BTreeSet<String>,
) -> Result<(), ModelError> {
    let is_null = |schema: &&Ordered| schema.get("type").and_then(Ordered::as_str) == Some("null");
    if !list.iter().any(|schema| is_null(&schema)) {
        result.put("anyOf", convert_list(list, context, resolving)?);
        return Ok(());
    }
    let others: Vec<Ordered> = list.iter().filter(|schema| !is_null(schema)).cloned().collect();
    if let [only] = others.as_slice() {
        if let Some(Ordered::Object(fields)) = convert(Some(only), false, context, resolving)? {
            result.put("nullable", Ordered::Bool(true));
            for (key, value) in fields {
                result.put(&key, value);
            }
        }
    } else {
        result.put("anyOf", convert_list(&others, context, resolving)?);
        result.put("nullable", Ordered::Bool(true));
    }
    Ok(())
}

fn convert_reference(
    schema: &Ordered,
    reference: &Ordered,
    is_root: bool,
    context: &Context,
    resolving: &BTreeSet<String>,
) -> Result<Option<Ordered>, ModelError> {
    let text = reference.as_str().unwrap_or_default();
    let (definition, key) = referenced_definition(text, context)?;
    if resolving.contains(&key) {
        return Err(unsupported("Google schema conversion does not support recursive JSON Schema references."));
    }
    let mut resolving = resolving.clone();
    resolving.insert(key);
    let mut sibling = schema.clone();
    sibling.take("$ref");
    let merged = match definition {
        Ordered::Bool(true) => sibling,
        Ordered::Bool(false) => Ordered::Bool(false),
        definition => {
            let mut merged = definition.clone();
            if let Ordered::Object(fields) = sibling {
                for (name, value) in fields {
                    merged.put(&name, value);
                }
            }
            merged
        }
    };
    convert(Some(&merged), is_root, context, &resolving)
}

fn unsupported_reference() -> ModelError {
    unsupported("Google schema conversion only supports references to direct children of root-level $defs or definitions.")
}

fn referenced_definition<'a>(
    reference: &str,
    context: &Context<'a>,
) -> Result<(&'a Ordered, String), ModelError> {
    let unsupported = unsupported_reference;
    let sources = [("#/$defs/", context.dollar_definitions), ("#/definitions/", context.definitions)];
    let (prefix, definitions) = sources
        .into_iter()
        .find(|(prefix, _)| reference.starts_with(prefix))
        .ok_or_else(unsupported)?;
    let encoded = &reference[prefix.len()..];
    if encoded.is_empty() || encoded.contains('/') {
        return Err(unsupported());
    }
    let decoded = decode_uri_component(encoded).ok_or_else(unsupported)?;
    let bad_escape = decoded
        .match_indices('~')
        .any(|(at, _)| !matches!(decoded.as_bytes().get(at + 1), Some(b'0' | b'1')));
    if decoded.contains('/') || bad_escape {
        return Err(unsupported());
    }
    let definitions = definitions.filter(|value| !matches!(value, Ordered::Null)).ok_or_else(unsupported)?;
    let name = decoded.replace("~1", "/").replace("~0", "~");
    let definition = definitions.get(&name).ok_or_else(unsupported)?;
    Ok((definition, format!("{prefix}{name}")))
}

fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = text.get(at + 1..at + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else {
            decoded.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn converted(text: &str) -> Option<String> {
        to_openapi(&Ordered::from_text(text).unwrap()).unwrap().map(|schema| schema.to_text())
    }

    #[test]
    fn an_empty_root_object_is_left_out() {
        assert_eq!(converted(r#"{"type":"object","properties":{}}"#), None);
        assert_eq!(converted(r#"{"type":"object","properties":{"a":{"type":"object"}}}"#).unwrap(), r#"{"type":"object","properties":{"a":{"type":"object"}}}"#);
    }

    #[test]
    fn property_order_survives() {
        assert_eq!(
            converted(r#"{"type":"object","properties":{"z":{"type":"string"},"a":{"type":"number"}},"required":["z"],"additionalProperties":false}"#).unwrap(),
            r#"{"required":["z"],"type":"object","properties":{"z":{"type":"string"},"a":{"type":"number"}}}"#,
        );
    }

    #[test]
    fn nullable_forms() {
        assert_eq!(converted(r#"{"type":["string","null"]}"#).unwrap(), r#"{"anyOf":[{"type":"string"}],"nullable":true}"#);
        assert_eq!(converted(r#"{"anyOf":[{"type":"string"},{"type":"null"}]}"#).unwrap(), r#"{"nullable":true,"type":"string"}"#);
        assert_eq!(
            converted(r#"{"anyOf":[{"type":"string"},{"type":"number"},{"type":"null"}]}"#).unwrap(),
            r#"{"anyOf":[{"type":"string"},{"type":"number"}],"nullable":true}"#,
        );
    }

    #[test]
    fn enums_take_one_primitive_type() {
        assert_eq!(converted(r#"{"enum":["a","b"]}"#).unwrap(), r#"{"type":"string","enum":["a","b"]}"#);
        assert_eq!(converted(r#"{"const":"a"}"#).unwrap(), r#"{"type":"string","enum":["a"]}"#);
        assert_eq!(converted(r#"{"enum":[1,2]}"#).unwrap(), r#"{"type":"number","format":"enum","enum":["1","2"]}"#);
        assert_eq!(converted(r#"{"enum":["a",null]}"#).unwrap(), r#"{"type":"string","nullable":true,"enum":["a"]}"#);
        assert_eq!(converted(r#"{"const":null}"#).unwrap(), r#"{"type":"null"}"#);
        assert!(to_openapi(&Ordered::from_text(r#"{"enum":["a",1]}"#).unwrap()).is_err());
    }

    #[test]
    fn references_resolve_and_recursion_is_refused() {
        assert_eq!(
            converted(r##"{"type":"object","properties":{"a":{"$ref":"#/$defs/thing","description":"Here."}},"$defs":{"thing":{"type":"string"}}}"##).unwrap(),
            r#"{"type":"object","properties":{"a":{"description":"Here.","type":"string"}}}"#,
        );
        let recursive = r##"{"$ref":"#/definitions/node","definitions":{"node":{"type":"object","properties":{"next":{"$ref":"#/definitions/node"}}}}}"##;
        assert!(to_openapi(&Ordered::from_text(recursive).unwrap()).is_err());
        assert!(to_openapi(&Ordered::from_text(r##"{"$ref":"https://example.com/x"}"##).unwrap()).is_err());
    }
}
