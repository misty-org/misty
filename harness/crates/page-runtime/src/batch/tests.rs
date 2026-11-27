use super::*;
use crate::host::Approval;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

struct Noop;
impl Wake for Noop {
    fn wake(self: Arc<Self>) {}
}

fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(Noop));
    let mut context = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
    }
}

#[derive(Default)]
struct FakePage {
    calls: Mutex<Vec<(String, Value)>>,
    dialogs: Mutex<Vec<Value>>,
    approval: Option<&'static str>,
    console: bool,
    downloads: Mutex<Vec<Value>>,
    new_download: Mutex<Option<Value>>,
}

impl FakePage {
    fn operations(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }
}

impl PageHost for FakePage {
    async fn call(
        &self,
        _frame: Option<u64>,
        operation: &str,
        args: Value,
        _semantic: bool,
    ) -> Result<Value, String> {
        self.calls
            .lock()
            .unwrap()
            .push((operation.to_owned(), args.clone()));
        Ok(match operation {
            "observe" => {
                json!({"ok": true, "documentId": "doc-1", "url": "https://a.test/", "dialogs": []})
            }
            "prepare" => {
                json!({"ok": true, "point": {"x": 0.5, "y": 0.5}, "viewport": {"width": 800, "height": 600}, "describe": "Delete", "consequenceKind": args["ref"].as_str().filter(|r| *r == "e9").map(|_| "delete").unwrap_or("")})
            }
            "perform" => json!({"ok": true, "attempted": true}),
            "console" if self.console => {
                if args["since"] == 0 && args["limit"] == 1 {
                    json!({"ok": true, "last": 4, "messages": []})
                } else {
                    json!({"ok": true, "last": 5, "messages": [{"level": "error", "text": "TypeError: x is undefined"}]})
                }
            }
            "armDialog" => json!({"ok": true, "attempted": false, "armed": true}),
            "dialogSeen" => {
                let next = self.dialogs.lock().unwrap().pop();
                match next {
                    Some(seen) => seen,
                    None => json!({"ok": true, "dialog": null}),
                }
            }
            "effectStart" => json!({"ok": true, "token": "t", "target": "button"}),
            "effectEnd" => {
                if let Some(download) = self.new_download.lock().unwrap().take() {
                    self.downloads.lock().unwrap().push(download);
                }
                json!({"ok": true, "effect": "page changed"})
            }
            "compact" => {
                json!({"ok": true, "documentId": "doc-1", "tree": "- button \"Done\" [ref=e2]", "compact": true})
            }
            _ => json!({"ok": true}),
        })
    }

    async fn native(&self, _input: Value, _prepared: &Value) -> Result<Option<Value>, String> {
        Ok(Some(json!({"attempted": true})))
    }

    async fn approve(&self, _kind: &str, _control: &str, _reason: &str) -> Approval {
        match self.approval {
            Some("refused") => Approval::Refused,
            Some("allowed") => Approval::Allowed,
            _ => Approval::Unasked,
        }
    }

    fn authorize(&self) -> Result<(), String> {
        Ok(())
    }

    fn downloads(&self) -> Vec<Value> {
        self.downloads.lock().unwrap().clone()
    }

    async fn sleep(&self, _ms: u64) {}

    fn fresh_id(&self) -> String {
        "fresh".into()
    }

    fn url(&self) -> Option<String> {
        Some("https://a.test/".into())
    }

    fn go(&self, _to: crate::navigation::Go<'_>) -> Result<(), String> {
        Ok(())
    }
}

fn steps(raw: Value) -> Vec<Step> {
    crate::steps::parse_steps(&json!({ "steps": raw })).unwrap()
}

#[test]
fn a_batch_turns_dialog_answers_on_and_off() {
    let page = FakePage::default();
    let output = block_on(run_batch(
        &page,
        "doc-1",
        &steps(json!([{"action": "click", "ref": "e3"}])),
        false,
    ))
    .unwrap();
    assert_eq!(output["completed"], 1);
    let calls = page.calls.lock().unwrap();
    assert_eq!(calls.first().unwrap().0, "acting");
    assert_eq!(calls.first().unwrap().1["on"], true);
    let off = calls
        .iter()
        .position(|(name, args)| name == "acting" && args["on"] == false)
        .unwrap();
    let last_step = calls
        .iter()
        .rposition(|(name, _)| name == "effectEnd")
        .unwrap();
    assert!(off > last_step);
}

