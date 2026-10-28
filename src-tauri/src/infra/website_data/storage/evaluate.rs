//! Running the storage script in a page and reading its answer.
use super::*;

/// Reading another profile's store is never skipped past: it aborts capture.
pub(in crate::infra::website_data) const PROFILE_UNVERIFIED: &str =
    "Website profile could not be verified";

pub(in crate::infra::website_data) async fn evaluate(
    view: &Webview,
    physical: &str,
    origin: &str,
    write: Option<Value>,
) -> Result<Value, String> {
    evaluate_request(
        view,
        physical,
        origin,
        json!({"origin":origin, "write":write}),
    )
    .await
}

/// A periodic read: `read` names the areas wanted and `known` the stamps of
/// what the caller already holds. Areas whose stamp still matches come back
/// listed in `unchanged` instead of exported again.
pub(in crate::infra::website_data) async fn evaluate_read(
    view: &Webview,
    physical: &str,
    origin: &str,
    read: Value,
    known: Value,
) -> Result<Value, String> {
    evaluate_request(
        view,
        physical,
        origin,
        json!({"origin":origin, "write":null, "read":read, "known":known}),
    )
    .await
}

pub(super) async fn evaluate_request(
    view: &Webview,
    physical: &str,
    origin: &str,
    mut request: Value,
) -> Result<Value, String> {
    let url = view.url().map_err(|_| "Website storage is unavailable")?;
    if url.origin().ascii_serialization() != origin {
        return Err("Website navigated during sync".into());
    }
    // Verify the real store without the about:blank-only cookie-import guard.
    // WebView2 verifies its native profile inside evaluate_storage below.
    #[cfg(target_os = "macos")]
    super::super::cookie_store::verify_storage_profile(view, physical)
        .await
        .map_err(|_| PROFILE_UNVERIFIED)?;
    request["scope"] = super::super::signin_scope::page_scope();
    let request = serde_json::to_string(&request).map_err(|_| "Invalid website storage request")?;
    let script = SCRIPT.replace("__MISTY_STORAGE_REQUEST__", &request);
    #[cfg(target_os = "macos")]
    let raw =
        super::super::super::browser_macos::evaluate_browser_async_javascript(view.clone(), script)
            .await
            .map_err(|_| "This website's storage could not be transferred")?;
    #[cfg(windows)]
    let raw = super::super::cookie_store::evaluate_storage(view, physical, script)
        .await
        .map_err(|error| match error {
            super::super::cookie_store::CookieStoreError::Profile => PROFILE_UNVERIFIED,
            _ => "This website's storage could not be transferred",
        })?;
    let raw = zeroize::Zeroizing::new(raw);
    if raw.len() > 8 << 20 {
        return Err("Website storage exceeds the sync limit".into());
    }
    let value: Value = serde_json::from_str(&raw).map_err(|_| "Invalid website storage")?;
    if value["origin"].as_str() != Some(origin) {
        return Err("Website changed origin during sync".into());
    }
    Ok(value)
}
