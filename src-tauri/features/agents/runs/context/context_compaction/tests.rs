use super::*;
use crate::transcript::fixtures::{call_message, error_output, json, result_message, text_output, turn};

fn step(number: usize) -> Vec<Message> {
    step_with(number, &format!("page {number} body ").repeat(20))
}

fn step_with(number: usize, result: &str) -> Vec<Message> {
    turn(&format!("call-{number}"), "browser_read", &format!(r#"{{"page":{number}}}"#), text_output(result))
}

fn task() -> Message {
    user_message("Compare the prices on these ten pages.")
}

fn outputs(messages: &[Message]) -> Vec<&ToolOutput> {
    messages
        .iter()
        .flat_map(|message| match message {
            Message::Tool { content, .. } => content.iter().map(|part| &part.output).collect::<Vec<_>>(),
            _ => Vec::new(),
        })
        .collect()
}

#[test]
fn uses_the_models_window_and_falls_back_for_unknown_models() {
    assert_eq!(context_window(Some(400_000.0)), 400_000);
    assert_eq!(context_window(None), DEFAULT_CONTEXT_WINDOW);
    assert_eq!(context_window(Some(1_000.0)), 16_000);
}

#[test]
fn estimates_from_reported_tokens_plus_what_the_transcript_grew_by() {
    let mut messages = vec![task()];
    let sent = message_bytes(&messages);
    messages.extend(step(1));
    assert_eq!(estimate_input_tokens(5_000.0, sent, &messages), 5_000.0 + (message_bytes(&messages) - sent) as f64 / 4.0);
}

#[test]
fn clears_all_but_the_most_recent_tool_results_and_keeps_every_call_paired() {
    let mut messages = vec![task()];
    messages.extend((0..6).flat_map(step));
    let (cleared, count) = clear_old_tool_results(&messages, 4);
    assert_eq!(count, 2);
    let was_cleared: Vec<bool> = outputs(&cleared).iter().map(|output| matches!(output, ToolOutput::Text { value } if value == CLEARED_RESULT)).collect();
    assert_eq!(was_cleared, [true, true, false, false, false, false]);
    // Calls and results still pair one to one.
    assert_eq!(cleared.iter().filter(|message| matches!(message, Message::Tool { .. })).count(), 6);
    assert_eq!(cleared.iter().filter(|message| matches!(message, Message::Assistant { .. })).count(), 6);
    assert!(message_bytes(&cleared) < message_bytes(&messages));
    // Clearing again changes nothing.
    assert_eq!(clear_old_tool_results(&cleared, 4).1, 0);
}

#[test]
fn keeps_errors_but_shortens_long_ones() {
    let mut messages = vec![task()];
    messages.extend(step(1));
    messages.push(call_message("e", "note_update", "{}"));
    messages.push(result_message("e", "note_update", error_output(&"x".repeat(5_000))));
    messages.extend(step(2));
    let (cleared, _) = clear_old_tool_results(&messages, 1);
    let Message::Tool { content, .. } = &cleared[4] else {
        panic!("the error result stays at its place");
    };
    let ToolOutput::ErrorText { value } = &content[0].output else {
        panic!("an error stays an error");
    };
    assert_eq!(value.len(), 2_000);
}

#[test]
fn summarizes_older_steps_but_keeps_the_task_the_persons_words_and_a_tail_that_starts_with_the_model() {
    let mut messages = vec![task()];
    messages.extend(step(1));
    messages.push(user_message("Skip the second store."));
    for number in 2..=5 {
        messages.extend(step(number));
    }
    let plan = plan_compaction(&messages, 5).unwrap();
    assert_eq!(json(std::slice::from_ref(&plan.task)), json(&[task()]));
    assert_eq!(plan.person_messages, ["Skip the second store."]);
    assert!(matches!(plan.recent[0], Message::Assistant { .. }));
    assert_eq!(plan.older.len() + plan.recent.len() + 1, messages.len());
    let compacted = apply_compaction(&plan, "Task: compare prices.\nDone so far: read pages 1-2.");
    let text = user_string(&compacted[0]).unwrap();
    assert!(text.contains("Compare the prices on these ten pages."));
    assert!(text.contains("Done so far: read pages 1-2."));
    assert!(text.contains("- Skip the second store."));
    assert!(text.contains("untrusted data"));
    assert_eq!(json(&compacted[1..]), json(&plan.recent));
}

#[test]
fn does_nothing_when_there_is_too_little_history() {
    let mut messages = vec![task()];
    messages.extend(step(1));
    assert!(plan_compaction(&messages, 6).is_none());
}

#[test]
fn renders_the_older_steps_as_plain_text_within_a_limit_keeping_the_newest() {
    let mut messages = step_with(1, "first result");
    messages.push(user_message("Use euros."));
    messages.extend(step_with(2, "second result"));
    let transcript = render_transcript(&messages, 10_000);
    assert!(transcript.contains(r#"Agent called browser_read with {"page":1}"#));
    assert!(transcript.contains("Result of browser_read: first result"));
    assert!(transcript.contains("Person: Use euros."));
    let mut long = step_with(1, &"old ".repeat(500));
    long.extend(step_with(2, "newest result"));
    let clipped = render_transcript(&long, 200);
    assert!(clipped.starts_with("[Earliest steps omitted]"));
    assert!(clipped.contains("newest result"));
}
