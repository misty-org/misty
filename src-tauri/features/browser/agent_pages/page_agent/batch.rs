//! Batches of page actions (browser.steps, browser.fill_form), skills and
//! uploads by ref, under the batch rules: stop at a failure, a navigation or
//! a new dialog, and re-check Stop and grants between steps.
use super::step::run_step;
use super::{
    call, page_error, rejected, resolve_agent_webview, steps, webview, BrowserAgentExecuteRequest,
    BrowserSessionState, Step, AFTER_STEPS_SNAPSHOT_CHARS,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Webview};

mod skill;
pub(super) use skill::run_skill;

fn request_document(request: &BrowserAgentExecuteRequest) -> Option<String> {
    request.input["documentId"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .map(str::to_owned)
}

/// The compact state's size after a batch that stayed on its page (page_effects.js).
const COMPACT_STATE_CHARS: u64 = 4_000;

/// The page after a batch: the compact state, with controls new since the last read marked, when
/// every step stayed on the batch's document; a full snapshot after a navigation.
async fn after_snapshot(
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    document: &str,
    output: &mut Value,
) -> Result<(), String> {
    if request.input["includeSnapshot"] == false {
        return Ok(());
    }
    let navigated = output["page"]["documentId"] != json!(document)
        || output["steps"]
            .as_array()
            .is_some_and(|steps| steps.iter().any(|step| step["effect"] == "navigated"));
    let candidate = uuid::Uuid::new_v4().to_string();
    let mut snapshot = if navigated {
        call(
            view,
            "snapshot",
            json!({"candidateId": candidate, "maxChars": AFTER_STEPS_SNAPSHOT_CHARS, "maxRefs": 800}),
            true,
        )
        .await?
    } else {
        call(
            view,
            "compact",
            json!({"candidateId": candidate, "maxChars": COMPACT_STATE_CHARS, "maxRefs": 800}),
            false,
        )
        .await?
    };
    if snapshot["ok"] == true {
        super::with_frame_trees(view, &mut snapshot).await;
        output["snapshot"] = json!({"documentId": snapshot["documentId"], "tree": snapshot["tree"], "truncated": snapshot["truncated"], "skills": snapshot["skills"], "compact": snapshot["compact"] == true});
    }
    Ok(())
}

pub(super) async fn run_steps(
    app: &AppHandle,
    state: &BrowserSessionState,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    steps: &[Step],
) -> Result<Value, String> {
    let Some(document) = request_document(request) else {
        return Ok(rejected(
            "browser_step_invalid",
            "Pass the documentId from the latest browser_snapshot.",
        ));
    };
    // Set by the server only after the person approved, when the account asks.
    let allow_consequential = request.input["allowConsequential"] == true;
    let mut output = run_batch(
        app,
        state,
        view,
        request,
        &document,
        steps,
        allow_consequential,
    )
    .await?;
    after_snapshot(view, request, &document, &mut output).await?;
    Ok(output)
}

/// Runs steps in order under the batch rules; no trailing snapshot.
async fn run_batch(
    app: &AppHandle,
    state: &BrowserSessionState,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    document: &str,
    steps: &[Step],
    allow_consequential: bool,
) -> Result<Value, String> {
    let document = document.to_owned();
    let task = request.input["__mistyTaskId"].as_str().unwrap_or("");
    let before = call(view, "observe", json!({}), false).await?;
    let mut results = Vec::with_capacity(steps.len());
    let mut stopped = Value::Null;
    let mut dispatched = false;
    for (index, step) in steps.iter().enumerate() {
        // Stop, takeover and revocation apply between every step.
        crate::agents::task_scopes::authorize_scope(
            app,
            &request.scope_id,
            &request.agent_id,
            task,
        )?;
        resolve_agent_webview(app, state, request)?;
        // Arms the step's verdict (page_effects.js); read after the step settles.
        let armed = call(view, "effectStart", json!({"ref": step.reference}), false)
            .await
            .ok();
        let token = armed
            .as_ref()
            .and_then(|armed| armed["token"].as_str().map(str::to_owned));
        // The element the step acts on, named as a person would (`button "Search"`).
        let target = armed
            .as_ref()
            .and_then(|armed| armed["target"].as_str().map(str::to_owned));
        let outcome = match run_step(
            app,
            state,
            view,
            request,
            &document,
            step,
            allow_consequential,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) if !dispatched && error.starts_with("browser_snapshot_stale") => {
                return Err(error)
            }
            Err(error) => json!({"ok": false, "error": error}),
        };
        // Anything not explicitly unattempted may have reached the page.
        dispatched |= outcome["attempted"] != false;
        let mut record =
            json!({"index": index + 1, "action": step.action, "ok": outcome["ok"] == true});
        if let Some(reference) = &step.reference {
            record["ref"] = json!(reference);
        }
        if let Some(target) = &target {
            record["target"] = json!(target);
        }
        for field in [
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
        ] {
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
        if failed {
            stopped = json!(format!(
                "Step {} did not complete; later steps were not run.",
                index + 1
            ));
            break;
        }
        if step.action != "wait_for" {
            let _ = call(
                view,
                "settle",
                json!({"quietMs": 150, "maxMs": 1500}),
                false,
            )
            .await;
        }
        // What the step did: navigated, page changed, or no change (a click the page ignored).
        if let Some(token) = &token {
            if let (Ok(effect), Some(record)) = (
                call(view, "effectEnd", json!({"token": token}), false).await,
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
        let now = call(view, "observe", json!({}), false).await?;
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
    let completed = results.iter().filter(|record| record["ok"] == true).count();
    let page = call(view, "observe", json!({}), false).await?;
    let mut output = json!({"ran": results.len(), "completed": completed, "steps": results, "stopped": stopped, "page": page});
    if !dispatched && completed < steps.len() {
        // Nothing reached the page: report a failure the model can correct.
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

/// Attaches a task file to a file input named by a snapshot ref.
pub(in crate::browser) async fn upload(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
    input: &Value,
) -> Result<Value, String> {
    let view = webview(app, id)?;
    // Reading a file must not extend a revoked task or execution grant.
    crate::agents::task_scopes::authorize_scope(
        app,
        &request.scope_id,
        &request.agent_id,
        input["__mistyTaskId"].as_str().unwrap_or(""),
    )?;
    resolve_agent_webview(app, state, request)?;
    let document = input["documentId"]
        .as_str()
        .ok_or("browser_snapshot_stale: take a snapshot first")?;
    let args = json!({"documentId": document, "step": {"action": "upload", "ref": input["ref"]}, "file": input["file"]});
    let result = call(&view, "perform", args, false).await?;
    if result["ok"] != true {
        return Err(page_error(&result, "File upload failed."));
    }
    Ok(
        json!({"inputSelected": result["inputSelected"], "name": result["name"], "byteSize": result["byteSize"], "websiteUploadVerified": false}),
    )
}
