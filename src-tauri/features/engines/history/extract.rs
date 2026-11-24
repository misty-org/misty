// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/history/extract.rs.
use super::{content_text, parse_ts_ms_str, Message};
use serde_json::Value;
use std::collections::HashMap;
use std::io::BufRead;
use std::path::Path;

pub struct ParsedSession {
    pub messages: Vec<Message>,
}

pub fn parse_session_file(engine: &str, path: &Path) -> Result<ParsedSession, String> {
    if engine == "agy" {
        return Ok(super::agy::parse_agy_session(path));
    }
    let reader = open_line_reader(path)?;
    Ok(collect_session(
        reader,
        &extractor_for(engine, ImageMode::Collect),
    ))
}

pub struct ScanSummary {
    pub title: String,
    pub preview: String,
    pub first_ts: Option<i64>,
    pub last_ts: Option<i64>,
    pub message_count: i64,
}

pub fn scan_summary_file(engine: &str, path: &Path) -> Result<ScanSummary, String> {
    if engine == "agy" {
        return Ok(super::agy::scan_agy_summary(path));
    }
    let reader = open_line_reader(path)?;
    let mut acc = ScanAcc::default();
    walk_lines(
        reader,
        &extractor_for(engine, ImageMode::SkipDataUrls),
        |row| {
            acc.accept(row);
        },
    );
    Ok(acc.finish())
}

#[allow(
    clippy::disallowed_types,
    reason = "reads the engine's own session file in place, wherever the engine keeps it"
)]
fn open_line_reader(path: &Path) -> Result<Box<dyn BufRead>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    Ok(Box::new(std::io::BufReader::new(file)))
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum ImageMode {
    Collect,
    SkipDataUrls,
}

type LineExtractor<'a> = Box<dyn Fn(&Value) -> LineRows + 'a>;

fn extractor_for(engine: &str, images: ImageMode) -> LineExtractor<'static> {
    if engine == "claude" {
        let local_command = std::cell::Cell::new(false);
        Box::new(move |value| {
            let mut open = local_command.get();
            let drop_line = claude_drop_local_command(value, &mut open);
            local_command.set(open);
            if drop_line {
                return Vec::new();
            }
            extract_claude_line(value, images)
        })
    } else {
        let engine = engine.to_string();
        Box::new(move |value| extract_line_messages(&engine, value, images))
    }
}

fn claude_plain_user_text(value: &Value) -> Option<String> {
    if type_str(value) != "user" {
        return None;
    }
    let content = value.get("message")?.get("content");
    match content {
        Some(Value::Array(blocks)) => {
            let mut text = String::new();
            for block in blocks {
                if block.get("type").and_then(Value::as_str) != Some("text") {
                    continue;
                }
                if let Some(t) = block.get("text").and_then(Value::as_str) {
                    text.push_str(t);
                }
            }
            Some(text)
        }
        other => Some(content_text(other)),
    }
}

fn wrapped_tag_only(text: &str, tag: &str) -> bool {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let trimmed = text.trim();
    let Some(inner) = trimmed.strip_prefix(&open) else {
        return false;
    };
    let Some(body) = inner.strip_suffix(&close) else {
        return false;
    };
    !body.contains(&open)
}

fn claude_drop_local_command(value: &Value, open: &mut bool) -> bool {
    let Some(text) = claude_plain_user_text(value) else {
        return false;
    };
    let trimmed = text.trim();
    if trimmed.starts_with("<local-command-caveat>") {
        *open = true;
        return true;
    }
    if wrapped_tag_only(trimmed, "local-command-stdout") {
        return true;
    }
    if *open {
        if trimmed.is_empty() {
            return false;
        }
        if super::slash_command_envelope_only(trimmed) {
            return true;
        }
        if value.get("isMeta").and_then(Value::as_bool) == Some(true) {
            return true;
        }
        *open = false;
    }
    false
}

fn walk_lines(reader: impl BufRead, extract: &LineExtractor<'_>, mut consume: impl FnMut(LineRow)) {
    for text in reader.lines() {
        let Ok(text) = text else { continue };
        let trimmed = text.trim();
        if trimmed.is_empty() || !trimmed.contains("\"type\"") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        for row in extract(&value) {
            let Some(row) = normalize_extracted_row(row) else {
                continue;
            };
            consume(row);
        }
    }
}

