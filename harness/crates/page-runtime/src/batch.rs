use crate::host::PageHost;
use crate::step::run_step;
use crate::steps::Step;
use crate::{page_error, rejected};
use serde_json::{json, Value};

pub const DIALOG_HELD: &str = "browser_dialog_held";

fn held_note(dialog: &Value) -> String {
    let kind = dialog["kind"].as_str().unwrap_or("dialog");
    let message = dialog["message"].as_str().unwrap_or("");
    let how = if kind == "alert" {
        "a dialog step (accept true) closes it"
    } else if kind == "prompt" {
        "a dialog step answers it: accept true with text, or accept false"
    } else {
        "a dialog step answers it: accept true or false"
    };
    format!("A {kind} is open on the page and waiting: “{message}”. The page is paused until it is answered; {how}, as the first step of your next browser_steps.")
}

pub async fn modal_refusal<H: PageHost>(host: &H) -> Option<Value> {
    let dialog = host.held_dialog().await?;
    let mut refused = rejected(DIALOG_HELD, held_note(&dialog));
    refused["dialog"] = dialog.clone();
    refused["heldDialog"] = dialog;
    Some(refused)
}

const AFTER_STEPS_SNAPSHOT_CHARS: u64 = 12_000;
const COMPACT_STATE_CHARS: u64 = 4_000;