#[test]
fn new_console_errors_and_downloads_join_the_answer() {
    let page = FakePage {
        console: true,
        ..FakePage::default()
    };
    page.downloads
        .lock()
        .unwrap()
        .push(json!({"downloadId": "old", "url": "https://a.test/old.csv"}));
    page.new_download
        .lock()
        .unwrap()
        .replace(json!({"downloadId": "d2", "url": "https://a.test/report.csv"}));
    let output = block_on(run_batch(
        &page,
        "doc-1",
        &steps(json!([{"action": "click", "ref": "e3"}])),
        false,
    ))
    .unwrap();
    assert_eq!(output["console"][0]["text"], "TypeError: x is undefined");
    assert_eq!(output["downloads"].as_array().unwrap().len(), 1);
    assert_eq!(output["downloads"][0]["downloadId"], "d2");
}

#[test]
fn an_unarmed_dialog_stops_the_batch() {
    let page = FakePage::default();
    page.dialogs.lock().unwrap().push(
        json!({"ok": true, "dialog": {"kind": "confirm", "message": "Delete it?", "accepted": false}}),
    );
    let output = block_on(run_batch(
        &page,
        "doc-1",
        &steps(json!([{"action": "click", "ref": "e3"}, {"action": "click", "ref": "e4"}])),
        false,
    ))
    .unwrap();
    assert_eq!(output["ran"], 1);
    assert_eq!(output["steps"][0]["dialog"]["message"], "Delete it?");
    assert!(output["stopped"].as_str().unwrap().contains("dismissed"));
}

#[test]
fn an_armed_dialog_lets_the_batch_go_on() {
    let page = FakePage::default();
    page.dialogs.lock().unwrap().push(
        json!({"ok": true, "dialog": {"kind": "confirm", "message": "Sure?", "accepted": true}}),
    );
    let output = block_on(run_batch(
        &page,
        "doc-1",
        &steps(json!([
            {"action": "dialog", "accept": true},
            {"action": "click", "ref": "e3"},
            {"action": "click", "ref": "e4"}
        ])),
        false,
    ))
    .unwrap();
    assert_eq!(output["ran"], 3);
    assert_eq!(output["steps"][1]["dialog"]["accepted"], true);
    assert!(output["stopped"].is_null());
    assert!(page.operations().contains(&"armDialog".to_owned()));
}

#[test]
fn a_file_chooser_stops_the_batch_with_its_ref() {
    let page = FakePage::default();
    page.dialogs
        .lock()
        .unwrap()
        .push(json!({"ok": true, "dialog": null, "fileChooser": "e7"}));
    let output = block_on(run_batch(
        &page,
        "doc-1",
        &steps(json!([{"action": "click", "ref": "e3"}, {"action": "click", "ref": "e4"}])),
        false,
    ))
    .unwrap();
    assert_eq!(output["ran"], 1);
    assert_eq!(output["steps"][0]["fileChooser"], "e7");
    assert!(output["stopped"].as_str().unwrap().contains("e7"));
}

#[test]
fn a_consequential_click_needs_approval() {
    let page = FakePage::default();
    let output = block_on(run_batch(
        &page,
        "doc-1",
        &steps(json!([{"action": "click", "ref": "e9"}])),
        false,
    ))
    .unwrap();
    assert_eq!(
        output["steps"][0]["errorCode"],
        "browser_consequential_requires_approval"
    );
    let refused = FakePage {
        approval: Some("refused"),
        ..FakePage::default()
    };
    let output = block_on(run_batch(
        &refused,
        "doc-1",
        &steps(json!([{"action": "click", "ref": "e9"}])),
        true,
    ))
    .unwrap();
    assert_eq!(output["steps"][0]["errorCode"], "browser_action_declined");
}

#[test]
fn run_steps_reads_the_page_after() {
    let page = FakePage::default();
    let output = block_on(run_steps(
        &page,
        &json!({"documentId": "doc-1"}),
        &steps(json!([{"action": "click", "ref": "e3"}])),
    ))
    .unwrap();
    assert_eq!(output["snapshot"]["compact"], true);
    assert!(page
        .calls
        .lock()
        .unwrap()
        .iter()
        .any(|(name, args)| name == "compact" && args["candidateId"] == "fresh"));
}
