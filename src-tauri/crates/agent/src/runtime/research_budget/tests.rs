use super::*;
use crate::runtime::{requirements_review::ledger_note, transcript::{fixtures::call_message, user_message}};

fn tools() -> ResearchTools {
    ResearchTools { search: Some("web_search".to_owned()), fetch: Some("web_fetch".to_owned()), open: None }
}

fn search(index: usize, query: &str) -> Message {
    call_message(&format!("s{index}"), "web_search", &format!(r#"{{"query":"{query}"}}"#))
}

fn fetch(index: usize, url: &str) -> Message {
    call_message(&format!("f{index}"), "web_fetch", &format!(r#"{{"url":"{url}"}}"#))
}

fn sites(count: usize) -> Vec<Message> {
    (0..count).map(|index| fetch(index, &format!("https://site{index}.com"))).collect()
}

fn words(list: &[&str]) -> HashSet<String> {
    list.iter().map(|word| (*word).to_owned()).collect()
}

#[test]
fn stays_open_for_a_handful_of_distinct_calls() {
    let usage = research_use(&[search(0, "prime time anthropic video"), fetch(0, "https://youtube.com/watch?v=1")], &tools(), 1);
    assert_eq!(usage, ResearchUse { searches: 1, fetches: 1, repeats: 0, cost: 2, stage: ResearchStage::Open });
}

#[test]
fn counts_a_reworded_search_and_a_reread_page_as_repeats_that_cost_double() {
    let usage = research_use(
        &[
            search(0, "ThePrimeagen anthropic no cruel language video"),
            search(1, "theprimeagen anthropic cruel language"),
            fetch(0, "https://a.com/x#top"),
            fetch(1, "https://a.com/x/"),
        ],
        &tools(),
        1,
    );
    assert_eq!(usage.repeats, 2);
    assert_eq!(usage.cost, 6);
    assert_eq!(usage.stage, ResearchStage::WrapUp);
}

#[test]
fn keeps_the_larger_budget_a_run_had_after_its_checklist_was_summarized_away() {
    let many = sites(RESEARCH_CLOSE);
    assert_eq!(research_use(&many, &tools(), 1).stage, ResearchStage::Closed);
    assert_eq!(research_use(&many, &tools(), 4).stage, ResearchStage::Open);
}

#[test]
fn does_not_call_different_questions_repeats() {
    assert!(!same_query(&words(&["rust", "async", "runtime"]), &words(&["postgres", "pricing", "tiers"])));
}

#[test]
fn closes_at_the_limit_hides_the_research_tools_and_ignores_other_tools() {
    let mut many = sites(RESEARCH_CLOSE);
    many.push(call_message("x", "browser_act", r#"{"goal":"x"}"#));
    let usage = research_use(&many, &tools(), 1);
    assert_eq!(usage.stage, ResearchStage::Closed);
    let mut hidden: Vec<String> = closed_research_tools(&usage, &tools()).into_iter().collect();
    hidden.sort();
    assert_eq!(hidden, ["web_fetch", "web_search"]);
    assert!(closed_research_tools(&research_use(&[], &tools(), 1), &tools()).is_empty());
}

#[test]
fn says_each_stage_once_from_the_transcript() {
    let mut messages = sites(RESEARCH_WRAP_UP);
    let usage = research_use(&messages, &tools(), 1);
    let note = research_note(&usage, &messages, &ResearchTools::default()).unwrap();
    assert!(note.starts_with("Research budget (wrap-up)"));
    messages.push(user_message(note));
    assert_eq!(research_note(&usage, &messages, &ResearchTools::default()), None);
    assert_eq!(research_note(&research_use(&[], &tools(), 1), &[], &ResearchTools::default()), None);
}

#[test]
fn does_nothing_when_the_run_has_no_research_tools() {
    assert_eq!(research_use(&[search(0, "a b c")], &ResearchTools::default(), 1).cost, 0);
}

#[test]
fn sends_a_run_with_its_own_tabs_to_work_on_pages_instead_of_answering_early() {
    let with_tabs = ResearchTools { open: Some("screen_open".to_owned()), ..tools() };
    let wrap_up = ResearchUse { searches: 3, fetches: 3, repeats: 0, cost: 6, stage: ResearchStage::WrapUp };
    let note = research_note(&wrap_up, &[], &with_tabs).unwrap();
    assert!(note.contains("in your own tabs with screen_open"));
    assert!(!note.contains("Answer now"));
    let closed = ResearchUse { stage: ResearchStage::Closed, ..wrap_up };
    assert!(research_note(&closed, &[], &with_tabs).unwrap().contains("Keep working in your own tabs"));
    assert!(research_note(&wrap_up, &[], &tools()).unwrap().contains("Answer now"));
}

#[test]
fn gives_a_long_planned_request_a_longer_budget() {
    let queries = ["notion pricing", "linear plans", "airtable cost", "depop seller", "hulu shows", "memory alpha", "ponies cast", "old navy joggers"];
    let searches: Vec<Message> = queries.iter().enumerate().map(|(index, query)| search(index, query)).collect();
    assert_eq!(research_use(&searches, &tools(), 1).stage, ResearchStage::WrapUp);
    let items = ["a", "b", "c", "d", "e", "f"].map(|id| format!(r#"{{"id":"{id}","title":"{id}","status":"pending"}}"#)).join(",");
    let mut planned = vec![call_message("plan", "log_work_checklist", &format!(r#"{{"items":[{items}]}}"#))];
    planned.extend(searches);
    assert_eq!(research_use(&planned, &tools(), 1).stage, ResearchStage::Open);
}

#[test]
fn budget_scale_grows_with_the_requirements_misty_listed_up_to_twenty() {
    let lines: Vec<String> = (1..=26).map(|index| format!("{index}. Requirement {index}")).collect();
    assert_eq!(budget_scale(&[user_message(ledger_note(&lines[..7].join("\n")))]), 7);
    assert_eq!(budget_scale(&[user_message(ledger_note(&lines.join("\n")))]), 20);
    assert_eq!(budget_scale(&[user_message("Find a flight")]), 1);
}

#[test]
fn page_keys_drop_the_scheme_fragment_and_trailing_slashes() {
    assert_eq!(page_key("https://A.com/x/?q=1#top"), "a.com/x?q=1");
    assert_eq!(page_key("https://a.com/x?"), "a.com/x");
    assert_eq!(page_key(" Not a URL "), "not a url");
}
