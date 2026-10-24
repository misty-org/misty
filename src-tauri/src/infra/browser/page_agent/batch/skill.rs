//! Running one page skill action, and the steps it returns.
use super::*;

/// Runs a pattern or app skill (page_skills.js). A skill acts in the page or
/// hands back steps, which run under the same rules as browser.steps; a skill
/// may then continue once those steps have run (selecting a cell, then pasting).
pub(in crate::infra::browser::page_agent) async fn run_skill(
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
    let frame = super::super::frame_of(view, next["args"]["ref"].as_str());
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
        let result = super::super::call_at(view, frame, "skill", next.clone(), false).await?;
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
