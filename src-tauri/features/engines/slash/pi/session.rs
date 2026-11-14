//! The session commands pi and omp answer over rpc.

use super::*;

/// `/session`: pi's get_state and get_session_stats, as the TUI's session panel shows them.
pub(super) async fn session_info(rpc: &mut RpcSession) -> Result<Output, String> {
    let state = rpc.call("get_state", json!({})).await?;
    let stats = rpc.call("get_session_stats", json!({})).await?;
    Ok(Output::info("Session", session_sections(&state, &stats)))
}

pub(super) fn session_sections(state: &Value, stats: &Value) -> Vec<Section> {
    let text = |value: &Value, key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    let mut about = Vec::new();
    push_some(&mut about, "Name", text(state, "sessionName"));
    push_some(&mut about, "Session", text(state, "sessionId"));
    push_some(&mut about, "File", text(state, "sessionFile"));
    // pi with no model to run says `{"id": "unknown", "provider": "unknown"}`.
    let model = state.get("model").and_then(|model| {
        let id = text(model, "id").filter(|id| id != "unknown")?;
        Some(match text(model, "provider") {
            Some(provider) => format!("{provider}/{id}"),
            None => id,
        })
    });
    push_some(&mut about, "Model", model);
    push_some(&mut about, "Thinking", text(state, "thinkingLevel"));
    let auto = state
        .get("autoCompactionEnabled")
        .and_then(Value::as_bool)
        .map(|on| if on { "On" } else { "Off" }.to_string());
    push_some(&mut about, "Auto-compaction", auto);

    let number = |value: &Value, pointer: &str| value.pointer(pointer).and_then(Value::as_f64);
    let mut messages = Vec::new();
    for (label, pointer) in [
        ("You", "/userMessages"),
        ("pi", "/assistantMessages"),
        ("Tool calls", "/toolCalls"),
        ("Tool results", "/toolResults"),
        ("Total", "/totalMessages"),
    ] {
        push_some(&mut messages, label, number(stats, pointer).map(count));
    }
    let mut tokens = Vec::new();
    for (label, pointer) in [
        ("Input", "/tokens/input"),
        ("Output", "/tokens/output"),
        ("Cache read", "/tokens/cacheRead"),
        ("Cache write", "/tokens/cacheWrite"),
        ("Total", "/tokens/total"),
    ] {
        push_some(&mut tokens, label, number(stats, pointer).map(count));
    }
    push_some(
        &mut tokens,
        "Cost",
        number(stats, "/cost").map(|cost| format!("${cost:.4}")),
    );
    let context = number(stats, "/contextUsage/contextWindow").map(|window| {
        match (
            number(stats, "/contextUsage/tokens"),
            number(stats, "/contextUsage/percent"),
        ) {
            (Some(used), Some(percent)) => {
                format!("{} of {} ({percent:.1}%)", count(used), count(window))
            }
            // pi doesn't know until the next reply after a compaction.
            _ => format!("Unknown of {}", count(window)),
        }
    });
    push_some(&mut tokens, "Context", context);
    vec![
        Section {
            rows: about,
            ..Section::default()
        },
        Section {
            heading: Some("Messages".into()),
            rows: messages,
            ..Section::default()
        },
        Section {
            heading: Some("Tokens".into()),
            rows: tokens,
            ..Section::default()
        },
    ]
}

/// `/name <name>`: pi's own session name, which the chat takes as its title.
pub(super) async fn rename(rpc: &mut RpcSession, name: &str) -> Result<Output, String> {
    rpc.call("set_session_name", json!({ "name": name }))
        .await?;
    Ok(Output::Rename {
        title: name.to_string(),
    })
}

/// The calls one engine names its forking by: pi's `get_fork_messages` / `fork`, omp's
/// `get_branch_messages` / `branch`. Both take a user message's entryId and answer
/// `{text, cancelled}`, with the session switched to the new one.
#[derive(Clone, Copy)]
pub(super) struct Flavor {
    list: &'static str,
    fork: &'static str,
    command: &'static str,
}

