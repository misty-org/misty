use super::*;
use crate::runtime::transcript::{
    fixtures::{assistant_text, call_message, result_message, text_output},
    user_message,
};

fn parts_json(text: &str) -> Option<JsValue> {
    Some(JsValue::parse(text).unwrap())
}

fn report_json(outcome: &str, remaining: &str) -> String {
    format!(r#"{{"outcome":"{outcome}","summary":"Task result","remaining":{remaining}}}"#)
}

fn part(kind: &str, tool: &str, id: Option<&str>, output: Option<JsValue>) -> CompletionPart {
    CompletionPart { kind: kind.to_owned(), tool_name: Some(tool.to_owned()), tool_call_id: id.map(str::to_owned), output }
}

fn finish_step(output: &str) -> Vec<CompletionPart> {
    vec![part("tool-call", TASK_COMPLETION_TOOL, None, None), part("tool-result", TASK_COMPLETION_TOOL, None, parts_json(output))]
}

fn text_part() -> CompletionPart {
    CompletionPart { kind: "text".to_owned(), ..CompletionPart::default() }
}

#[test]
fn reads_the_pinned_workflow_agents_executed_receipt_separate_from_step_content() {
    let completed = report_json("completed", "[]");
    let call = part("tool-call", TASK_COMPLETION_TOOL, Some("finish"), None);
    let receipt = part("tool-result", TASK_COMPLETION_TOOL, Some("finish"), parts_json(&completed));
    let steps = vec![vec![call.clone()]];
    assert_eq!(final_task_completion(&steps, std::slice::from_ref(&receipt)).unwrap().outcome, Outcome::Completed);
    let earlier = CompletionPart { tool_call_id: Some("earlier".to_owned()), ..receipt.clone() };
    let other = CompletionPart { tool_name: Some("note.read".to_owned()), ..receipt.clone() };
    let errored = CompletionPart { kind: "tool-error".to_owned(), ..receipt.clone() };
    let malformed = CompletionPart { output: parts_json(r#"{"outcome":"completed"}"#), ..receipt.clone() };
    let bad: [Vec<CompletionPart>; 6] = [vec![], vec![earlier], vec![other], vec![errored], vec![receipt.clone(), receipt.clone()], vec![malformed]];
    for receipts in &bad {
        assert_eq!(final_task_completion(&steps, receipts), None);
    }
    let with_write = vec![vec![call.clone(), part("tool-call", "note.create", Some("write"), None)]];
    assert_eq!(final_task_completion(&with_write, std::slice::from_ref(&receipt)), None);
    let after_text = vec![vec![call], vec![text_part()]];
    assert_eq!(final_task_completion(&after_text, std::slice::from_ref(&receipt)), None);
}

#[test]
fn keeps_earlier_reads_without_a_deliverable_blocked() {
    let reason = "No authorized browser or YouTube reader is available.";
    let value = report_json("blocked", &format!(r#"[{{"requirement":"Verified GothamChess weekly playlist manifest","reason":"{reason}"}}]"#));
    let steps = vec![vec![part("tool-result", "note_search", None, parts_json(r#"{"results":[]}"#))], finish_step(&value)];
    let completed = final_task_completion(&steps, &[]).unwrap();
    assert!(matches!(task_completion_outcome(Some(&completed)), TaskOutcome::Incomplete { error_code: "task_blocked", .. }));
    assert!(task_completion_text(&completed).contains(reason));
}

fn report(outcome: Outcome, remaining: Vec<RemainingItem>) -> TaskCompletion {
    TaskCompletion { outcome, summary: "Task result".to_owned(), remaining }
}

fn save_note() -> Vec<RemainingItem> {
    vec![RemainingItem { requirement: "Save note".to_owned(), reason: "Permission denied".to_owned() }]
}

#[test]
fn distinguishes_verified_completion_from_partial_or_contradictory_claims() {
    let steps = vec![finish_step(&report_json("completed", "[]"))];
    assert_eq!(task_completion_outcome(final_task_completion(&steps, &[]).as_ref()), TaskOutcome::Success);
    assert!(matches!(task_completion_outcome(Some(&report(Outcome::Partial, save_note()))), TaskOutcome::Incomplete { error_code: "task_incomplete", .. }));
    assert!(matches!(task_completion_outcome(Some(&report(Outcome::Completed, save_note()))), TaskOutcome::Incomplete { .. }));
}

#[test]
fn never_upgrades_plain_final_prose_a_missing_report_or_malformed_report_into_success() {
    let cases = [vec![], vec![vec![text_part()]], vec![finish_step(r#"{"outcome":"completed"}"#)]];
    for steps in &cases {
        assert!(matches!(task_completion_outcome(final_task_completion(steps, &[]).as_ref()), TaskOutcome::Incomplete { error_code: "task_outcome_unreported", .. }));
    }
}

#[test]
fn requires_the_final_standalone_report_after_any_further_work_or_steering() {
    let earlier = finish_step(&report_json("completed", "[]"));
    let later = vec![part("tool-result", "note.create", None, parts_json(r#"{"id":"note"}"#))];
    assert_eq!(final_task_completion(&[earlier.clone(), later.clone()], &[]), None);
    assert_eq!(final_task_completion(&[[earlier.clone(), later.clone()].concat()], &[]), None);
    let partial = finish_step(&report_json("partial", "[]"));
    assert_eq!(final_task_completion(&[earlier.clone(), later, partial], &[]).unwrap().outcome, Outcome::Partial);
    assert_eq!(final_task_completion(&[[earlier.clone(), earlier].concat()], &[]), None);
}

const ANSWER: &str = "The capital of France is Paris.";

fn answered() -> Vec<Message> {
    vec![
        user_message("What is the capital of France?"),
        call_message("a", "web_search", "{}"),
        result_message("a", "web_search", text_output("Paris")),
        assistant_text(ANSWER),
        user_message(FINISH_MISSING_NOTE),
    ]
}

fn input(summary: Option<&str>, remaining: Vec<RemainingItem>) -> TaskCompletionInput {
    TaskCompletionInput { outcome: if remaining.is_empty() { Outcome::Completed } else { Outcome::Partial }, summary: summary.map(str::to_owned), remaining }
}

#[test]
fn asks_for_outcome_and_remaining_only_and_the_instructions_no_longer_demand_a_repeat() {
    assert!(FINISH_MISSING_NOTE.contains("only outcome and remaining"));
    assert!(!FINISH_MISSING_NOTE.contains("same answer in full"));
    assert!(TASK_COMPLETION_INSTRUCTIONS.contains("leave summary out"));
    assert!(parse_task_completion_input(&JsValue::parse(r#"{"outcome":"completed","remaining":[]}"#).unwrap()).is_some());
}

#[test]
fn uses_the_text_answer_as_the_summary_so_the_final_text_is_that_answer_once() {
    let messages = answered();
    let filled = with_answer_summary(&input(None, Vec::new()), &messages).unwrap();
    assert_eq!(filled, TaskCompletion { outcome: Outcome::Completed, summary: ANSWER.to_owned(), remaining: Vec::new() });
    assert_eq!(task_completion_text(&filled), ANSWER);
    let receipt = serde_json::to_string(&filled).unwrap();
    assert_eq!(task_completion_outcome(final_task_completion(&[finish_step(&receipt)], &[]).as_ref()), TaskOutcome::Success);
    // An empty summary counts as left out, and a summary the model wrote stands.
    assert_eq!(with_answer_summary(&input(Some("  "), Vec::new()), &messages).unwrap().summary, ANSWER);
    assert_eq!(with_answer_summary(&input(Some("Paris."), Vec::new()), &messages).unwrap().summary, "Paris.");
}

#[test]
fn keeps_the_still_incomplete_suffix_for_a_partial_run() {
    let remaining = vec![RemainingItem { requirement: "Population".to_owned(), reason: "No source".to_owned() }];
    let filled = with_answer_summary(&input(None, remaining), &answered()).unwrap();
    assert_eq!(task_completion_text(&filled), format!("{ANSWER}\n\nStill incomplete:\n- Population: No source"));
}

#[test]
fn looks_past_a_refused_finish_sent_again_but_never_takes_narration_around_other_tools() {
    let mut refused = answered();
    refused.push(call_message("f", TASK_COMPLETION_TOOL, "{}"));
    refused.push(result_message("f", TASK_COMPLETION_TOOL, text_output("refused")));
    assert_eq!(last_text_answer(&refused), ANSWER);
    let mut narrated = answered();
    narrated.push(Message::Assistant {
        content: vec![
            crate::sdk::AssistantPart::Text { text: "Let me check one more page.".to_owned(), provider_options: None },
            crate::sdk::AssistantPart::ToolCall { tool_call_id: "b".to_owned(), tool_name: "web_fetch".to_owned(), input: RawJson::empty_object(), provider_options: None },
        ],
        provider_options: None,
    });
    assert_eq!(last_text_answer(&narrated), "");
    assert_eq!(last_text_answer(&[assistant_text("Last: read two pages. Next: read the third.")]), "");
    assert_eq!(with_answer_summary(&input(None, Vec::new()), &answered()[..3]), None);
}

#[test]
fn tells_a_progress_line_from_an_answer() {
    assert!(is_progress_note("Last: the UBalt visit page is already read and open, so I'm not reopening it. Next: I'll read UMD's Leadership Scholars page, then finish."));
    assert!(is_progress_note("**Last:** opened three tabs. **Have:** 4 of 10. **Next:** open the next five."));
    assert!(!is_progress_note("**Recommendation: contact American University first.** Its PIPS scholarship is the largest. Next steps for you: call admissions."));
    assert!(!is_progress_note(&format!("Last year the school changed its deadline. {}", "Detail. ".repeat(80))));
    assert!(is_progress_note("The popup is still showing. Let me try clicking the Cocktail Dresses link directly."));
    assert!(is_progress_note("PLT is done. Now I need to open JJ's House and find a deep V-neck dress."));
    assert!(!is_progress_note("Would you like me to keep looking for more options?"));
    assert!(!is_progress_note("The cheapest flight is $212 on Delta, leaving at 7:05."));
    assert!(!is_progress_note("## Shortlist\n- Dress: $28\n- Jogger: $25\nLet me know if you want more."));
}

#[test]
fn only_the_last_sentence_can_announce_a_move() {
    assert!(!is_progress_note("Let me be clear. The answer is 4."));
    assert!(is_progress_note("Done.   Let me look. "));
    // A colon ends a sentence too, and a space after other punctuation doesn't.
    assert!(!is_progress_note("I will go: home"));
    assert!(is_progress_note("Well, I will go"));
}

fn call_step() -> ClosingStep {
    ClosingStep { text: None, has_tool_call: true }
}

fn say(text: &str) -> ClosingStep {
    ClosingStep { text: Some(text.to_owned()), has_tool_call: false }
}

#[test]
fn keeps_the_fullest_answer_since_the_last_tool_call_not_a_later_recap() {
    let shortlist = "## Shortlist\n- Dress: Forest Green, $28\n- Jogger: $25\n- Boots: 6 colors\n- Cleat: $54.99, under $60";
    assert_eq!(closing_text(&[say("Opening pages."), call_step(), say(shortlist), say("My full answer is already provided above.")]), shortlist);
    let early = format!("Early draft answer that is long {}", "x".repeat(200));
    assert_eq!(closing_text(&[say(&early), call_step(), say("Final.")]), "Final.");
    assert_eq!(closing_text(&[say("Hi! How can I help?")]), "Hi! How can I help?");
}

#[test]
fn zod_rules_hold_when_reading_a_report() {
    let parse = |text: &str| parse_task_completion(&JsValue::parse(text).unwrap());
    assert_eq!(parse(r#"{"outcome":"completed","summary":"  a  ","remaining":[]}"#).unwrap().summary, "a");
    assert_eq!(parse(r#"{"outcome":"done","summary":"a","remaining":[]}"#), None);
    assert_eq!(parse(r#"{"outcome":"completed","summary":"  ","remaining":[]}"#), None);
    assert_eq!(parse(r#"{"outcome":"completed","summary":"a","remaining":[{"requirement":"r"}]}"#), None);
    assert!(task_completion_input_schema().get().contains(r#""required":["outcome","remaining"]"#));
}
