//! An extension's toolbar actions in a tab: which may run there, and opening their pages.
use super::*;

fn may_use(host: &Host, loaded: &Loaded, tab: Option<&str>) -> bool {
    loaded.private_access || !tab.is_some_and(|tab| host.private_tabs.contains(tab))
}

pub(super) fn actions(host: &Host, tab: Option<&str>) -> Value {
    let actions: Vec<Value> = host
        .loaded
        .iter()
        .map(|(id, loaded)| {
            let action = action_of(&loaded.manifest);
            let title = action["default_title"]
                .as_str()
                .or_else(|| loaded.manifest["name"].as_str())
                .unwrap_or_default();
            json!({
                "id": id,
                "title": localized(loaded, title),
                "badge": "",
                "enabled": may_use(host, loaded, tab) && page_host(&loaded.origin).is_some(),
                "icon": icon(loaded),
            })
        })
        .collect();
    json!({"actions": actions})
}

fn page_url(loaded: &Loaded, page: &str) -> Result<String, String> {
    let crx = page_host(&loaded.origin).ok_or("Open a browser tab, then try again.")?;
    inside(&loaded.folder, page).ok_or("This extension's page is invalid.")?;
    Ok(format!(
        "{}://{crx}/{}",
        super::super::EXTENSION_SCHEME,
        page.trim_start_matches('/')
    ))
}

pub(super) fn invoke(host: &Host, id: &str, tab: Option<&str>) -> Result<Value, String> {
    let loaded = host
        .loaded
        .get(id)
        .ok_or("This extension is not running.")?;
    if !may_use(host, loaded, tab) {
        return Err("This extension cannot access the current tab.".into());
    }
    let popup = action_of(&loaded.manifest)["default_popup"]
        .as_str()
        .filter(|page| !page.is_empty())
        .ok_or(
            "This extension's button has no popup, and Windows can't run its click action yet.",
        )?;
    let url = page_url(loaded, popup)?;
    emit(
        host,
        "open-window",
        json!({"urls": [url], "popup": true, "focused": true, "private": false}),
    );
    Ok(json!({}))
}

pub(super) fn options(host: &Host, id: &str) -> Result<Value, String> {
    let loaded = host
        .loaded
        .get(id)
        .ok_or("This extension is not running.")?;
    let page = loaded.manifest["options_ui"]["page"]
        .as_str()
        .or_else(|| loaded.manifest["options_page"].as_str())
        .ok_or("This extension has no options page.")?;
    let url = page_url(loaded, page)?;
    emit(host, "open-tab", json!({"url": url, "private": false}));
    Ok(json!({}))
}
