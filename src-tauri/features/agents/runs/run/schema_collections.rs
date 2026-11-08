//! Ajv's keywords for arrays and objects, in its order. See `schema_check.rs`.
use std::collections::HashSet;

use crate::js_json::{number_text, JsValue};
use crate::js_regex::try_js_regex;

use super::schema_check::{deep_equal, escaped, Checker};

/// `new RegExp(pattern, "u")`. A pattern the `regex` crate can't read checks nothing.
pub(super) fn pattern_matches(pattern: &str, text: &str) -> bool {
    try_js_regex(pattern, false).map_or(true, |regex| regex.is_match(text))
}

impl<'a> Checker<'a> {
    pub(super) fn check_array(&mut self, schema: &'a JsValue, items: &[JsValue], path: &str) {
        let count = items.len() as f64;
        let limit = |name: &str| schema.get(name).and_then(|limit| if let JsValue::Number(limit) = limit { Some(*limit) } else { None });
        if let Some(maximum) = limit("maxItems").filter(|maximum| count > *maximum) {
            return self.fail(path, format!("must NOT have more than {} items", number_text(maximum)));
        }
        if let Some(minimum) = limit("minItems").filter(|minimum| count < *minimum) {
            return self.fail(path, format!("must NOT have fewer than {} items", number_text(minimum)));
        }
        if schema.get("uniqueItems") == Some(&JsValue::Bool(true)) {
            for later in (1..items.len()).rev() {
                if let Some(earlier) = (0..later).rev().find(|earlier| deep_equal(&items[*earlier], &items[later])) {
                    return self.fail(path, format!("must NOT have duplicate items (items ## {earlier} and {later} are identical)"));
                }
            }
        }
        let prefix = schema.get("prefixItems").and_then(JsValue::as_array).unwrap_or_default();
        for (index, (item, part)) in items.iter().zip(prefix).enumerate() {
            self.check(part, item, &format!("{path}/{index}"));
            if !self.errors.is_empty() {
                return;
            }
        }
        match schema.get("items") {
            Some(JsValue::Array(parts)) => {
                for (index, (item, part)) in items.iter().zip(parts).enumerate() {
                    self.check(part, item, &format!("{path}/{index}"));
                    if !self.errors.is_empty() {
                        return;
                    }
                }
            }
            Some(part) => {
                for (index, item) in items.iter().enumerate().skip(prefix.len()) {
                    self.check(part, item, &format!("{path}/{index}"));
                    if !self.errors.is_empty() {
                        return;
                    }
                }
            }
            None => {}
        }
        if let Some(part) = schema.get("contains") {
            if !items.iter().any(|item| self.fits(part, item)) {
                self.fail(path, "must contain at least 1 valid item(s)".to_owned());
            }
        }
    }

    pub(super) fn check_object(&mut self, schema: &'a JsValue, fields: &[(String, JsValue)], value: &JsValue, path: &str) {
        let count = fields.len() as f64;
        let limit = |name: &str| schema.get(name).and_then(|limit| if let JsValue::Number(limit) = limit { Some(*limit) } else { None });
        if let Some(maximum) = limit("maxProperties").filter(|maximum| count > *maximum) {
            return self.fail(path, format!("must NOT have more than {} properties", number_text(maximum)));
        }
        if let Some(minimum) = limit("minProperties").filter(|minimum| count < *minimum) {
            return self.fail(path, format!("must NOT have fewer than {} properties", number_text(minimum)));
        }
        for name in schema.get("required").and_then(JsValue::as_array).unwrap_or_default() {
            let Some(name) = name.as_str() else {
                continue;
            };
            if value.get(name).is_none() {
                return self.fail(path, format!("must have required property '{name}'"));
            }
        }
        let properties = schema.get("properties");
        let patterns = schema.get("patternProperties");
        let known: HashSet<&str> = match properties {
            Some(JsValue::Object(declared)) => declared.iter().map(|(name, _)| name.as_str()).collect(),
            _ => HashSet::new(),
        };
        let matches_pattern = |name: &str| match patterns {
            Some(JsValue::Object(declared)) => declared.iter().any(|(pattern, _)| pattern_matches(pattern, name)),
            _ => false,
        };
        if let Some(extra) = schema.get("additionalProperties") {
            for (name, item) in fields {
                if known.contains(name.as_str()) || matches_pattern(name) {
                    continue;
                }
                if matches!(extra, JsValue::Bool(false)) {
                    return self.fail(path, "must NOT have additional properties".to_owned());
                }
                self.check(extra, item, &format!("{path}/{}", escaped(name)));
                if !self.errors.is_empty() {
                    return;
                }
            }
        }
        if let Some(JsValue::Object(declared)) = properties {
            for (name, part) in declared {
                if let Some(item) = value.get(name) {
                    self.check(part, item, &format!("{path}/{}", escaped(name)));
                    if !self.errors.is_empty() {
                        return;
                    }
                }
            }
        }
        if let Some(JsValue::Object(declared)) = patterns {
            for (pattern, part) in declared {
                for (name, item) in fields.iter().filter(|(name, _)| pattern_matches(pattern, name)) {
                    self.check(part, item, &format!("{path}/{}", escaped(name)));
                    if !self.errors.is_empty() {
                        return;
                    }
                }
            }
        }
    }
}
