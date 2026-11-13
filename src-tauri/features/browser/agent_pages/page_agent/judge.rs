//! A click planned from a screenshot, judged natively before it lands. The vision model's own word on
//! whether it matters is one signal and never the only one: the page says what's under the point, and
//! `confirm::ask` holds the input until the person answers, as a page step's stop does.
use super::{call, call_at, frame_of, BrowserAgentExecuteRequest, BrowserSessionState};
use crate::agents::run_control::tool_policy::kind_of;
use crate::agents::run_control::tool_question::{Control, Controls};
use crate::browser::agent_pages::action_confirm as confirm;
use crate::browser::webview_label;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

/// What the page says this input would do. A page that can't answer leaves only the model's word.
async fn judged(view: &Webview, input: &Value) -> Value {
    let answer = match input["kind"].as_str().unwrap_or("") {
        "click" => {
            call(
                view,
                "consequenceAt",
                json!({"x": input["x"], "y": input["y"]}),
                false,
            )
            .await
        }
        "key" => {
            call(
                view,
                "consequenceOfKey",
                json!({"key": input["key"], "modifiers": input["modifiers"]}),
                false,
            )
            .await
        }
        _ => return Value::Null,
    };
    answer.unwrap_or(Value::Null)
}

/// The kind of stop this needs, from what's under the point and then from what the model said.
fn stop_kind<'a>(page: &'a Value, consequential: bool, description: &str) -> &'a str {
    match page["consequenceKind"]
        .as_str()
        .filter(|kind| !kind.is_empty())
    {
        Some(kind) => kind,
        None if consequential => kind_of(description),
        None => "",
    }
}

fn describe<'a>(page: &'a Value, description: &'a str) -> &'a str {
    if !description.is_empty() {
        return description;
    }
    page["describe"]
        .as_str()
        .filter(|control| !control.is_empty())
        .unwrap_or("this control")
}

/// `Err` holds what the goal hears when the person said no, or nobody answered. Nothing was sent.
pub(crate) async fn judge_point(
    app: &AppHandle,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    input: &Value,
) -> Result<Option<Value>, String> {
    let page = judged(view, input).await;
    let description = request.input["description"].as_str().unwrap_or("");
    let kind = stop_kind(&page, request.input["consequential"] == true, description);
    let origin = confirm::page_origin(view);
    if !confirm::asks(request, kind) || confirm::covered(request, &origin, kind) {
        return Ok(None);
    }
    let control = describe(&page, description);
    let reason = page["consequence"].as_str().unwrap_or("");
    let what = confirm::label(kind);
    match confirm::ask(app, view, request, kind, control, reason).await {
        confirm::Answer::Allowed => Ok(None),
        confirm::Answer::Refused => Err(format!("browser_action_declined: The person said no to {control}, which would {what}. Nothing was done. Don't try another way to do it; tell them it wasn't done.")),
        confirm::Answer::Unanswered => Err(format!("browser_action_unconfirmed: Stopped before {control}, which would {what}: nobody confirmed it in Misty within 3 minutes. Nothing was done. Tell the person it's waiting for them to confirm.")),
    }
}

fn view_of_scope(app: &AppHandle, scope: &str) -> Option<Webview> {
    let state = app.state::<BrowserSessionState>();
    let id = state
        .sessions
        .lock()
        .ok()?
        .iter()
        .find(|(_, session)| session.scope_id == scope)
        .map(|(id, _)| id.clone())?;
    app.get_webview(&webview_label(&id).ok()?)
}

/// Which site a tab is on, for a question's words.
pub(crate) fn scope_site(app: &AppHandle, scope: &str) -> String {
    view_of_scope(app, scope)
        .and_then(|view| view.url().ok())
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_default()
}

/// What the page calls the controls a call names, so a question says more than `e12`.
pub(crate) async fn page_controls(app: &AppHandle, scope: &str, refs: &[String]) -> Controls {
    let mut controls = Controls::new();
    let Some(view) = view_of_scope(app, scope) else {
        return controls;
    };
    for reference in refs {
        let frame = frame_of(&view, Some(reference)).map(|(frame, _)| frame);
        let Ok(found) = call_at(
            &view,
            frame,
            "describeRef",
            json!({"ref": reference}),
            false,
        )
        .await
        else {
            continue;
        };
        let name = found["name"].as_str().unwrap_or("");
        if !name.is_empty() {
            controls.insert(
                reference.clone(),
                Control {
                    name: name.to_owned(),
                    password: found["password"] == true,
                },
            );
        }
    }
    controls
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_under_the_point_decides_and_the_models_word_only_adds_to_it() {
        // The model calling a Send button harmless changes nothing.
        let send = json!({"consequenceKind": "send", "describe": "button \"Send\""});
        assert_eq!(stop_kind(&send, false, "click the button"), "send");
        // A plain button stays plain unless the model says otherwise.
        let plain = json!({"consequenceKind": "", "describe": "button \"Next\""});
        assert_eq!(stop_kind(&plain, false, "go on"), "");
        assert_eq!(stop_kind(&plain, true, "delete the row"), "delete");
        assert_eq!(stop_kind(&Value::Null, true, "buy it"), "payment");
        assert_eq!(stop_kind(&Value::Null, false, "buy it"), "");
    }

    #[test]
    fn a_question_says_what_was_planned_or_what_the_page_calls_it() {
        let page = json!({"describe": "button \"Send\""});
        assert_eq!(describe(&page, "Send the email"), "Send the email");
        assert_eq!(describe(&page, ""), "button \"Send\"");
        assert_eq!(describe(&Value::Null, ""), "this control");
    }
}
