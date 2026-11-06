//! Search engines and bangs as profile data: the default engine, custom engines and custom
//! `!bangs` live in the `search` collection of the window's profile. Whether typed text goes out
//! for suggestions stays a device setting.
#[cfg(desktop)]
mod records;
#[cfg(desktop)]
pub(crate) use records::seed_records;

/// The window's profile's search settings, after replacing its custom bangs when `bangs` is
/// given. None while this computer's key storage isn't answering: the defaults apply, and bangs
/// cannot be saved.
#[tauri::command]
pub async fn browser_profile_search(
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
            records::set_bangs(&label, bangs).await?;
        }
        let search = records::read_profile(&label).await?;
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
