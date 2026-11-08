use super::*;
use crate::transcript::fixtures::{call_message, error_output, json_output, raw, turn};
use crate::transcript::user_message;
use crate::model_calls::ToolOutput;

fn ok() -> ToolOutput {
    json_output(r#"{"ok":true}"#)
}

fn fetches(urls: &[&str], from: usize) -> Vec<Message> {
    urls.iter()
        .enumerate()
        .flat_map(|(index, url)| turn(&format!("call-{}", from + index), "web_fetch", &format!(r#"{{"url":"{url}"}}"#), ok()))
        .collect()
}

#[test]
fn says_nothing_for_ordinary_research() {
    assert_eq!(loop_note(&fetches(&["https://a.com/1", "https://b.com/2", "https://c.com/3", "https://a.com/4"], 0)), None);
}

#[test]
fn catches_one_address_opened_three_times_however_it_was_written_across_the_whole_run() {
    let mut messages = fetches(&["https://www.hypebeast.com/2026/10/palace-winter?utm_source=x"], 0);
    for index in 0..14 {
        messages.extend(turn(&format!("s{index}"), "web_search", &format!(r#"{{"query":"q{index}"}}"#), ok()));
    }
    messages.extend(fetches(&["http://hypebeast.com/2026/10/palace-winter/", "https://hypebeast.com/2026/10/palace-winter#top"], 20));
    assert!(loop_note(&messages).unwrap().contains("opened https://hypebeast.com/2026/10/palace-winter 3 times"));
}

#[test]
fn catches_most_of_the_last_pages_on_one_site_but_not_on_a_search_engine() {
    let urls: Vec<String> = (0..6).map(|index| format!("https://hypebeast.com/2026/10/article-{index}")).collect();
    let urls: Vec<&str> = urls.iter().map(String::as_str).collect();
    assert!(loop_note(&fetches(&urls, 0)).unwrap().contains("6 of the last 6 pages you opened are on hypebeast.com"));
    let results: Vec<Message> = (0..6)
        .flat_map(|index| turn(&format!("g{index}"), "browser_navigate", &format!(r#"{{"url":"https://www.google.com/search?q={index}"}}"#), ok()))
        .collect();
    assert_eq!(loop_note(&results), None);
}

#[test]
fn catches_a_call_that_failed_twice_and_the_same_call_three_times() {
    let mut twice = turn("a", "browser_steps", r#"{"ref":"e4"}"#, error_output("no element"));
    twice.extend(turn("b", "browser_steps", r#"{"ref":"e4"}"#, error_output("no element")));
    assert!(loop_note(&twice).unwrap().contains("failed 2 times"));
    let thrice: Vec<Message> = (0..3).flat_map(|index| turn(&format!("c{index}"), "browser_snapshot", r#"{"scopeId":"s"}"#, ok())).collect();
    assert!(loop_note(&thrice).unwrap().contains("browser_snapshot with the same input 3 times"));
}

#[test]
fn says_each_pattern_once() {
    let mut messages = fetches(&["https://a.com/x", "https://a.com/x", "https://a.com/x"], 0);
    let note = loop_note(&messages).unwrap();
    messages.push(user_message(note));
    messages.extend(fetches(&["https://a.com/x"], 3));
    assert_eq!(loop_note(&messages), None);
}

#[test]
fn address_ignores_scheme_www_fragments_trailing_slashes_and_tracking_parameters() {
    assert_eq!(address(&raw(r#"{"url":"http://WWW.Example.com/a/?utm_medium=y&id=2#s"}"#)), "https://example.com/a?id=2");
    assert_eq!(address(&raw(r#"{"url":"example.com/a"}"#)), "https://example.com/a");
    assert_eq!(address(&raw("{}")), "");
}

#[test]
fn an_address_keeps_javascripts_url_rules() {
    // The query is rewritten only when a parameter goes, and then as a form.
    assert_eq!(address(&raw(r#"{"url":"https://a.com/x?q=a%20b"}"#)), "https://a.com/x?q=a%20b");
    assert_eq!(address(&raw(r#"{"url":"https://a.com/x?q=a%20b&fbclid=1"}"#)), "https://a.com/x?q=a+b");
    assert_eq!(address(&raw(r#"{"url":"https://a.com/x/?UTM_x=1"}"#)), "https://a.com/x");
    // Moving to https drops a port that is https's default.
    assert_eq!(address(&raw(r#"{"url":"http://a.com:443/x"}"#)), "https://a.com/x");
    assert_eq!(address(&raw(r#"{"url":"about:blank"}"#)), "about:blank");
    assert_eq!(address(&raw(r#"{"url":"  https:// "}"#)), "https://");
}

#[test]
fn notes_keep_their_wording() {
    let messages = [call_message("a", "web_fetch", r#"{"url":"https://a.com"}"#), call_message("b", "web_fetch", r#"{"url":"https://a.com"}"#), call_message("c", "web_fetch", r#"{"url":"https://a.com"}"#)];
    assert_eq!(
        loop_note(&messages).unwrap(),
        "Loop guard [open:https://a.com]: you have opened https://a.com 3 times in this run. Its content won't change by opening it again. Change approach: use the page itself (click through, search on the site, apply its filters), try another source, or record what you have, say plainly what is unconfirmed, and move to the next part or finish."
    );
}

#[test]
fn says_nothing_for_ordinary_progress() {
    let messages = ["a", "b", "c"].map(|page| call_message(page, "browser_navigate", &format!(r#"{{"url":"https://shop.example/{page}"}}"#)));
    assert_eq!(loop_note(&messages), None);
}

#[test]
fn notes_the_same_address_opened_three_times_once() {
    let mut messages = vec![
        call_message("1", "screen_open", r#"{"url":"https://www.usnews.com/rankings/"}"#),
        call_message("2", "web_fetch", r#"{"url":"https://www.usnews.com/rankings"}"#),
        call_message("3", "browser_navigate", r#"{"url":"https://www.usnews.com/rankings#top"}"#),
    ];
    let note = loop_note(&messages).unwrap();
    assert!(note.contains("opened https://usnews.com/rankings 3 times"));
    messages.push(user_message(note));
    assert_eq!(loop_note(&messages), None);
}
