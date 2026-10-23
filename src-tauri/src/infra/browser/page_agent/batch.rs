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

fn request_document(request: &BrowserAgentExecuteRequest) -> Option<String> {
    request.input["documentId"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .map(str::to_owned)
}

async fn after_snapshot(
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    output: &mut Value,
) -> Result<(), String> {
    if request.input["includeSnapshot"] == false {
        return Ok(());
    }
    let candidate = uuid::Uuid::new_v4().to_string();
    let snapshot = call(
        view,
        "snapshot",
        json!({"candidateId": candidate, "maxChars": AFTER_STEPS_SNAPSHOT_CHARS, "maxRefs": 800}),
        true,
    )
    .await?;
    let mut snapshot = snapshot;
    if snapshot["ok"] == true {
        super::with_frame_trees(view, &mut snapshot).await;
        output["snapshot"] = json!({"documentId": snapshot["documentId"], "tree": snapshot["tree"], "truncated": snapshot["truncated"], "skills": snapshot["skills"]});
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
    after_snapshot(view, request, &mut output).await?;
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
        crate::infra::agents::workspace::authorize_scope(
            app,
            &request.scope_id,
            &request.agent_id,
            task,
        )?;
        resolve_agent_webview(app, state, request)?;
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

/// Runs a pattern or app skill (page_skills.js). A skill acts in the page or
/// hands back steps, which run under the same rules as browser.steps; a skill
/// may then continue once those steps have run (selecting a cell, then pasting).
pub(super) async fn run_skill(
    app: &AppHandle,
    state: &BrowserSessionState,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    const MAX_PHASES: usize = 4;
    let Some(document) = request_document(request) else {
        return Ok(rejected(
            "browser_step_invalid",
            "Pass the documentId from the latest browser_snapshot.",
        ));
    };
    let input = &request.input;
    let (Some(skill), Some(action)) = (input["skill"].as_str(), input["action"].as_str()) else {
        return Ok(rejected(
            "browser_step_invalid",
            "Name the skill and its action, as listed in the snapshot's skills.",
        ));
    };
    let allow_consequential = input["allowConsequential"] == true;
    let task = input["__mistyTaskId"].as_str().unwrap_or("");
    let mut next = json!({"skill": skill, "action": action, "args": input.get("args").cloned().unwrap_or(json!({}))});
    // A skill on a control inside a cross-origin frame (a document editor) runs there.
    let frame = super::frame_of(view, next["args"]["ref"].as_str());
    let skill_document = frame
        .as_ref()
        .map_or(document.to_string(), |(_, document)| document.clone());
    let frame = frame.map(|(frame, _)| frame);
    let mut phases = Vec::new();
    let mut dispatched = false;
    let mut ok = true;
    for _ in 0..MAX_PHASES {
        crate::infra::agents::workspace::authorize_scope(
            app,
            &request.scope_id,
            &request.agent_id,
            task,
        )?;
        resolve_agent_webview(app, state, request)?;
        next["documentId"] = json!(skill_document);
        let result = super::call_at(view, frame, "skill", next.clone(), false).await?;
        if result["ok"] != true {
            if !dispatched && result["errorCode"] == "browser_snapshot_stale" {
                return Err(page_error(
                    &result,
                    "The page changed. Take a new snapshot.",
                ));
            }
            dispatched |= result["attempted"] != false;
            ok = false;
            phases.push(result);
            break;
        }
        dispatched |= result["attempted"] == true;
        let mut phase = result.clone();
        if let Some(object) = phase.as_object_mut() {
            object.remove("steps");
            object.remove("then");
        }
        if let Some(raw) = result.get("steps").filter(|steps| !steps.is_null()) {
            let steps: Vec<Step> = match serde_json::from_value(raw.clone()) {
                Ok(steps) => steps,
                Err(error) => return Err(format!("The skill returned invalid steps: {error}")),
            };
            if steps.len() > steps::MAX_FORM_FIELDS
                || steps.iter().any(|step| step.validate().is_err())
            {
                return Err("The skill returned steps outside the step rules.".into());
            }
            let batch = run_batch(
                app,
                state,
                view,
                request,
                &document,
                &steps,
                allow_consequential,
            )
            .await?;
            dispatched |= batch["attempted"] != false && batch["ran"].as_u64().unwrap_or(0) > 0;
            let completed = batch["completed"].as_u64() == Some(steps.len() as u64);
            phase["steps"] = batch;
            phases.push(phase);
            if !completed {
                ok = false;
                break;
            }
        } else {
            phases.push(phase);
        }
        match result.get("then").filter(|then| then.is_object()) {
            Some(then) => next = then.clone(),
            None => break,
        }
    }
    let mut output = json!({"skill": skill, "action": action, "ok": ok, "phases": phases, "page": call(view, "observe", json!({}), false).await?});
    if !ok && !dispatched {
        let message = output["phases"]
            .as_array()
            .and_then(|phases| phases.last())
            .and_then(|phase| {
                phase["error"]
                    .as_str()
                    .or_else(|| phase["steps"]["tool_error"]["message"].as_str())
            })
            .unwrap_or("The skill did not run.")
            .to_owned();
        output["status"] = json!("failure");
        output["attempted"] = json!(false);
        output["tool_error"] = json!({"code": "browser_skill_failed", "message": message});
    }
    after_snapshot(view, request, &mut output).await?;
    Ok(output)
}

/// Attaches a task file to a file input named by a snapshot ref.
pub(in super::super) async fn upload(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
    input: &Value,
) -> Result<Value, String> {
    let view = webview(app, id)?;
    // Reading a file must not extend a revoked task or execution grant.
    crate::infra::agents::workspace::authorize_scope(
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
