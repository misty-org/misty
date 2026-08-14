use super::*;
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PageContext {
    url: String,
    document_revision: String,
    title: String,
    content: String,
    selection: bool,
    editable: bool,
    link: String,
    image: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskContext {
    id: String,
    scope_id: String,
    space_id: Option<String>,
    profile_id: Option<String>,
    provider_id: Option<String>,
    revision: String,
    content_hash: String,
    page: PageContext,
    intent: String,
}

pub(super) struct PendingMenu {
    key: String,
    created: std::time::Instant,
    context: AskContext,
    actions: Vec<String>,
}

pub(super) fn forward(app: &AppHandle, id: &str, url: &Url) -> bool {
    if url.scheme() != "misty-context-menu" {
        return false;
    }
    let values = url.query_pairs().collect::<HashMap<_, _>>();
    let Some(state) = app.try_state::<BrowserSessionState>() else {
        return true;
    };
    let token = values.get("token").map(|s| s.as_ref()).unwrap_or("");
    if !shortcut_token_matches(&state, id, token) {
        return true;
    }
    let raw = values.get("payload").map(|s| s.as_ref()).unwrap_or("");
    if raw.len() > 100_000 {
        return true;
    }
    let Ok(page) = serde_json::from_str::<PageContext>(raw) else {
        return true;
    };
    if page.content.chars().count() > 16000
        || page.title.chars().count() > 200
        || page.url.len() > 8192
        || page.document_revision.len() > 80
    {
        return true;
    }
    let Ok(label) = webview_label(id) else {
        return true;
    };
    let Some(view) = app.get_webview(&label) else {
        return true;
    };
    // The page can supply content, never the native scope, account, or Space.
    if view.url().ok().as_ref().map(Url::as_str) != Some(page.url.as_str())
        || external_url(&page.url).is_err()
    {
        return true;
    }
    for link in [&page.link, &page.image] {
        if !link.is_empty() && (link.len() > 8192 || external_url(link).is_err()) {
            return true;
        }
    }
    let context = {
        let Ok(sessions) = state.sessions.lock() else {
            return true;
        };
        let Some(session) = sessions.get(id) else {
            return true;
        };
        AskContext {
            id: id.to_owned(),
            scope_id: session.scope_id.clone(),
            space_id: session.origin_space_id.clone(),
            profile_id: session.context_profile_id().map(str::to_owned),
            provider_id: session.profile_provider.clone(),
            revision: page.document_revision.clone(),
            content_hash: format!("{:x}", Sha256::digest(page.content.as_bytes())),
            page,
            intent: "ask".into(),
        }
    };
    let app = app.clone();
    let dispatcher = app.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        let _ = show(&app, context);
    });
    true
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuPresentation {
    key: String,
    x: f64,
    y: f64,
    actions: Vec<String>,
}

/// Commands the owning browser workspace runs itself; the menu only names the page they target.
const WORKSPACE_COMMANDS: [&str; 7] = [
    "back",
    "forward",
    "reload",
    "bookmark",
    "qr-code",
    "annotate",
    "open-link-split",
];

fn menu_actions(context: &AskContext) -> Vec<String> {
    let page = &context.page;
    let mut actions = vec!["ask", "separator"];
    if !page.link.is_empty() {
        actions.extend(["open-link", "open-link-split", "copy-link", "separator"]);
    }
    if !page.image.is_empty() {
        actions.extend(["open-image", "copy-image-link", "separator"]);
    }
    if page.selection {
        actions.extend(["copy", "search-web"]);
    }
    if page.editable {
        if page.selection {
            actions.push("cut");
        }
        actions.push("paste");
    }
    // Page commands belong to the page itself, not to a link, image, or selection under the pointer.
    if !page.selection && !page.editable && page.link.is_empty() && page.image.is_empty() {
        actions.extend([
            "back",
            "forward",
            "reload",
            "separator",
            "bookmark",
            "copy-page-link",
            "qr-code",
            "separator",
            "annotate",
        ]);
    }
    #[cfg(debug_assertions)]
    actions.extend(["separator", "inspect"]);
    let mut shown: Vec<&str> = Vec::with_capacity(actions.len());
    for action in actions {
        if action == "separator" && shown.last().is_none_or(|last| *last == "separator") {
            continue;
        }
        shown.push(action);
    }
    if shown.last() == Some(&"separator") {
        shown.pop();
    }
    shown.into_iter().map(str::to_owned).collect()
}

