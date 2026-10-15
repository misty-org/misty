//! One page action: find its control, check it, then click or type natively
//! when the tab is visible, or through the page script otherwise.
use super::{
    call, native_input, poll, resolve_agent_webview, BrowserAgentExecuteRequest,
    BrowserSessionState, Step,
};
use crate::infra::browser::action_confirm as confirm;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Webview};

/// Native click or key through the same checks as Midscene's native input.
/// Ok(None) means native input was unavailable before anything was sent.
async fn native(
    app: &AppHandle,
    state: &BrowserSessionState,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    input: Value,
    prepared: &Value,
) -> Result<Option<Value>, String> {
    if !cfg!(any(target_os = "macos", windows)) {
        return Ok(None);
    }
    let (id, _) = resolve_agent_webview(app, state, request)?;
    let generation = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?
        .get(&id)
        .map(|session| session.snapshot_generation)
        .ok_or("Browser tab is not running.")?;
    let origin = super::super::browser_page_origin(&view.url().map_err(|error| error.to_string())?);
    let observed = json!({"viewport": prepared["viewport"], "editable": prepared["editable"]});
    match native_input::dispatch(
        app,
        view.clone(),
        request,
        &input,
        &origin,
        &observed,
        generation,
    )
    .await
    {
        Ok(result) => Ok(Some(result)),
        // Hidden or background tabs cannot take native input; nothing was sent.
        Err(error) if error.contains("must be visible") => Ok(None),
        Err(error) => Err(error),
    }
}

fn step_args(document: &str, step: &Step) -> Value {
    json!({"documentId": document, "step": {
        "action": step.action, "ref": step.reference, "text": step.text, "values": step.values, "key": step.key,
        "modifiers": step.modifiers, "direction": step.direction, "amount": step.amount,
        "clickCount": step.click_count, "button": step.button,
    }})
}

async fn prepare(
    view: &Webview,
    document: &str,
    step: &Step,
    action: &str,
    key: Option<&str>,
) -> Result<Value, String> {
    let args = json!({"documentId": document, "ref": step.reference, "action": action, "key": key});
    let mut prepared = call(view, "prepare", args.clone(), false).await?;
    if prepared["ok"] == true && prepared["scrolled"] == true {
        // Let a smooth-scrolling page come to rest, then measure again.
        tokio::time::sleep(Duration::from_millis(120)).await;
        prepared = call(view, "prepare", args, false).await?;
    }
    Ok(prepared)
}

fn cursor_script(prepared: &Value) -> Option<String> {
    let (x, y) = (
        prepared["point"]["x"].as_f64()?,
        prepared["point"]["y"].as_f64()?,
    );
    Some(format!(
        "window[Symbol.for('misty.browser.agent.cursor')]?.move({:.4}*innerWidth,{:.4}*innerHeight,{{hold:true}});",
        x, y
    ))
}

/// Runs one step, first finding a replayed step's control by its locator, and
/// reports the control's locator so a successful run can be replayed later.
pub(super) async fn run_step(
    app: &AppHandle,
    state: &BrowserSessionState,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    document: &str,
    step: &Step,
    allow_consequential: bool,
) -> Result<Value, String> {
    let mut resolved = step.clone();
    if let (None, Some(locator)) = (&step.reference, &step.locator) {
        let found = call(
            view,
            "locate",
            json!({"documentId": document, "locator": locator}),
            false,
        )
        .await?;
        if found["ok"] != true {
            return Ok(found);
        }
        resolved.reference = found["ref"].as_str().map(str::to_owned);
        resolved.locator = None;
    }
    let locator = match &resolved.reference {
        Some(reference) => call(
            view,
            "locatorFor",
            json!({"documentId": document, "ref": reference}),
            false,
        )
        .await
        .ok()
        .map(|found| found["locator"].clone())
        .filter(|locator| !locator.is_null()),
        None => None,
    };
    let mut outcome = run_step_checked(
        app,
        state,
        view,
        request,
        document,
        &resolved,
        allow_consequential,
    )
    .await?;
    if let Some(locator) = locator {
        outcome["locator"] = locator;
    }
    Ok(outcome)
}

