use crate::browser::agent_pages::action_confirm::{self as confirm, Answer};
use crate::browser::*;

fn allowed_once() -> &'static Mutex<HashSet<String>> {
    static ALLOWED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ALLOWED.get_or_init(Default::default)
}

fn once_key(request: &BrowserAgentExecuteRequest, origin: &str) -> String {
    let task = request.input["__mistyTaskId"]
        .as_str()
        .filter(|task| !task.is_empty())
        .unwrap_or(&request.scope_id);
    format!("{}\0{task}\0{origin}", request.agent_id)
}

fn account_of(app: &AppHandle, request: &BrowserAgentExecuteRequest, page_id: &str) -> String {
    request
        .policy
        .call
        .as_ref()
        .map(|call| call.facts.account.clone())
        .filter(|account| !account.is_empty())
        .or_else(|| {
            crate::agents::run_control::windows::account_of_window(&browser_owner_label(
                app, page_id,
            ))
        })
        .unwrap_or_default()
}

fn gated(page_id: &str, url: &Url) -> bool {
    !is_agent_page(page_id) && matches!(url.scheme(), "http" | "https")
}

pub(in crate::browser) async fn gate_person_tab(
    app: &AppHandle,
    page_id: &str,
    request: &BrowserAgentExecuteRequest,
    url: &Url,
) -> Result<(), String> {
    if !gated(page_id, url) {
        return Ok(());
    }
    if crate::browser::agent_pages::page_agent::site_blocked(
        url,
        &request.policy.site_blocks.clone().unwrap_or_default(),
    )
    .is_some()
    {
        let host = url.host_str().unwrap_or("this site");
        return Err(format!("browser_site_blocked: agents can't read or act on {host} in the person's own tab; it is a banking, crypto, payment or adult site, or one they blocked. Ask the person to do this step."));
    }
    let origin = confirm::origin_of(url);
    if origin.is_empty() {
        return Ok(());
    }
    let key = once_key(request, &origin);
    if allowed_once()
        .lock()
        .is_ok_and(|allowed| allowed.contains(&key))
    {
        return Ok(());
    }
    let account = account_of(app, request, page_id);
    let store = app
        .state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store();
    if crate::agents::run_control::tool_gate::account_site_granted(
        &store,
        &account,
        &request.agent_id,
        &origin,
    ) {
        return Ok(());
    }
    match confirm::ask_account(app, &account, request, url).await {
        Answer::Allowed => {
            if let Ok(mut allowed) = allowed_once().lock() {
                allowed.insert(key);
            }
            Ok(())
        }
        Answer::Refused => Err(format!("browser_account_declined: The person said no to you using their account on {origin}. Nothing was done there. Don't try another way to reach it; tell them it wasn't done.")),
        Answer::Unanswered => Err(format!("browser_account_unconfirmed: Stopped before using the person's account on {origin}: nobody answered in Misty within 3 minutes. Nothing was done there. Tell the person it's waiting for them.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_pages_in_the_persons_own_tabs_are_gated() {
        let page = Url::parse("https://mail.example.com/inbox").unwrap();
        assert!(gated("web-1", &page));
        assert!(!gated("agent-1", &page));
        assert!(!gated("web-1", &Url::parse("about:blank").unwrap()));
    }
}
