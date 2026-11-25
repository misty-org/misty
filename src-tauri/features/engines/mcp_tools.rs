use super::*;

pub(super) fn wire_name(name: &str) -> String {
    name.replace('.', "_")
}

pub(super) fn is_space_tool(name: &str) -> bool {
    SPACE_TOOLS.iter().any(|family| name.starts_with(family))
}

pub(super) fn files_offered(app: &AppHandle, name: &str) -> bool {
    crate::files::agent_paths::tools::offered(app, name)
}

pub(super) fn is_browser_tool(name: &str) -> bool {
    BROWSER_TOOLS.contains(&name)
}

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

pub(super) fn save_path(
    folder: &std::path::Path,
    name: &str,
) -> Result<std::path::PathBuf, String> {
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

pub(super) fn image_block(url: &str) -> Option<Value> {
    let (media_type, data) = url.strip_prefix("data:")?.split_once(";base64,")?;
    media_type
        .starts_with("image/")
        .then(|| json!({ "type": "image", "data": data, "mimeType": media_type }))
}

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
            "name": wire_name("browser.tab.list"),
            "description": TAB_LIST,
            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {} },
            "annotations": { "readOnlyHint": true },
        }));
        tools.push(json!({
            "name": wire_name("browser.tab.use"),
            "description": TAB_USE,
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["scopeId", "reason"],
                "properties": {
                    "scopeId": { "type": "string", "minLength": 8, "maxLength": 256 },
                    "reason": {
                        "type": "string",
                        "minLength": 3,
                        "maxLength": 300,
                        "description": "What you'll do in the tab, in a few words the person sees.",
                    },
                },
            },
            "annotations": { "readOnlyHint": false },
        }));
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

pub(crate) fn names_misty_tool(tool: &str, call: &Value) -> bool {
    let named = |text: &str| {
        let text = text.to_ascii_lowercase();
        text.contains("misty")
            && (space_tools()
                .iter()
                .filter_map(|offered| offered["name"].as_str())
                .any(|name| text.contains(name))
                || crate::engines::agent_memory::WIRE_NAMES
                    .iter()
                    .any(|name| text.contains(name))
                || text.contains(&format!("misty__{}", crate::engines::recall::RECALL)))
    };
    named(tool) || named(&call.to_string())
}

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
    for known in ["browser.tab.list", "browser.tab.use"] {
        if wire_name(known) == name {
            return Some((known.to_string(), arguments));
        }
    }
    let catalog: Vec<Value> = serde_json::from_str(CATALOG).unwrap_or_default();
    catalog.iter().find_map(|tool| {
        let known = tool["name"].as_str()?;
        if !(is_space_tool(known) || is_browser_tool(known)) || wire_name(known) != name {
            return None;
        }
        let mut input = arguments.clone();
        if known == "screen.open" {
            if let Some(fields) = input.as_object_mut() {
                fields.remove("target");
            }
        }
        Some((known.to_string(), input))
    })
}
