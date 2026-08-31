use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use url::Url;

use super::browser::BrowserSessionState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserShortcutBinding {
    shortcut: String,
    allow_in_editable: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserShortcutEvent {
    id: String,
    key: String,
    code: String,
    alt_key: bool,
    ctrl_key: bool,
    meta_key: bool,
    shift_key: bool,
    repeat: bool,
    editable: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserShortcutFocusEvent {
    id: String,
}

pub(super) fn shortcut_token_for(state: &BrowserSessionState, id: &str) -> Result<String, String> {
    let mut tokens = state
        .shortcut_tokens
        .lock()
        .map_err(|_| "Browser shortcut state is unavailable.")?;
    Ok(tokens
        .entry(id.to_owned())
        .or_insert_with(|| uuid::Uuid::new_v4().simple().to_string())
        .clone())
}

pub(super) fn shortcut_token_matches(state: &BrowserSessionState, id: &str, token: &str) -> bool {
    state
        .shortcut_tokens
        .lock()
        .ok()
        .and_then(|tokens| {
            tokens
                .get(id)
                .map(|expected| !token.is_empty() && expected == token)
        })
        .unwrap_or(false)
}

pub(super) fn forget_shortcut_token(state: &BrowserSessionState, id: &str) {
    if let Ok(mut tokens) = state.shortcut_tokens.lock() {
        tokens.remove(id);
    }
}

pub(super) fn forward_navigation(app: &AppHandle, id: &str, url: &Url) -> bool {
    if url.scheme() != "misty-shortcut" {
        return false;
    }
    let values = url.query_pairs().collect::<HashMap<_, _>>();
    let value = |key: &str| values.get(key).map(|value| value.as_ref()).unwrap_or("");
    let trusted = app
        .try_state::<BrowserSessionState>()
        .map(|state| shortcut_token_matches(&state, id, value("token")))
        .unwrap_or(false);
    if !trusted {
        return true;
    }
    // The native child WebView is outside the renderer's focus tree. Focus its
    // owning dock tab before dispatching so a shortcut can never act on a
    // different split while native focus is still catching up.
    let _ = app.emit_to(
        "main",
        "misty://browser-focus",
        BrowserShortcutFocusEvent { id: id.to_owned() },
    );
    let flag = |key: &str| value(key) == "true";
    let _ = app.emit_to(
        "main",
        "misty://browser-shortcut",
        BrowserShortcutEvent {
            id: id.to_owned(),
            key: value("key").to_owned(),
            code: value("code").to_owned(),
            alt_key: flag("alt"),
            ctrl_key: flag("ctrl"),
            meta_key: flag("meta"),
            shift_key: flag("shift"),
            repeat: flag("repeat"),
            editable: flag("editable"),
        },
    );
    true
}

#[tauri::command]
pub fn browser_shortcuts_update(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    bindings: Vec<BrowserShortcutBinding>,
) -> Result<(), String> {
    if bindings.len() > 512 || bindings.iter().any(|binding| binding.shortcut.len() > 80) {
        return Err("Shortcut forwarding payload is invalid.".to_owned());
    }
    *state
        .shortcut_bindings
        .lock()
        .map_err(|_| "Browser shortcut state is unavailable.")? = bindings;
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            apply(&webview, &state)?;
        }
    }
    Ok(())
}

pub(super) fn apply(webview: &Webview, state: &BrowserSessionState) -> Result<(), String> {
    let bindings = state
        .shortcut_bindings
        .lock()
        .map_err(|_| "Browser shortcut state is unavailable.")?
        .clone();
    let payload = serde_json::to_string(&bindings).map_err(|error| error.to_string())?;
    webview
        .eval(&format!("window.__MISTY_SET_SHORTCUTS__?.({payload});"))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_shortcut_tokens_are_scoped_to_the_owning_tab() {
        let state = BrowserSessionState::default();
        state
            .shortcut_tokens
            .lock()
            .unwrap()
            .insert("tab-a".to_owned(), "secret-a".to_owned());
        assert!(shortcut_token_matches(&state, "tab-a", "secret-a"));
        assert!(!shortcut_token_matches(&state, "tab-a", "secret-b"));
        assert!(!shortcut_token_matches(&state, "tab-b", "secret-a"));
    }
}