fn collect_session(reader: impl BufRead, extract: &LineExtractor<'_>) -> ParsedSession {
    let mut rows = Vec::new();
    walk_lines(reader, extract, |row| rows.push(row));
    fold_rows(rows)
}

fn fold_rows(rows: Vec<LineRow>) -> ParsedSession {
    let mut messages = Vec::<Message>::new();
    let mut seq = 0i64;
    let mut last_user_ts: Option<i64> = None;
    let mut call_rows: HashMap<String, usize> = HashMap::new();
    for row in rows {
        if row.role == "__usage__" {
            if let Some(last) = messages.iter_mut().rev().find(|m| m.role == "assistant") {
                let mut new_usage = row.usage;
                if let (Some(prev), Some(next)) = (last.usage.as_ref(), new_usage.as_mut()) {
                    if let (Some(mcw), Some(obj)) =
                        (prev.get("model_context_window"), next.as_object_mut())
                    {
                        if !obj.contains_key("model_context_window") {
                            obj.insert("model_context_window".to_string(), mcw.clone());
                        }
                    }
                }
                last.usage = new_usage;
            }
            continue;
        }
        if row.role == "__tool_result__" {
            if let Some(res) = row.result {
                let index = match row.tool_call_id.as_deref() {
                    Some(id) => call_rows
                        .get(id)
                        .copied()
                        .filter(|index| messages[*index].result.is_none()),
                    None => messages
                        .iter()
                        .rposition(|m| m.role == "tool" && m.result.is_none()),
                };
                if let Some(index) = index {
                    if let Some(todos) =
                        crate::engines::parse_todo_result(&messages[index].text, &res)
                    {
                        messages[index].todos = Some(todos);
                    }
                    messages[index].result = Some(res);
                }
            }
            continue;
        }
        if !user_row_is_visible(&row.text, !row.images.is_empty()) {
            continue;
        }
        let parsed_ts = row.ts.as_deref().and_then(super::parse_ts_ms_str);
        if row.role == "user" {
            last_user_ts = parsed_ts;
        }
        let duration_ms = row.duration_ms.or_else(|| {
            if row.role == "assistant" {
                if let (Some(u_ts), Some(a_ts)) = (last_user_ts, parsed_ts) {
                    if a_ts >= u_ts && a_ts - u_ts < 24 * 3600 * 1000 {
                        return Some(a_ts - u_ts);
                    }
                }
            }
            None
        });
        seq += 1;
        let call_id = row.tool_call_id;
        messages.push(Message {
            seq,
            role: row.role,
            text: row.text,
            ts: row.ts,
            path: row.path,
            args: row.args,
            result: row.result,
            todos: row.todos,
            usage: row.usage,
            model: row.model,
            effort: row.effort,
            duration_ms,
            images: row.images,
        });
        if let Some(id) = call_id {
            call_rows.insert(id, messages.len() - 1);
        }
    }
    ParsedSession { messages }
}

#[derive(Default)]
struct ScanAcc {
    count: i64,
    first_ts: Option<String>,
    last_ts: Option<String>,
    title: Option<String>,
    first_user_text: Option<String>,
    last_assistant_text: Option<String>,
}

impl ScanAcc {
    fn accept(&mut self, row: LineRow) {
        if row.role == "__usage__" {
            return;
        }
        if row.text.trim().is_empty() && row.images.is_empty() {
            return;
        }
        if self.count == 0 {
            self.first_ts = row.ts.clone();
        }
        self.count += 1;
        self.last_ts = row.ts.clone();
        match row.role.as_str() {
            "user" => {
                if self.title.is_none() {
                    let body = super::strip_title_noise(&row.text);
                    if !body.is_empty() {
                        self.title = Some(super::truncate_chars(&body, 80));
                    }
                }
                if self.first_user_text.is_none() {
                    self.first_user_text = Some(row.text);
                }
            }
            "assistant" => self.last_assistant_text = Some(row.text),
            _ => {}
        }
    }

