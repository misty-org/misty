//! One page action: find its control, check it, then click or type natively
//! when the tab is visible, or through the page script otherwise.
use super::{
    call, call_at, frame_of, native_input, poll, resolve_agent_webview, BrowserAgentExecuteRequest,
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
    frame: Option<u64>,
    document: &str,
    step: &Step,
    action: &str,
    key: Option<&str>,
) -> Result<Value, String> {
    let args = json!({"documentId": document, "ref": step.reference, "action": action, "key": key});
    let mut prepared = call_at(view, frame, "prepare", args.clone(), false).await?;
    // A popup over the control is closed first, as a person would (page_read.js), then the
    // control is measured again; anything else covering it still fails back to the agent.
    if prepared["errorCode"] == "browser_target_covered" {
        let closed = call_at(view, None, "dismissPopup", json!({}), false).await;
        if closed.is_ok_and(|closed| closed["dismissed"].as_str().is_some_and(|label| !label.is_empty())) {
            prepared = call_at(view, frame, "prepare", args.clone(), false).await?;
        }
    }
    if prepared["ok"] == true && prepared["scrolled"] == true {
        // Let a smooth-scrolling page come to rest, then measure again.
        tokio::time::sleep(Duration::from_millis(120)).await;
        prepared = call_at(view, frame, "prepare", args, false).await?;
    }
    Ok(prepared)
}

/// How long the cursor glides to a control (browser_agent_cursor.js) before the click.
pub(crate) const CURSOR_GLIDE_MS: u64 = 320;