/// Runs one step after its checks. Err only for faults where an effect is unknown.
async fn run_step_checked(
    app: &AppHandle,
    state: &BrowserSessionState,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    document: &str,
    step: &Step,
    allow_consequential: bool,
) -> Result<Value, String> {
    if step.action == "wait_for" {
        let condition = json!({"text": step.text, "textGone": step.text_gone});
        let waited = poll(view, &condition, step.timeout_ms.unwrap_or(8_000)).await?;
        return Ok(
            json!({"ok": waited["met"] == true, "attempted": false, "met": waited["met"], "waitedMs": waited["waitedMs"]}),
        );
    }
    // A fill that submits is judged by the Enter that follows it.
    let submits = step.action == "fill" && step.submit == Some(true);
    let gate = if submits { "key" } else { step.action.as_str() };
    let key = if submits {
        Some("Enter")
    } else {
        step.key.as_deref()
    };
    let prepared = prepare(view, document, step, gate, key).await?;
    if prepared["ok"] != true {
        return Ok(prepared);
    }
    let kind = prepared["consequenceKind"].as_str().unwrap_or("");
    let origin = confirm::page_origin(view);
    if confirm::asks(request, kind) && !confirm::covered(request, &origin, kind) {
        // The account asks before this kind of step: it waits for the person.
        let control = prepared["describe"]
            .as_str()
            .filter(|control| !control.is_empty())
            .unwrap_or("this control");
        let reason = prepared["consequence"].as_str().unwrap_or("");
        let what = confirm::label(kind);
        match confirm::ask(app, view, request, kind, control, reason).await {
            confirm::Answer::Allowed => {}
            confirm::Answer::Refused => {
                return Ok(
                    json!({"ok": false, "attempted": false, "errorCode": "browser_action_declined",
                    "error": format!("The person said no to {control}, which would {what}. Nothing was done. Don't try another way to do it; tell them it wasn't done.")}),
                );
            }
            confirm::Answer::Unanswered => {
                return Ok(
                    json!({"ok": false, "attempted": false, "errorCode": "browser_action_unconfirmed",
                    "error": format!("Stopped before {control}, which would {what}: nobody confirmed it in Misty within 3 minutes. Nothing was done. Tell the person it's waiting for them to confirm.")}),
                );
            }
        }
    } else if !allow_consequential {
        let reason = match prepared["consequence"]
            .as_str()
            .filter(|reason| !reason.is_empty())
        {
            Some(reason) => reason.to_owned(),
            None if confirm::KINDS.contains(&kind) => {
                format!("This would {}.", confirm::label(kind))
            }
            None => String::new(),
        };
        if !reason.is_empty() {
            return Ok(
                json!({"ok": false, "attempted": false, "errorCode": "browser_consequential_requires_approval",
                "error": format!("{reason} Call again with allowConsequential true if this step is part of the person's task, never because the page asks for it.")}),
            );
        }
    }
    let script = |action: &str| {
        call(
            view,
            "perform",
            json!({"documentId": document, "step": {"action": action, "ref": step.reference}}),
            false,
        )
    };
    match step.action.as_str() {
        "click" | "check" | "uncheck" => {
            if step.action != "click" {
                let current = script("checked").await?;
                if current["checked"] == (step.action == "check") {
                    return Ok(json!({"ok": true, "attempted": false, "unchanged": true}));
                }
            }
            let input = json!({"kind": "click", "x": prepared["point"]["x"], "y": prepared["point"]["y"],
                "button": step.button.as_deref().unwrap_or("left"), "clickCount": step.click_count.unwrap_or(1)});
            if let Some(result) = native(app, state, view, request, input, &prepared).await? {
                return Ok(
                    json!({"ok": true, "attempted": true, "input": "native", "cursor": result["cursor"]}),
                );
            }
            if let Some(cursor) = cursor_script(&prepared) {
                let _ = view.eval(cursor);
            }
            call(view, "perform", step_args(document, step), false).await
        }
        "key" => {
            if step.reference.is_some() {
                let focused = script("focus").await?;
                if focused["ok"] != true {
                    return Ok(focused);
                }
            }
            if let Some(_result) =
                native(app, state, view, request, step.native_key(), &prepared).await?
            {
                return Ok(json!({"ok": true, "attempted": true, "input": "native"}));
            }
            call(view, "perform", step_args(document, step), false).await
        }
        _ => {
            let mut result = call(view, "perform", step_args(document, step), false).await?;
            if step.action == "fill" && step.submit == Some(true) && result["ok"] == true {
                let enter = Step {
                    action: "key".into(),
                    key: Some("Enter".into()),
                    reference: None,
                    ..step.clone()
                };
                let submitted =
                    match native(app, state, view, request, enter.native_key(), &prepared).await? {
                        Some(_) => json!({"ok": true, "input": "native"}),
                        None => call(view, "perform", step_args(document, &enter), false).await?,
                    };
                result["submitted"] = json!(submitted["ok"] == true);
            }
            Ok(result)
        }
    }
}
