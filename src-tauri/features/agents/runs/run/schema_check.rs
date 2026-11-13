//! Checks a tool call's input the way the Workflow adapter does (`resolveSerializableTools`): Ajv with
//! its formats, stopping at the first error, its keywords in Ajv's order, and its wording, because
//! `errorsText` reaches the model and the model corrects itself from it. Draft 7 and 2020-12 differ
//! here only in `items`, `prefixItems` and `$defs`, which are all read.
use crate::js_json::{number_text, JsValue};

use super::{schema_collections::pattern_matches, schema_formats::format_matches};

/// Ajv's `errorsText` for what's wrong with `value`, or `None` when it fits.
pub(crate) fn schema_errors(schema: &JsValue, value: &JsValue) -> Option<String> {
    let mut checker = Checker { root: schema, errors: Vec::new(), depth: 0 };
    checker.check(schema, value, "");
    (!checker.errors.is_empty()).then(|| checker.errors.join(", "))
}

pub(super) struct Checker<'a> {
    pub(super) root: &'a JsValue,
    pub(super) errors: Vec<String>,
    pub(super) depth: usize,
}

fn type_name_matches(name: &str, value: &JsValue) -> bool {
    match name {
        "string" => matches!(value, JsValue::String(_)),
        "number" => matches!(value, JsValue::Number(number) if number.is_finite()),
        "integer" => matches!(value, JsValue::Number(number) if number.is_finite() && number.fract() == 0.0),
        "boolean" => matches!(value, JsValue::Bool(_)),
        "null" => matches!(value, JsValue::Null),
        "array" => matches!(value, JsValue::Array(_)),
        "object" => matches!(value, JsValue::Object(_)),
        _ => false,
    }
}

/// Ajv counts characters in code points, not UTF-16 units.
fn char_count(text: &str) -> f64 {
    text.chars().count() as f64
}

pub(super) fn deep_equal(left: &JsValue, right: &JsValue) -> bool {
    match (left, right) {
        (JsValue::Array(left), JsValue::Array(right)) => left.len() == right.len() && left.iter().zip(right).all(|(a, b)| deep_equal(a, b)),
        (JsValue::Object(left), JsValue::Object(right)) => {
            left.len() == right.len() && left.iter().all(|(key, value)| right.iter().any(|(other, item)| other == key && deep_equal(value, item)))
        }
        _ => left == right,
    }
}

impl<'a> Checker<'a> {
    pub(super) fn fail(&mut self, path: &str, message: String) {
        self.errors.push(format!("data{path} {message}"));
    }

