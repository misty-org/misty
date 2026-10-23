//! "Add to Misty" on the Chrome Web Store and Firefox Add-ons. People find
//! extensions on the stores' own sites; the page script there adds the button
//! and reports a click. Its message names no extension: Misty reads the
//! extension from the tab's real address, downloads it from the store itself
//! and opens the install review in Misty's own window, where nothing the page
//! runs can reach.
use super::super::*;
use std::collections::HashMap;

/// Handles `misty-extension-store:` messages from the page script. Returns
/// whether the message was one.
pub(super) fn forward(app: &AppHandle, id: &str, url: &Url) -> bool {
    if url.scheme() != "misty-extension-store" {
        return false;
    }
    let values: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let Some(state) = app.try_state::<BrowserSessionState>() else {
        return true;
    };
    let token = values.get("token").map(String::as_str).unwrap_or("");
    if !shortcut_token_matches(&state, id, token) {
        return true;
    }
    let Some(extension) = page_extension(app, id) else {
        return true;
    };
    let app = app.clone();
    let id = id.to_owned();
    match url.path() {
        "install" => {
            tauri::async_runtime::spawn(async move {
                crate::infra::extensions::request_store_install(&app, &id, &extension).await;
            });
        }
        "remove" => {
            tauri::async_runtime::spawn(async move {
                crate::infra::extensions::request_store_remove(&app, &id, &extension).await;
            });
        }
        // Whether the page's extension is installed, so its button can offer
        // removal. The page learns only that, and only for the extension it shows.
        "state" => {
            tauri::async_runtime::spawn(async move {
                let installed = crate::infra::extensions::store_installation(&id, &extension)
                    .await
                    .is_some();
                if page_extension(&app, &id).as_deref() != Some(&extension) {
                    return;
                }
                if let Some(view) = webview_label(&id)
                    .ok()
                    .and_then(|label| app.get_webview(&label))
                {
                    let _ = view.eval(format!("window.__MISTY_EXTENSION_STORE__?.({installed});"));
                }
            });
        }
        _ => {}
    }
    true
}

fn page_extension(app: &AppHandle, id: &str) -> Option<String> {
    let page = webview_label(id)
        .ok()
        .and_then(|label| app.get_webview(&label))?
        .url()
        .ok()?;
    store_extension(&page)
}

/// The extension a store page shows: a Chrome Web Store ID, or a Firefox
/// Add-ons slug.
pub(super) fn store_extension(page: &Url) -> Option<String> {
    if page.scheme() != "https" || page.port().is_some() || !page.username().is_empty() {
        return None;
    }
    let segments: Vec<&str> = page.path_segments()?.collect();
    match page.host_str()? {
        "chromewebstore.google.com" => {
            // /detail/<slug>/<id> or /detail/<id>
            if segments.first() != Some(&"detail") {
                return None;
            }
            segments[1..]
                .iter()
                .take(2)
                .find(|segment| crate::infra::extensions::is_chrome_store_id(segment))
                .map(|id| (*id).to_owned())
        }
        // Firefox Add-ons is not offered: Misty's one extension standard is
        // Chrome (Manifest V3), so only Chrome Web Store pages are read.
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extension(url: &str) -> Option<String> {
        store_extension(&Url::parse(url).unwrap())
    }

    #[test]
    fn reads_the_extension_from_store_addresses_only() {
        assert_eq!(
            extension("https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh?hl=en").as_deref(),
            Some("ddkjiahejlhfcafbddmgiahcphecmpfh")
        );
        assert_eq!(
            extension("https://chromewebstore.google.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh")
                .as_deref(),
            Some("ddkjiahejlhfcafbddmgiahcphecmpfh")
        );
        for url in [
            "https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/",
            "https://addons.mozilla.org/firefox/addon/darkreader/reviews/",
            "https://chromewebstore.google.com/category/extensions",
            "https://chromewebstore.google.com/detail/slug/notanid",
            "http://chromewebstore.google.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "https://chromewebstore.google.com.evil.test/detail/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "https://evil.test/detail/ddkjiahejlhfcafbddmgiahcphecmpfh",
            "https://addons.mozilla.org/en-US/android/addon/ublock-origin/",
            "https://addons.mozilla.org/en-US/firefox/",
            "https://addons.mozilla.org/en-US/firefox/addon/",
        ] {
            assert_eq!(extension(url), None, "{url}");
        }
    }
}