impl Flavor {
    pub(super) const PI: Self = Self {
        list: "get_fork_messages",
        fork: "fork",
        command: "fork",
    };
    pub(super) const OMP: Self = Self {
        list: "get_branch_messages",
        fork: "branch",
        command: "branch",
    };
}

/// `/fork` (pi) and `/branch` (omp): a new session from before one of the person's messages,
/// opened as a new chat. With no argument, the latest message; `list` shows them, numbered.
/// The message itself isn't in the new session (the terminal app puts it back in the editor), so
/// nothing is sent there on its own.
pub(super) async fn fork(
    rpc: &mut RpcSession,
    flavor: Flavor,
    args: &str,
) -> Result<Output, String> {
    let data = rpc.call(flavor.list, json!({})).await?;
    let messages: Vec<(&str, &str)> = data
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| {
            Some((
                message.get("entryId")?.as_str()?,
                message.get("text").and_then(Value::as_str).unwrap_or(""),
            ))
        })
        .collect();
    if args == "list" {
        return Ok(fork_list(&messages, flavor));
    }
    let target = if args.is_empty() {
        messages.last()
    } else {
        messages.iter().find(|(id, _)| *id == args).or_else(|| {
            let number = args.parse::<usize>().ok()?;
            messages.get(number.checked_sub(1)?)
        })
    };
    let Some((entry, _)) = target else {
        return Err(if messages.is_empty() {
            "This session has no message to fork from yet.".into()
        } else {
            format!(
                "No message {args}. /{} list shows the ones there are.",
                flavor.command
            )
        });
    };
    let forked = rpc.call(flavor.fork, json!({ "entryId": entry })).await?;
    if forked.get("cancelled").and_then(Value::as_bool) == Some(true) {
        return Ok(Output::done("An extension cancelled the fork."));
    }
    new_chat(rpc).await
}

fn fork_list(messages: &[(&str, &str)], flavor: Flavor) -> Output {
    let rows: Vec<Row> = messages
        .iter()
        .enumerate()
        .map(|(index, (_, text))| row((index + 1).to_string(), excerpt(text)))
        .collect();
    let text = if rows.is_empty() {
        "No messages to fork from yet.".to_string()
    } else {
        format!(
            "/{} <number> starts a new chat from before that message.",
            flavor.command
        )
    };
    Output::info(
        "Messages",
        vec![Section {
            rows,
            text: Some(text),
            ..Section::default()
        }],
    )
}

/// `/clone`: the whole session, up to where it is now, copied into a new chat.
pub(super) async fn clone(rpc: &mut RpcSession) -> Result<Output, String> {
    let cloned = rpc.call("clone", json!({})).await?;
    if cloned.get("cancelled").and_then(Value::as_bool) == Some(true) {
        return Ok(Output::done("An extension cancelled the clone."));
    }
    new_chat(rpc).await
}

/// After a fork, the process is on the new session: its id opens the new chat.
async fn new_chat(rpc: &mut RpcSession) -> Result<Output, String> {
    let state = rpc.call("get_state", json!({})).await?;
    let session = state
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or("The engine didn't say which session it made.")?;
    Ok(Output::Fork {
        session: session.to_string(),
        title: state
            .get("sessionName")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .map(str::to_string),
        prompt: None,
    })
}

/// `/export [path]`: pi's HTML export; a relative path is taken from the chat's folder, as pi
/// takes it from its own.
pub(super) async fn export(
    rpc: &mut RpcSession,
    folder: &Path,
    path: &str,
) -> Result<Output, String> {
    let fields = if path.is_empty() {
        json!({})
    } else {
        json!({ "outputPath": path })
    };
    let data = rpc.call("export_html", fields).await?;
    let written = data
        .get("path")
        .and_then(Value::as_str)
        .ok_or("pi didn't say where it wrote the export.")?;
    // pi 1.5.2 answers with the path as given, which is relative to its folder.
    Ok(Output::done(format!(
        "Exported to {}",
        folder.join(written).display()
    )))
}