fn cursor_script(prepared: &Value) -> Option<String> {
    let (x, y) = (
        prepared["point"]["x"].as_f64()?,
        prepared["point"]["y"].as_f64()?,
    );
    // The cursor installs itself the first time (it is idempotent), so every agent tab shows it.
    Some(format!(
        "{}\nwindow[Symbol.for('misty.browser.agent.cursor')]?.move({:.4}*innerWidth,{:.4}*innerHeight,{{hold:true}});",
        include_str!("../browser_agent_cursor.js"),
        x,
        y
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
    // A ref inside a cross-origin frame runs there, against that frame's document.
    let frame = frame_of(view, resolved.reference.as_deref());
    let document = frame
        .as_ref()
        .map_or(document, |(_, document)| document.as_str());
    let frame = frame.as_ref().map(|(frame, _)| *frame);
    let locator = match &resolved.reference {
        Some(reference) => call_at(
            view,
            frame,
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
        frame,
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
#[allow(clippy::too_many_arguments)]
async fn run_step_checked(
    app: &AppHandle,
    state: &BrowserSessionState,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    frame: Option<u64>,
    document: &str,
    step: &Step,
    allow_consequential: bool,
) -> Result<Value, String> {
    // Native input lands at a point in the top document; a frame's controls take script input.
    let native = |input: Value, prepared: Value| async move {
        if frame.is_some() {
            return Ok(None);
        }
        native(app, state, view, request, input, &prepared).await
    };
    if step.action == "wait_for" {
        let condition = json!({"text": step.text, "textGone": step.text_gone});
        let waited = poll(view, &condition, step.timeout_ms.unwrap_or(8_000)).await?;
        return Ok(
            json!({"ok": waited["met"] == true, "attempted": false, "met": waited["met"], "waitedMs": waited["waitedMs"]}),
        );
    }
    // A fill that submits is judged by the Enter that follows it.
    let submits = step.action == "fill" && step.submit == Some(true);
    // Typing is judged like filling: the same fields (payment, passwords) need the same care.
    let gate = if submits {
        "key"
    } else if step.action == "type" {
        "fill"
    } else {
        step.action.as_str()
    };
    let key = if submits {
        Some("Enter")
    } else {
        step.key.as_deref()
    };
    let prepared = prepare(view, frame, document, step, gate, key).await?;
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
        call_at(
            view,
            frame,
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
            if let Some(result) = native(input, prepared.clone()).await? {
                return Ok(
                    json!({"ok": true, "attempted": true, "input": "native", "cursor": result["cursor"]}),
                );
            }
            if let Some(cursor) = cursor_script(&prepared).filter(|_| frame.is_none()) {
                // The person watching sees the cursor reach the control before it is pressed.
                if view.eval(cursor).is_ok() {
                    tokio::time::sleep(std::time::Duration::from_millis(CURSOR_GLIDE_MS)).await;
                }
            }
            call_at(view, frame, "perform", step_args(document, step), false).await
        }
        "key" => {
            if step.reference.is_some() {
                let focused = script("focus").await?;
                if focused["ok"] != true {
                    return Ok(focused);
                }
            }
            if let Some(_result) = native(step.native_key(), prepared.clone()).await? {
                return Ok(json!({"ok": true, "attempted": true, "input": "native"}));
            }
            call_at(view, frame, "perform", step_args(document, step), false).await
        }
        // Hover with a real pointer as well as the page's own events: the pointer opens CSS
        // :hover menus while the window is in front (WebKit ignores pointer moves into a window
        // behind others), and the events open menus built in script either way.
        "hover" => {
            let input =
                json!({"kind": "move", "x": prepared["point"]["x"], "y": prepared["point"]["y"]});
            let moved =
                cfg!(target_os = "macos") && native(input, prepared.clone()).await?.is_some();
            let mut result =
                call_at(view, frame, "perform", step_args(document, step), false).await?;
            if moved {
                tokio::time::sleep(Duration::from_millis(150)).await;
                result["input"] = json!("native");
            }
            Ok(result)
        }
        // Typing as a person types, through the text input path, so suggest-as-you-type fields,
        // search boxes and editors respond. The field's text is replaced.
        "type" => {
            if step.reference.is_some() {
                let focused = script("focus").await?;
                if focused["ok"] != true {
                    return Ok(focused);
                }
                let select_all = json!({"kind": "key", "key": "a", "modifiers": [if cfg!(target_os = "macos") { "Meta" } else { "Control" }]});
                let _ = native(select_all, prepared.clone()).await?;
            }
            let typed = json!({"kind": "type", "text": step.text});
            let mut result = match native(typed, prepared.clone()).await? {
                Some(_) => json!({"ok": true, "attempted": true, "input": "native"}),
                None => {
                    let fill = Step {
                        action: "fill".into(),
                        ..step.clone()
                    };
                    call_at(view, frame, "perform", step_args(document, &fill), false).await?
                }
            };
            if step.submit == Some(true) && result["ok"] == true {
                let enter = Step {
                    action: "key".into(),
                    key: Some("Enter".into()),
                    reference: None,
                    ..step.clone()
                };
                let submitted = match native(enter.native_key(), prepared.clone()).await? {
                    Some(_) => json!({"ok": true, "input": "native"}),
                    None => {
                        call_at(view, frame, "perform", step_args(document, &enter), false).await?
                    }
                };
                result["submitted"] = json!(submitted["ok"] == true);
            }
            Ok(result)
        }
        // A page scroll turns the wheel, so pages that load or move on wheel events respond.
        // Scrolling a named panel, or text into view, stays with the page script.
        "scroll"
            if step.reference.is_none()
                && step.text.is_none()
                && matches!(
                    step.direction.as_deref(),
                    Some("up" | "down" | "left" | "right")
                ) =>
        {
            let horizontal = matches!(step.direction.as_deref(), Some("left" | "right"));
            let size = prepared["viewport"][if horizontal { "width" } else { "height" }]
                .as_f64()
                .unwrap_or(800.0);
            let sign = if matches!(step.direction.as_deref(), Some("up" | "left")) {
                -1.0
            } else {
                1.0
            };
            let delta = (sign * step.amount.unwrap_or(0.8) * size)
                .round()
                .clamp(-2000.0, 2000.0) as i64;
            let input = json!({"kind": "scroll", "x": 0.5, "y": 0.5,
                "deltaX": if horizontal { delta } else { 0 }, "deltaY": if horizontal { 0 } else { delta }});
            if native(input, prepared.clone()).await?.is_some() {
                tokio::time::sleep(Duration::from_millis(300)).await;
                return Ok(
                    json!({"ok": true, "attempted": true, "scrolled": true, "input": "native"}),
                );
            }
            call_at(view, frame, "perform", step_args(document, step), false).await
        }
        _ => {
            let mut result =
                call_at(view, frame, "perform", step_args(document, step), false).await?;
            // An editor that keeps its own model (canvas editors such as OnlyOffice in CryptPad)
            // drops inserted text and takes only real keystrokes. A fill it did not keep is typed
            // instead, as a person would; it was reported as done and the document stayed empty
            // (Odysseys, October 20).
            let text = step.text.as_deref().unwrap_or("");
            if step.action == "fill"
                && result["ok"] == true
                && result["retained"] == false
                && !text.is_empty()
                && text.len() <= 16_000
            {
                let focused = script("focus").await?;
                let select_all = json!({"kind": "key", "key": "a", "modifiers": [if cfg!(target_os = "macos") { "Meta" } else { "Control" }]});
                let typed = if focused["ok"] == true {
                    let _ = native(select_all, prepared.clone()).await?;
                    native(json!({"kind": "type", "text": text}), prepared.clone()).await?
                } else {
                    None
                };
                result = match typed {
                    Some(_) => json!({"ok": true, "attempted": true, "input": "native", "typed": true,
                        "note": "This editor keeps its own copy of the text, so it was typed with real keystrokes. Read the editor to check it."}),
                    None => json!({"ok": false, "attempted": true, "errorCode": "browser_text_not_kept",
                        "error": "The editor did not keep the text. Type it with browser_steps type (real keystrokes), in parts if it is long."}),
                };
            }
            if step.action == "fill" && step.submit == Some(true) && result["ok"] == true {
                let enter = Step {
                    action: "key".into(),
                    key: Some("Enter".into()),
                    reference: None,
                    ..step.clone()
                };
                let submitted = match native(enter.native_key(), prepared.clone()).await? {
                    Some(_) => json!({"ok": true, "input": "native"}),
                    None => {
                        call_at(view, frame, "perform", step_args(document, &enter), false).await?
                    }
                };
                result["submitted"] = json!(submitted["ok"] == true);
            }
            Ok(result)
        }
    }
}
