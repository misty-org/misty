//! Tool schemas as providers will take them.
use crate::sdk::RawJson;

use super::js_json::JsValue;

/// Older Go catalogs encode an empty required slice as null. Preserve every actual constraint while
/// accepting that legacy representation during rollout. Do not coerce malformed non-null
/// constraints or property schemas.
///
/// Providers take an object schema only: Anthropic refuses oneOf, anyOf and allOf at the top level,
/// which failed every run that reached browser tools (browser.upload's exclusive sources). Misty's
/// gateway enforces those rules before it runs a tool, so the model-facing schema drops them and
/// keeps everything inside the properties.
pub(crate) fn normalize_tool_input_schema(schema: &RawJson) -> RawJson {
    // The TypeScript's object reached the provider through `JSON.stringify`, so this writes the same text.
    let Some(JsValue::Object(fields)) = JsValue::from_raw(schema) else {
        return schema.clone();
    };
    let normalized = fields
        .into_iter()
        .filter(|(name, _)| !matches!(name.as_str(), "oneOf" | "anyOf" | "allOf"))
        .map(|(name, value)| match (name.as_str(), &value) {
            ("required", JsValue::Null) => (name, JsValue::Array(Vec::new())),
            _ => (name, value),
        })
        .collect();
    RawJson::from_text(JsValue::Object(normalized).stringify()).unwrap_or_else(|_| schema.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(text: &str) -> RawJson {
        RawJson::from_text(text.to_owned()).unwrap()
    }

    // The TypeScript also compiles each schema with Ajv. The crate has no JSON schema validator, so
    // these check the schema's text, which is what a validator or provider would be given.
    #[test]
    fn lets_the_runtime_compile_a_no_argument_tool_whose_go_slice_was_nil() {
        let input = raw(r#"{"type":"object","properties":{},"required":null,"additionalProperties":false}"#);
        assert_eq!(normalize_tool_input_schema(&input).get(), r#"{"type":"object","properties":{},"required":[],"additionalProperties":false}"#);
        assert!(input.get().contains(r#""required":null"#));
    }

    #[test]
    fn preserves_required_fields_and_property_constraints() {
        let input = r#"{"type":"object","properties":{"operation":{"type":"string","enum":["create","update"]}},"required":["operation"],"additionalProperties":false}"#;
        assert_eq!(normalize_tool_input_schema(&raw(input)).get(), input);
    }

    #[test]
    fn does_not_silently_weaken_malformed_constraints() {
        let input = r#"{"type":"object","required":"operation"}"#;
        assert_eq!(normalize_tool_input_schema(&raw(input)).get(), input);
    }

    #[test]
    fn drops_top_level_combinators_providers_refuse_keeping_the_properties() {
        let input = raw(concat!(
            r#"{"type":"object","properties":{"attachmentId":{"type":"string"},"downloadId":{"type":"string"}},"required":["documentId"],"#,
            r#""oneOf":[{"required":["attachmentId"]},{"required":["downloadId"]}],"additionalProperties":false}"#,
        ));
        assert_eq!(
            normalize_tool_input_schema(&input).get(),
            r#"{"type":"object","properties":{"attachmentId":{"type":"string"},"downloadId":{"type":"string"}},"required":["documentId"],"additionalProperties":false}"#
        );
    }

    #[test]
    fn a_combinator_inside_the_properties_stays() {
        let input = r#"{"type":"object","properties":{"a":{"anyOf":[{"type":"string"}]}}}"#;
        assert_eq!(normalize_tool_input_schema(&raw(input)).get(), input);
    }
}
