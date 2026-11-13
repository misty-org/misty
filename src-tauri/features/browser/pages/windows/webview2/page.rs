//! Page-level CDP helpers: evaluating script, the viewport and trusted clicks.
use serde_json::Value;
use tauri::Webview;

use super::{cdp, cdp_in_session, CdpError};

/// Evaluates `expression` in the page, awaiting a returned promise, and gives
/// back the JSON value it produced. `context` names an isolated world created
/// with `Page.createIsolatedWorld`; `None` is the page's own world.
pub(crate) async fn evaluate(
    view: &Webview,
    expression: String,
    context: Option<i64>,
) -> Result<Value, CdpError> {
    evaluate_in(view, None, expression, context).await
}

/// `evaluate` in a target session the view attached to; `context` belongs to
/// that session.
pub(crate) async fn evaluate_in_session(
    view: &Webview,
    session: &str,
    expression: String,
    context: i64,
) -> Result<Value, CdpError> {
    evaluate_in(view, Some(session), expression, Some(context)).await
}

async fn evaluate_in(
    view: &Webview,
    session: Option<&str>,
    expression: String,
    context: Option<i64>,
) -> Result<Value, CdpError> {
    let mut parameters = serde_json::json!({
        "expression": expression,
        "awaitPromise": true,
        "returnByValue": true,
    });
    if let Some(context) = context {
        parameters["contextId"] = context.into();
    }
    let result = match session {
        Some(session) => cdp_in_session(view, session, "Runtime.evaluate", &parameters).await?,
        None => cdp(view, "Runtime.evaluate", &parameters).await?,
    };
    if result.get("exceptionDetails").is_some() {
        return Err(CdpError::Invalid);
    }
    Ok(result["result"]
        .get("value")
        .cloned()
        .unwrap_or(Value::Null))
}

/// The page's visible viewport size in CSS pixels.
pub(crate) async fn css_viewport(view: &Webview) -> Result<(f64, f64), CdpError> {
    let metrics = cdp(view, "Page.getLayoutMetrics", &serde_json::json!({})).await?;
    let size = |key: &str| {
        metrics["cssVisualViewport"][key]
            .as_f64()
            .filter(|value| value.is_finite() && *value > 0.0)
    };
    Ok((
        size("clientWidth").ok_or(CdpError::Invalid)?,
        size("clientHeight").ok_or(CdpError::Invalid)?,
    ))
}

/// A mouse button for `Input.dispatchMouseEvent`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MouseButton {
    Left,
    Right,
}

impl MouseButton {
    fn name(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
        }
    }

    /// The `buttons` bitmask while this button is held.
    fn held(self) -> u8 {
        match self {
            Self::Left => 1,
            Self::Right => 2,
        }
    }
}

/// Sends a press and release of `button` at a CSS-pixel point in the viewport.
/// The page receives trusted events, as it would from the person's mouse.
pub(crate) async fn click(
    view: &Webview,
    x: f64,
    y: f64,
    button: MouseButton,
    clicks: u8,
) -> Result<(), CdpError> {
    for (kind, buttons) in [("mousePressed", button.held()), ("mouseReleased", 0)] {
        cdp(
            view,
            "Input.dispatchMouseEvent",
            &serde_json::json!({
                "type": kind,
                "x": x,
                "y": y,
                "button": button.name(),
                "buttons": buttons,
                "clickCount": clicks,
            }),
        )
        .await?;
    }
    Ok(())
}
