// The tools the local MCP server offers and how their calls and results are shaped: Misty's
// own catalog in MCP's names, browser and Space tools told apart, results turned into MCP content
// (pictures as image blocks, a program's output saved to a file when asked).
use super::*;

/// MCP clients accept only letters, digits, `_` and `-` in a tool's name.
pub(super) fn wire_name(name: &str) -> String {
    name.replace('.', "_")
}

pub(super) fn is_space_tool(name: &str) -> bool {
    SPACE_TOOLS.iter().any(|family| name.starts_with(family))
}

pub(super) fn is_browser_tool(name: &str) -> bool {
    BROWSER_TOOLS.contains(&name)
}

/// A tool as an engine sees it. Opening a screen is described for an engine and always opens a tab
/// of the run's own: the desktop and the person's tabs are not offered here.
pub(super) fn offered_tool(tool: &Value) -> Value {
    let name = tool["name"].as_str().unwrap_or("");
    let mut offered = json!({
        "name": wire_name(name),
        "description": tool["description"],
        "inputSchema": tool["inputSchema"],
        "annotations": tool["annotations"],
    });
    if name == "screen.open" {
        offered["description"] = json!(SCREEN_OPEN);
        if let Some(properties) = offered["inputSchema"]["properties"].as_object_mut() {
            properties.remove("target");
        }
    }
    if name == "browser.run" {
        offered["description"] = json!(format!(
            "{}{SAVE_AS_HINT}",
            tool["description"].as_str().unwrap_or("")
        ));
        if let Some(properties) = offered["inputSchema"]["properties"].as_object_mut() {
            properties.insert(
                SAVE_AS.into(),
                json!({
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200,
                    "description": "A file in your working folder to write the program's return value to.",
                }),
            );
        }
    }
    offered
}

/// Where `saveAs` writes: a relative path inside the run's folder, never one that leaves it.
pub(super) fn save_path(folder: &std::path::Path, name: &str) -> Result<std::path::PathBuf, String> {
    let relative = std::path::Path::new(name.trim());
    let inside = !name.trim().is_empty()
        && relative
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)));
    if !inside {
        return Err(format!(
            "saveAs must name a file inside your working folder, such as \"outputs/data.json\"; \
{name:?} doesn't. Nothing was run."
        ));
    }
    Ok(folder.join(relative))
}

/// Writes a finished program's value (or its notes, when it returned nothing) to `path`, and puts
/// the path, size and a preview where the value was.
pub(super) fn save_value(path: &std::path::Path, output: &mut Value) -> Result<(), String> {
    let saved = match &output["value"] {
        Value::Null => output["notes"].clone(),
        value => value.clone(),
    };
    let text = match &saved {
        Value::String(text) => text.clone(),
        value => serde_json::to_string_pretty(value).unwrap_or_default(),
    };
    let failed = |error: std::io::Error| {
        format!(
            "The program ran, but Misty couldn't write {}: {error}",
            path.display()
        )
    };
    if let Some(parent) = path.parent() {
        file_access::fs::create_dir_all(parent).map_err(failed)?;
    }
    file_access::fs::write(path, &text).map_err(failed)?;
    let preview: String = text.chars().take(SAVED_PREVIEW_CHARS).collect();
    output["value"] = json!({
        "savedTo": path.display().to_string(),
        "bytes": text.len(),
        "preview": preview,
        "previewCut": preview.len() < text.len(),
    });
    Ok(())
}

/// A picture in a result (`data:image/...;base64,...`) as an MCP image block.
pub(super) fn image_block(url: &str) -> Option<Value> {
    let (media_type, data) = url.strip_prefix("data:")?.split_once(";base64,")?;
    media_type
        .starts_with("image/")
        .then(|| json!({ "type": "image", "data": data, "mimeType": media_type }))
}

/// A tool's result as MCP content. Pictures (`browser_visual`'s `image`, a step's
/// `displayCaptures`) go as image blocks the engine sees, as Misty's own agent gets them
/// (`agents/runs/model_tools.rs`, `visual_tool_output`); as text they were a base64 string far
/// over an engine's limit for one result, which it set aside unread.
pub(super) fn result_content(mut value: Value) -> Value {
    let mut pictures = Vec::new();
    if let Some(image) = value.get_mut("image").and_then(Value::as_object_mut) {
        if let Some(block) = image
            .get("dataUrl")
            .and_then(Value::as_str)
            .and_then(image_block)
        {
            image.remove("dataUrl");
            pictures.push(block);
        }
    }
    if let Some(captures) = value
        .get_mut("displayCaptures")
        .and_then(Value::as_array_mut)
    {
        for capture in captures.iter_mut() {
            let Some(block) = capture["dataUrl"].as_str().and_then(image_block) else {
                continue;
            };
            pictures.push(json!({
                "type": "text",
                "text": format!(
                    "{} screenshot: {} x {} pixels, top-left origin",
                    capture["name"].as_str().unwrap_or("Screen"),
                    capture["width"],
                    capture["height"],
                ),
            }));
            pictures.push(block);
            if let Some(fields) = capture.as_object_mut() {
                fields.remove("dataUrl");
            }
        }
    }
    let mut content = vec![json!({ "type": "text", "text": value.to_string() })];
    content.extend(pictures);
    json!({ "content": content })
}

