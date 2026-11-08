use super::*;

fn check(schema: &str, value: &str) -> Option<String> {
    schema_errors(&JsValue::parse(schema).unwrap(), &JsValue::parse(value).unwrap())
}

// test/workflow-schema-dialects.test.ts: validation survives, for each input it tried.
const DIALECT: &str = r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","format":"uuid"},"date":{"type":"string","format":"date"}},"required":["id","date"],"additionalProperties":false}"#;

#[test]
fn preserves_validation_across_workflow_serialization() {
    let id = "10000000-0000-4000-8000-000000000001";
    assert_eq!(check(DIALECT, &format!(r#"{{"id":"{id}","date":"2026-09-08","extra":"forbidden"}}"#)).unwrap(), "data must NOT have additional properties");
    assert_eq!(check(DIALECT, r#"{"id":"not-a-uuid","date":"2026-09-08"}"#).unwrap(), "data/id must match format \"uuid\"");
    assert_eq!(check(DIALECT, &format!(r#"{{"id":"{id}","date":"2026-02-30"}}"#)).unwrap(), "data/date must match format \"date\"");
    assert_eq!(check(DIALECT, &format!(r#"{{"id":"{id}","date":"2026-09-08"}}"#)), None);
}

#[test]
fn stops_at_the_first_error_in_ajvs_order() {
    let schema = r#"{"type":"object","required":["a"],"additionalProperties":false,"properties":{"a":{"type":"string","minLength":2},"b":{"type":"number"}}}"#;
    assert_eq!(check(schema, r#"{"c":1}"#).unwrap(), "data must have required property 'a'");
    assert_eq!(check(schema, r#"{"a":"x","c":1}"#).unwrap(), "data must NOT have additional properties");
    assert_eq!(check(schema, r#"{"a":"x","b":"y"}"#).unwrap(), "data/a must NOT have fewer than 2 characters");
    assert_eq!(check(schema, r#"{"a":"xy","b":"y"}"#).unwrap(), "data/b must be number");
    assert_eq!(check(schema, r#"[]"#).unwrap(), "data must be object");
}

#[test]
fn reads_the_common_keywords() {
    assert_eq!(check(r#"{"type":"string","enum":["a"]}"#, r#""b""#).unwrap(), "data must be equal to one of the allowed values");
    assert_eq!(check(r#"{"type":["string","null"]}"#, "1").unwrap(), "data must be string,null");
    assert_eq!(check(r#"{"type":"integer","minimum":1}"#, "1.5").unwrap(), "data must be integer");
    assert_eq!(check(r#"{"type":"integer","maximum":1}"#, "2").unwrap(), "data must be <= 1");
    assert_eq!(check(r#"{"type":"array","maxItems":1}"#, "[1,2]").unwrap(), "data must NOT have more than 1 items");
    assert_eq!(check(r#"{"type":"array","items":{"type":"string"}}"#, r#"["a",1]"#).unwrap(), "data/1 must be string");
    assert_eq!(check(r#"{"type":"string","pattern":"^a"}"#, r#""b""#).unwrap(), "data must match pattern \"^a\"");
    assert_eq!(check(r#"{"anyOf":[{"type":"string"},{"type":"number"}]}"#, "true").unwrap(), "data must be string, data must be number, data must match a schema in anyOf");
    assert_eq!(check(r##"{"$defs":{"s":{"type":"string"}},"properties":{"a":{"$ref":"#/$defs/s"}}}"##, r#"{"a":1}"#).unwrap(), "data/a must be string");
    assert_eq!(check(r#"{"type":"object"}"#, "{}"), None);
    assert_eq!(check("{}", "1"), None);
}

#[test]
fn counts_characters_as_ajv_does() {
    assert_eq!(check(r#"{"type":"string","maxLength":1}"#, r#""😀""#), None);
}
