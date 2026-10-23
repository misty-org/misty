//! A hidden, off-screen page in one website profile. Native code uses it to
//! reach a profile's engine store (cookies, cached data) when no tab of that
//! profile is open.
use tauri::Webview;

/// Opens a hidden `about:blank` page in `profile` (the default profile when
/// `None`). The caller closes it; [`ProfileView`] does so on drop.
pub(crate) fn open_hidden_profile_view(
    app: &tauri::AppHandle,
    profile: Option<&str>,
) -> Result<Webview, String> {
    // Any Space window can hold the off-screen page; the store, not the window,
    // decides whose data it reaches.
    let owner = crate::infra::space_windows::primary(app).ok_or("No Space window is open")?;
    let builder = tauri::WebviewBuilder::new(
        format!("misty-browser-capture-{}", uuid::Uuid::new_v4()),
        tauri::WebviewUrl::External("about:blank".parse().map_err(|_| "Invalid capture URL")?),
    )
    .focused(false);
    #[cfg(target_os = "macos")]
    let builder =
        builder.data_store_identifier(super::browser_profile::data_store_identifier(profile)?);
    #[cfg(windows)]
    let builder = super::browser::with_browser_data(builder, app, profile)?;
    let _creating = super::browser::creation_guard::Creating::enter();
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

/// A hidden profile page that closes when dropped (Windows reaches profile data through one).
#[cfg(windows)]
pub(crate) struct ProfileView(Webview);

#[cfg(windows)]
impl ProfileView {
    pub(crate) fn open(app: &tauri::AppHandle, profile: Option<&str>) -> Result<Self, String> {
        open_hidden_profile_view(app, profile).map(Self)
    }
}

#[cfg(windows)]
impl std::ops::Deref for ProfileView {
    type Target = Webview;

    fn deref(&self) -> &Webview {
        &self.0
    }
}

#[cfg(windows)]
impl Drop for ProfileView {
    fn drop(&mut self) {
        let _ = self.0.close();
    }
}
