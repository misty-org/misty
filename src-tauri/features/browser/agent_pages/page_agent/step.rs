use super::{
    call, call_at, frame_of, native_input, poll, resolve_agent_webview, BrowserAgentExecuteRequest,
    BrowserSessionState, Step,
};
use crate::browser::agent_pages::action_confirm as confirm;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Webview};

mod checked;
use checked::run_step_checked;

async fn native(
    app: &AppHandle,
    state: &BrowserSessionState,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    input: Value,
    prepared: &Value,
) -> Result<Option<Value>, String> {
    if !cfg!(any(target_os = "macos", windows, target_os = "linux")) {
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
    let origin =
        crate::browser::browser_page_origin(&view.url().map_err(|error| error.to_string())?);
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
    let args = json!({"documentId": document, "ref": step.reference, "action": action, "key": key, "modifiers": step.modifiers});
    let mut prepared = call_at(view, frame, "prepare", args.clone(), false).await?;
    if prepared["errorCode"] == "browser_target_covered" {
        let closed = call_at(view, None, "dismissPopup", json!({}), false).await;
        if closed.is_ok_and(|closed| {
            closed["dismissed"]
                .as_str()
                .is_some_and(|label| !label.is_empty())
        }) {
            prepared = call_at(view, frame, "prepare", args.clone(), false).await?;
        }
    }
    if prepared["ok"] == true && prepared["scrolled"] == true {
        tokio::time::sleep(Duration::from_millis(120)).await;
        prepared = call_at(view, frame, "prepare", args, false).await?;
    }
    Ok(prepared)
}

pub(crate) const CURSOR_GLIDE_MS: u64 = 320;

fn cursor_script(prepared: &Value) -> Option<String> {
    let (x, y) = (
        prepared["point"]["x"].as_f64()?,
        prepared["point"]["y"].as_f64()?,
    );
    Some(format!(
        "{}\nwindow[Symbol.for('misty.browser.agent.cursor')]?.move({:.4}*innerWidth,{:.4}*innerHeight,{{hold:true}});",
        include_str!("../../kiri_link/scripts/agent_cursor.js"),
        x,
        y
    ))
}

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
