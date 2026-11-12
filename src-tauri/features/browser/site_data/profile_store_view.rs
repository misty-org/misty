//! A hidden, off-screen page in one website data store. Native code uses it to
//! reach a store's cookies and cached data when none of its tabs is open.
use tauri::Webview;

/// Opens a hidden `about:blank` page in `store` (the original store when
/// `None`). The caller closes it; [`StoreView`] does so on drop.
// Windows reaches store data through it.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn open_hidden_store_view(
    app: &tauri::AppHandle,
    store: Option<&str>,
) -> Result<Webview, String> {
    // Any app window can hold the off-screen page; the store, not the window,
    // decides whose data it reaches.
    let owner = crate::browser::app_windows::primary(app).ok_or("No Misty window is open")?;
    let builder = tauri::WebviewBuilder::new(
        format!("misty-browser-capture-{}", uuid::Uuid::new_v4()),
        tauri::WebviewUrl::External("about:blank".parse().map_err(|_| "Invalid capture URL")?),
    )
    .focused(false);
    #[cfg(target_os = "macos")]
    let builder =
        builder.data_store_identifier(super::profile_store::data_store_identifier(store)?);
    #[cfg(windows)]
    let builder = crate::browser::with_store_data(builder, app, store)?;
    let _creating = crate::browser::pages::creation_guard::Creating::enter();
    let view = owner
        .add_child(
            builder,
            tauri::LogicalPosition::new(-10000., -10000.),
            tauri::LogicalSize::new(1., 1.),
        )
        .map_err(|_| "Could not open a hidden page for that profile")?;
    if view.hide().is_err() {
        let _ = view.close();
        return Err("Could not hide the profile's page".into());
    }
    Ok(view)
}

/// A hidden store page that closes when dropped (Windows reaches store data through one).
#[cfg(windows)]
pub(crate) struct StoreView(Webview);

#[cfg(windows)]
impl StoreView {
    pub(crate) fn open(app: &tauri::AppHandle, store: Option<&str>) -> Result<Self, String> {
        open_hidden_store_view(app, store).map(Self)
    }
}

#[cfg(windows)]
impl std::ops::Deref for StoreView {
    type Target = Webview;

    fn deref(&self) -> &Webview {
        &self.0
    }
}

#[cfg(windows)]
impl Drop for StoreView {
    fn drop(&mut self) {
        let _ = self.0.close();
    }
}
