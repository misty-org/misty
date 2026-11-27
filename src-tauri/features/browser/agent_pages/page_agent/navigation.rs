use super::*;

pub(in crate::browser) async fn first_load(app: &AppHandle, id: &str) -> bool {
    let started = tokio::time::Instant::now();
    loop {
        let elapsed = started.elapsed();
        if let Ok(view) = webview(app, id) {
            let blank = view
                .url()
                .map(|url| url.as_str() == "about:blank")
                .unwrap_or(true);
            let check = call(&view, "waitCheck", json!({}), false).await.ok();
            let ready = check.as_ref().is_some_and(|check| check["ready"] == true);
            let challenge = check
                .as_ref()
                .is_some_and(|check| check["challenge"] == true);
            if !blank && ready && !(challenge && elapsed < Duration::from_secs(20)) {
                return true;
            }
            if elapsed > Duration::from_secs(if blank { 15 } else { 25 }) {
                return false;
            }
        } else if elapsed > Duration::from_secs(15) {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

pub(in crate::browser) async fn navigate(
    app: &AppHandle,
    state: &BrowserSessionState,
    request: &BrowserAgentExecuteRequest,
    go: misty_page_runtime::Go<'_>,
    include_snapshot: bool,
) -> Result<Value, String> {
    let (id, _) = resolve_agent_webview(app, state, request)?;
    let view = webview(app, &id)?;
    let host = TabHost {
        app,
        state,
        view: &view,
        request,
    };
    misty_page_runtime::navigate(&host, go, include_snapshot).await
}

pub(in crate::browser) async fn picture(
    app: &AppHandle,
    state: &BrowserSessionState,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let (id, _) = resolve_agent_webview(app, state, request)?;
    let view = webview(app, &id)?;
    let host = TabHost {
        app,
        state,
        view: &view,
        request,
    };
    let mut input = request.input.clone();
    if input["type"].is_null() {
        input["type"] = json!("jpeg");
    }
    misty_page_runtime::picture(&host, &input).await
}