    fn finish(self) -> ScanSummary {
        let title = self
            .title
            .or_else(|| self.first_user_text.map(|t| super::truncate_chars(&t, 80)))
            .unwrap_or_default();
        ScanSummary {
            title,
            preview: self
                .last_assistant_text
                .map(|t| super::truncate_chars(&t, 120))
                .unwrap_or_default(),
            first_ts: self.first_ts.as_deref().and_then(parse_ts_ms_str),
            last_ts: self.last_ts.as_deref().and_then(parse_ts_ms_str),
            message_count: self.count,
        }
    }
}

fn user_row_is_visible(text: &str, has_images: bool) -> bool {
    !text.trim().is_empty() || has_images
}

fn claude_image_data_url(block: &Value) -> Option<String> {
    let source = block.get("source")?;
    let data = source.get("data").and_then(Value::as_str)?;
    if data.is_empty() {
        return None;
    }
    let mime = source
        .get("media_type")
        .and_then(Value::as_str)
        .unwrap_or("image/png");
    Some(format!("data:{mime};base64,{data}"))
}

fn usage_from_codex_token_info(info: Option<&Value>) -> Option<Value> {
    let info = info?;
    let mut usage = info
        .get("last_token_usage")
        .or_else(|| info.get("total_token_usage"))?
        .clone();
    if let Some(window) = info.get("model_context_window") {
        if let Some(obj) = usage.as_object_mut() {
            obj.insert("model_context_window".to_string(), window.clone());
        }
    }
    Some(usage)
}

fn codex_image_part(part: &Value) -> Option<String> {
    if part.get("type").and_then(Value::as_str) != Some("input_image") {
        return None;
    }
    let url = part.get("image_url").and_then(Value::as_str)?;
    if url.is_empty() {
        None
    } else {
        Some(url.to_string())
    }
}

fn type_str(value: &Value) -> &str {
    value.get("type").and_then(Value::as_str).unwrap_or("")
}

fn ts_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|k| value.get(k).and_then(Value::as_str))
        .map(str::to_string)
}

fn text_of_parts(parts: &[Value], sep: &str) -> String {
    parts
        .iter()
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(sep)
}

struct LineRow {
    role: String,
    text: String,
    ts: Option<String>,
    path: Option<String>,
    args: Option<Value>,
    tool_call_id: Option<String>,
    result: Option<Value>,
    todos: Option<crate::engines::TodosPayload>,
    usage: Option<Value>,
    model: Option<String>,
    effort: Option<String>,
    duration_ms: Option<i64>,
    images: Vec<String>,
}

impl LineRow {
    fn new(role: &str, text: String, ts: Option<String>) -> Self {
        Self {
            role: role.to_string(),
            text,
            ts,
            path: None,
            args: None,
            tool_call_id: None,
            result: None,
            todos: None,
            usage: None,
            model: None,
            effort: None,
            duration_ms: None,
            images: Vec::new(),
        }
    }
}

type LineRows = Vec<LineRow>;
const INTERNAL_PROMPT_MARKERS: [&str; 2] = [
    "\n\n[CCGUI internal system-tail]\n",
    "\n\n[CCGUI internal request-tail]\n",
];

pub(super) fn strip_internal_prompt_tail(text: &str) -> &str {
    INTERNAL_PROMPT_MARKERS
        .iter()
        .filter_map(|marker| text.find(marker))
        .min()
        .map_or(text, |index| &text[..index])
}

fn normalize_extracted_row(mut row: LineRow) -> Option<LineRow> {
    if row.role != "user" {
        return Some(row);
    }
    let visible = strip_internal_prompt_tail(&row.text);
    let text = super::clean_user_turn(visible);
    if super::is_injected_user_context(&text) {
        return None;
    }
    if text.trim().is_empty() && row.images.is_empty() {
        return None;
    }
    row.text = text;
    Some(row)
}

fn extract_line_messages(engine: &str, value: &Value, images: ImageMode) -> LineRows {
    match engine {
        "claude" => extract_claude_line(value, images),
        "codex" => extract_codex_line(value, images),
        _ => Vec::new(),
    }
}

