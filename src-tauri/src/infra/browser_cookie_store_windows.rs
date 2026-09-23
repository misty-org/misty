//! WebView2 cookie transport. CDP is invoked in the native process, never exposed
//! as renderer IPC. Every call validates the real user-data folder and profile.
use super::browser_cookie_cdp as codec;
pub(crate) use codec::CookieStoreError;
use misty_browser_sync::document::credentials::Cookie;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager, Webview};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2Environment7, ICoreWebView2_13, ICoreWebView2_2,
    },
};
use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, CookieStoreError>;

// Frees native strings even if the platform returns a failed HRESULT after
// allocating them. Never format native errors (which may include payload data).
unsafe fn owned_string(
    read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>,
) -> Result<String> {
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
    value.ok_or(CookieStoreError::Unavailable)
}
unsafe fn verify_profile(view: &ICoreWebView2, expected: &Path) -> Result<()> {
    let extended = view
        .cast::<ICoreWebView2_2>()
        .map_err(|_| CookieStoreError::Unsupported)?;
    let environment = extended
        .Environment()
        .map_err(|_| CookieStoreError::Unavailable)?
        .cast::<ICoreWebView2Environment7>()
        .map_err(|_| CookieStoreError::Unsupported)?;
    let actual = PathBuf::from(owned_string(|p| environment.UserDataFolder(p))?);
    let actual = actual
        .canonicalize()
        .map_err(|_| CookieStoreError::Profile)?;
    let expected = expected
        .canonicalize()
        .map_err(|_| CookieStoreError::Profile)?;
    if actual != expected {
        return Err(CookieStoreError::Profile);
    }
    let profile = view
        .cast::<ICoreWebView2_13>()
        .map_err(|_| CookieStoreError::Unsupported)?
        .Profile()
        .map_err(|_| CookieStoreError::Unavailable)?;
    let name = owned_string(|p| profile.ProfileName(p))?;
    let mut private = Default::default();
    profile
        .IsInPrivateModeEnabled(&mut private)
        .map_err(|_| CookieStoreError::Unavailable)?;
    if name != "Default" || private.as_bool() {
        return Err(CookieStoreError::Profile);
    }
    Ok(())
}

async fn call(
    view: &Webview,
    profile: &str,
    method: &'static str,
    parameters: Value,
) -> Result<Value> {
    if !view.label().starts_with("misty-browser-") {
        return Err(CookieStoreError::Profile);
    }
    super::browser_profile::data_store_identifier(Some(profile))
        .map_err(|_| CookieStoreError::Profile)?;
    let expected = super::browser::browser_data_directory(view.app_handle(), Some(profile))
        .map_err(|_| CookieStoreError::Profile)?;
    let parameters =
        Zeroizing::new(serde_json::to_string(&parameters).map_err(|_| CookieStoreError::Invalid)?);
    if parameters.len() > 16 * 1024 * 1024 {
        return Err(CookieStoreError::TooLarge);
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Arc::new(Mutex::new(Some(send)));
    view.with_webview(move |platform| unsafe {
        let begin = (|| -> Result<()> {
            let native = platform
                .controller()
                .CoreWebView2()
                .map_err(|_| CookieStoreError::Unavailable)?;
            verify_profile(&native, &expected)?;
            let reply = send.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, payload| {
                    let payload = Zeroizing::new(payload);
                    let result = if status.is_err() {
                        Err(CookieStoreError::Unavailable)
                    } else if payload.len() > 16 * 1024 * 1024 {
                        Err(CookieStoreError::TooLarge)
                    } else {
                        serde_json::from_str::<Value>(&payload)
                            .map_err(|_| CookieStoreError::Invalid)
                            .and_then(|value| {
                                if value.get("error").is_some() {
                                    Err(CookieStoreError::Unavailable)
                                } else {
                                    Ok(value)
                                }
                            })
                    };
                    if let Some(send) = reply.lock().ok().and_then(|mut value| value.take()) {
                        let _ = send.send(result);
                    }
                    Ok(())
                },
            ));
            native
                .CallDevToolsProtocolMethod(
                    &HSTRING::from(method),
                    &HSTRING::from(parameters.as_str()),
                    &handler,
                )
                .map_err(|_| CookieStoreError::Unavailable)?;
            Ok(())
        })();
        if let Err(error) = begin {
            if let Some(send) = send.lock().ok().and_then(|mut value| value.take()) {
                let _ = send.send(Err(error));
            }
        }
    })
    .map_err(|_| CookieStoreError::Unavailable)?;
    tokio::time::timeout(Duration::from_secs(15), receive)
        .await
        .map_err(|_| CookieStoreError::Timeout)?
        .map_err(|_| CookieStoreError::Unavailable)?
}

pub(crate) async fn read(view: &Webview, profile: &str) -> Result<Vec<Cookie>> {
    codec::decode(call(view, profile, "Storage.getCookies", json!({})).await?)
}
pub(crate) async fn preflight(view: &Webview, profile: &str, target: Vec<Cookie>) -> Result<()> {
    for cookie in &target {
        codec::encode(cookie)?;
    }
    // Verify actual profile and read capability without mutating the store.
    read(view, profile).await?;
    Ok(())
}
pub(crate) async fn write(
    view: &Webview,
    profile: &str,
    cookie: Cookie,
    delete: bool,
) -> Result<()> {
    let (method, parameters) = if delete {
        ("Network.deleteCookies", codec::deletion(&cookie)?)
    } else {
        (
            "Storage.setCookies",
            json!({ "cookies": [codec::encode(&cookie)?] }),
        )
    };
    call(view, profile, method, parameters).await?;
    Ok(())
}

/// Only fixed native website-storage code uses this method; it is not an IPC command.
pub(super) async fn evaluate_storage(view: &Webview, profile: &str, body: String) -> Result<String> {
    let result = call(view, profile, "Runtime.evaluate", json!({
        "expression": format!("(async()=>{{{body}}})()"), "awaitPromise": true, "returnByValue": true,
    })).await?;
    if result.get("exceptionDetails").is_some() { return Err(CookieStoreError::Unsupported); }
    result["result"]["value"].as_str().map(str::to_owned).ok_or(CookieStoreError::Invalid)
}
