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

fn mouse(kind: &str, x: f64, y: f64, button: &str, buttons: u8, clicks: u64) -> Value {
    json!({
        "type": kind,
        "x": x,
        "y": y,
        "button": button,
        "buttons": buttons,
        "clickCount": clicks,
    })
}

/// CDP's modifier bits: Alt 1, Control 2, Meta 4, Shift 8.
fn modifier_bits(modifiers: &Value) -> u8 {
    modifiers.as_array().map_or(0, |list| {
        list.iter().fold(0, |bits, value| {
            bits | match value.as_str() {
                Some("Alt") => 1,
                Some("Control") => 2,
                Some("Meta") => 4,
                Some("Shift") => 8,
                _ => 0,
            }
        })
    })
}

/// A key as CDP describes it: its `key`, physical `code`, Windows virtual-key
/// code, the text it types, and whether it needs Shift on a US layout.
struct Key {
    key: String,
    code: String,
    virtual_key: u32,
    text: Option<String>,
}

fn key(name: &str) -> Option<Key> {
    let special = |key: &str, code: &str, virtual_key: u32, text: Option<&str>| Key {
        key: key.into(),
        code: code.into(),
        virtual_key,
        text: text.map(str::to_owned),
    };
    Some(match name {
        "Enter" => special("Enter", "Enter", 13, Some("\r")),
        "Escape" => special("Escape", "Escape", 27, None),
        "Tab" => special("Tab", "Tab", 9, None),
        "Backspace" => special("Backspace", "Backspace", 8, None),
        "Delete" => special("Delete", "Delete", 46, None),
        "ArrowLeft" => special("ArrowLeft", "ArrowLeft", 37, None),
        "ArrowUp" => special("ArrowUp", "ArrowUp", 38, None),
        "ArrowRight" => special("ArrowRight", "ArrowRight", 39, None),
        "ArrowDown" => special("ArrowDown", "ArrowDown", 40, None),
        "Home" => special("Home", "Home", 36, None),
        "End" => special("End", "End", 35, None),
        "PageUp" => special("PageUp", "PageUp", 33, None),
        "PageDown" => special("PageDown", "PageDown", 34, None),
        "Space" => special(" ", "Space", 32, Some(" ")),
        _ => return printable(name),
    })
}

/// A single printable ASCII character on a US layout.
fn printable(name: &str) -> Option<Key> {
    let &[byte] = name.as_bytes() else {
        return None;
    };
    let character = byte as char;
    // Shifted punctuation types through its unshifted key.
    const SHIFTED: &str = r#"!@#$%^&*()_+{}|:"<>?~"#;
    const BASE: &str = r#"1234567890-=[]\;',./`"#;
    let base = SHIFTED
        .find(character)
        .and_then(|index| BASE.chars().nth(index))
        .unwrap_or(character.to_ascii_lowercase());
    let (code, virtual_key) = match base {
        'a'..='z' => (
            format!("Key{}", base.to_ascii_uppercase()),
            base.to_ascii_uppercase() as u32,
        ),
        '0'..='9' => (format!("Digit{base}"), base as u32),
        ';' => ("Semicolon".into(), 186),
        '=' => ("Equal".into(), 187),
        ',' => ("Comma".into(), 188),
        '-' => ("Minus".into(), 189),
        '.' => ("Period".into(), 190),
        '/' => ("Slash".into(), 191),
        '`' => ("Backquote".into(), 192),
        '[' => ("BracketLeft".into(), 219),
        '\\' => ("Backslash".into(), 220),
        ']' => ("BracketRight".into(), 221),
        '\'' => ("Quote".into(), 222),
        _ => return None,
    };
    Some(Key {
        key: name.to_owned(),
        code,
        virtual_key,
        text: Some(name.to_owned()),
    })
}

/// The editing command a select-all or undo shortcut runs in an editable
/// field, so it acts on the page's own editor, as WebKit's does.
fn editing_command(name: &str, bits: u8) -> Option<&'static str> {
    match name.to_ascii_lowercase().as_str() {
        "a" => Some("selectAll"),
        "z" if bits & 8 != 0 => Some("redo"),
        "z" => Some("undo"),
        _ => None,
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
mod tests {
    use super::*;

    #[test]
    fn keys_map_to_us_layout_codes() {
        let enter = key("Enter").unwrap();
        assert_eq!((enter.virtual_key, enter.text.as_deref()), (13, Some("\r")));
        let upper = key("A").unwrap();
        assert_eq!((upper.code.as_str(), upper.virtual_key), ("KeyA", 65));
        let bang = key("!").unwrap();
        assert_eq!((bang.code.as_str(), bang.virtual_key), ("Digit1", 49));
        let quote = key("\"").unwrap();
        assert_eq!((quote.code.as_str(), quote.virtual_key), ("Quote", 222));
        assert!(key("é").is_none());
        assert!(key("Shell").is_none());
    }

    #[test]
    fn shortcuts_run_editing_commands() {
        assert_eq!(editing_command("a", 2), Some("selectAll"));
        assert_eq!(editing_command("Z", 2), Some("undo"));
        assert_eq!(editing_command("z", 2 | 8), Some("redo"));
        assert_eq!(editing_command("c", 2), None);
        assert_eq!(modifier_bits(&json!(["Control", "Shift"])), 10);
    }
}