fn show(app: &AppHandle, context: AskContext) -> Result<(), String> {
    let key = uuid::Uuid::new_v4().to_string();
    let actions = menu_actions(&context);
    let owner = browser_owner_label(app, &context.id);
    let window = app
        .get_window(&owner)
        .ok_or("Misty window is unavailable")?;
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    // Fractions of the host client area survive renderer zoom and display scale.
    let x = ((cursor.x - origin.x as f64) / size.width.max(1) as f64).clamp(0.0, 1.0);
    let y = ((cursor.y - origin.y as f64) / size.height.max(1) as f64).clamp(0.0, 1.0);
    app.state::<BrowserSessionState>()
        .context_menu
        .lock()
        .map_err(|_| "Browser menu is unavailable")?
        .insert(
            owner.clone(),
            PendingMenu {
                key: key.clone(),
                created: std::time::Instant::now(),
                context,
                actions: actions.clone(),
            },
        );
    app.emit_to(
        &owner,
        "misty://browser-context-menu",
        MenuPresentation { key, x, y, actions },
    )
    .map_err(|e| e.to_string())
}

fn menu_action_allowed(menu: &PendingMenu, key: &str, action: &str) -> bool {
    menu.key == key
        && menu.created.elapsed() <= Duration::from_secs(120)
        && (action == "dismiss"
            || (action != "separator" && menu.actions.iter().any(|a| a == action)))
}