/// `/tree`: pi's session tree, as an indented list. A run of single replies stays at one level;
/// each branch at a fork goes one level in. The entry the session is on is marked.
pub(super) async fn tree(rpc: &mut RpcSession) -> Result<Output, String> {
    let data = rpc.call("get_tree", json!({})).await?;
    let roots: Vec<&Value> = data
        .get("tree")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .collect();
    let current = current_entry(&roots, data.get("leafId").and_then(Value::as_str));
    let mut lines = Vec::new();
    // Iterative: a long session is a chain thousands of entries deep.
    let mut stack: Vec<(&Value, usize)> = roots.iter().rev().map(|node| (*node, 0)).collect();
    let mut hidden = 0;
    while let Some((node, depth)) = stack.pop() {
        let entry = &node["entry"];
        if let Some(line) = tree_line(entry) {
            if lines.len() < TREE_MOST {
                let marker = if entry["id"].as_str() == current {
                    " (current)"
                } else {
                    ""
                };
                lines.push(format!("{}- {line}{marker}", "  ".repeat(depth.min(12))));
            } else {
                hidden += 1;
            }
        }
        let children: Vec<&Value> = node
            .get("children")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .collect();
        let depth = if children.len() > 1 { depth + 1 } else { depth };
        stack.extend(children.into_iter().rev().map(|child| (child, depth)));
    }
    if hidden > 0 {
        lines.push(format!("- … and {hidden} more"));
    }
    let text = if lines.is_empty() {
        "This session has no messages yet.".to_string()
    } else {
        lines.join("\n")
    };
    Ok(Output::info(
        "Session tree",
        vec![Section {
            text: Some(text),
            ..Section::default()
        }],
    ))
}

const TREE_MOST: usize = 400;

/// The shown entry the session is on: the leaf, or the nearest of its parents that is shown
/// (the leaf is often a model or label change).
pub(super) fn current_entry<'a>(roots: &[&'a Value], leaf: Option<&'a str>) -> Option<&'a str> {
    let mut parents: HashMap<&str, &str> = HashMap::new();
    let mut shown: HashSet<&str> = HashSet::new();
    let mut stack: Vec<&Value> = roots.to_vec();
    while let Some(node) = stack.pop() {
        let entry = &node["entry"];
        if let Some(id) = entry["id"].as_str() {
            if let Some(parent) = entry["parentId"].as_str() {
                parents.insert(id, parent);
            }
            if tree_line(entry).is_some() {
                shown.insert(id);
            }
        }
        stack.extend(
            node.get("children")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        );
    }
    let mut at = leaf?;
    for _ in 0..parents.len() + 1 {
        if shown.contains(at) {
            return Some(at);
        }
        at = *parents.get(at)?;
    }
    None
}

/// One entry's line: the person's and pi's messages, compactions and branch summaries.
pub(super) fn tree_line(entry: &Value) -> Option<String> {
    match entry["type"].as_str()? {
        "message" => {
            let message = &entry["message"];
            let who = match message["role"].as_str()? {
                "user" => "You",
                "assistant" => "pi",
                _ => return None,
            };
            let text = content_text(&message["content"]);
            (!text.trim().is_empty()).then(|| format!("{who}: {}", excerpt(&text)))
        }
        "compaction" => Some("Compacted".into()),
        "branch_summary" => Some("Branch summary".into()),
        _ => None,
    }
}

/// A message's text: a plain string, or its text blocks.
fn content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|block| block["type"] == "text")
            .filter_map(|block| block["text"].as_str())
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

/// A message's first line, short enough for a row.
fn excerpt(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let mut short: String = line.chars().take(120).collect();
    if line.chars().count() > 120 {
        short.push('…');
    }
    short
}

fn push_some(rows: &mut Vec<Row>, label: &str, value: Option<String>) {
    if let Some(value) = value {
        rows.push(row(label, value));
    }
}

/// A whole number with thousands separators.
pub(super) fn count(value: f64) -> String {
    let digits = format!("{}", value.max(0.0).round() as u64);
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}
