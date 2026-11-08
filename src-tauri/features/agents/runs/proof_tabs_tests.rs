use super::*;
use crate::model_calls::{RawJson, ToolResultPart};

fn call(tool: &str) -> Message {
    Message::Assistant {
        content: vec![AssistantPart::ToolCall {
            tool_call_id: tool.to_owned(),
            tool_name: tool.to_owned(),
            input: RawJson::empty_object(),
            provider_options: None,
        }],
        provider_options: None,
    }
}

fn result(tool: &str, output: ToolOutput) -> Message {
    Message::Tool {
        content: vec![ToolResultPart { kind: "tool-result".to_owned(), tool_call_id: tool.to_owned(), tool_name: tool.to_owned(), output }],
        provider_options: None,
    }
}

fn text(value: &str) -> ToolOutput {
    ToolOutput::Text { value: value.to_owned() }
}

fn program(value: &str) -> Message {
    result("browser_run", ToolOutput::Json { value: RawJson::from_text(value.to_owned()).unwrap() })
}

#[test]
fn recognises_requests_to_leave_pages_open() {
    assert!(asks_for_open_pages("open at least one qualifying listing in its own tab so I can see the photos"));
    assert!(asks_for_open_pages("keep that product page open too so I can compare"));
    assert!(asks_for_open_pages("leave the directory tabs open as visual proof"));
    assert!(!asks_for_open_pages("What is the capital of France?"));
}

#[test]
fn the_gap_before_open_counts_as_javascript_counts_it() {
    let near = format!("keep {} open", "a".repeat(78));
    assert!(asks_for_open_pages(&near));
    // Each emoji is two units, so this gap is over the limit though it's under 80 characters.
    let far = format!("keep {} open", "😀".repeat(41));
    assert!(!asks_for_open_pages(&far));
    assert!(!asks_for_open_pages("keep the page. open"));
}

#[test]
fn sends_a_finish_back_once_to_list_tabs_not_when_they_were_just_listed() {
    let request = "Keep the PIPS scholarship page open in another tab.";
    assert!(proof_tabs_refusal(request, &[], Some("browser_tab_list"), None).unwrap().contains("call browser_tab_list"));
    assert_eq!(proof_tabs_refusal(request, &[call("browser_tab_list")], Some("browser_tab_list"), None), None);
}

#[test]
fn looks_only_at_the_last_four_calls_and_programs_always_check() {
    let request = "keep that product page open too";
    let long_ago = [call("browser_tab_list"), call("a"), call("b"), call("c"), call("d")];
    assert!(proof_tabs_refusal(request, &long_ago, Some("browser_tab_list"), None).is_some());
    assert_eq!(proof_tabs_refusal("What time is it?", &[], Some("browser_tab_list"), None), None);
    assert_eq!(proof_tabs_refusal(request, &[], None, None), None);
    let with_program = proof_tabs_refusal(request, &[call("browser_tab_list")], Some("browser_tab_list"), Some("browser_run")).unwrap();
    assert!(with_program.contains("call browser_run with `return listTabs()`"));
}

#[test]
fn names_kept_tabs_that_end_on_an_error_page() {
    let messages = [program(r#"{"kept":["a","b"],"tabs":[{"id":"a","url":"https://aetna.com/x","title":"We Can't Find That Page | Aetna"},{"id":"b","url":"https://uhc.com","title":"UnitedHealthcare"}]}"#)];
    assert_eq!(broken_proof_tabs(&messages), ["https://aetna.com/x (\"We Can't Find That Page | Aetna\")"]);
    assert!(broken_proof_tabs(&[program(r#"{"kept":["b"],"tabs":[{"id":"b","url":"https://uhc.com","title":"UnitedHealthcare"}]}"#)]).is_empty());
    let as_text = result("browser_run", text(r#"{"kept":["c"],"tabs":[{"id":"c","url":"about:blank","title":""}]}"#));
    assert_eq!(broken_proof_tabs(&[as_text]), ["about:blank (\"\")"]);
}

#[test]
fn names_a_site_the_request_asks_for_that_the_run_visited_and_left_with_no_tab_open() {
    let ask = "Start on Google, look up kits on RockAuto, then check Amazon for a tool and open the product page; leave those tabs open.";
    let visits = [
        program(r#"{"tabs":[{"id":"g","url":"https://www.google.com/search?q=x"},{"id":"r","url":"https://www.rockauto.com/en/catalog"},{"id":"a","url":"https://www.amazon.com/s?k=pliers"}]}"#),
        result("screen_close", text("closed | Closed that tab. Your open tabs: r.")),
    ];
    assert_eq!(missing_site_tabs(ask, &visits), ["amazon"]);
    assert!(missing_site_tabs(ask, &visits[..1]).is_empty());
    assert!(missing_site_tabs("Check Amazon for a tool.", &visits).is_empty());
}
