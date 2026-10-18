//! What a browser tab asks of its Space's extensions: agent actions, store
//! pages' install and remove buttons, the context menu and view swaps.
use super::*;

/// An extension ID in an agent's tool input. Agents once sent Firefox
/// Add-ons IDs as numbers; Chrome Web Store IDs are always strings.
pub(crate) fn agent_extension_id(value: &Value) -> Option<String> {
    let id = match value {
        Value::Number(number) => number.as_u64()?.to_string(),
        Value::String(text) => text.clone(),
        _ => return None,
    };
    catalog::Store::of(&id).map(|_| id)
}

/// The Space a browser tab belongs to.
fn tab_space(tab: &str) -> Result<String, String> {
    native::app()
        .and_then(|app| native::page_space(app, tab))
        .ok_or_else(|| "This tab is closed.".into())
}

// Called only after the browser service has validated the agent's live grant.
pub(crate) async fn agent_action(
    operation: &str,
    id: Option<String>,
    tab: &str,
    script: Option<String>,
) -> Result<Value, String> {
    // The tab's own Space answers: its extensions and its agent access.
    let space = tab_space(tab)?;
    let state = service(&space).lock().await;
    if !state.agent_access {
        return Err("Agent access to extensions is disabled.".into());
    }
    let allowed = state
        .desired
        .values()
        .filter(|v| v.installed && v.enabled && v.agent_access)
        .map(|v| v.id.clone())
        .collect::<Vec<_>>();
    if id.as_ref().is_some_and(|id| !allowed.contains(id)) {
        return Err("Agent access to this extension is disabled.".into());
    }
    let account = state.account.clone();
    drop(state);
    let mut value = native::request(
        json!({"operation":operation,"account":account,"space":space,"id":id,"tabId":tab,"script":script}),
    )
    .await?;
    let state = service(&space).lock().await;
    if state.account != account
        || !state.agent_access
        || id.as_ref().is_some_and(|id| {
            !state
                .desired
                .get(id)
                .is_some_and(|v| v.installed && v.enabled && v.agent_access)
        })
    {
        return Err("Agent extension access was revoked.".into());
    }
    if let Some(actions) = value["actions"].as_array_mut() {
        actions.retain(|action| {
            action["id"].as_str().is_some_and(|id| {
                state
                    .desired
                    .get(id)
                    .is_some_and(|v| v.installed && v.enabled && v.agent_access)
            })
        });
    }
    Ok(value)
}
pub(crate) async fn authorize_agent_url(url: &url::Url) -> Result<(), String> {
    if url.scheme() != EXTENSION_SCHEME {
        return Ok(());
    }
    for space in spaces_running() {
        let state = service(&space).lock().await;
        if state.agent_access
            && state.desired.values().any(|v| {
                v.installed
                    && v.enabled
                    && v.agent_access
                    && url.host_str().is_some_and(|host| {
                        page_host(&installation_origin(&state.account, &v.guid)).as_deref()
                            == Some(host)
                    })
            })
        {
            return Ok(());
        }
    }
    Err("Agent access to this extension is disabled.".into())
}

pub(crate) fn is_chrome_store_id(value: &str) -> bool {
    catalog::is_chrome_id(value)
}

/// "Add to Misty" on a store page: Misty's window opens the install review
/// for `key`, a Chrome Web Store ID or Firefox Add-ons slug read from the
/// tab's own address.
pub(crate) async fn request_store_install(app: &tauri::AppHandle, tab: &str, key: &str) {
    // The store page's own Space installs it.
    let Ok(space) = tab_space(tab) else { return };
    let account = service(&space).lock().await.account.clone();
    crate::infra::space_windows::emit_to_space(
        app,
        &space,
        "misty://extensions",
        json!({"kind":"store-install","account":account,"space":space,"id":key}),
    );
}

/// The installed extension a store page shows, if any. Firefox Add-ons pages
/// name a slug, which the store resolves to its ID once per slug.
pub(crate) async fn store_installation(tab: &str, key: &str) -> Option<String> {
    let space = tab_space(tab).ok()?;
    fn slugs() -> &'static std::sync::Mutex<BTreeMap<String, String>> {
        static SLUGS: OnceLock<std::sync::Mutex<BTreeMap<String, String>>> = OnceLock::new();
        SLUGS.get_or_init(Default::default)
    }
    // A statement of its own, so the cache lock is released before any lookup.
    let cached = slugs().lock().ok()?.get(key).cloned();
    let id = if catalog::Store::of(key) == Some(catalog::Store::Chrome) {
        key.to_owned()
    } else if let Some(id) = cached {
        id
    } else {
        let id = catalog::latest(key).await.ok()?.id;
        slugs().lock().ok()?.insert(key.to_owned(), id.clone());
        id
    };
    let state = service(&space).lock().await;
    state
        .desired
        .get(&id)
        .filter(|item| item.installed)
        .map(|item| item.id.clone())
}

/// "Remove from Misty" on a store page: Misty's window asks before removing.
pub(crate) async fn request_store_remove(app: &tauri::AppHandle, tab: &str, key: &str) {
    let Some(id) = store_installation(tab, key).await else {
        return;
    };
    let Ok(space) = tab_space(tab) else { return };
    let account = service(&space).lock().await.account.clone();
    crate::infra::space_windows::emit_to_space(
        app,
        &space,
        "misty://extensions",
        json!({"kind":"store-remove","account":account,"space":space,"id":id}),
    );
}

pub(crate) async fn pending_navigation(space: &str, tab: &str) -> bool {
    let account = service(space).lock().await.account.clone();
    if account.is_empty() {
        return false;
    }
    native::request(
        json!({"operation":"pending-navigation","account":account,"space":space,"tabId":tab}),
    )
    .await
    .is_ok_and(|v| v["pending"] == true)
}

pub(crate) fn has_extensions() -> bool {
    origins().read().is_ok_and(|v| !v.is_empty())
}
pub(crate) async fn context_menu(tab: &str, agent: bool) -> Result<Value, String> {
    let space = tab_space(tab)?;
    let state = service(&space).lock().await;
    let account = state.account.clone();
    let allowed: Vec<String> = state
        .desired
        .values()
        .filter(|v| v.installed && v.enabled && (!agent || (state.agent_access && v.agent_access)))
        .map(|v| v.id.clone())
        .collect();
    drop(state);
    native::request(
        json!({"operation":"context-menu","account":account,"space":space,"tabId":tab,"allowedIds":allowed}),
    )
    .await
}
