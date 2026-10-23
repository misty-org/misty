//! Trusted agent input for WebView2 pages through the Chrome DevTools
//! Protocol. Events go to the granted page's renderer only: never to Misty's
//! window, another tab, or another app, and never as global desktop input.
use std::{
    collections::HashSet,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use serde_json::{json, Value};
use tauri::Webview;

use crate::infra::webview2::{self, CdpError};

mod keys;
use keys::*;

/// Pages whose person-made input is ignored while an agent drives them.
fn locked_pages() -> &'static Mutex<HashSet<String>> {
    static LOCKED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    LOCKED.get_or_init(Mutex::default)
}

fn is_locked(view: &Webview) -> bool {
    locked_pages()
        .lock()
        .is_ok_and(|pages| pages.contains(view.label()))
}

/// Chromium drops every input event, including the agent's, while a page
/// ignores input. The lock stays on between actions and lifts only for the
/// moment each agent event is delivered.
pub(super) fn set_locked(view: &Webview, locked: bool) -> Result<(), String> {
    {
        let mut pages = locked_pages()
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        if locked {
            pages.insert(view.label().to_owned());
        } else {
            pages.remove(view.label());
        }
    }
    let view = view.clone();
    tauri::async_runtime::spawn(async move {
        let _ = ignore_input(&view, locked).await;
    });
    Ok(())
}

async fn ignore_input(view: &Webview, ignore: bool) -> Result<Value, CdpError> {
    webview2::cdp(
        view,
        "Input.setIgnoreInputEvents",
        &json!({ "ignore": ignore }),
    )
    .await
}

/// A check that runs on the page's UI thread right before each event, so an
/// event cannot outlive revoked ownership, a takeover or a navigation.
pub(super) type Authorize = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;

/// Sends one CDP input event, after `authorize` passes, with the input lock
/// lifted for just this event.
async fn send(
    view: &Webview,
    authorize: &Authorize,
    method: &'static str,
    parameters: Value,
) -> Result<(), String> {
    let refusal = Arc::new(Mutex::new(None::<String>));
    let check = {
        let authorize = authorize.clone();
        let refusal = refusal.clone();
        move |_: &_| {
            authorize().map_err(|reason| {
                if let Ok(mut slot) = refusal.lock() {
                    *slot = Some(reason);
                }
                CdpError::Invalid
            })
        }
    };
    let locked = is_locked(view);
    if locked {
        ignore_input(view, false).await.map_err(String::from)?;
    }
    let result = webview2::cdp_checked(view, method, &parameters, check).await;
    if locked {
        let _ = ignore_input(view, true).await;
    }
    match result {
        Ok(_) => Ok(()),
        Err(error) => Err(refusal
            .lock()
            .ok()
            .and_then(|mut slot| slot.take())
            .unwrap_or_else(|| error.message().to_owned())),
    }
}

/// Delivers one validated action. `point` turns a viewport fraction into CSS
/// pixels. Returns the same receipt the WebKit adapter does.
pub(super) async fn act(
    view: &Webview,
    authorize: Authorize,
    action: &Value,
    viewport: (f64, f64),
    editable: bool,
) -> Result<Value, String> {
    let point = |x: &str, y: &str| -> (f64, f64) {
        let fraction = |key: &str| action[key].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
        (
            (fraction(x) * viewport.0).min(viewport.0 - 1.0).max(0.0),
            (fraction(y) * viewport.1).min(viewport.1 - 1.0).max(0.0),
        )
    };
    match action["kind"].as_str().unwrap_or("") {
        "click" => {
            let (x, y) = point("x", "y");
            let right = action["button"] == "right";
            let (button, held) = if right { ("right", 2) } else { ("left", 1) };
            send(
                view,
                &authorize,
                "Input.dispatchMouseEvent",
                mouse("mouseMoved", x, y, "none", 0, 0),
            )
            .await?;
            for clicks in 1..=action["clickCount"].as_u64().unwrap_or(1) {
                send(
                    view,
                    &authorize,
                    "Input.dispatchMouseEvent",
                    mouse("mousePressed", x, y, button, held, clicks),
                )
                .await?;
                send(
                    view,
                    &authorize,
                    "Input.dispatchMouseEvent",
                    mouse("mouseReleased", x, y, button, 0, clicks),
                )
                .await?;
            }
        }
        "drag" => {
            let (from_x, from_y) = point("fromX", "fromY");
            let (to_x, to_y) = point("toX", "toY");
            send(
                view,
                &authorize,
                "Input.dispatchMouseEvent",
                mouse("mouseMoved", from_x, from_y, "none", 0, 0),
            )
            .await?;
            send(
                view,
                &authorize,
                "Input.dispatchMouseEvent",
                mouse("mousePressed", from_x, from_y, "left", 1, 1),
            )
            .await?;
            for step in 1..=24 {
                let fraction = f64::from(step) / 24.0;
                let (x, y) = (
                    from_x + (to_x - from_x) * fraction,
                    from_y + (to_y - from_y) * fraction,
                );
                send(
                    view,
                    &authorize,
                    "Input.dispatchMouseEvent",
                    mouse("mouseMoved", x, y, "left", 1, 0),
                )
                .await?;
                tokio::time::sleep(Duration::from_millis(12)).await;
            }
            send(
                view,
                &authorize,
                "Input.dispatchMouseEvent",
                mouse("mouseReleased", to_x, to_y, "left", 0, 1),
            )
            .await?;
        }
        "scroll" => {
            let (x, y) = point("x", "y");
            let mut event = mouse("mouseWheel", x, y, "none", 0, 0);
            event["deltaX"] = action["deltaX"].clone();
            event["deltaY"] = action["deltaY"].clone();
            send(view, &authorize, "Input.dispatchMouseEvent", event).await?;
        }
        "type" => {
            let text = action["text"].as_str().unwrap_or_default();
            send(
                view,
                &authorize,
                "Input.insertText",
                json!({ "text": text }),
            )
            .await?;
        }
        "key" => {
            let name = action["key"].as_str().unwrap_or_default();
            let spec = key(name).ok_or("Unsupported native browser key")?;
            let bits = modifier_bits(&action["modifiers"]);
            let shortcut = bits & (2 | 4) != 0;
            let mut down = json!({
                "type": if shortcut || spec.text.is_none() { "rawKeyDown" } else { "keyDown" },
                "key": spec.key,
                "code": spec.code,
                "windowsVirtualKeyCode": spec.virtual_key,
                "modifiers": bits,
            });
            if !shortcut {
                if let Some(text) = &spec.text {
                    down["text"] = text.clone().into();
                    down["unmodifiedText"] = text.clone().into();
                }
            } else if editable {
                if let Some(command) = editing_command(name, bits) {
                    down["commands"] = json!([command]);
                }
            }
            send(view, &authorize, "Input.dispatchKeyEvent", down).await?;
            let up = json!({
                "type": "keyUp",
                "key": spec.key,
                "code": spec.code,
                "windowsVirtualKeyCode": spec.virtual_key,
                "modifiers": bits,
            });
            send(view, &authorize, "Input.dispatchKeyEvent", up).await?;
        }
        _ => return Err("Unsupported native browser action".into()),
    }
    Ok(json!({ "attempted": true, "verified": false, "driver": "cdp-webview2" }))
}

#[cfg(test)]
mod tests;