fn extract_codex_line(value: &Value, images: ImageMode) -> LineRows {
    let line_type = type_str(value);
    let ts = ts_string(value, &["timestamp"]);
    match line_type {
        "response_item" => {
            let Some(payload) = value.get("payload") else {
                return Vec::new();
            };
            if payload.get("type").and_then(Value::as_str) == Some("reasoning") {
                let text = match payload.get("summary") {
                    Some(Value::Array(parts)) => text_of_parts(parts, "\n"),
                    _ => String::new(),
                };
                return if text.trim().is_empty() {
                    Vec::new()
                } else {
                    vec![LineRow::new("thinking", text, ts)]
                };
            }
            if payload.get("type").and_then(Value::as_str) != Some("message") {
                return Vec::new();
            }
            let role = payload
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if role != "user" && role != "assistant" {
                return Vec::new();
            }
            let content = payload.get("content");
            let text = match content {
                Some(Value::Array(parts)) => text_of_parts(parts, ""),
                other => content_text(other),
            };
            let collected = match (images, content) {
                (ImageMode::Collect, Some(Value::Array(parts))) => {
                    parts.iter().filter_map(codex_image_part).collect()
                }
                _ => Vec::new(),
            };
            if !user_row_is_visible(&text, !collected.is_empty()) {
                Vec::new()
            } else {
                vec![LineRow {
                    images: collected,
                    ..LineRow::new(&role, text, ts)
                }]
            }
        }
        "event_msg" => {
            let Some(payload) = value.get("payload") else {
                return Vec::new();
            };
            if payload.get("type").and_then(Value::as_str) == Some("token_count") {
                if let Some(usage) = usage_from_codex_token_info(payload.get("info")) {
                    return vec![LineRow {
                        usage: Some(usage),
                        ..LineRow::new("__usage__", String::new(), ts)
                    }];
                }
            }
            Vec::new()
        }
        _ => Vec::new(),
    }
}

fn claude_flush_text(
    out: &mut LineRows,
    text: &mut String,
    role: &str,
    ts: &Option<String>,
    usage: &Option<Value>,
    model: &Option<String>,
    effort: &Option<String>,
) {
    if !text.trim().is_empty() {
        out.push(LineRow {
            usage: usage.clone(),
            model: model.clone(),
            effort: effort.clone(),
            ..LineRow::new(role, std::mem::take(text), ts.clone())
        });
    }
}

