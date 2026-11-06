//! Enums in a schema, in the form Google takes. Ported from `addEnumToSchema` and `getEnumType`.
use crate::sdk::{
    error::ModelError,
    providers::{ordered::Ordered, ordered_ext::OrderedExt},
};

fn type_allows(kind: Option<&Ordered>, name: &str) -> bool {
    match kind {
        None | Some(Ordered::Null) => true,
        Some(Ordered::String(text)) => text == name,
        Some(Ordered::Array(kinds)) => kinds.iter().any(|kind| kind.as_str() == Some(name)),
        Some(_) => false,
    }
}

fn enum_type(values: &[Ordered], kind: Option<&Ordered>) -> Option<&'static str> {
    if values.is_empty() {
        return None;
    }
    if type_allows(kind, "string") && values.iter().all(|value| matches!(value, Ordered::String(_))) {
        return Some("string");
    }
    let numbers = (type_allows(kind, "number") || type_allows(kind, "integer"))
        && values.iter().all(|value| matches!(value, Ordered::Number(_)));
    if numbers {
        if type_allows(kind, "number") {
            return Some("number");
        }
        let whole = |value: &Ordered| match value {
            Ordered::Number(number) => number.as_f64().is_some_and(|value| value.fract() == 0.0),
            _ => false,
        };
        if values.iter().all(whole) {
            return Some("integer");
        }
    }
    if type_allows(kind, "boolean") && values.iter().all(|value| matches!(value, Ordered::Bool(_))) {
        return Some("boolean");
    }
    None
}

/// `String(value)` for an enum's numbers and booleans.
fn js_string(value: &Ordered) -> String {
    match value {
        Ordered::String(text) => text.clone(),
        other => other.to_text(),
    }
}

pub(super) fn add_enum(values: &[Ordered], kind: Option<&Ordered>, result: &mut Ordered) -> Result<(), ModelError> {
    let kind = kind.filter(|kind| !matches!(kind, Ordered::Null));
    let is_null = |value: &Ordered| matches!(value, Ordered::Null);
    let array_with_null = matches!(kind, Some(Ordered::Array(kinds)) if kinds.iter().any(|kind| kind.as_str() == Some("null")));
    let nullable = array_with_null || (kind.is_none() && values.iter().any(is_null));
    let kept: Vec<Ordered> = if nullable {
        values.iter().filter(|value| !is_null(value)).cloned().collect()
    } else {
        values.to_vec()
    };
    if !values.is_empty() && values.iter().all(is_null) {
        let allows_null = kind.is_none() || kind.and_then(Ordered::as_str) == Some("null") || array_with_null;
        if allows_null {
            result.put("type", Ordered::text("null"));
            if matches!(kind, Some(Ordered::Array(_))) {
                result.take("anyOf");
            }
            return Ok(());
        }
    }
    let Some(found) = enum_type(&kept, kind) else {
        return Err(ModelError::Unsupported(
            "Google does not support this JSON Schema enum. Enum values must share one supported primitive type and match the schema type.".to_owned(),
        ));
    };
    result.put("type", Ordered::text(found));
    if matches!(kind, Some(Ordered::Array(_))) {
        result.take("anyOf");
    }
    if nullable {
        result.put("nullable", Ordered::Bool(true));
    }
    if found == "string" {
        result.put("enum", Ordered::Array(kept));
    } else {
        result.put("format", Ordered::text("enum"));
        result.put("enum", Ordered::Array(kept.iter().map(|value| Ordered::String(js_string(value))).collect()));
    }
    Ok(())
}
