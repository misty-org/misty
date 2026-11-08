//! Inserts text into the field focused in a page without touching the system clipboard.

use crate::browser::*;

/// Types `text` (or `html` into a rich editor) where the page's caret is.
pub(crate) fn paste_into_page(
    app: &AppHandle,
    caller: &Webview,
    id: &str,
    text: &str,
    html: &str,
) -> Result<(), String> {
    let view = app
        .get_webview(&webview_label(id)?)
        .ok_or("browser_context_closed")?;
    if view.window().label() != caller.window().label() {
        return Err("browser_window_mismatch".into());
    }
    let script = format!(
        "(() => {{ const text = {}; const html = {}; const el = document.activeElement; \
         if (html && el && el.isContentEditable) document.execCommand('insertHTML', false, html); \
         else document.execCommand('insertText', false, text); }})();",
        json!(text),
        json!(html),
    );
    view.eval(&script).map_err(|error| error.to_string())
}
