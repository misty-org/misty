//! Page references belong to one document: an action carries the documentId of the page read its refs
//! came from, so refs from a page that changed fail as stale instead of hitting the wrong control. A
//! free model garbled those ids while copying them, splicing the document's id onto its tab's scopeId
//! ("98b065b1-5ec0-4aad-8a47-…"), and every action on one site failed as stale until the run gave the
//! site up (Odysseys, October 20).
//!
//! The run knows each tab's latest documentId from its own tool results. An action whose id is
//! missing, malformed, or a garbled copy of the latest one (same first block, never issued) gets the
//! real one. An id the tab really had before is left alone: refs from an old page still fail.
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

use regex::Regex;

use super::{js_json::JsValue, js_regex::js_regex, text::js_prefix};

static UUID: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", true));
/// documentId values anywhere in a result, nested JSON strings included.
static DOCUMENT_IDS: LazyLock<Regex> = LazyLock::new(|| js_regex(r#"documentId\\*"\s*:\s*\\*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"#, true));
static SCOPE_ID: LazyLock<Regex> = LazyLock::new(|| js_regex(r#""scopeId"\s*:\s*"([^"]+)""#, false));

#[derive(Debug, Default)]
pub(crate) struct DocumentIds {
    latest: HashMap<String, String>,
    issued: HashSet<String>,
}

impl DocumentIds {
    /// Notes the documentId a browser call's result reports for its tab. `output` is the result as
    /// text: a string result itself, or any other result's `JSON.stringify`.
    pub(crate) fn note(&mut self, input: &JsValue, output: &str) {
        let found: Vec<String> = DOCUMENT_IDS
            .captures_iter(output)
            .filter_map(|captures| captures.get(1))
            .map(|id| id.as_str().to_lowercase())
            .collect();
        let Some(newest) = found.last().cloned() else {
            return;
        };
        self.issued.extend(found);
        let scope_id = match input.get("scopeId") {
            None | Some(JsValue::Null) => SCOPE_ID.captures(output).and_then(|captures| captures.get(1)).map(|scope| scope.as_str()),
            Some(scope) => scope.as_str(),
        };
        if let Some(scope_id) = scope_id.filter(|scope_id| !scope_id.is_empty()) {
            self.latest.insert(scope_id.to_owned(), newest);
        }
    }

    /// The call's input with its documentId repaired when it is missing or garbled.
    pub(crate) fn repair<'a>(&self, name: &str, input: &'a JsValue) -> Cow<'a, JsValue> {
        if !name.starts_with("browser.") || !input.is_object() {
            return Cow::Borrowed(input);
        }
        let Some(scope_id) = input.get("scopeId").and_then(JsValue::as_str) else {
            return Cow::Borrowed(input);
        };
        let Some(latest) = self.latest.get(scope_id) else {
            return Cow::Borrowed(input);
        };
        if input.get("documentId").is_none() && !needs_document(input) {
            return Cow::Borrowed(input);
        }
        let given = input.get("documentId").and_then(JsValue::as_str).unwrap_or("").to_lowercase();
        let garbled = given != *latest && !self.issued.contains(&given) && js_prefix(&given, 8) == js_prefix(latest, 8);
        if given.is_empty() || !UUID.is_match(&given) || garbled {
            return Cow::Owned(input.with_field("documentId", JsValue::String(latest.clone())));
        }
        Cow::Borrowed(input)
    }
}

/// Calls that act on refs need the document they came from.
fn needs_document(value: &JsValue) -> bool {
    matches!(value.get("steps"), Some(JsValue::Array(_))) || matches!(value.get("fields"), Some(JsValue::Array(_))) || matches!(value.get("ref"), Some(JsValue::String(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL: &str = "98b065b1-5ec0-4054-b100-4b09009a8709";
    const OLDER: &str = "4a1ec30b-b0f6-46a1-8979-ecd34677fc38";
    const SCOPE: &str = "agent-scope-77fa9154-ac1c-4aad-8a47-c72b00e9f1ca";

    fn json(text: &str) -> JsValue {
        JsValue::parse(text).unwrap()
    }

    fn scope() -> JsValue {
        json(&format!(r#"{{"scopeId":"{SCOPE}"}}"#))
    }

    fn document_id(value: &JsValue) -> Option<&str> {
        value.get("documentId").and_then(JsValue::as_str)
    }

    #[test]
    fn repairs_a_garbled_missing_or_malformed_document_id_with_the_tabs_latest() {
        let mut documents = DocumentIds::default();
        documents.note(&scope(), &format!(r#"{{"url":"about:blank","documentId":"{OLDER}"}}"#));
        documents.note(&scope(), &format!(r#"{{"documentId":"{REAL}","tree":"- searchbox [ref=e18]"}}"#));
        let steps = r#"[{"ref":"e18","action":"fill","text":"jogger"}]"#;
        let garbled = json(&format!(r#"{{"scopeId":"{SCOPE}","documentId":"98b065b1-5ec0-4aad-8a47-c72b00e9f1ca","steps":{steps}}}"#));
        assert_eq!(document_id(&documents.repair("browser.steps", &garbled)), Some(REAL));
        let missing = json(&format!(r#"{{"scopeId":"{SCOPE}","steps":{steps}}}"#));
        assert_eq!(document_id(&documents.repair("browser.steps", &missing)), Some(REAL));
        let malformed = json(&format!(r#"{{"scopeId":"{SCOPE}","documentId":"doc-1","fields":[]}}"#));
        assert_eq!(document_id(&documents.repair("browser.fill_form", &malformed)), Some(REAL));
    }

    #[test]
    fn leaves_a_real_earlier_id_alone_so_refs_from_an_old_page_still_fail_as_stale() {
        let mut documents = DocumentIds::default();
        documents.note(&scope(), &format!(r#"{{"documentId":"{OLDER}"}}"#));
        documents.note(&scope(), &format!(r#"{{"documentId":"{REAL}"}}"#));
        let stale = json(&format!(r#"{{"scopeId":"{SCOPE}","documentId":"{OLDER}","steps":[]}}"#));
        assert!(matches!(documents.repair("browser.steps", &stale), Cow::Borrowed(_)));
        let snapshot = json(&format!(r#"{{"scopeId":"{SCOPE}","maxChars":12000}}"#));
        assert!(matches!(documents.repair("browser.snapshot", &snapshot), Cow::Borrowed(_)));
        let fetch = json(r#"{"url":"https://example.com"}"#);
        assert_eq!(*documents.repair("web.fetch", &fetch), fetch);
    }

    #[test]
    fn a_repair_keeps_the_keys_in_their_places() {
        let mut documents = DocumentIds::default();
        documents.note(&scope(), &format!(r#"{{"documentId":"{REAL}"}}"#));
        let input = json(&format!(r#"{{"z":1,"scopeId":"{SCOPE}","documentId":"bad","a":2}}"#));
        assert_eq!(documents.repair("browser.x", &input).stringify(), format!(r#"{{"z":1,"scopeId":"{SCOPE}","documentId":"{REAL}","a":2}}"#));
    }

    #[test]
    fn finds_ids_inside_nested_json_text_and_the_scope_in_the_result() {
        let mut documents = DocumentIds::default();
        let nested = format!(r#"{{"scopeId":"s1","text":"{{\"documentId\":\"{REAL}\"}}"}}"#);
        documents.note(&json("{}"), &nested);
        let call = json(r#"{"scopeId":"s1","ref":"e1"}"#);
        assert_eq!(document_id(&documents.repair("browser.steps", &call)), Some(REAL));
    }
}