#[allow(clippy::too_many_arguments)]
fn claude_block_rows(
    block: &Value,
    images: ImageMode,
    out: &mut LineRows,
    text: &mut String,
    collected_images: &mut Vec<String>,
    role: &str,
    ts: &Option<String>,
    usage: &Option<Value>,
    model: &Option<String>,
    effort: &Option<String>,
) {
    match block.get("type").and_then(Value::as_str) {
        Some("thinking") => {
            claude_flush_text(out, text, role, ts, usage, model, effort);
            if let Some(t) = block.get("thinking").and_then(Value::as_str) {
                out.push(LineRow::new("thinking", t.to_string(), ts.clone()));
            }
        }
        Some("tool_use") => {
            claude_flush_text(out, text, role, ts, usage, model, effort);
            let name = block
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let input = block.get("input");
            out.push(LineRow {
                path: input.and_then(crate::engines::tool_path_arg),
                args: input.and_then(crate::engines::parse_tool_args_value),
                todos: input.and_then(crate::engines::parse_todo_args),
                tool_call_id: block.get("id").and_then(Value::as_str).map(str::to_string),
                ..LineRow::new("tool", name, ts.clone())
            });
        }
        Some("tool_result") => {
            let res = block.get("content").cloned();
            out.push(LineRow {
                tool_call_id: block
                    .get("tool_use_id")
                    .or_else(|| block.get("toolUseId"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                result: res,
                ..LineRow::new("__tool_result__", String::new(), ts.clone())
            });
        }
        Some("image") => {
            if images == ImageMode::Collect {
                if let Some(url) = claude_image_data_url(block) {
                    collected_images.push(url);
                }
            }
        }
        _ => {
            if let Some(t) = block.get("text").and_then(Value::as_str) {
                text.push_str(t);
            }
        }
    }
}

fn extract_claude_line(value: &Value, images: ImageMode) -> LineRows {
    let line_type = type_str(value);
    if line_type == "system" {
        if value.get("subtype").and_then(Value::as_str) == Some("compact_boundary") {
            let post_tokens = value
                .get("compactMetadata")
                .and_then(|m| m.get("postTokens").or_else(|| m.get("post_tokens")))
                .and_then(Value::as_i64);
            if let Some(tokens) = post_tokens {
                let ts = ts_string(value, &["timestamp"]);
                let usage = serde_json::json!({
                    "input_tokens": tokens,
                    "total_tokens": tokens,
                });
                return vec![LineRow {
                    usage: Some(usage),
                    ..LineRow::new("__usage__", String::new(), ts)
                }];
            }
        }
        return Vec::new();
    }
    if line_type != "user" && line_type != "assistant" {
        return Vec::new();
    }
    if value.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return Vec::new();
    }
    let Some(message) = value.get("message") else {
        return Vec::new();
    };
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or(line_type)
        .to_string();
    let ts = ts_string(value, &["timestamp"]);
    let usage = message.get("usage").cloned();
    let model = message
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string);
    let effort = value
        .get("effort")
        .or_else(|| message.get("effort"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let content = message.get("content");
    let mut out = Vec::new();
    match content {
        Some(Value::Array(blocks)) => {
            let mut text = String::new();
            let mut collected: Vec<String> = Vec::new();
            for block in blocks {
                claude_block_rows(
                    block,
                    images,
                    &mut out,
                    &mut text,
                    &mut collected,
                    &role,
                    &ts,
                    &usage,
                    &model,
                    &effort,
                );
            }
            if !text.trim().is_empty() {
                out.push(LineRow {
                    usage,
                    model,
                    effort,
                    images: collected,
                    ..LineRow::new(&role, text, ts)
                });
            } else if !collected.is_empty() {
                out.push(LineRow {
                    images: collected,
                    ..LineRow::new(&role, String::new(), ts)
                });
            }
        }
        _ => {
            let text = content_text(content);
            if !text.trim().is_empty() {
                out.push(LineRow {
                    usage,
                    model,
                    effort,
                    ..LineRow::new(&role, text, ts)
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_hides_internal_prompt_contributions_from_user_history() {
        let row = LineRow::new(
            "user",
            "visible request\n\n[CCGUI internal request-tail]\nsecret handoff\n\n[CCGUI internal request-tail]\nsemantic protocol".into(),
            None,
        );

        let normalized = normalize_extracted_row(row).expect("visible user row");
        assert_eq!(normalized.text, "visible request");
    }

    #[test]
    fn assistant_rows_are_untouched() {
        let padded = LineRow::new("assistant", "  spaced reply\n".into(), None);
        assert_eq!(
            normalize_extracted_row(padded)
                .expect("assistant row survives")
                .text,
            "  spaced reply\n"
        );
    }

    #[test]
    fn claude_line_extracts_thinking_and_tool_in_order() {
        let line: Value = serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "ponder", "signature": "sig"},
                    {"type": "text", "text": "reply"},
                    {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}
                ]
            }
        });
        let rows = extract_claude_line(&line, ImageMode::Collect);
        let roles: Vec<&str> = rows.iter().map(|r| r.role.as_str()).collect();
        assert_eq!(roles, ["thinking", "assistant", "tool"]);
        assert_eq!(rows[0].text, "ponder");
        assert_eq!(rows[1].text, "reply");
        assert_eq!(rows[2].text, "Bash");
        assert_eq!(rows[2].args, Some(serde_json::json!({"command": "ls"})));
    }

    #[test]
    fn claude_tool_use_row_carries_todowrite_snapshot() {
        let line: Value = serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "name": "TodoWrite", "input": {"todos": [
                        {"content": "scan files", "status": "completed"},
                        {"content": "write code", "status": "in_progress"},
                        {"content": "run tests", "status": "pending"},
                        {"content": "deploy", "status": "blocked"}
                    ]}}
                ]
            }
        });
        let rows = extract_claude_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "tool");
        let todos = rows[0].todos.as_ref().expect("todos payload");
        assert!(todos.replace);
        let statuses: Vec<&str> = todos.items.iter().map(|i| i.status.as_str()).collect();
        assert_eq!(statuses, ["complete", "active", "pending", "blocked"]);
        assert_eq!(todos.items[1].content, "write code");
    }

    #[test]
    fn claude_parallel_tool_results_pair_with_their_call_ids() {
        let call = |id: &str, subject: &str| {
            serde_json::json!({
                "type": "assistant", "timestamp": "2026-10-21T08:10:10Z",
                "message": {"role": "assistant", "content": [
                    {"type": "tool_use", "id": id, "name": "TaskCreate",
                     "input": {"subject": subject, "description": "", "activeForm": subject}}
                ]}
            })
        };
        let result = |call_id: &str, text: &str| {
            serde_json::json!({
                "type": "user", "timestamp": "2026-10-21T08:10:11Z",
                "message": {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": call_id, "content": text}
                ]}
            })
        };
        let lines = [
            call("call-a", "实测 Python 版"),
            call("call-b", "打包 exe"),
            result("call-b", "Task #2 created successfully: 打包 exe"),
            result("call-a", "Task #1 created successfully: 实测 Python 版"),
        ];
        let input = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let extractor: LineExtractor<'_> =
            Box::new(|value: &Value| extract_claude_line(value, ImageMode::Collect));
        let parsed = collect_session(std::io::Cursor::new(input), &extractor);

        assert_eq!(parsed.messages.len(), 2);
        let (first, second) = (&parsed.messages[0], &parsed.messages[1]);
        assert_eq!(first.text, "TaskCreate");
        assert_eq!(
            first.result,
            Some(serde_json::json!(
                "Task #1 created successfully: 实测 Python 版"
            ))
        );
        assert_eq!(
            second.result,
            Some(serde_json::json!("Task #2 created successfully: 打包 exe"))
        );
        let first_todos = first.todos.as_ref().expect("create payload");
        assert_eq!(first_todos.items[0].id.as_deref(), Some("1"));
        let second_todos = second.todos.as_ref().expect("create payload");
        assert_eq!(second_todos.items[0].id.as_deref(), Some("2"));
    }

    #[test]
    fn claude_task_get_row_carries_no_todo_patch() {
        let call = |id: &str, name: &str, input: Value| {
            serde_json::json!({
                "type": "assistant", "timestamp": "2026-10-21T08:10:10Z",
                "message": {"role": "assistant", "content": [
                    {"type": "tool_use", "id": id, "name": name, "input": input}
                ]}
            })
        };
        let result = |call_id: &str, text: &str| {
            serde_json::json!({
                "type": "user", "timestamp": "2026-10-21T08:10:11Z",
                "message": {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": call_id, "content": text}
                ]}
            })
        };
        let lines = [
            call(
                "call-c",
                "TaskCreate",
                serde_json::json!({"subject": "A", "description": ""}),
            ),
            result("call-c", "Task #1 created successfully: A"),
            call(
                "call-u",
                "TaskUpdate",
                serde_json::json!({"taskId": "1", "status": "completed"}),
            ),
            result("call-u", "Updated task #1 status"),
            call("call-g", "TaskGet", serde_json::json!({"taskId": "1"})),
            result("call-g", "Task #1: A\nStatus: completed\nDescription: "),
        ];
        let input = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let extractor: LineExtractor<'_> =
            Box::new(|value: &Value| extract_claude_line(value, ImageMode::Collect));
        let parsed = collect_session(std::io::Cursor::new(input), &extractor);

        assert_eq!(parsed.messages.len(), 3);
        assert_eq!(
            parsed.messages[0].todos.as_ref().unwrap().items[0]
                .id
                .as_deref(),
            Some("1")
        );
        assert_eq!(
            parsed.messages[1].todos.as_ref().unwrap().items[0].status,
            "complete"
        );
        assert_eq!(parsed.messages[2].text, "TaskGet");
        assert!(parsed.messages[2].todos.is_none());
    }

    #[test]
    fn claude_line_drops_is_meta_command_expansion() {
        let expansion: Value = serde_json::json!({
            "type": "user",
            "isMeta": true,
            "timestamp": "2026-09-08T10:00:00.000Z",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": "# 代码审查\n对未提交更改进行全面的安全和质量审查"}]
            }
        });
        assert!(extract_claude_line(&expansion, ImageMode::Collect).is_empty());
    }

    fn claude_user(text: &str, is_meta: bool) -> Value {
        serde_json::json!({
            "type": "user",
            "isMeta": is_meta,
            "timestamp": "2026-09-28T11:51:19.751Z",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": text}]
            }
        })
    }

    fn claude_texts(lines: &[Value]) -> Vec<String> {
        let input = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let extractor = extractor_for("claude", ImageMode::Collect);
        collect_session(std::io::Cursor::new(input), &extractor)
            .messages
            .into_iter()
            .map(|m| m.text)
            .collect()
    }

    #[test]
    fn claude_local_commands_stay_out_of_the_conversation() {
        let caveat = "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>";
        let model = "<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>";
        let stdout = "<local-command-stdout>Set model to `Opus 5.5` and saved as your default for new sessions</local-command-stdout>";
        let login = "<command-name>/login</command-name>\n            <command-message>login</command-message>\n            <command-args></command-args>";
        let lines = vec![
            claude_user(caveat, true),
            claude_user(model, false),
            claude_user(stdout, false),
            claude_user("review下本地代码", false),
            serde_json::json!({
                "type": "assistant",
                "timestamp": "2026-09-28T12:00:25.817Z",
                "message": {"role": "assistant", "content": [{"type": "text", "text": "看过了"}]}
            }),
            claude_user(caveat, true),
            claude_user(login, false),
            claude_user(
                "<local-command-stdout>Login successful</local-command-stdout>",
                false,
            ),
            claude_user("你能干啥", false),
        ];
        assert_eq!(
            claude_texts(&lines),
            ["review下本地代码", "看过了", "你能干啥"]
        );

        let input = lines
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let mut acc = ScanAcc::default();
        walk_lines(
            std::io::Cursor::new(input),
            &extractor_for("claude", ImageMode::SkipDataUrls),
            |row| acc.accept(row),
        );
        assert_eq!(acc.finish().title, "review下本地代码");
    }

    #[test]
    fn claude_skill_command_without_caveat_stays_visible() {
        let text = "<command-message>aimax:code-review</command-message>\n<command-name>/aimax:code-review</command-name>\n<command-args>审查1772</command-args>";
        assert_eq!(
            claude_texts(&[claude_user(text, false)]),
            ["/aimax:code-review 审查1772"]
        );
    }

    #[test]
    fn claude_local_command_string_content_is_dropped() {
        let lines = vec![
            serde_json::json!({
                "type": "user",
                "isMeta": true,
                "message": {"role": "user", "content": "<local-command-caveat>Caveat: local command.</local-command-caveat>"}
            }),
            serde_json::json!({
                "type": "user",
                "message": {"role": "user", "content": "<command-name>/effort</command-name>\n            <command-message>effort</command-message>\n            <command-args></command-args>"}
            }),
            serde_json::json!({
                "type": "user",
                "message": {"role": "user", "content": "<local-command-stdout>Set effort level to xhigh</local-command-stdout>"}
            }),
            serde_json::json!({
                "type": "user",
                "message": {"role": "user", "content": "你再设计下看看"}
            }),
        ];
        assert_eq!(claude_texts(&lines), ["你再设计下看看"]);
    }

    #[test]
    fn claude_clear_without_stdout_does_not_become_the_title() {
        let caveat = "<local-command-caveat>Caveat: local command.</local-command-caveat>";
        let clear = "<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>";
        let lines = vec![
            claude_user(caveat, true),
            claude_user(clear, false),
            claude_user("你好", false),
        ];
        assert_eq!(claude_texts(&lines), ["你好"]);
    }

    #[test]
    fn codex_reasoning_item_becomes_thinking_row() {
        let line: Value = serde_json::json!({
            "type": "response_item",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "payload": {
                "type": "reasoning",
                "summary": [
                    {"type": "summary_text", "text": "plan step one"},
                    {"type": "summary_text", "text": "plan step two"}
                ]
            }
        });
        let rows = extract_codex_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "thinking");
        assert_eq!(rows[0].text, "plan step one\nplan step two");

        let encrypted: Value = serde_json::json!({
            "type": "response_item",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "payload": {"type": "reasoning", "summary": [], "content": [{"type": "reasoning_text", "text": "hidden"}]}
        });
        assert!(extract_codex_line(&encrypted, ImageMode::Collect).is_empty());
    }
    #[test]
    fn claude_user_image_block_becomes_data_url() {
        let line: Value = serde_json::json!({
            "type": "user",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "message": {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "aGk="}},
                    {"type": "text", "text": "这是什么?"}
                ]
            }
        });
        let rows = extract_claude_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "这是什么?");
        assert_eq!(rows[0].images, ["data:image/png;base64,aGk="]);

        let image_only: Value = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "eGk="}}
                ]
            }
        });
        let rows = extract_claude_line(&image_only, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].images, ["data:image/jpeg;base64,eGk="]);
    }

    #[test]
    fn codex_input_image_part_is_collected() {
        let line: Value = serde_json::json!({
            "type": "response_item",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_image", "image_url": "data:image/png;base64,aGk="},
                    {"type": "input_text", "text": "see this"}
                ]
            }
        });
        let rows = extract_codex_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "see this");
        assert_eq!(rows[0].images, ["data:image/png;base64,aGk="]);
    }

    #[test]
    fn codex_token_count_uses_last_turn_not_session_total() {
        let line: Value = serde_json::json!({
            "type": "event_msg",
            "timestamp": "2026-09-10T04:54:08.090Z",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 2741100,
                        "output_tokens": 11900,
                        "total_tokens": 2753000
                    },
                    "last_token_usage": {
                        "input_tokens": 34660,
                        "cached_input_tokens": 27520,
                        "output_tokens": 85,
                        "total_tokens": 34745
                    },
                    "model_context_window": 475000
                }
            }
        });
        let rows = extract_codex_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "__usage__");
        assert_eq!(rows[0].usage.as_ref().unwrap()["input_tokens"], 34660);
        assert_eq!(rows[0].usage.as_ref().unwrap()["total_tokens"], 34745);
        assert_eq!(
            rows[0].usage.as_ref().unwrap()["model_context_window"],
            475000
        );
    }

    #[test]
    fn codex_token_count_prefers_last_usage_and_attaches_context_window() {
        let line: Value = serde_json::json!({
            "type": "event_msg",
            "timestamp": "2026-09-05T11:12:16.469Z",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 200000,
                        "output_tokens": 5000,
                        "total_tokens": 205000
                    },
                    "last_token_usage": {
                        "input_tokens": 30000,
                        "cached_input_tokens": 15000,
                        "output_tokens": 500,
                        "total_tokens": 30500
                    },
                    "model_context_window": 1000000
                }
            }
        });
        let rows = extract_codex_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "__usage__");
        let usage = rows[0].usage.as_ref().expect("usage object");
        assert_eq!(
            usage.get("input_tokens").and_then(Value::as_i64),
            Some(30000)
        );
        assert_eq!(
            usage.get("cached_input_tokens").and_then(Value::as_i64),
            Some(15000)
        );
        assert_eq!(
            usage.get("total_tokens").and_then(Value::as_i64),
            Some(30500)
        );
        assert_eq!(
            usage.get("model_context_window").and_then(Value::as_i64),
            Some(1000000)
        );
    }

    #[test]
    fn claude_compact_boundary_extracts_post_tokens_into_usage() {
        let line: Value = serde_json::json!({
            "type": "system",
            "subtype": "compact_boundary",
            "timestamp": "2026-09-10T05:55:55.956Z",
            "compactMetadata": {
                "preTokens": 30190,
                "postTokens": 8038,
                "durationMs": 4207
            }
        });
        let rows = extract_claude_line(&line, ImageMode::Collect);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "__usage__");
        let usage = rows[0].usage.as_ref().expect("usage object");
        assert_eq!(
            usage.get("input_tokens").and_then(Value::as_i64),
            Some(8038)
        );
        assert_eq!(
            usage.get("total_tokens").and_then(Value::as_i64),
            Some(8038)
        );
    }
}
