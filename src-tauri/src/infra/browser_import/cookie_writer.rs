//! Writes imported sign-ins into one Misty browser profile's cookie store,
//! through the native transport that is never reachable from the renderer.
use misty_browser_sync::document::credentials::Cookie;
use tauri::AppHandle;

/// On macOS the profile's WebKit store is opened by its identifier, so no tab
/// has to be open. Cookies the engine cannot represent exactly are skipped.
#[cfg(target_os = "macos")]
pub async fn write(
    app: &AppHandle,
    profile: Option<&str>,
    cookies: Vec<Cookie>,
) -> Result<usize, String> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSProcessInfo, NSUUID};
    use objc2_web_kit::WKWebsiteDataStore;
    use std::sync::Mutex;
    if NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        < 14
    {
        return Err("Importing sign-ins needs macOS 14 or later.".into());
    }
    let identifier = super::super::browser_profile::data_store_identifier(profile)?;
    let (sender, receiver) = tokio::sync::oneshot::channel::<usize>();
    app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("main thread");
        unsafe {
            let store =
                WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(identifier), mtm);
            let cookie_store = store.httpCookieStore();
            let natives: Vec<_> = cookies
                .iter()
                .filter_map(|cookie| super::super::browser_cookie_store::import_cookie(cookie).ok())
                .collect();
            let total = natives.len();
            if total == 0 {
                let _ = sender.send(0);
                return;
            }
            let pending = std::rc::Rc::new(Mutex::new((total, Some(sender))));
            for native in natives {
                let pending = pending.clone();
                let keep = store.clone();
                let handler = RcBlock::new(move || {
                    let _store = &keep;
                    if let Ok(mut state) = pending.lock() {
                        state.0 -= 1;
                        if state.0 == 0 {
                            if let Some(sender) = state.1.take() {
                                let _ = sender.send(total);
                            }
                        }
                    }
                });
                cookie_store.setCookie_completionHandler(&native, Some(&handler));
            }
        }
    })
    .map_err(|_| "Misty could not reach the browser profile.".to_owned())?;
    tokio::time::timeout(std::time::Duration::from_secs(120), receiver)
        .await
        .map_err(|_| "Saving sign-ins took too long. Try again.".to_owned())?
        .map_err(|_| "Saving sign-ins stopped unexpectedly.".to_owned())
}

/// WebView2 writes through an open browser tab of the same profile.
#[cfg(windows)]
pub async fn write(
    app: &AppHandle,
    profile: Option<&str>,
    cookies: Vec<Cookie>,
) -> Result<usize, String> {
    use super::super::browser_cookie_store::{self as store, CookieStoreError};
    use tauri::Manager;
    let profile = profile
        .map(str::to_owned)
        .unwrap_or_else(super::super::browser_profile::legacy_profile_identity);
    for (label, view) in app.webviews() {
        if !label.starts_with("misty-browser-") {
            continue;
        }
        let mut written = 0;
        let mut matched = false;
        for cookie in &cookies {
            match store::write(&view, &profile, cookie.clone(), false).await {
                Ok(()) => {
                    written += 1;
                    matched = true;
                }
                // Another profile's tab: try the next one.
                Err(CookieStoreError::Profile) if !matched => break,
                Err(_) => {}
            }
        }
        if matched {
            return Ok(written);
        }
    }
    Err("Open a browser tab in Misty, then import sign-ins again.".into())
}

#[cfg(all(unix, not(target_os = "macos")))]
pub async fn write(
    _app: &AppHandle,
    _profile: Option<&str>,
    _cookies: Vec<Cookie>,
) -> Result<usize, String> {
    Err("Sign-ins can't be imported on Linux yet.".into())
}
