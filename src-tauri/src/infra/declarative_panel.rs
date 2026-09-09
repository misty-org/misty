//! Data-only widgets: bounded, validated text and controls; no HTML or code.
use super::plugin_commands::{PluginPanelAction, PluginPanelElement};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    elements: Vec<Element>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Element {
    kind: String,
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    action: Option<Action>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Action {
    method: String,
    #[serde(default)]
    value: String,
}

pub fn render(
    document: &Value,
    inputs: &HashMap<String, String>,
    clicked: &str,
) -> Result<Vec<PluginPanelElement>, String> {
    if document.to_string().len() > 65_536 {
        return Err("Widget documents are limited to 64 KB.".into());
    }
    let document: Document = serde_json::from_value(document.clone())
        .map_err(|_| "Invalid widget document or unsupported property.")?;
    if ![1, 2].contains(&document.version) || document.elements.len() > 128 {
        return Err("Unsupported widget version or too many elements.".into());
    }
    let mut ids = HashSet::new();
    for element in &document.elements {
        if ![
            "text",
            "button",
            "input",
            "inputText",
            "separator",
            "spacing",
        ]
        .contains(&element.kind.as_str())
            || element.id.is_empty()
            || element.id.len() > 80
            || !element
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || element.text.len() > 4096
            || !ids.insert(element.id.clone())
            || (document.version == 1 && element.action.is_some())
            || element.action.as_ref().is_some_and(|action| {
                element.kind != "button"
                    || ![
                        "clipboard.writeText",
                        "clipboard.readText",
                        "files.readText",
                        "network.fetch",
                    ]
                    .contains(&action.method.as_str())
                    || action.value.len() > 4096
                    || (action.method.ends_with("readText") && !action.value.is_empty())
                    || ((action.method == "clipboard.writeText"
                        || action.method == "network.fetch")
                        && action.value.is_empty())
            })
        {
            return Err("Invalid widget element, duplicate id, or oversized text.".into());
        }
    }
    if !clicked.is_empty()
        && !document
            .elements
            .iter()
            .any(|e| e.id == clicked && e.kind == "button")
    {
        return Err("Unknown widget button.".into());
    }
    if inputs.len() > 128 || inputs.values().any(|v| v.len() > 4096) {
        return Err("Invalid widget input.".into());
    }
    let fields: HashMap<_, _> = document
        .elements
        .iter()
        .filter(|e| e.kind == "input" || e.kind == "inputText")
        .map(|e| (e.id.clone(), inputs.get(&e.id).cloned().unwrap_or_default()))
        .collect();
    if inputs.len() > 128
        || inputs.values().any(|v| v.len() > 4096)
        || inputs.keys().any(|key| !fields.contains_key(key))
    {
        return Err("Invalid widget input.".into());
    }
    document
        .elements
        .into_iter()
        .map(|element| {
            let mut text = element.text;
            if element.kind == "text" {
                // Substitution is plain text only, with no expression evaluator.
                text = interpolate(&text, &fields)?;
            }
            let action = element
                .action
                .map(|action| {
                    Ok::<PluginPanelAction, String>(PluginPanelAction {
                        method: action.method,
                        value: interpolate(&action.value, &fields)?,
                    })
                })
                .transpose()?;
            Ok(PluginPanelElement {
                kind: element.kind,
                id: element.id,
                text,
                width: 0.,
                height: 0.,
                border: false,
                action,
            })
        })
        .collect()
}

fn interpolate(template: &str, fields: &HashMap<String, String>) -> Result<String, String> {
    let mut result = String::new();
    let mut remaining = template;
    while let Some(start) = remaining.find("{{") {
        result.push_str(&remaining[..start]);
        let Some(end) = remaining[start + 2..].find("}}") else {
            remaining = &remaining[start..];
            break;
        };
        let end = start + 2 + end;
        let key = &remaining[start + 2..end];
        result.push_str(
            fields
                .get(key)
                .map(String::as_str)
                .unwrap_or(&remaining[start..end + 2]),
        );
        if result.len() > 16_384 {
            return Err("Rendered widget text is too long.".into());
        }
        remaining = &remaining[end + 2..];
    }
    result.push_str(remaining);
    if result.len() > 16_384 {
        return Err("Rendered widget text is too long.".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn renders_data_only_controls_and_plain_text_inputs() {
        let ui = json!({"version":1,"elements":[{"kind":"input","id":"name","text":"Your name"},{"kind":"text","id":"greeting","text":"Hello {{name}}"},{"kind":"button","id":"preview","text":"Preview"}]});
        let inputs = HashMap::from([("name".into(), "<script>unsafe()</script>".into())]);
        let result = render(&ui, &inputs, "preview").unwrap();
        assert_eq!(result[1].text, "Hello <script>unsafe()</script>");
        assert_eq!(result[1].kind, "text");
        assert!(render(&ui, &inputs, "host.invoke").is_err());
        assert_eq!(
            interpolate(
                "{{a}}",
                &HashMap::from([
                    ("a".into(), "{{b}}".into()),
                    ("b".into(), "expanded".into())
                ])
            )
            .unwrap(),
            "{{b}}"
        );
    }
    #[test]
    fn rejects_scripts_properties_unknown_nodes_and_unbounded_documents() {
        for ui in [
            json!({"version":1,"elements":[{"kind":"html","id":"a","text":"<script/>"}]}),
            json!({"version":1,"elements":[{"kind":"button","id":"a","onClick":"shell.execute"}]}),
            json!({"version":1,"elements":[{"kind":"text","id":"a"},{"kind":"text","id":"a"}]}),
            json!({"version":3,"elements":[]}),
            json!({"version":1,"elements":[{"kind":"text","id":"a","text":"x".repeat(4097)}]}),
        ] {
            assert!(render(&ui, &HashMap::new(), "").is_err());
        }
    }
    #[test]
    fn version_two_exposes_only_fixed_interpolated_capability_actions() {
        let ui = json!({"version":2,"elements":[
            {"kind":"input","id":"message","text":"Message"},
            {"kind":"button","id":"copy","text":"Copy","action":{"method":"clipboard.writeText","value":"Hello {{message}}"}}
        ]});
        let rendered = render(
            &ui,
            &HashMap::from([("message".into(), "Misty".into())]),
            "copy",
        )
        .unwrap();
        assert_eq!(
            rendered[1].action.as_ref().unwrap().method,
            "clipboard.writeText"
        );
        assert_eq!(rendered[1].action.as_ref().unwrap().value, "Hello Misty");
        for invalid in [
            json!({"version":2,"elements":[{"kind":"text","id":"x","action":{"method":"clipboard.readText"}}]}),
            json!({"version":2,"elements":[{"kind":"button","id":"x","action":{"method":"shell.execute","value":"whoami"}}]}),
            json!({"version":1,"elements":[{"kind":"button","id":"x","action":{"method":"clipboard.readText"}}]}),
        ] {
            assert!(render(&invalid, &HashMap::new(), "").is_err());
        }
    }
}
