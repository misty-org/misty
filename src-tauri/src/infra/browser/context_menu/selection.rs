//! Running the action a person chose from a page's context menu.
use super::*;

pub(super) fn menu_action_allowed(menu: &PendingMenu, key: &str, action: &str) -> bool {
    menu.key == key
        && menu.created.elapsed() <= Duration::from_secs(120)
        && (action == "dismiss"
            || (action != "separator" && menu.actions.iter().any(|a| a == action)))
}

pub(in crate::infra::browser) fn select(
    app: &AppHandle,
    webview: &Webview,
    key: &str,
    action: &str,
) -> Result<(), String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
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
        "extensions" => {
            let id = context.id.clone();
            tauri::async_runtime::spawn(async move {
                let _ = super::super::super::extensions::context_menu(&id).await;
            });
        }
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
            let url = if matches!(command, "open-link-split" | "peek-link") {
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
            use kiri::engine::EditCommand;
            let command = match action {
                "copy" => EditCommand::Copy,
                "cut" => EditCommand::Cut,
                _ => EditCommand::Paste,
            };
            kiri::engine::edit(&view, command)?;
        }
        _ => unreachable!(),
    }
    Ok(())
}
