//! Keeps long browser runs cheap and fast.
//!
//! Providers cache the unchanged start of a request. The transcript only grows at its end, so every
//! turn reuses the turn before it, as long as older messages stay byte-identical. Page snapshots are
//! the bulk of a browser run and go stale after the next action, so older ones are dropped, but in
//! batches: each drop rewrites earlier messages and costs one uncached turn.
use std::borrow::Cow;

use serde_json::{json, Map, Value};

use crate::js_json::JsValue;
use crate::text::js_len;
use crate::model_calls::{Message, ProviderOptions, ToolOutput};

/// Page tools whose results carry a snapshot tree.
const SNAPSHOT_TOOLS: [&str; 4] = ["browser_snapshot", "browser_steps", "browser_fill_form", "browser_navigate"];
/// The newest snapshots stay; the model acts on them.
const KEEP_SNAPSHOTS: usize = 2;
/// Stale snapshot text that triggers one batched drop.
const STALE_BYTES: usize = 48_000;

pub(crate) const DROPPED_SNAPSHOT: &str = "[Older page snapshot removed; its refs may be stale. Take a new snapshot to see the page now.]";

/// A tool result's text, if it holds a JSON object.
fn output_object(output: &ToolOutput) -> Option<JsValue> {
    let ToolOutput::Text { value } = output else {
        return None;
    };
    JsValue::parse(value).filter(JsValue::is_object)
}

fn snapshot_text(value: &JsValue) -> &str {
    if let Some(tree) = value.get("tree").and_then(JsValue::as_str) {
        return tree;
    }
    value.get("snapshot").and_then(|nested| nested.get("tree")).and_then(JsValue::as_str).unwrap_or("")
}

fn drop_snapshot(value: &JsValue) -> Option<JsValue> {
    let dropped = || JsValue::String(DROPPED_SNAPSHOT.to_owned());
    if value.get("tree").and_then(JsValue::as_str).is_some_and(|tree| tree != DROPPED_SNAPSHOT) {
        return Some(value.with_field("tree", dropped()));
    }
    let nested = value.get("snapshot")?;
    if nested.get("tree").and_then(JsValue::as_str).is_some_and(|tree| tree != DROPPED_SNAPSHOT) {
        return Some(value.with_field("snapshot", nested.with_field("tree", dropped())));
    }
    None
}

/// Replaces every page snapshot but the newest two with a short note, once the stale ones add up to
/// enough to be worth a cache miss.
pub(crate) fn prune_stale_page_snapshots(messages: &[Message]) -> (Cow<'_, [Message]>, usize) {
    let mut located = Vec::new();
    for (message_index, message) in messages.iter().enumerate() {
        let Message::Tool { content, .. } = message else {
            continue;
        };
        for (part_index, part) in content.iter().enumerate() {
            if !SNAPSHOT_TOOLS.contains(&part.tool_name.as_str()) {
                continue;
            }
            let Some(value) = output_object(&part.output) else {
                continue;
            };
            let text = snapshot_text(&value);
            let bytes = if text == DROPPED_SNAPSHOT { 0 } else { js_len(text) };
            if bytes > 0 {
                located.push((message_index, part_index, bytes));
            }
        }
    }
    let stale = &located[..located.len().saturating_sub(KEEP_SNAPSHOTS)];
    if stale.iter().map(|(_, _, bytes)| bytes).sum::<usize>() < STALE_BYTES {
        return (Cow::Borrowed(messages), 0);
    }
    let mut out = messages.to_vec();
    let mut dropped = 0;
    for &(message_index, part_index, _) in stale {
        let Message::Tool { content, .. } = &mut out[message_index] else {
            continue;
        };
        let part = &mut content[part_index];
        let Some(next) = output_object(&part.output).and_then(|value| drop_snapshot(&value)) else {
            continue;
        };
        part.output = ToolOutput::Text { value: next.stringify() };
        dropped += 1;
    }
    (Cow::Owned(out), dropped)
}

fn options_slot(message: &mut Message) -> &mut Option<ProviderOptions> {
    match message {
        Message::System { provider_options, .. }
        | Message::User { provider_options, .. }
        | Message::Assistant { provider_options, .. }
        | Message::Tool { provider_options, .. } => provider_options,
    }
}

