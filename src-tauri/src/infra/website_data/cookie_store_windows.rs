//! WebView2 cookie transport. CDP is invoked in the native process, never exposed
//! as renderer IPC. Every call validates the real user-data folder and profile.
use super::super::webview2::{self, CdpError};
use super::cookie_cdp as codec;
use super::coverage::CookieRead;
pub(crate) use codec::CookieStoreError;
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

/// Says in a debug build which check refused a view. Folders hold no cookie or site detail.
fn wrong_store(check: &str) -> CookieStoreError {
    if cfg!(debug_assertions) {
        eprintln!("[site-data] wrong store: {check}");
    }
    CookieStoreError::Profile
}

/// The view must use `expected` as its user-data folder and not be private, so a cookie can never
/// cross into another profile. A folder holds one profile: Misty never names a second.
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
    let actual = crate::infra::file_access::fs::canonicalize(&actual)
        .map_err(|_| wrong_store(&format!("can't resolve the view's folder {actual:?}")))?;
    let expected = crate::infra::file_access::fs::canonicalize(&expected)
        .map_err(|_| wrong_store(&format!("can't resolve the profile's folder {expected:?}")))?;
    if actual != expected {
        return Err(wrong_store(&format!(
            "the view uses {actual:?}, the profile is {expected:?}"
        )));
    }
    let profile = view
        .cast::<ICoreWebView2_13>()
        .map_err(|_| CookieStoreError::Unsupported)?
        .Profile()
        .map_err(|_| CookieStoreError::Unavailable)?;
    let mut private = Default::default();
    profile
        .IsInPrivateModeEnabled(&mut private)
        .map_err(|_| CookieStoreError::Unavailable)?;
    if private.as_bool() {
        return Err(wrong_store("the view is private"));
    }
    Ok(())
}

/// A view may only be used on the profile it really belongs to.
pub(crate) async fn verify_storage_profile(view: &Webview, profile: &str) -> Result<()> {
    if !view.label().starts_with("misty-browser-") {
        return Err(wrong_store("not a browser view"));
    }
    super::super::browser_profile::data_store_identifier(Some(profile))
        .map_err(|_| wrong_store("not a store identity"))?;
    let expected = super::super::browser::browser_data_directory(view.app_handle(), Some(profile))
        .map_err(|_| wrong_store("no folder for this store"))?;
    // SAFETY: runs on the view's UI thread with its live WebView2 object.
    webview2::with_core(view, move |core, _| {
        Ok(unsafe { verify_profile(core, &expected) })
    })
    .await??;
    Ok(())
}

async fn call(
    view: &Webview,
    profile: &str,
    method: &'static str,
    parameters: Value,
) -> Result<Value> {
    verify_storage_profile(view, profile).await?;
    Ok(webview2::cdp(view, method, &parameters).await?)
}

/// Network.* is answered by the view's own store, the one its pages use. Storage.* with no
/// context named is answered by whatever the browser calls its default, so it's only the fallback.
pub(crate) async fn read(view: &Webview, profile: &str) -> Result<CookieRead> {
    let cookies = match call(view, profile, "Network.getAllCookies", json!({})).await {
        Ok(cookies) => cookies,
        Err(_) => call(view, profile, "Storage.getCookies", json!({})).await?,
    };
    codec::decode(cookies)
}
pub(crate) async fn write(
    view: &Webview,
    profile: &str,
    cookie: Cookie,
    delete: bool,
) -> Result<()> {
    if delete {
        call(view, profile, "Network.deleteCookies", codec::deletion(&cookie)?).await?;
        return Ok(());
    }
    let cookies = json!({ "cookies": [codec::encode(&cookie)?] });
    if call(view, profile, "Network.setCookies", cookies.clone())
        .await
        .is_err()
    {
        call(view, profile, "Storage.setCookies", cookies).await?;
    }
    Ok(())
}