pub fn request_document(input: &Value) -> Option<String> {
    input["documentId"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .map(str::to_owned)
}

pub async fn after_snapshot<H: PageHost>(
    host: &H,
    input: &Value,
    document: &str,
    output: &mut Value,
) -> Result<(), String> {
    if input["includeSnapshot"] == false || output["heldDialog"].is_object() {
        return Ok(());
    }
    let navigated = output["page"]["documentId"] != json!(document)
        || output["steps"]
            .as_array()
            .is_some_and(|steps| steps.iter().any(|step| step["effect"] == "navigated"));
    let mut args = json!({"maxRefs": 800, "candidateId": host.fresh_id()});
    let mut snapshot = if navigated {
        args["maxChars"] = json!(AFTER_STEPS_SNAPSHOT_CHARS);
        host.call(None, "snapshot", args, true).await?
    } else {
        args["maxChars"] = json!(COMPACT_STATE_CHARS);
        host.call(None, "compact", args, false).await?
    };
    if snapshot["ok"] == true {
        host.with_frame_trees(&mut snapshot).await;
        output["snapshot"] = json!({"documentId": snapshot["documentId"], "tree": snapshot["tree"], "truncated": snapshot["truncated"], "skills": snapshot["skills"], "compact": snapshot["compact"] == true});
    }
    Ok(())
}

pub async fn run_steps<H: PageHost>(
    host: &H,
    input: &Value,
    steps: &[Step],
) -> Result<Value, String> {
    let Some(document) = request_document(input) else {
        return Ok(rejected(
            "browser_step_invalid",
            "Pass the documentId from the latest browser_snapshot.",
        ));
    };
    let allow_consequential = input["allowConsequential"] == true;
    let mut output = run_batch(host, &document, steps, allow_consequential).await?;
    after_snapshot(host, input, &document, &mut output).await?;
    Ok(output)
}

const KEPT: [&str; 17] = [
    "error",
    "errorCode",
    "input",
    "retained",
    "selected",
    "scrolled",
    "atEnd",
    "unchanged",
    "submitted",
    "met",
    "inputSelected",
    "locator",
    "opensNewTab",
    "moved",
    "atStart",
    "container",
    "note",
];

pub async fn run_batch<H: PageHost>(
    host: &H,
    document: &str,
    steps: &[Step],
    allow_consequential: bool,
) -> Result<Value, String> {
    let mut steps = steps;
    let mut answered = None;
    if let Some(dialog) = host.held_dialog().await {
        let Some(first) = steps.first().filter(|step| step.action == "dialog") else {
            let mut refused = rejected(DIALOG_HELD, held_note(&dialog));
            refused["dialog"] = dialog.clone();
            refused["heldDialog"] = dialog;
            return Ok(refused);
        };
        let done = host
            .answer_dialog(first.accept == Some(true), first.text.clone())
            .await;
        answered =
            Some(json!({"index": 1, "action": "dialog", "ok": done.is_some(), "dialog": done}));
        steps = &steps[1..];
        host.sleep(150).await;
    }
    if let (Some(record), true) = (&answered, steps.is_empty()) {
        let page = host
            .call(None, "observe", json!({}), false)
            .await
            .unwrap_or(Value::Null);
        let ok = record["ok"] == true;
        return Ok(
            json!({"ran": 1, "completed": usize::from(ok), "steps": [record], "stopped": Value::Null, "page": page}),
        );
    }
    let holds = host.holds_dialogs();
    if holds {
        host.hold_dialogs(true).await;
    }
    let _ = host
        .call(None, "acting", json!({"on": true, "hold": holds}), false)
        .await;
    let console_mark = host
        .call(None, "console", json!({"since": 0, "limit": 1}), false)
        .await
        .ok()
        .and_then(|seen| seen["last"].as_u64())
        .unwrap_or(0);
    let downloads_before: Vec<Value> = host
        .downloads()
        .iter()
        .map(|download| download["downloadId"].clone())
        .collect();
    let mut outcome = batch_steps(host, document, steps, allow_consequential).await;
    if holds {
        host.hold_dialogs(false).await;
    }
    if let (Some(record), Ok(output)) = (&answered, outcome.as_mut()) {
        if let Some(list) = output["steps"].as_array_mut() {
            for item in list.iter_mut() {
                item["index"] = json!(item["index"].as_u64().unwrap_or(0) + 1);
            }
            list.insert(0, record.clone());
        }
        output["ran"] = json!(output["ran"].as_u64().unwrap_or(0) + 1);
        if record["ok"] == true {
            output["completed"] = json!(output["completed"].as_u64().unwrap_or(0) + 1);
        }
    }
    let held = matches!(&outcome, Ok(output) if output["heldDialog"].is_object());
    if held {
        return outcome;
    }
    let _ = host.call(None, "acting", json!({"on": false}), false).await;
    if let Ok(output) = outcome.as_mut() {
        if let Ok(seen) = host
            .call(
                None,
                "console",
                json!({"since": console_mark, "level": "warning", "limit": 20}),
                false,
            )
            .await
        {
            if seen["messages"]
                .as_array()
                .is_some_and(|messages| !messages.is_empty())
            {
                output["console"] = seen["messages"].clone();
            }
        }
        let fresh: Vec<Value> = host
            .downloads()
            .into_iter()
            .filter(|download| !downloads_before.contains(&download["downloadId"]))
            .collect();
        if !fresh.is_empty() {
            output["downloads"] = json!(fresh);
        }
    }
    outcome
}

fn dialog_note(dialog: &Value) -> String {
    let message = dialog["message"].as_str().unwrap_or("");
    let answer = if dialog["accepted"] == true {
        "accepted"
    } else {
        "dismissed"
    };
    format!(
        "A {} asked “{message}” and Misty {answer} it. If that was wrong, put a dialog step (accept, and text for a prompt) right before the step that opens it, and run them again.",
        dialog["kind"].as_str().unwrap_or("dialog")
    )
}

async fn batch_steps<H: PageHost>(
    host: &H,
    document: &str,
    steps: &[Step],
    allow_consequential: bool,
) -> Result<Value, String> {
    let mut dialog_armed = false;
    let before = host.call(None, "observe", json!({}), false).await?;
    let mut results = Vec::with_capacity(steps.len());
    let mut stopped = Value::Null;
    let mut dispatched = false;
    let mut held: Option<Value> = None;
    for (index, step) in steps.iter().enumerate() {
        host.authorize()?;
        let armed = host
            .call(None, "effectStart", json!({"ref": step.reference}), false)
            .await
            .ok();
        let token = armed
            .as_ref()
            .and_then(|armed| armed["token"].as_str().map(str::to_owned));
        let target = armed
            .as_ref()
            .and_then(|armed| armed["target"].as_str().map(str::to_owned));
        let outcome = match run_step(host, document, step, allow_consequential).await {
            Ok(outcome) => outcome,
            Err(error) if error.starts_with(DIALOG_HELD) => json!({"ok": true, "attempted": true}),
            Err(error) if !dispatched && error.starts_with("browser_snapshot_stale") => {
                return Err(error)
            }
            Err(error) => json!({"ok": false, "error": error}),
        };
        dispatched |= outcome["attempted"] != false;
        let mut record =
            json!({"index": index + 1, "action": step.action, "ok": outcome["ok"] == true});
        if let Some(reference) = &step.reference {
            record["ref"] = json!(reference);
        }
        if let Some(target) = &target {
            record["target"] = json!(target);
        }
        for field in KEPT {
            if !outcome[field].is_null() {
                record[field] = outcome[field].clone();
            }
        }
        let failed = outcome["ok"] != true;
        if failed && !dispatched && outcome["errorCode"] == "browser_snapshot_stale" {
            return Err(page_error(
                &outcome,
                "The page changed. Take a new snapshot.",
            ));
        }
        results.push(record);
        if let Some(dialog) = host.held_dialog().await {
            held = Some(dialog);
            break;
        }
        if failed {
            stopped = json!(format!(
                "Step {} did not complete; later steps were not run.",
                index + 1
            ));
            break;
        }
        if step.action != "wait_for" {
            let _ = host
                .call(
                    None,
                    "settle",
                    json!({"quietMs": 150, "maxMs": 1500}),
                    false,
                )
                .await;
        }
        if let Some(dialog) = host.held_dialog().await {
            held = Some(dialog);
            break;
        }
        if let Some(token) = &token {
            if let (Ok(effect), Some(record)) = (
                host.call(None, "effectEnd", json!({"token": token}), false)
                    .await,
                results.last_mut(),
            ) {
                if let Some(verdict) = effect["effect"].as_str() {
                    record["effect"] = json!(verdict);
                }
                for field in ["valueNow", "checkedNow", "focus"] {
                    if !effect[field].is_null() {
                        record[field] = effect[field].clone();
                    }
                }
            }
        }
        if step.action == "dialog" {
            dialog_armed = true;
        } else if let Ok(seen) = host.call(None, "dialogSeen", json!({}), false).await {
            if let Some(chooser) = seen["fileChooser"].as_str() {
                if let Some(record) = results.last_mut() {
                    record["fileChooser"] = json!(chooser);
                }
                stopped = json!(format!(
                    "The step opened a file chooser ({chooser}). Hand it a file with browser_upload: ref {chooser} and the file's path in your working folder."
                ));
                break;
            }
            if seen["dialog"].is_object() {
                if let Some(record) = results.last_mut() {
                    record["dialog"] = seen["dialog"].clone();
                }
                if !std::mem::take(&mut dialog_armed) {
                    stopped = json!(dialog_note(&seen["dialog"]));
                    break;
                }
            }
        }
        let now = match host.call(None, "observe", json!({}), false).await {
            Ok(now) => now,
            Err(error) if error.starts_with(DIALOG_HELD) => {
                held = host.held_dialog().await;
                if held.is_some() {
                    break;
                }
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        if index + 1 < steps.len() {
            if now["url"] != before["url"] || now["documentId"] != json!(document) {
                stopped =
                    json!("The page navigated; take a new snapshot before the remaining steps.");
                break;
            }
            let opened = now["dialogs"].as_array().map(Vec::len).unwrap_or(0)
                > before["dialogs"].as_array().map(Vec::len).unwrap_or(0);
            if opened {
                stopped = json!("A dialog opened; read it before the remaining steps.");
                break;
            }
        }
    }
    if let Some(dialog) = &held {
        if let Some(record) = results.last_mut() {
            record["dialog"] = dialog.clone();
        }
        stopped = json!(held_note(dialog));
    }
    let completed = results.iter().filter(|record| record["ok"] == true).count();
    let page = if held.is_some() {
        Value::Null
    } else {
        host.call(None, "observe", json!({}), false).await?
    };
    let mut output = json!({"ran": results.len(), "completed": completed, "steps": results, "stopped": stopped, "page": page});
    if let Some(dialog) = held {
        output["heldDialog"] = dialog;
    }
    if !dispatched && completed < steps.len() {
        let first = output["steps"][0]["error"]
            .as_str()
            .unwrap_or("The step did not run.")
            .to_owned();
        output["status"] = json!("failure");
        output["tool_error"] = json!({"code": output["steps"][0]["errorCode"].as_str().unwrap_or("browser_step_failed"), "message": first});
        output["attempted"] = json!(false);
    }
    Ok(output)
}

#[cfg(test)]
mod tests;
