//! A profile's browser store, however each engine reaches it. WebKit opens a store by its
//! identifier, so on the Mac nothing has to exist to read one. WebView2 needs a page of the
//! profile: one of its tabs when there is one, or else a hidden helper, which is checked on every
//! use since the window holding it can close at any time.
use crate::browser::app_windows;
use crate::browser::site_data::profile_store::original_store_identity;
use crate::browser::site_data::website_data::cookie_store::{self, CookieStoreError};
use crate::browser::site_data::website_data::coverage::CookieRead;
use browser_data::document::credentials::Cookie;
use tauri::{AppHandle, Webview};

pub(super) use cookie_store::SAME_SITE_NONE_IS_UNSPECIFIED as CONFLATES_NONE;

/// Which native store a profile's pages open in. Fixed for the life of an account, and looked up
/// once: asking the registry saves its file.
#[derive(Clone)]
pub(super) struct Store {
    /// `None` is this computer's original store.
    #[cfg(windows)]
    pub store: Option<String>,
    pub identity: String,
}

impl Store {
    pub fn for_profile(profile: &str) -> Option<Self> {
        let store = app_windows::store_for_profile(profile).ok()?;
        Some(Self {
            identity: store.clone().unwrap_or_else(original_store_identity),
            #[cfg(windows)]
            store,
        })
    }
}

/// The profile's open pages.
pub(super) fn tabs(app: &AppHandle, store: &Store) -> Vec<Webview> {
    crate::browser::sync_storage_views(app, &store.identity)
        .unwrap_or_default()
        .into_iter()
        .map(|(_, view)| view)
        .collect()
}

/// A write the engine will never accept, as opposed to one that didn't get there this time.
pub(super) fn is_refusal(error: CookieStoreError) -> bool {
    matches!(
        error,
        CookieStoreError::Unsupported | CookieStoreError::Invalid
    )
}

#[cfg(target_os = "macos")]
pub(super) async fn read(app: &AppHandle, store: &Store) -> Result<CookieRead, CookieStoreError> {
    cookie_store::read(app, &store.identity).await
}

#[cfg(target_os = "macos")]
pub(super) async fn write(
    app: &AppHandle,
    store: &Store,
    cookie: Cookie,
    delete: bool,
) -> Result<(), CookieStoreError> {
    cookie_store::write(app, &store.identity, cookie, delete).await
}

/// Nothing is kept open on the Mac.
#[cfg(target_os = "macos")]
pub(super) fn release_helpers() {}

#[cfg(windows)]
mod helper {
    use super::*;
    use crate::browser::site_data::profile_store_view::StoreView;
    use std::collections::BTreeMap;
    use std::sync::Mutex;
    use tauri::Manager;

    /// Hidden helpers by store, closed when the account changes or their profile closes.
    static HELPERS: Mutex<BTreeMap<String, StoreView>> = Mutex::new(BTreeMap::new());

    pub(super) fn view(app: &AppHandle, store: &Store) -> Result<Webview, CookieStoreError> {
        if let Some(view) = tabs(app, store).into_iter().next() {
            return Ok(view);
        }
        let mut helpers = HELPERS.lock().map_err(|_| CookieStoreError::Unavailable)?;
        if let Some(view) = helpers.get(&store.identity) {
            // The window holding it may have closed, taking the view with it.
            if app.get_webview(view.label()).is_some() {
                return Ok((**view).clone());
            }
            helpers.remove(&store.identity);
        }
        let opened = StoreView::open(app, store.store.as_deref())
            .map_err(|_| CookieStoreError::Unavailable)?;
        let view = (*opened).clone();
        helpers.insert(store.identity.clone(), opened);
        Ok(view)
    }

    pub(super) fn release() {
        if let Ok(mut helpers) = HELPERS.lock() {
            helpers.clear();
        }
    }
}

#[cfg(windows)]
pub(super) async fn read(app: &AppHandle, store: &Store) -> Result<CookieRead, CookieStoreError> {
    let view = helper::view(app, store)?;
    cookie_store::read(&view, &store.identity).await
}

#[cfg(windows)]
pub(super) async fn write(
    app: &AppHandle,
    store: &Store,
    cookie: Cookie,
    delete: bool,
) -> Result<(), CookieStoreError> {
    let view = helper::view(app, store)?;
    cookie_store::write(&view, &store.identity, cookie, delete).await
}

#[cfg(windows)]
pub(super) fn release_helpers() {
    helper::release();
}
