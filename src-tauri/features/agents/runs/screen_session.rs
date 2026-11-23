use super::js_json::JsValue;

pub(crate) fn screen_joined(outputs: &[JsValue]) -> bool {
    outputs.iter().any(|output| catalog_changed(output, 0))
}

fn catalog_changed(output: &JsValue, depth: usize) -> bool {
    if depth > 6 {
        return false;
    }
    match output {
        JsValue::String(text) => {
            if !text.contains("catalog_changed") {
                return false;
            }
            JsValue::parse(text).is_some_and(|parsed| catalog_changed(&parsed, depth + 1))
        }
        JsValue::Object(fields) => {
            let status_open = match output.get("status") {
                None | Some(JsValue::Null) => true,
                Some(status) => status.as_str() == Some("open"),
            };
            if output.get("catalog_changed") == Some(&JsValue::Bool(true)) && status_open {
                return true;
            }
            fields
                .iter()
                .any(|(_, value)| catalog_changed(value, depth + 1))
        }
        JsValue::Array(items) => items.iter().any(|value| catalog_changed(value, depth + 1)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(output: &str) -> bool {
        screen_joined(&[JsValue::parse(output).unwrap()])
    }

    const OPENED: &str = r#"{"status":"open","scopeId":"agent-scope-1","catalog_changed":true}"#;

    #[test]
    fn sees_a_tab_that_joined_the_run_however_misty_wrapped_the_result() {
        assert!(joined(OPENED));
        let as_text = JsValue::String(OPENED.to_owned()).stringify();
        assert!(joined(&as_text));
        assert!(joined(&format!(
            r#"{{"type":"json","value":{{"content":[{{"text":{as_text}}}]}}}}"#
        )));
    }

    #[test]
    fn sees_tabs_a_browser_run_program_opened() {
        assert!(joined(
            r#"{"ok":true,"value":"done","catalog_changed":true}"#
        ));
    }

    #[test]
    fn ignores_other_results_and_failed_opens() {
        assert!(!joined(r#"{"status":"screen_requested"}"#));
        assert!(!joined(r#"{"status":"failure","catalog_changed":true}"#));
        assert!(!joined(r#""plain text mentioning catalog_changed""#));
        assert!(!screen_joined(&[]));
    }

    #[test]
    fn stops_looking_past_six_levels() {
        let deep = |levels: usize| {
            format!(
                "{}{OPENED}{}",
                r#"{"a":"#.repeat(levels),
                "}".repeat(levels)
            )
        };
        assert!(joined(&deep(6)));
        assert!(!joined(&deep(7)));
    }
}
