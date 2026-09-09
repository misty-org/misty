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
    mail: Option<MailContext>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MailContext {
    account: String,
    thread_reference: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AvailabilityRequest {
    id: String,
    scope_id: String,
    profile_id: String,
    space_id: String,
    provider_id: String,
    account: String,
    capabilities: Vec<String>,
    origins: Vec<String>,
}

pub(super) struct AvailabilityReceipt {
    request: AvailabilityRequest,
    observed: std::time::Instant,
}

pub(super) fn publish_availability(webview: Webview, state: State<'_, BrowserSessionState>, request: AvailabilityRequest) -> Result<(), String> {
    if webview.label() != "main" { return Err("Only Misty's trusted shell can publish action availability.".into()); }
    if request.account.len() > 320 || request.account.is_empty() || request.capabilities.len() > 4 || request.origins.is_empty() || request.origins.len() > 32 ||
        request.capabilities.iter().any(|c| !["inbox.read", "inbox.draft", "inbox.send", "tasks.create"].contains(&c.as_str())) {
        return Err("Invalid browser action availability.".into());
    }
    let mut sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
    let session = sessions.get_mut(&request.id).ok_or("Browser view is closed.")?;
    if session.scope_id != request.scope_id || session.profile_id.as_deref() != Some(&request.profile_id) ||
        session.origin_space_id.as_deref() != Some(&request.space_id) || session.profile_provider.as_deref() != Some(&request.provider_id) {
        return Err("Browser context changed.".into());
    }
    session.context_capabilities = Some(AvailabilityReceipt { request, observed: std::time::Instant::now() });
    Ok(())
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
    if url.scheme() != "misty-context-menu" { return false; }
    let values = url.query_pairs().collect::<HashMap<_, _>>();
    let Some(state) = app.try_state::<BrowserSessionState>() else { return true };
    let token = values.get("token").map(|s| s.as_ref()).unwrap_or("");
    if !shortcut_token_matches(&state, id, token) { return true; }
    let raw = values.get("payload").map(|s| s.as_ref()).unwrap_or("");
    if raw.len() > 100_000 { return true; }
    let Ok(page) = serde_json::from_str::<PageContext>(raw) else { return true };
    if page.content.chars().count() > 16000 || page.title.chars().count() > 200 || page.url.len() > 8192 || page.document_revision.len() > 80 { return true; }
    let Ok(label) = webview_label(id) else { return true };
    let Some(view) = app.get_webview(&label) else { return true };
    // The page can supply content, never the native scope, account, or Space.
    if view.url().ok().as_ref().map(Url::as_str) != Some(page.url.as_str()) || external_url(&page.url).is_err() { return true; }
    for link in [&page.link, &page.image] {
        if !link.is_empty() && (link.len() > 8192 || external_url(link).is_err()) { return true; }
    }
    let context = {
        let Ok(sessions) = state.sessions.lock() else { return true };
        let Some(session) = sessions.get(id) else { return true };
        AskContext {
            id: id.to_owned(), scope_id: session.scope_id.clone(), space_id: session.origin_space_id.clone(),
            profile_id: session.profile_id.clone(), provider_id: session.profile_provider.clone(),
            revision: page.document_revision.clone(),
            content_hash: format!("{:x}", Sha256::digest(page.content.as_bytes())), page,
            intent: "ask".into(),
        }
    };
    let app = app.clone();
    let dispatcher = app.clone();
    let _ = dispatcher.run_on_main_thread(move || { let _ = show(&app, context); });
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

fn menu_actions(context: &AskContext, task: bool, reply: bool) -> Vec<String> {
    let mut actions = vec!["ask"];
    if task { actions.push("create-task"); }
    if reply { actions.push("prepare-reply"); }
    if task && reply { actions.push("task-and-reply"); }
    actions.push("separator");
    if context.page.selection { actions.push("copy"); }
    if context.page.editable {
        if context.page.selection { actions.push("cut"); }
        actions.push("paste");
    }
    if !context.page.link.is_empty() { actions.extend(["open-link", "copy-link"]); }
    if !context.page.image.is_empty() { actions.extend(["open-image", "copy-image-link"]); }
    #[cfg(debug_assertions)]
    actions.push("inspect");
    if actions.last() == Some(&"separator") { actions.pop(); }
    actions.into_iter().map(str::to_owned).collect()
}

fn show(app: &AppHandle, context: AskContext) -> Result<(), String> {
    let key = uuid::Uuid::new_v4().to_string();
    let (task, reply) = {
        let state = app.state::<BrowserSessionState>();
        let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
        let receipt = sessions.get(&context.id).and_then(|s| s.context_capabilities.as_ref());
        available_suggestions(receipt, &context)
    };
    let actions = menu_actions(&context, task, reply);
    let window = app.get_window("main").ok_or("Misty window is unavailable")?;
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    // Fractions of the host client area survive renderer zoom and display scale.
    let x = ((cursor.x - origin.x as f64) / size.width.max(1) as f64).clamp(0.0, 1.0);
    let y = ((cursor.y - origin.y as f64) / size.height.max(1) as f64).clamp(0.0, 1.0);
    *app.state::<BrowserSessionState>().context_menu.lock().map_err(|_| "Browser menu is unavailable")? = Some(PendingMenu {
        key: key.clone(), created: std::time::Instant::now(), context, actions: actions.clone(),
    });
    app.emit_to("main", "misty://browser-context-menu", MenuPresentation { key, x, y, actions }).map_err(|e| e.to_string())
}

fn menu_action_allowed(menu: &PendingMenu, key: &str, action: &str) -> bool {
    menu.key == key && menu.created.elapsed() <= Duration::from_secs(120)
        && (action == "dismiss" || (action != "separator" && menu.actions.iter().any(|a| a == action)))
}

pub(super) fn select(app: &AppHandle, webview: &Webview, key: &str, action: &str) -> Result<(), String> {
    if webview.label() != "main" { return Err("Only Misty's trusted shell can select a browser action.".into()); }
    let state = app.state::<BrowserSessionState>();
    let mut context = {
        let mut pending = state.context_menu.lock().map_err(|_| "Browser menu is unavailable")?;
        let menu = pending.as_ref().ok_or("The browser menu has closed.")?;
        if !menu_action_allowed(menu, key, action) { return Err("The browser menu changed. Open it again.".into()); }
        pending.take().unwrap().context
    };
    let view = app.get_webview(&webview_label(&context.id)?).ok_or("The browser view has closed.")?;
    {
        let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable")?;
        let session = sessions.get(&context.id).ok_or("The browser view has closed.")?;
        if session.scope_id != context.scope_id || session.profile_id != context.profile_id || session.origin_space_id != context.space_id {
            return Err("The browser context changed. Open the menu again.".into());
        }
    }
    if action != "dismiss" && view.url().ok().as_ref().map(Url::as_str) != Some(context.page.url.as_str()) {
        return Err("The page changed. Open the menu again.".into());
    }
    view.set_focus().map_err(|e| e.to_string())?;
    match action {
        "dismiss" => {},
        #[cfg(debug_assertions)]
        "inspect" => view.open_devtools(),
        "ask" | "create-task" | "prepare-reply" | "task-and-reply" => {
            context.intent = action.into();
            app.emit_to("main", "misty://browser-ask-context", context).map_err(|e| e.to_string())?;
        }
        "open-link" | "open-image" => {
            let url = if action == "open-link" { context.page.link } else { context.page.image };
            app.emit_to("main", "misty://browser-popup", json!({"sourceId": context.id, "url": url})).map_err(|e| e.to_string())?;
        }
        "copy-link" | "copy-image-link" => {
            let text = if action == "copy-link" { context.page.link } else { context.page.image };
            arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())?;
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

fn available_suggestions(receipt: Option<&AvailabilityReceipt>, context: &AskContext) -> (bool, bool) {
    let (Some(receipt), Some(mail)) = (receipt, &context.page.mail) else { return (false, false) };
    let r = &receipt.request;
    let origin = Url::parse(&context.page.url).ok().map(|u| u.origin().ascii_serialization());
    if receipt.observed.elapsed() > Duration::from_secs(300) || r.id != context.id || r.scope_id != context.scope_id ||
        Some(r.profile_id.as_str()) != context.profile_id.as_deref() || Some(r.space_id.as_str()) != context.space_id.as_deref() ||
        Some(r.provider_id.as_str()) != context.provider_id.as_deref() || !r.account.eq_ignore_ascii_case(&mail.account) ||
        mail.thread_reference != context.page.url || !origin.as_ref().is_some_and(|o| r.origins.contains(o)) || context.page.editable || context.page.content.trim().is_empty() {
        return (false, false);
    }
    let has = |name: &str| r.capabilities.iter().any(|c| c == name);
    (has("tasks.create"), has("inbox.read") && has("inbox.draft"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (AvailabilityReceipt, AskContext) {
        let page: PageContext = serde_json::from_value(json!({
            "url": "https://mail.google.com/mail/u/0/#inbox/pilot", "documentRevision": "1:2", "title": "Pilot", "content": "Please reply", "selection": false, "editable": false, "link": "", "image": "",
            "mail": {"account": "pilot@example.com", "threadReference": "https://mail.google.com/mail/u/0/#inbox/pilot"}
        })).unwrap();
        let context = AskContext { id: "view".into(), scope_id: "scope".into(), space_id: Some("family".into()), profile_id: Some("profile".into()), provider_id: Some("google".into()), revision: "1:2".into(), content_hash: "hash".into(), page, intent: "ask".into() };
        let receipt = AvailabilityReceipt { request: AvailabilityRequest { id: "view".into(), scope_id: "scope".into(), profile_id: "profile".into(), space_id: "family".into(), provider_id: "google".into(), account: "pilot@example.com".into(), capabilities: vec!["inbox.read".into(), "inbox.draft".into(), "tasks.create".into()], origins: vec!["https://mail.google.com".into()] }, observed: std::time::Instant::now() };
        (receipt, context)
    }
    #[test]
    fn custom_menu_only_dispatches_presented_actions_for_its_live_key() {
        let (_, context) = fixture();
        let mut menu = PendingMenu { key: "current".into(), created: std::time::Instant::now(), actions: menu_actions(&context, false, false), context };
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
        let (_, mut context) = fixture();
        context.page.selection = true;
        context.page.editable = true;
        context.page.link = "https://example.com/link".into();
        context.page.image = "https://example.com/image.png".into();
        let actions = menu_actions(&context, false, false);
        assert_eq!(actions.first().map(String::as_str), Some("ask"));
        for action in ["copy", "cut", "paste", "open-link", "copy-link", "open-image", "copy-image-link"] {
            assert!(actions.iter().any(|a| a == action));
        }
        context.page.editable = false;
        context.page.selection = false;
        let actions = menu_actions(&context, true, true);
        assert!(actions.iter().any(|a| a == "task-and-reply"));
        assert!(!actions.iter().any(|a| ["copy", "cut", "paste"].contains(&a.as_str())));
    }
    #[test]
    fn suggestions_require_host_receipt_and_fresh_matching_mail_identity() {
        let (receipt, mut context) = fixture();
        assert_eq!(available_suggestions(Some(&receipt), &context), (true, true));
        assert_eq!(available_suggestions(None, &context), (false, false));
        context.page.mail.as_mut().unwrap().account = "other@example.com".into();
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, false));
    }
    #[test]
    fn stale_or_retargeted_context_never_inherits_suggestions() {
        let (mut receipt, mut context) = fixture();
        receipt.observed -= Duration::from_secs(301);
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, false));
        receipt.observed = std::time::Instant::now();
        context.space_id = Some("work".into());
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, false));
        context.space_id = Some("family".into());
        context.page.url = "https://mail.google.com/mail/u/0/#inbox/another".into();
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, false));
        context.page.url = "https://unrelated.example/".into();
        context.page.mail.as_mut().unwrap().thread_reference = context.page.url.clone();
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, false));
    }
    #[test]
    fn unrelated_controls_and_editors_do_not_offer_reply_actions() {
        let (receipt, mut context) = fixture();
        context.page.editable = true;
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, false));
        context.page.editable = false;
        context.page.mail = None;
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, false));
    }
    #[test]
    fn suggestions_follow_independently_available_capabilities() {
        let (mut receipt, context) = fixture();
        receipt.request.capabilities = vec!["inbox.read".into(), "inbox.draft".into()];
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, true));
        receipt.request.capabilities = vec!["tasks.create".into()];
        assert_eq!(available_suggestions(Some(&receipt), &context), (true, false));
        receipt.request.capabilities.clear();
        assert_eq!(available_suggestions(Some(&receipt), &context), (false, false));
    }
}
