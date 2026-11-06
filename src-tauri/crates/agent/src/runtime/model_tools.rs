//! The run's tool catalog as a model sees it: names it can take, and results it can read.
use std::collections::HashMap;

use serde::Deserialize;

use crate::sdk::{FileData, OutputItem, RawJson, ToolDefinition, ToolOutput};

use super::{js_json::JsValue, text::js_prefix};

// Providers accept at most 128 tools per request and 64-character tool names.
const MAX_MODEL_TOOLS: usize = 128;

/// One tool as the server's catalog describes it (`MCPRemoteTool`).
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct McpRemoteTool {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) description: String,
    #[serde(rename = "inputSchema")]
    pub(crate) input_schema: RawJson,
    /// Read-only and run on the server or a provider, never a device: it holds
    /// no durable wait, so it may run alongside other such reads.
    #[serde(default)]
    pub(crate) concurrent: bool,
    /// Misty's read-only annotation; a failed read is always safe to retry.
    #[serde(default, rename = "readOnly")]
    pub(crate) read_only: bool,
    /// Runs in this runtime on the device (web.search), never through Misty's gateway.
    #[serde(default)]
    pub(crate) local: bool,
}

/// The model sees Misty's tool names with dots as underscores.
fn model_tool_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for character in name.chars() {
        if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
            out.push(character);
        } else {
            // The TypeScript replaced per UTF-16 unit, so a character outside the BMP counts twice.
            out.extend(std::iter::repeat('_').take(character.len_utf16()));
        }
    }
    js_prefix(&out, 64).to_owned()
}

#[derive(Clone, Debug)]
pub(crate) struct ModelTool {
    pub(crate) descriptor: McpRemoteTool,
    pub(crate) model_name: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ModelCatalog {
    /// Catalog tools the model sees, in catalog order.
    pub(crate) tools: Vec<ModelTool>,
    /// Tools past the provider limit. Misty's own tools come first in a catalog.
    pub(crate) omitted: Vec<String>,
    by_model_name: HashMap<String, usize>,
    by_misty_name: HashMap<String, String>,
}

impl ModelCatalog {
    /// Names every catalog tool once, avoiding the runtime's own tool names.
    pub(crate) fn new(descriptors: Vec<McpRemoteTool>, reserved: &[&str]) -> Self {
        let mut taken: Vec<String> = reserved.iter().map(|name| (*name).to_owned()).collect();
        let visible = MAX_MODEL_TOOLS.saturating_sub(reserved.len()).min(descriptors.len());
        let omitted = descriptors[visible..].iter().map(|descriptor| descriptor.name.clone()).collect();
        let mut tools = Vec::with_capacity(visible);
        let mut by_model_name = HashMap::new();
        let mut by_misty_name = HashMap::new();
        for descriptor in descriptors.into_iter().take(visible) {
            let base = model_tool_name(&descriptor.name);
            let mut candidate = base.clone();
            let mut suffix = 2;
            while taken.contains(&candidate) {
                candidate = format!("{}_{suffix}", js_prefix(&base, 60));
                suffix += 1;
            }
            taken.push(candidate.clone());
            by_model_name.insert(candidate.clone(), tools.len());
            by_misty_name.insert(descriptor.name.clone(), candidate.clone());
            tools.push(ModelTool { descriptor, model_name: candidate });
        }
        Self { tools, omitted, by_model_name, by_misty_name }
    }

    fn tool(&self, model_name: &str) -> Option<&ModelTool> {
        self.by_model_name.get(model_name).and_then(|index| self.tools.get(*index))
    }

    pub(crate) fn misty_name<'a>(&'a self, model_name: &'a str) -> &'a str {
        self.tool(model_name).map_or(model_name, |tool| tool.descriptor.name.as_str())
    }

    pub(crate) fn model_name(&self, misty_name: &str) -> Option<&str> {
        self.by_misty_name.get(misty_name).map(String::as_str)
    }

    pub(crate) fn read_only(&self, model_name: &str) -> bool {
        self.tool(model_name).is_some_and(|tool| tool.descriptor.read_only)
    }

