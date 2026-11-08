//! What a run does after a browser action was rejected for a stale page read.
use super::js_json::JsValue;

/// Only the control plane's explicit pre-dispatch rejection permits replanning. An uncertain result,
/// denial, transport error, or arbitrary tool failure does not.
pub(crate) fn requires_browser_reinspection(name: &str, output: Option<&JsValue>) -> bool {
    if !["browser.upload", "browser.steps", "browser.fill_form"].contains(&name) {
        return false;
    }
    let Some(result) = output else {
        return false;
    };
    result.get("status").and_then(JsValue::as_str) == Some("failure")
        && result.get("reason").and_then(JsValue::as_str) == Some("browser_snapshot_stale")
        && result.get("attempted") == Some(&JsValue::Bool(false))
}

/// Snapshot refs and inspections carry different references.
pub(crate) fn browser_reinspection_tool(name: &str) -> &'static str {
    if name == "browser.steps" || name == "browser.fill_form" {
        return "browser.snapshot";
    }
    "browser.inspect"
}

/// Told to the model with its visible tool names before the next turn.
pub(crate) fn browser_reinspection_instruction(name: &str) -> &'static str {
    if name == "browser.snapshot" {
        return "The previous page action was rejected before dispatch because the page changed since its snapshot. Call browser_snapshot now, then act with the new refs and documentId. Do not report that the rejected action succeeded.";
    }
    "The previous browser action was rejected before dispatch because its page inspection was stale. Call browser_inspect now, then decide the next action using fresh references. Do not report that the rejected action succeeded."
}

#[cfg(test)]
mod tests {
    use super::*;

    const STALE: &str = r#"{"status":"failure","reason":"browser_snapshot_stale","attempted":false}"#;
    const ATTEMPTED: &str = r#"{"status":"failure","reason":"browser_snapshot_stale","attempted":true}"#;

    fn requires(name: &str, output: &str) -> bool {
        requires_browser_reinspection(name, Some(&JsValue::parse(output).unwrap()))
    }

    #[test]
    fn only_replans_for_a_known_browser_pre_dispatch_stale_rejection() {
        assert!(requires("browser.upload", STALE));
        assert!(!requires_browser_reinspection("browser.upload", None));
        for result in [
            r#"{"status":"uncertain","reason":"browser_snapshot_stale"}"#,
            r#"{"denied":true}"#,
            r#"{"status":"failure","reason":"permission_denied","attempted":false}"#,
            r#"{"status":"failure","reason":"browser_snapshot_stale"}"#,
            ATTEMPTED,
        ] {
            assert!(!requires("browser.upload", result));
        }
        assert!(!requires("message.send", STALE));
    }

    #[test]
    fn inspects_the_page_again_after_a_stale_upload() {
        assert_eq!(browser_reinspection_tool("browser.upload"), "browser.inspect");
        assert!(browser_reinspection_instruction("browser.inspect").contains("browser_inspect"));
    }

    #[test]
    fn refreshes_the_snapshot_when_page_steps_were_rejected_before_dispatch() {
        for name in ["browser.steps", "browser.fill_form"] {
            assert!(requires(name, STALE));
            assert!(!requires(name, ATTEMPTED));
            assert_eq!(browser_reinspection_tool(name), "browser.snapshot");
        }
        assert!(browser_reinspection_instruction("browser.snapshot").contains("browser_snapshot"));
    }
}
