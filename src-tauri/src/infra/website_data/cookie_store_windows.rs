//! WebView2 cookie transport. CDP is invoked in the native process, never exposed
//! as renderer IPC. Every call validates the real user-data folder and profile.
use super::super::webview2::{self, CdpError};
use super::cookie_cdp as codec;
use super::coverage::CookieRead;
pub(crate) use codec::{representable, CookieStoreError};
use misty_browser_sync::document::credentials::Cookie;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{Manager, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Environment7, ICoreWebView2_13, ICoreWebView2_2,
};
use windows::core::Interface;

type Result<T> = std::result::Result<T, CookieStoreError>;
/// CDP reports unspecified and explicit SameSite=None separately.
pub(crate) const SAME_SITE_NONE_IS_UNSPECIFIED: bool = false;

impl From<CdpError> for CookieStoreError {
    fn from(error: CdpError) -> Self {
        match error {
            CdpError::Unavailable => Self::Unavailable,
            CdpError::Timeout => Self::Timeout,
            CdpError::TooLarge => Self::TooLarge,
            CdpError::Invalid => Self::Invalid,
        }
    }
}

/// The view must use `expected` as its user-data folder and its default,
/// non-private profile, so a cookie can never cross into another profile.
unsafe fn verify_profile(view: &ICoreWebView2, expected: &Path) -> Result<()> {
    let extended = view
        .cast::<ICoreWebView2_2>()
        .map_err(|_| CookieStoreError::Unsupported)?;
    let environment = extended
        .Environment()
        .map_err(|_| CookieStoreError::Unavailable)?
        .cast::<ICoreWebView2Environment7>()
        .map_err(|_| CookieStoreError::Unsupported)?;
    let actual = webview2::owned_string(|p| environment.UserDataFolder(p))
        .map(PathBuf::from)
        .ok_or(CookieStoreError::Unavailable)?;
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
    let name =
        webview2::owned_string(|p| profile.ProfileName(p)).ok_or(CookieStoreError::Unavailable)?;
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
    super::super::browser_profile::data_store_identifier(Some(profile))
        .map_err(|_| CookieStoreError::Profile)?;
    let expected = super::super::browser::browser_data_directory(view.app_handle(), Some(profile))
        .map_err(|_| CookieStoreError::Profile)?;
    // SAFETY: runs on the view's UI thread with its live WebView2 object.
    webview2::with_core(view, move |core, _| {
        Ok(unsafe { verify_profile(core, &expected) })
    })
    .await??;
    Ok(webview2::cdp(view, method, &parameters).await?)
}

pub(crate) async fn read(view: &Webview, profile: &str) -> Result<CookieRead> {
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
pub(super) async fn evaluate_storage(
    view: &Webview,
    profile: &str,
    body: String,
) -> Result<String> {
    let result = call(view, profile, "Runtime.evaluate", json!({
        "expression": format!("(async()=>{{{body}}})()"), "awaitPromise": true, "returnByValue": true,
    })).await?;
    if result.get("exceptionDetails").is_some() {
        return Err(CookieStoreError::Unsupported);
    }
    result["result"]["value"]
        .as_str()
        .map(str::to_owned)
        .ok_or(CookieStoreError::Invalid)
}
