use std::sync::Mutex;

use futures_util::future::BoxFuture;

use super::*;
use crate::runtime::tool_transport::ToolCheckpoints;

fn json(text: &str) -> JsValue {
    JsValue::parse(text).unwrap()
}

fn replay() -> BrowserReplay {
    valid_replay(&json(concat!(
        r#"{"scope_id":"scope-12345678","start_url":"https://app.example/form","calls":["#,
        r#"{"tool":"browser.steps","args":{"steps":[{"action":"fill","locator":{"role":"textbox","name":"Name"},"text":"Ada"}]}},"#,
        r#"{"tool":"browser.wait_for","args":{"text":"Saved"}}]}"#,
    )))
    .unwrap()
}

struct Deps {
    results: Vec<(&'static str, Result<JsValue, RuntimeError>)>,
    calls: Mutex<Vec<(String, String, JsValue)>>,
}

fn deps(results: Vec<(&'static str, Result<&str, RuntimeError>)>) -> Deps {
    Deps {
        results: results.into_iter().map(|(name, result)| (name, result.map(json))).collect(),
        calls: Mutex::new(Vec::new()),
    }
}

impl ToolCheckpoints for Deps {
    fn checkpoint(&self, _event: HarnessCheckpoint) -> BoxFuture<'_, Result<(), RuntimeError>> {
        Box::pin(async { Ok(()) })
    }
}

impl ToolTransport for Deps {
    fn run<'a>(&'a self, call_id: &'a str, name: &'a str, input: &'a JsValue) -> BoxFuture<'a, Result<Option<JsValue>, RuntimeError>> {
        self.calls.lock().unwrap().push((call_id.to_owned(), name.to_owned(), input.clone()));
        let result = self.results.iter().find(|(tool, _)| *tool == name).map(|(_, result)| result.clone());
        Box::pin(async move {
            match result {
                Some(Ok(value)) => Ok(Some(value)),
                Some(Err(error)) => Err(error),
                None => Ok(None),
            }
        })
    }
}

fn anything(_name: &str) -> bool {
    true
}

#[tokio::test]
async fn replays_every_saved_step_without_a_model_and_opens_the_start_page_first() {
    let deps = deps(vec![
        ("browser.navigate", Ok(r#"{"ok":true}"#)),
        ("browser.snapshot", Ok(r#"{"documentId":"doc-1"}"#)),
        ("browser.steps", Ok(r#"{"completed":1,"steps":[{"ok":true}]}"#)),
        ("browser.wait_for", Ok(r#"{"met":true}"#)),
    ]);
    let outcome = run_browser_replay(&replay(), &deps, anything).await.unwrap();
    assert!(matches!(outcome, ReplayOutcome::Completed { actions: 3, .. }), "{outcome:?}");
    let calls = deps.calls.lock().unwrap();
    let names: Vec<&str> = calls.iter().map(|call| call.1.as_str()).collect();
    assert_eq!(names, ["browser.navigate", "browser.snapshot", "browser.steps", "browser.wait_for"]);
    // Steps act on the current page's document, in the run's own browser.
    let input = &calls[2].2;
    assert_eq!(input.get("scopeId").and_then(JsValue::as_str), Some("scope-12345678"));
    assert_eq!(input.get("documentId").and_then(JsValue::as_str), Some("doc-1"));
    assert_eq!(input.get("includeSnapshot"), Some(&JsValue::Bool(false)));
    let mut ids: Vec<&str> = calls.iter().map(|call| call.0.as_str()).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), calls.len());
}

#[tokio::test]
async fn hands_the_task_to_the_agent_at_the_first_step_the_page_no_longer_matches() {
    let deps = deps(vec![
        ("browser.navigate", Ok(r#"{"ok":true}"#)),
        ("browser.snapshot", Ok(r#"{"documentId":"doc-1"}"#)),
        ("browser.steps", Ok(r#"{"status":"failure","attempted":false,"tool_error":{"code":"browser_locator_missing","message":"No textbox named “Name” on this page."}}"#)),
    ]);
    let ReplayOutcome::Diverged { note, .. } = run_browser_replay(&replay(), &deps, anything).await.unwrap() else {
        panic!("expected a divergence");
    };
    assert!(note.contains("stopped at action 2"));
    assert!(note.contains("No textbox named"));
}

#[tokio::test]
async fn stops_the_run_when_an_actions_outcome_is_unknown_and_hands_off_for_approval() {
    let unknown = deps(vec![("browser.navigate", Err(RuntimeError::error("tool_sequence_stopped: delivery uncertain")))]);
    assert!(matches!(run_browser_replay(&replay(), &unknown, anything).await.unwrap(), ReplayOutcome::Stopped { .. }));
    let approval = deps(vec![
        ("browser.navigate", Ok(r#"{"ok":true}"#)),
        ("browser.snapshot", Ok(r#"{"documentId":"doc-1"}"#)),
        ("browser.steps", Ok(r#"{"status":"awaiting_approval","user_message":"“Act on a web page” is waiting for your approval above."}"#)),
    ]);
    assert_eq!(
        run_browser_replay(&replay(), &approval, anything).await.unwrap(),
        ReplayOutcome::Handoff { text: "“Act on a web page” is waiting for your approval above.".to_owned() }
    );
}

#[test]
fn accepts_only_well_formed_replays_of_browser_actions() {
    let good = r#"{"scope_id":"scope-12345678","calls":[{"tool":"browser.navigate","args":{"url":"https://a.example"}}]}"#;
    assert!(valid_replay(&json(good)).is_some());
    assert!(valid_replay(&json(r#"{"scope_id":"scope-12345678","calls":[]}"#)).is_none());
    assert!(valid_replay(&json(r#"{"scope_id":"scope-12345678","calls":[{"tool":"note.create","args":{}}]}"#)).is_none());
    assert!(valid_replay(&json(r#"{"scope_id":"x","calls":[{"tool":"browser.navigate","args":{}}]}"#)).is_none());
    assert!(valid_replay(&json("null")).is_none());
}

#[tokio::test]
async fn a_replay_that_cant_run_here_hands_over_at_once_and_a_short_page_reads_as_diverged() {
    let none = deps(vec![]);
    assert_eq!(
        run_browser_replay(&replay(), &none, |name| name != "browser.snapshot").await.unwrap(),
        ReplayOutcome::Diverged { note: String::new(), actions: 0 }
    );
    let unread = deps(vec![("browser.navigate", Ok(r#"{"ok":true}"#)), ("browser.snapshot", Ok("{}"))]);
    let ReplayOutcome::Diverged { note, actions } = run_browser_replay(&replay(), &unread, anything).await.unwrap() else {
        panic!("expected a divergence");
    };
    assert_eq!(actions, 1);
    assert!(note.starts_with("[Saved replay] Misty replayed 1 of 3 saved browser actions of this workflow, then stopped at action 2: The page could not be read. The browser is in that state now."));
}
