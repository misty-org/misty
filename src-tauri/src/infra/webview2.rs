//! Native access to a WebView2 page: code that runs against the view's
//! `ICoreWebView2` on the UI thread, and Chrome DevTools Protocol calls.
//!
//! CDP runs in Misty's process and is never exposed to renderers. Callers
//! choose the method and build the parameters; nothing here forwards page or
//! renderer input as a method name.
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use serde_json::Value;
use tauri::Webview;
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2Controller},
};
use windows::core::{HSTRING, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;
use zeroize::Zeroizing;

/// The largest CDP request or reply Misty sends or accepts.
pub(crate) const MAX_CDP_BYTES: usize = 16 * 1024 * 1024;
const CDP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CdpError {
    /// The view is gone, or WebView2 refused the call.
    Unavailable,
    /// The page did not answer in time.
    Timeout,
    TooLarge,
    /// The reply was not the JSON CDP promises, or reported an error.
    Invalid,
}

impl CdpError {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Unavailable => "The page is not available.",
            Self::Timeout => "The page did not respond in time.",
            Self::TooLarge => "The page's answer was too large.",
            Self::Invalid => "The page returned an unexpected answer.",
        }
    }
}

/// A failed WebView2 call. Native error text is dropped: it can contain page data.
impl From<windows::core::Error> for CdpError {
    fn from(_: windows::core::Error) -> Self {
        Self::Unavailable
    }
}

impl From<CdpError> for String {
    fn from(error: CdpError) -> Self {
        error.message().to_owned()
    }
}

/// Runs `body` against the view's WebView2 objects on the UI thread and
/// returns its result. `body` must not block: completion handlers it starts
/// run later on the same thread.
pub(crate) async fn with_core<T: Send + 'static>(
    view: &Webview,
    body: impl FnOnce(&ICoreWebView2, &ICoreWebView2Controller) -> Result<T, CdpError> + Send + 'static,
) -> Result<T, CdpError> {
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        let controller = platform.controller();
        // SAFETY: the controller is live for the duration of this UI-thread callback.
        let result = unsafe { controller.CoreWebView2() }
            .map_err(|_| CdpError::Unavailable)
            .and_then(|core| body(&core, &controller));
        let _ = send.send(result);
    })
    .map_err(|_| CdpError::Unavailable)?;
    receive.await.map_err(|_| CdpError::Unavailable)?
}

/// Calls one CDP method on the view. `check` runs first, on the UI thread,
/// and can refuse the call (for example when the view is in the wrong profile).
pub(crate) async fn cdp_checked(
    view: &Webview,
    method: &'static str,
    parameters: &Value,
    check: impl FnOnce(&ICoreWebView2) -> Result<(), CdpError> + Send + 'static,
) -> Result<Value, CdpError> {
    let parameters =
        Zeroizing::new(serde_json::to_string(parameters).map_err(|_| CdpError::Invalid)?);
    if parameters.len() > MAX_CDP_BYTES {
        return Err(CdpError::TooLarge);
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Arc::new(Mutex::new(Some(send)));
    let reply = send.clone();
    let started = with_core(view, move |core, _| {
        check(core)?;
        let handler =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, payload| {
                let payload = Zeroizing::new(payload);
                let result = if status.is_err() {
                    Err(CdpError::Unavailable)
                } else if payload.len() > MAX_CDP_BYTES {
                    Err(CdpError::TooLarge)
                } else {
                    serde_json::from_str::<Value>(&payload)
                        .map_err(|_| CdpError::Invalid)
                        .and_then(|value| {
                            if value.get("error").is_some() {
                                Err(CdpError::Invalid)
                            } else {
                                Ok(value)
                            }
                        })
                };
                if let Some(send) = reply.lock().ok().and_then(|mut slot| slot.take()) {
                    let _ = send.send(result);
                }
                Ok(())
            }));
        // SAFETY: a live view on its UI thread; the handler owns its state.
        unsafe {
            core.CallDevToolsProtocolMethod(
                &HSTRING::from(method),
                &HSTRING::from(parameters.as_str()),
                &handler,
            )
        }
        .map_err(|_| CdpError::Unavailable)
    })
    .await;
    started?;
    drop(send);
    tokio::time::timeout(CDP_TIMEOUT, receive)
        .await
        .map_err(|_| CdpError::Timeout)?
        .map_err(|_| CdpError::Unavailable)?
}

/// Calls one CDP method on the view.
pub(crate) async fn cdp(
    view: &Webview,
    method: &'static str,
    parameters: &Value,
) -> Result<Value, CdpError> {
    cdp_checked(view, method, parameters, |_| Ok(())).await
}

/// Evaluates `expression` in the page, awaiting a returned promise, and gives
/// back the JSON value it produced. `context` names an isolated world created
/// with `Page.createIsolatedWorld`; `None` is the page's own world.
pub(crate) async fn evaluate(
    view: &Webview,
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
    let result = cdp(view, "Runtime.evaluate", &parameters).await?;
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
    None,
    Left,
    Right,
}

impl MouseButton {
    fn name(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Left => "left",
            Self::Right => "right",
        }
    }

    /// The `buttons` bitmask while this button is held.
    fn held(self) -> u8 {
        match self {
            Self::None => 0,
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

/// Reads a string WebView2 allocated and frees it, even when the call failed
/// after allocating. Native error text is never kept: it may contain page data.
///
/// # Safety
/// `read` must be a WebView2 getter that writes a CoTaskMem string to its argument.
pub(crate) unsafe fn owned_string(
    read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>,
) -> Option<String> {
    let mut pointer = PWSTR::null();
    let status = read(&mut pointer);
    let value = if status.is_ok() && !pointer.is_null() {
        pointer.to_string().ok()
    } else {
        None
    };
    if !pointer.is_null() {
        CoTaskMemFree(Some(pointer.0.cast()));
    }
    value
}