    fn resolve(&self, reference: &str) -> Option<&'a JsValue> {
        let mut at = self.root;
        for part in reference.strip_prefix('#')?.split('/').filter(|part| !part.is_empty()) {
            let key = part.replace("~1", "/").replace("~0", "~");
            at = match at {
                JsValue::Array(items) => items.get(key.parse::<usize>().ok()?)?,
                other => other.get(&key)?,
            };
        }
        Some(at)
    }

    /// One schema against one value. Each keyword group stops the rest once an error is found.
    pub(super) fn check(&mut self, schema: &'a JsValue, value: &JsValue, path: &str) {
        // A boolean schema: `true` allows anything.
        if matches!(schema, JsValue::Bool(false)) {
            self.fail(path, "boolean schema is false".to_owned());
            return;
        }
        if !schema.is_object() || self.depth > 64 {
            return;
        }
        self.depth += 1;
        self.check_object_schema(schema, value, path);
        self.depth -= 1;
    }

    fn check_object_schema(&mut self, schema: &'a JsValue, value: &JsValue, path: &str) {
        if let Some(reference) = schema.get("$ref").and_then(JsValue::as_str) {
            if let Some(target) = self.resolve(reference) {
                self.check(target, value, path);
            }
            if !self.errors.is_empty() {
                return;
            }
        }
        // A type list is checked first; a single type is checked in its own group below, which is
        // Ajv's order when the schema has keywords for that type.
        let types = schema_types(schema);
        let single = (types.len() == 1).then(|| types[0]);
        let single_has_group = single.is_some_and(|name| has_rules_for(schema, name));
        if !types.is_empty() && !single_has_group && !types.iter().any(|name| type_name_matches(name, value)) {
            self.fail(path, format!("must be {}", types.join(",")));
            return;
        }
        self.check_any_type(schema, value, path);
        if !self.errors.is_empty() {
            return;
        }
        match value {
            JsValue::Number(number) if number.is_finite() && single != Some("string") => self.check_number(schema, *number, path),
            JsValue::String(text) => self.check_string(schema, text, path),
            JsValue::Array(items) => self.check_array(schema, items, path),
            JsValue::Object(fields) => self.check_object(schema, fields, value, path),
            _ => {}
        }
        if self.errors.is_empty() && single_has_group {
            if let Some(name) = single.filter(|name| !type_name_matches(name, value)) {
                self.fail(path, format!("must be {name}"));
            }
        }
    }

    fn check_any_type(&mut self, schema: &'a JsValue, value: &JsValue, path: &str) {
        if let Some(allowed) = schema.get("const") {
            if !deep_equal(allowed, value) {
                self.fail(path, "must be equal to constant".to_owned());
                return;
            }
        }
        if let Some(allowed) = schema.get("enum").and_then(JsValue::as_array) {
            if !allowed.iter().any(|item| deep_equal(item, value)) {
                self.fail(path, "must be equal to one of the allowed values".to_owned());
                return;
            }
        }
        if let Some(not) = schema.get("not") {
            if self.fits(not, value) {
                self.fail(path, "must NOT be valid".to_owned());
                return;
            }
        }
        if let Some(branches) = schema.get("anyOf").and_then(JsValue::as_array) {
            let mut seen = Vec::new();
            let matched = branches.iter().any(|branch| {
                let mut trial = Checker { root: self.root, errors: Vec::new(), depth: self.depth };
                trial.check(branch, value, path);
                let fits = trial.errors.is_empty();
                seen.extend(trial.errors);
                fits
            });
            if !matched {
                self.errors.extend(seen);
                self.fail(path, "must match a schema in anyOf".to_owned());
                return;
            }
        }
        if let Some(branches) = schema.get("oneOf").and_then(JsValue::as_array) {
            let fitting = branches.iter().filter(|branch| self.fits(branch, value)).count();
            if fitting != 1 {
                self.fail(path, "must match exactly one schema in oneOf".to_owned());
                return;
            }
        }
        if let Some(branches) = schema.get("allOf").and_then(JsValue::as_array) {
            for branch in branches {
                self.check(branch, value, path);
                if !self.errors.is_empty() {
                    return;
                }
            }
        }
        if let Some(condition) = schema.get("if") {
            let branch = if self.fits(condition, value) { "then" } else { "else" };
            if let Some(chosen) = schema.get(branch) {
                if !self.fits(chosen, value) {
                    self.check(chosen, value, path);
                    self.fail(path, format!("must match \"{branch}\" schema"));
                }
            }
        }
    }

    pub(super) fn fits(&self, schema: &'a JsValue, value: &JsValue) -> bool {
        let mut trial = Checker { root: self.root, errors: Vec::new(), depth: self.depth };
        trial.check(schema, value, "");
        trial.errors.is_empty()
    }

    fn check_number(&mut self, schema: &JsValue, number: f64, path: &str) {
        let limit = |name: &str| schema.get(name).and_then(|limit| if let JsValue::Number(limit) = limit { Some(*limit) } else { None });
        let bound = |limit: f64| number_text(limit);
        if let Some(maximum) = limit("maximum").filter(|maximum| number > *maximum) {
            return self.fail(path, format!("must be <= {}", bound(maximum)));
        }
        if let Some(minimum) = limit("minimum").filter(|minimum| number < *minimum) {
            return self.fail(path, format!("must be >= {}", bound(minimum)));
        }
        if let Some(maximum) = limit("exclusiveMaximum").filter(|maximum| number >= *maximum) {
            return self.fail(path, format!("must be < {}", bound(maximum)));
        }
        if let Some(minimum) = limit("exclusiveMinimum").filter(|minimum| number <= *minimum) {
            return self.fail(path, format!("must be > {}", bound(minimum)));
        }
        if let Some(divisor) = limit("multipleOf").filter(|divisor| (number / divisor).fract() != 0.0) {
            self.fail(path, format!("must be multiple of {}", bound(divisor)));
        }
    }

    fn check_string(&mut self, schema: &JsValue, text: &str, path: &str) {
        let limit = |name: &str| schema.get(name).and_then(|limit| if let JsValue::Number(limit) = limit { Some(*limit) } else { None });
        if let Some(maximum) = limit("maxLength").filter(|maximum| char_count(text) > *maximum) {
            return self.fail(path, format!("must NOT have more than {} characters", number_text(maximum)));
        }
        if let Some(minimum) = limit("minLength").filter(|minimum| char_count(text) < *minimum) {
            return self.fail(path, format!("must NOT have fewer than {} characters", number_text(minimum)));
        }
        if let Some(pattern) = schema.get("pattern").and_then(JsValue::as_str) {
            if !pattern_matches(pattern, text) {
                return self.fail(path, format!("must match pattern \"{pattern}\""));
            }
        }
        if let Some(format) = schema.get("format").and_then(JsValue::as_str) {
            if !format_matches(format, text) {
                self.fail(path, format!("must match format \"{format}\""));
            }
        }
    }
}

fn schema_types(schema: &JsValue) -> Vec<&str> {
    match schema.get("type") {
        Some(JsValue::String(name)) => vec![name.as_str()],
        Some(JsValue::Array(names)) => names.iter().filter_map(JsValue::as_str).collect(),
        _ => Vec::new(),
    }
}

/// Ajv's `schemaHasRulesForType`: a single type is checked with its keywords when it has any.
fn has_rules_for(schema: &JsValue, name: &str) -> bool {
    let keywords: &[&str] = match name {
        "number" | "integer" => &["maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum", "multipleOf"],
        "string" => &["maxLength", "minLength", "pattern", "format"],
        "array" => &["maxItems", "minItems", "uniqueItems", "items", "prefixItems", "contains"],
        "object" => &["maxProperties", "minProperties", "required", "additionalProperties", "properties", "patternProperties"],
        _ => &[],
    };
    // An integer is checked ahead of the number group, so its keywords never come first.
    name != "integer" && keywords.iter().any(|keyword| schema.get(keyword).is_some())
}

/// A JSON pointer segment, as Ajv writes it in a path.
pub(super) fn escaped(name: &str) -> String {
    name.replace('~', "~0").replace('/', "~1")
}

#[cfg(test)]
#[path = "schema_check_tests.rs"]
mod tests;