pub(super) fn select(
    app: &AppHandle,
    webview: &Webview,
    key: &str,
    action: &str,
) -> Result<(), String> {
    if webview.label() != "main" && !webview.label().starts_with("misty-agent-") {
        return Err("Only Misty's trusted shell can select a browser action.".into());
    }
    let state = app.state::<BrowserSessionState>();
    let mut context = {
        let mut pending = state
            .context_menu
            .lock()
            .map_err(|_| "Browser menu is unavailable")?;
        let menu = pending
            .get(webview.window().label())
            .ok_or("The browser menu has closed.")?;
        if !menu_action_allowed(menu, key, action) {
            return Err("The browser menu changed. Open it again.".into());
        }
        pending.remove(webview.window().label()).unwrap().context
    };
    let view = app
        .get_webview(&webview_label(&context.id)?)
        .ok_or("The browser view has closed.")?;
    {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable")?;
        let session = sessions
            .get(&context.id)
            .ok_or("The browser view has closed.")?;
        if session.scope_id != context.scope_id
            || session.context_profile_id() != context.profile_id.as_deref()
            || session.origin_space_id != context.space_id
        {
            return Err("The browser context changed. Open the menu again.".into());
        }
    }
    if action != "dismiss"
        && view.url().ok().as_ref().map(Url::as_str) != Some(context.page.url.as_str())
    {
        return Err("The page changed. Open the menu again.".into());
    }
    view.set_focus().map_err(|e| e.to_string())?;
    match action {
        "dismiss" => {}
        #[cfg(debug_assertions)]
        "inspect" => view.open_devtools(),
        "ask" => {
            context.intent = action.into();
            app.emit_to(
                webview.window().label(),
                "misty://browser-ask-context",
                context,
            )
            .map_err(|e| e.to_string())?;
        }
        "open-link" | "open-image" => {
            let url = if action == "open-link" {
                context.page.link
            } else {
                context.page.image
            };
            app.emit_to(
                webview.window().label(),
                "misty://browser-popup",
                json!({"sourceId": context.id, "url": url}),
            )
            .map_err(|e| e.to_string())?;
        }
        command if WORKSPACE_COMMANDS.contains(&command) => {
            let url = if command == "open-link-split" {
                context.page.link
            } else {
                context.page.url
            };
            app.emit_to(
                webview.window().label(),
                "misty://browser-menu-command",
                json!({"sourceId": context.id, "command": command, "url": url}),
            )
            .map_err(|e| e.to_string())?;
        }
        "search-web" => {
            // The selection only leaves the native side once the person asks to search for it.
            let query: String = context.page.content.trim().chars().take(400).collect();
            app.emit_to(
                webview.window().label(),
                "misty://browser-menu-command",
                json!({"sourceId": context.id, "command": "search-web", "query": query}),
            )
            .map_err(|e| e.to_string())?;
        }
        "copy-link" | "copy-image-link" | "copy-page-link" => {
            let text = match action {
                "copy-link" => context.page.link,
                "copy-image-link" => context.page.image,
                _ => context.page.url,
            };
            arboard::Clipboard::new()
                .and_then(|mut c| c.set_text(text))
                .map_err(|e| e.to_string())?;
        }
        "copy" | "cut" | "paste" => {
            let action = action.to_owned();
            view.with_webview(move |platform| unsafe {
                let native: &objc2::runtime::AnyObject = &*platform.inner().cast();
                match action.as_str() {
                    "copy" => { let _: () = objc2::msg_send![native, copy: std::ptr::null::<objc2::runtime::AnyObject>()]; },
                    "cut" => { let _: () = objc2::msg_send![native, cut: std::ptr::null::<objc2::runtime::AnyObject>()]; },
                    _ => { let _: () = objc2::msg_send![native, paste: std::ptr::null::<objc2::runtime::AnyObject>()]; },
                }
            }).map_err(|e| e.to_string())?;
        }
        _ => unreachable!(),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> AskContext {
        let page: PageContext = serde_json::from_value(json!({
            "url": "https://example.com/article", "documentRevision": "1:2", "title": "Pilot", "content": "Please reply", "selection": false, "editable": false, "link": "", "image": ""
        })).unwrap();
        AskContext {
            id: "view".into(),
            scope_id: "scope".into(),
            space_id: Some("family".into()),
            profile_id: Some("profile".into()),
            provider_id: None,
            revision: "1:2".into(),
            content_hash: "hash".into(),
            page,
            intent: "ask".into(),
        }
    }
    #[test]
    fn custom_menu_only_dispatches_presented_actions_for_its_live_key() {
        let context = fixture();
        let mut menu = PendingMenu {
            key: "current".into(),
            created: std::time::Instant::now(),
            actions: menu_actions(&context),
            context,
        };
        assert!(menu_action_allowed(&menu, "current", "ask"));
        assert!(menu_action_allowed(&menu, "current", "dismiss"));
        assert!(!menu_action_allowed(&menu, "old", "ask"));
        assert!(!menu_action_allowed(&menu, "current", "create-task"));
        assert!(!menu_action_allowed(&menu, "current", "paste"));
        assert!(!menu_action_allowed(&menu, "current", "separator"));
        menu.created -= Duration::from_secs(121);
        assert!(!menu_action_allowed(&menu, "current", "ask"));
    }
    #[test]
    fn custom_menu_preserves_context_appropriate_browser_commands() {
        let mut context = fixture();
        context.page.selection = true;
        context.page.editable = true;
        context.page.link = "https://example.com/link".into();
        context.page.image = "https://example.com/image.png".into();
        let actions = menu_actions(&context);
        assert_eq!(actions.first().map(String::as_str), Some("ask"));
        for action in [
            "copy",
            "cut",
            "paste",
            "search-web",
            "open-link",
            "open-link-split",
            "copy-link",
            "open-image",
            "copy-image-link",
        ] {
            assert!(actions.iter().any(|a| a == action));
        }
        assert!(
            !actions.iter().any(|a| a == "reload"),
            "page commands stay off link, image, and selection menus"
        );
        context.page.editable = false;
        context.page.selection = false;
        let actions = menu_actions(&context);
        assert!(!actions
            .iter()
            .any(|a| ["copy", "cut", "paste"].contains(&a.as_str())));
    }
    #[test]
    fn page_menu_offers_page_commands_without_stray_separators() {
        let context = fixture();
        let actions = menu_actions(&context);
        for action in [
            "back",
            "forward",
            "reload",
            "bookmark",
            "copy-page-link",
            "qr-code",
            "annotate",
        ] {
            assert!(actions.iter().any(|a| a == action), "{action}");
        }
        assert!(actions
            .windows(2)
            .all(|pair| !(pair[0] == "separator" && pair[1] == "separator")));
        assert_ne!(actions.last().map(String::as_str), Some("separator"));
    }
}