pub(super) fn tool_error(text: String) -> Value {
    json!({ "isError": true, "content": [{ "type": "text", "text": text }] })
}

pub(super) fn space_tools() -> &'static Vec<Value> {
    static TOOLS: LazyLock<Vec<Value>> = LazyLock::new(|| {
        let catalog: Vec<Value> = serde_json::from_str(CATALOG).unwrap_or_default();
        let mut tools: Vec<Value> = catalog
            .iter()
            .filter(|tool| {
                tool["name"]
                    .as_str()
                    .is_some_and(|name| is_space_tool(name) || is_browser_tool(name))
            })
            .map(offered_tool)
            .collect();
        tools.push(json!({
            "name": ASK_MISTY,
            "description": "Hand a task to Misty's own agent, which works on its own in the \
background. State the finished result fully: it does not see this conversation. Waits up to about four minutes, then returns what is still \
running so you can call misty_wait.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["goal"],
                "properties": {
                    "goal": { "type": "string", "minLength": 1, "maxLength": 4000 },
                    "context": {
                        "type": "string",
                        "maxLength": 8000,
                        "description": "Facts, URLs or constraints it needs.",
                    },
                },
            },
        }));
        tools.push(json!({
            "name": OPEN_IN_CODE,
            "description": "Offer the person to move this chat into Misty's Code page, where its \
work becomes a project with a folder of its own. Use it in a chat whose work has become a project \
they will keep (a repository, an app or tool they will run again). Misty shows them a card; they \
pick the place and confirm, then the chat's files move there. Don't move or copy files yourself.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "name": {
                        "type": "string",
                        "maxLength": 100,
                        "description": "A short folder name for the project, such as todo-app.",
                    },
                    "why": {
                        "type": "string",
                        "maxLength": 300,
                        "description": "One sentence on why this is a project now.",
                    },
                },
            },
        }));
        tools.push(json!({
            "name": MISTY_WAIT,
            "description": "Wait up to about four minutes for work handed to Misty with ask_misty, \
        and return its state and answer.",
            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {} },
        }));
        tools
    });
    &TOOLS
}

/// Whether an engine's request names one of this server's tools. Each engine spells it its own
/// way (`mcp__misty__note_read`, `misty_note_read`, a title with the server beside it), so this
/// looks for the server's name together with a tool this server offers, in the name the engine
/// gave or in the call it described.
pub(crate) fn names_misty_tool(tool: &str, call: &Value) -> bool {
    let named = |text: &str| {
        let text = text.to_ascii_lowercase();
        text.contains("misty")
            && space_tools()
                .iter()
                .filter_map(|offered| offered["name"].as_str())
                .any(|name| text.contains(name))
    };
    named(tool) || named(&call.to_string())
}

/// Misty's own name for a tool an engine called, and the input Misty's tool takes.
pub(super) fn misty_call(name: &str, arguments: Value) -> Option<(String, Value)> {
    if name == ASK_MISTY {
        let mut task = json!({ "goal": arguments["goal"] });
        if let Some(context) = arguments["context"]
            .as_str()
            .filter(|text| !text.is_empty())
        {
            task["context"] = json!(context);
        }
        return Some((
            "agent.delegate".into(),
            json!({ "tasks": [task], "browser": true }),
        ));
    }
    if name == MISTY_WAIT {
        return Some(("agent.wait".into(), json!({})));
    }
    let catalog: Vec<Value> = serde_json::from_str(CATALOG).unwrap_or_default();
    catalog.iter().find_map(|tool| {
        let known = tool["name"].as_str()?;
        if !(is_space_tool(known) || is_browser_tool(known)) || wire_name(known) != name {
            return None;
        }
        let mut input = arguments.clone();
        // A screen an engine opens is always a tab of its own.
        if known == "screen.open" {
            if let Some(fields) = input.as_object_mut() {
                fields.remove("target");
            }
        }
        Some((known.to_string(), input))
    })
}