/// Marks the newest message as an Anthropic cache breakpoint, and the end of the previous request
/// (the message before the newest assistant turn), clearing older marks. Anthropic allows four. It
/// finds an earlier cache entry only within about 20 blocks of a breakpoint, and a turn of parallel
/// calls with pushed page states adds more, so the second mark keeps the previous request's prefix
/// in reach. Other providers cache unchanged prefixes on their own.
pub(crate) fn with_cache_breakpoint<'a>(messages: &'a [Message], model_id: &str) -> Cow<'a, [Message]> {
    if !model_id.starts_with("anthropic/") || messages.is_empty() {
        return Cow::Borrowed(messages);
    }
    let last_assistant = messages.iter().rposition(|message| matches!(message, Message::Assistant { .. }));
    let before_assistant = last_assistant.and_then(|index| index.checked_sub(1));
    let mut out = messages.to_vec();
    let newest = out.len() - 1;
    for (index, message) in out.iter_mut().enumerate() {
        let slot = options_slot(message);
        let mut options = slot.take().unwrap_or_default();
        let mut anthropic = match options.remove("anthropic") {
            Some(Value::Object(fields)) => fields,
            _ => Map::new(),
        };
        anthropic.remove("cacheControl");
        if index == newest || Some(index) == before_assistant {
            anthropic.insert("cacheControl".to_owned(), json!({ "type": "ephemeral" }));
        }
        if !anthropic.is_empty() {
            options.insert("anthropic".to_owned(), Value::Object(anthropic));
        }
        *slot = (!options.is_empty()).then_some(options);
    }
    Cow::Owned(out)
}

/// Where the server's run-specific part of the system prompt (time, tab, device) begins.
const VOLATILE_MARKERS: [&str; 2] = ["\n\nAuthoritative run context:", "\n\nCurrent time:"];

