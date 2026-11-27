use crate::batch::{after_snapshot, request_document, run_batch};
use crate::host::PageHost;
use crate::steps::{steps_of, MAX_FORM_FIELDS};
use crate::{page_error, rejected};
use serde_json::{json, Value};

const MAX_PHASES: usize = 4;

pub async fn run_skill<H: PageHost>(host: &H, input: &Value) -> Result<Value, String> {
    let Some(document) = request_document(input) else {
        return Ok(rejected(
            "browser_step_invalid",
            "Pass the documentId from the latest browser_snapshot.",
        ));
    };
    let (Some(skill), Some(action)) = (input["skill"].as_str(), input["action"].as_str()) else {
        return Ok(rejected(
            "browser_step_invalid",
            "Name the skill and its action, as listed in the snapshot's skills.",
        ));
    };
    let allow_consequential = input["allowConsequential"] == true;
    let mut next = json!({"skill": skill, "action": action, "args": input.get("args").cloned().unwrap_or(json!({}))});
    let frame = host.frame_of(next["args"]["ref"].as_str());
    let skill_document = frame
        .as_ref()
        .map_or(document.clone(), |(_, document)| document.clone());
    let frame = frame.map(|(frame, _)| frame);
    let mut phases = Vec::new();
    let mut dispatched = false;
    let mut ok = true;
    for _ in 0..MAX_PHASES {
        host.authorize()?;
        next["documentId"] = json!(skill_document);
        let result = host.call(frame, "skill", next.clone(), false).await?;
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
        if let Some(raw) = result
            .get("steps")
            .filter(|steps| steps.as_array().is_some_and(|steps| !steps.is_empty()))
        {
            let steps = steps_of(raw, MAX_FORM_FIELDS)
                .map_err(|_| "The skill returned steps outside the step rules.".to_owned())?;
            let batch = run_batch(host, &document, &steps, allow_consequential).await?;
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
    let page = host.call(None, "observe", json!({}), false).await?;
    let mut output =
        json!({"skill": skill, "action": action, "ok": ok, "phases": phases, "page": page});
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
    after_snapshot(host, input, &document, &mut output).await?;
    Ok(output)
}
