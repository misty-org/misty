use super::*;
use sha2::{Digest, Sha256};
// Peek, mouse gestures and protected-video reports share the menu's token.
mod page_signals;
mod right_click;
mod selection;
pub(super) use right_click::right_click;
#[cfg(test)]
use selection::menu_action_allowed;
pub(super) use selection::select;

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
    if !shortcut_token_matches(&state, id, token) || page_signals::forward(app, id, url, &values) {
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
const WORKSPACE_COMMANDS: [&str; 8] = [
    "back",
    "forward",
    "reload",
    "bookmark",
    "qr-code",
    "annotate",
    "open-link-split",
    "peek-link",
];

fn menu_actions(context: &AskContext) -> Vec<String> {
    let page = &context.page;
    let mut actions = vec!["ask", "separator"];
    if !page.link.is_empty() {
        actions.extend(["open-link", "open-link-split", "copy-link", "separator"]);
        actions.insert(actions.len() - 2, "peek-link");
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
    let mut actions = menu_actions(&context);
    if super::super::extensions::has_extensions() {
        actions.extend(["separator".into(), "extensions".into()]);
    }
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

/// Misty's menu for a page in `window` is on its way or open.
#[cfg(windows)]
pub(super) fn menu_pending(app: &AppHandle, window: &str) -> bool {
    app.state::<BrowserSessionState>()
        .context_menu
        .lock()
        .is_ok_and(|pending| {
            pending
                .get(window)
                .is_some_and(|menu| menu.created.elapsed() <= Duration::from_secs(120))
        })
}

#[cfg(test)]
mod tests;