    /// Read-only server or provider tools that may run alongside each other.
    pub(crate) fn concurrent(&self, model_name: &str) -> bool {
        self.tool(model_name).is_some_and(|tool| tool.descriptor.concurrent)
    }

    /// Tools this runtime runs itself, which Misty's gateway never sees.
    pub(crate) fn local(&self, model_name: &str) -> bool {
        self.tool(model_name).is_some_and(|tool| tool.descriptor.local)
    }
}

/// One definition per catalog entry. Every call but a local tool's runs through Misty's gateway, and
/// `visual_tool_output` shapes what comes back.
pub(crate) fn catalog_tools(catalog: &ModelCatalog) -> Vec<ToolDefinition> {
    catalog
        .tools
        .iter()
        .map(|tool| ToolDefinition {
            kind: "function".to_owned(),
            name: tool.model_name.clone(),
            description: Some(tool.descriptor.description.clone()),
            input_schema: tool.descriptor.input_schema.clone(),
            strict: None,
        })
        .collect()
}

/// `^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$`, by hand since screenshots are large.
fn image_data_url(url: &str) -> Option<(&str, &str)> {
    let (header, data) = url.strip_prefix("data:")?.split_once(";base64,")?;
    let known = matches!(header, "image/png" | "image/jpeg" | "image/webp");
    let base64 = !data.is_empty() && data.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='));
    (known && base64).then_some((header, data))
}

fn image_item(media_type: &str, data: &str) -> OutputItem {
    OutputItem::File {
        data: FileData::Data { data: data.to_owned() },
        media_type: media_type.to_owned(),
    }
}

fn without(fields: &[(String, JsValue)], name: &str) -> String {
    JsValue::Object(fields.iter().filter(|(key, _)| key != name).cloned().collect()).stringify()
}

fn template_text(value: Option<&JsValue>) -> String {
    value.map_or_else(|| "undefined".to_owned(), JsValue::to_js_string)
}

/// Screenshots return to the model as images rather than base64 text. `None` is a tool that returned
/// nothing.
pub(crate) fn visual_tool_output(name: &str, output: Option<&JsValue>) -> ToolOutput {
    let text = || ToolOutput::Text { value: output.map_or_else(|| "null".to_owned(), JsValue::stringify) };
    if !matches!(name, "browser.visual" | "browser.workspace.visual" | "browser.act") {
        return text();
    }
    let Some(JsValue::Object(fields)) = output else {
        return text();
    };
    let result = output.and_then(|output| output.get("displayCaptures")).and_then(JsValue::as_array);
    let Some(captures) = result else {
        return image_output(output, fields).unwrap_or_else(text);
    };
    let mut content = vec![OutputItem::Text { text: without(fields, "displayCaptures") }];
    for capture in captures {
        let Some((media_type, data)) = capture.get("dataUrl").and_then(JsValue::as_str).and_then(image_data_url) else {
            continue;
        };
        content.push(OutputItem::Text {
            text: format!(
                "Fresh {}: {} x {} screenshot pixels; top-left origin",
                template_text(capture.get("name")),
                template_text(capture.get("width")),
                template_text(capture.get("height")),
            ),
        });
        content.push(image_item(media_type, data));
    }
    ToolOutput::Content { value: content }
}

/// Returns a result's `image` as an image part next to the rest of the result.
fn image_output(output: Option<&JsValue>, fields: &[(String, JsValue)]) -> Option<ToolOutput> {
    let url = output?.get("image")?.get("dataUrl")?.as_str()?;
    let (media_type, data) = image_data_url(url)?;
    Some(ToolOutput::Content {
        value: vec![OutputItem::Text { text: without(fields, "image") }, image_item(media_type, data)],
    })
}


#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str) -> McpRemoteTool {
        McpRemoteTool {
            name: name.to_owned(),
            description: String::new(),
            input_schema: RawJson::empty_object(),
            concurrent: false,
            read_only: false,
            local: false,
        }
    }

    fn json(text: &str) -> JsValue {
        JsValue::parse(text).unwrap()
    }

    #[test]
    fn returns_browser_acts_final_screenshot_as_an_image_beside_its_report() {
        let output = json(r#"{"status":"done","summary":"Saved","cursor":{"x":0.5,"y":0.25},"image":{"dataUrl":"data:image/png;base64,AAAA","width":1,"height":1}}"#);
        let ToolOutput::Content { value } = visual_tool_output("browser.act", Some(&output)) else {
            panic!("expected content");
        };
        let OutputItem::Text { text } = &value[0] else {
            panic!("expected text first");
        };
        assert_eq!(text, r#"{"status":"done","summary":"Saved","cursor":{"x":0.5,"y":0.25}}"#);
        assert_eq!(serde_json::to_string(&value[1]).unwrap(), r#"{"type":"file","data":{"type":"data","data":"AAAA"},"mediaType":"image/png"}"#);
    }

    #[test]
    fn keeps_other_tools_as_text() {
        let output = json(r#"{"image":{"dataUrl":"data:image/png;base64,AAAA"}}"#);
        assert!(matches!(visual_tool_output("note.search", Some(&output)), ToolOutput::Text { .. }));
    }

    #[test]
    fn labels_each_display_capture_and_skips_ones_that_are_not_images() {
        let output = json(concat!(
            r#"{"z":1,"displayCaptures":[{"name":"screen1","dataUrl":"data:image/webp;base64,BB==","width":2,"height":3},"#,
            r#"{"name":"bad","dataUrl":"data:image/gif;base64,CC","width":2,"height":3}],"a":2}"#,
        ));
        let ToolOutput::Content { value } = visual_tool_output("browser.visual", Some(&output)) else {
            panic!("expected content");
        };
        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            concat!(
                r#"[{"type":"text","text":"{\"z\":1,\"a\":2}"},"#,
                r#"{"type":"text","text":"Fresh screen1: 2 x 3 screenshot pixels; top-left origin"},"#,
                r#"{"type":"file","data":{"type":"data","data":"BB=="},"mediaType":"image/webp"}]"#,
            )
        );
    }

    #[test]
    fn falls_back_to_the_results_text_and_nothing_reads_as_null() {
        let output = json(r#"{"b":1,"image":{"dataUrl":"https://example.com/a.png"}}"#);
        let ToolOutput::Text { value } = visual_tool_output("browser.act", Some(&output)) else {
            panic!("expected text");
        };
        assert_eq!(value, r#"{"b":1,"image":{"dataUrl":"https://example.com/a.png"}}"#);
        let ToolOutput::Text { value } = visual_tool_output("note.search", None) else {
            panic!("expected text");
        };
        assert_eq!(value, "null");
    }

    #[test]
    fn caps_the_catalog_and_keeps_names_unique_and_short() {
        let long = "a".repeat(70);
        let catalog = ModelCatalog::new(vec![tool(&long), tool(&format!("{long}b")), tool("note.😀")], &[]);
        assert_eq!(catalog.tools[0].model_name, "a".repeat(64));
        assert_eq!(catalog.tools[1].model_name, format!("{}_2", "a".repeat(60)));
        assert_eq!(catalog.tools[2].model_name, "note___");
        let many: Vec<_> = (0..130).map(|index| tool(&format!("t{index}"))).collect();
        let capped = ModelCatalog::new(many, &["agent_finish"]);
        assert_eq!(capped.tools.len(), 127);
        assert_eq!(capped.omitted, ["t127", "t128", "t129"]);
    }

    #[test]
    fn unknown_names_read_as_themselves() {
        let catalog = ModelCatalog::new(vec![tool("note.search")], &[]);
        assert_eq!(catalog.misty_name("note_search"), "note.search");
        assert_eq!(catalog.misty_name("agent_finish"), "agent_finish");
        assert_eq!(catalog.model_name("note.search"), Some("note_search"));
        assert_eq!(catalog.model_name("note.update"), None);
        assert!(!catalog.read_only("agent_finish"));
    }
}
