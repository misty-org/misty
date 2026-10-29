//! Running one step once its control is found: the consequence gate, then native or script input.
use super::*;

/// Runs one step after its checks. Err only for faults where an effect is unknown.
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_step_checked(
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
        // A link that stays covered after its popup was closed (a sticky video, a chat bubble)
        // goes where it points, as a person would by opening it: the click cannot reach it.
        if let (true, None, Some(href)) = (
            step.action == "click" && prepared["errorCode"] == "browser_target_covered",
            frame,
            prepared["href"]
                .as_str()
                .filter(|href| href.starts_with("http")),
        ) {
            let script = format!(
                "location.assign({})",
                serde_json::to_string(href).unwrap_or_default()
            );
            if view.eval(script).is_ok() {
                return Ok(
                    json!({"ok": true, "attempted": true, "input": "link", "navigated": href,
                    "note": format!("{} The click could not reach it, so its address was opened.", prepared["error"].as_str().unwrap_or(""))}),
                );
            }
        }
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
                    Some(_) => {
                        json!({"ok": true, "attempted": true, "input": "native", "typed": true,
                        "note": "This editor keeps its own copy of the text, so it was typed with real keystrokes. Read the editor to check it."})
                    }
                    None => {
                        json!({"ok": false, "attempted": true, "errorCode": "browser_text_not_kept",
                        "error": "The editor did not keep the text. Type it with browser_steps type (real keystrokes), in parts if it is long."})
                    }
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