/// Adds the runtime's fixed instructions to the server's system prompt ahead of the part that
/// changes every run. Providers cache a prompt only up to its first difference, so fixed text after
/// a timestamp would be re-read at full price by every new run.
pub(crate) fn with_runtime_instructions(system: &str, fixed: &[&str]) -> String {
    let marker = VOLATILE_MARKERS.iter().filter_map(|value| system.find(value)).min();
    let added = format!("\n{}", fixed.join("\n"));
    match marker {
        None => format!("{system}\n{added}"),
        Some(at) => format!("{}{added}{}", &system[..at], &system[at..]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::fixtures::{assistant_text, call_message, json, result_message, text_output};
    use crate::transcript::user_message;

    fn tree(number: usize) -> String {
        format!("- button \"Item {number}\" [ref=e{number}]\n").repeat(1_000)
    }

    fn quoted(text: &str) -> String {
        JsValue::String(text.to_owned()).stringify()
    }

    fn transcript(snapshots: usize) -> Vec<Message> {
        let mut messages = vec![user_message("Fill the form.")];
        for index in 0..snapshots {
            let name = if index % 2 == 1 { "browser_steps" } else { "browser_snapshot" };
            let tree = quoted(&tree(index));
            let value = if index % 2 == 1 {
                format!(r#"{{"ran":1,"snapshot":{{"documentId":"d","tree":{tree}}}}}"#)
            } else {
                format!(r#"{{"documentId":"d","tree":{tree}}}"#)
            };
            messages.push(call_message(&format!("c{index}"), name, "{}"));
            messages.push(result_message(&format!("c{index}"), name, text_output(value)));
        }
        messages
    }

    fn trees(messages: &[Message]) -> Vec<String> {
        messages
            .iter()
            .filter_map(|message| match message {
                Message::Tool { content, .. } => output_object(&content[0].output).map(|value| snapshot_text(&value).to_owned()),
                _ => None,
            })
            .collect()
    }

    fn anthropic_marks(messages: &[Message]) -> Vec<usize> {
        messages
            .iter()
            .enumerate()
            .filter_map(|(index, message)| {
                let mut message = message.clone();
                options_slot(&mut message).as_ref().is_some_and(|options| options.contains_key("anthropic")).then_some(index)
            })
            .collect()
    }

    #[test]
    fn keeps_every_snapshot_until_the_stale_ones_are_worth_a_cache_miss() {
        let short = transcript(3);
        let (messages, dropped) = prune_stale_page_snapshots(&short);
        assert_eq!(dropped, 0);
        assert!(matches!(messages, Cow::Borrowed(_)));
    }

    #[test]
    fn drops_all_but_the_newest_two_snapshots_in_one_batch() {
        let long = transcript(6);
        let (messages, dropped) = prune_stale_page_snapshots(&long);
        assert_eq!(dropped, 4);
        let kept = trees(&messages);
        assert!(kept[..4].iter().all(|value| value == DROPPED_SNAPSHOT));
        assert_eq!(kept[4], tree(4));
        assert_eq!(kept[5], tree(5));
        // Calls and their results stay paired; the original is untouched.
        assert_eq!(messages.len(), long.len());
        assert_eq!(trees(&long)[0], tree(0));
        // Already-dropped snapshots do not trigger another rewrite.
        let mut next = messages.into_owned();
        next.push(call_message("x", "browser_snapshot", "{}"));
        next.push(result_message("x", "browser_snapshot", text_output(r#"{"tree":"- text: hi"}"#)));
        assert_eq!(prune_stale_page_snapshots(&next).1, 0);
    }

    #[test]
    fn a_rewrite_keeps_the_keys_in_their_places() {
        let messages = [
            result_message("a", "browser_snapshot", text_output(format!(r#"{{"z":1,"tree":{},"a":2}}"#, quoted(&"x".repeat(50_000))))),
            result_message("b", "browser_snapshot", text_output(r#"{"tree":"one"}"#)),
            result_message("c", "browser_snapshot", text_output(r#"{"tree":"two"}"#)),
        ];
        let (out, dropped) = prune_stale_page_snapshots(&messages);
        assert_eq!(dropped, 1);
        let Message::Tool { content, .. } = &out[0] else {
            panic!("the message stays a tool result");
        };
        let ToolOutput::Text { value } = &content[0].output else {
            panic!("the output stays text");
        };
        assert_eq!(*value, format!(r#"{{"z":1,"tree":{},"a":2}}"#, quoted(DROPPED_SNAPSHOT)));
    }

    #[test]
    fn leaves_other_tools_results_alone() {
        let mut messages = vec![user_message("Go")];
        for index in 0..8 {
            messages.push(call_message(&format!("n{index}"), "note_search", "{}"));
            messages.push(result_message(&format!("n{index}"), "note_search", text_output(format!(r#"{{"tree":{}}}"#, quoted(&tree(index))))));
        }
        assert_eq!(prune_stale_page_snapshots(&messages).1, 0);
    }

    #[test]
    fn moves_one_anthropic_cache_breakpoint_to_the_newest_message() {
        let start = [user_message("a"), user_message("b")];
        let first = with_cache_breakpoint(&start, "anthropic/claude-sonnet-5-5").into_owned();
        assert_eq!(anthropic_marks(&first), [1]);
        let mut marked = first[1].clone();
        assert_eq!(options_slot(&mut marked).as_ref().map(|options| Value::Object(options.clone())), Some(json!({ "anthropic": { "cacheControl": { "type": "ephemeral" } } })));
        let mut grown = first.clone();
        grown.push(user_message("c"));
        let second = with_cache_breakpoint(&grown, "anthropic/claude-sonnet-5-5");
        assert_eq!(anthropic_marks(&second), [2]);
        let openai = [user_message("a")];
        assert!(matches!(with_cache_breakpoint(&openai, "openai/gpt-6-luna"), Cow::Borrowed(_)));
        assert_eq!(json(&with_cache_breakpoint(&openai, "openai/gpt-6-luna")), json(&openai));
    }

    #[test]
    fn also_marks_where_the_previous_request_ended_so_a_long_turn_still_finds_its_cache() {
        let messages = [user_message("Go"), assistant_text("First"), user_message("Previous end"), assistant_text("Second"), user_message("New end")];
        assert_eq!(anthropic_marks(&with_cache_breakpoint(&messages, "anthropic/claude-haiku-5-5")), [2, 4]);
    }

    #[test]
    fn other_options_survive_a_moved_mark() {
        let mut message = user_message("a");
        let mut options = ProviderOptions::new();
        options.insert("anthropic".to_owned(), json!({ "cacheControl": { "type": "ephemeral" }, "other": 1 }));
        options.insert("openai".to_owned(), json!({ "x": 1 }));
        *options_slot(&mut message) = Some(options);
        let marked = with_cache_breakpoint(&[message, user_message("b")], "anthropic/x").into_owned();
        let mut first = marked[0].clone();
        assert_eq!(
            options_slot(&mut first).as_ref().map(|options| Value::Object(options.clone())),
            Some(json!({ "anthropic": { "other": 1 }, "openai": { "x": 1 } }))
        );
    }

    #[test]
    fn fixed_instructions_go_ahead_of_the_part_that_changes_every_run() {
        assert_eq!(with_runtime_instructions("Base", &["One", "Two"]), "Base\n\nOne\nTwo");
        assert_eq!(
            with_runtime_instructions("Base\n\nCurrent time: 1\n\nAuthoritative run context: x", &["One"]),
            "Base\nOne\n\nCurrent time: 1\n\nAuthoritative run context: x"
        );
    }
}
