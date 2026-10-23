//! Search engines and bangs as Space data: the default engine, custom engines
//! and custom `!bangs` live in the `search` collection of the window's Space.
//! Whether typed text goes out for suggestions stays a device setting.
#[cfg(desktop)]
mod vault;
#[cfg(desktop)]
pub(crate) use vault::seed_records;

/// The window's Space's search settings, after replacing its custom bangs when
/// `bangs` is given. None while no Space vault is open (sync off or locked):
/// the device's own values apply, and bangs cannot be saved to a Space.
#[tauri::command]
pub async fn browser_space_search(
    webview: tauri::Webview,
    bangs: Option<Vec<serde_json::Value>>,
) -> Result<Option<serde_json::Value>, String> {
    #[cfg(desktop)]
    {
        let label = webview.window().label().to_owned();
        if let Some(bangs) = bangs {
            let bangs = bangs
                .into_iter()
                .map(serde_json::from_value)
                .collect::<Result<_, _>>()
                .map_err(|_| "Check the shortcut's name and search address.".to_owned())?;
            vault::set_bangs(&label, bangs).await?;
        }
        let search = vault::read_space(&label).await?;
        search
            .map(|search| serde_json::to_value(search).map_err(|error| error.to_string()))
            .transpose()
    }
    #[cfg(not(desktop))]
    {
        let _ = (webview, bangs);
        Ok(None)
    }
}
