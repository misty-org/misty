//! Disposable native regression fixture, reachable only from the debug probe harness.
use super::*;
use std::sync::Arc;
use tauri::Listener;

async fn eval(app: &AppHandle, id: &str, body: &str) -> Result<Value, String> {
    let view = app
        .get_webview(&webview_label(id)?)
        .ok_or("Fixture view unavailable")?;
    let raw = evaluate_browser_async_javascript(view, body.to_owned()).await?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}
async fn wait_for<F, Fut>(stage: &str, mut ready: F) -> Result<(), String>
where
    F: FnMut() -> Fut + Send,
    Fut: std::future::Future<Output = bool> + Send,
{
    let deadline = std::time::Instant::now() + Duration::from_secs(12);
    while !ready().await {
        if std::time::Instant::now() > deadline {
            return Err(format!("Native popup fixture timed out: {stage}"));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(())
}
async fn create_source(
    app: &AppHandle,
    id: &str,
    url: &Url,
    provider: Option<&str>,
    account: &str,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    println!("OAuth fixture: create {id}");
    let profile = hex::encode(Sha256::digest(format!("{}:{id}", uuid::Uuid::new_v4())));
    let request: BrowserWebviewCreateRequest = serde_json::from_value(json!({
        "id": id, "url": url.as_str(), "profileId": profile, "profileProviderId": provider,
        "scopeId": id, "x": 0, "y": 60, "width": 800, "height": 550,
    }))
    .map_err(|error| error.to_string())?;
    browser_webview_create(app.clone(), app.state::<BrowserSessionState>(), request).await?;
    // Mark this disposable loopback source as an integration without changing the
    // production admission rules to accept loopback sites as provider domains.
    app.state::<BrowserSessionState>()
        .sessions
        .lock()
        .map_err(|_| "Fixture state unavailable")?
        .get_mut(id)
        .ok_or("Fixture session missing")?
        .provider_id = provider.map(str::to_owned);
    wait_for("source fixture load", || async {
        eval(
            app,
            id,
            "return JSON.stringify({ready:document.body?.dataset.fixture==='ready'});",
        )
        .await
        .ok()
        .is_some_and(|v| v["ready"] == true)
    })
    .await?;
    eval(app, id, &format!("localStorage.setItem('popup-account', {account:?}); document.cookie='popup_account={account}; path=/'; document.querySelector('textarea').value='Retained draft'; return '{{}}';")).await?;
    Ok(())
}
fn children(app: &AppHandle, id: &str) -> Vec<String> {
    app.state::<BrowserSessionState>()
        .sessions
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, session)| session.popup_parent.as_deref() == Some(id))
        .map(|(id, _)| id.clone())
        .collect()
}
async fn open_popup(app: &AppHandle, id: &str, url: &str) -> Result<String, String> {
    println!("OAuth fixture: open popup from {id}");
    eval(
        app,
        id,
        &format!("window.fixturePopup=window.open({url:?}, '_blank'); return '{{}}';"),
    )
    .await?;
    wait_for("native popup creation", || async { !children(app, id).is_empty() }).await?;
    Ok(children(app, id)[0].clone())
}
fn close(app: &AppHandle, id: &str) -> Result<(), String> {
    browser_webview_close(
        app.clone(),
        app.state::<BrowserSessionState>(),
        BrowserWebviewIdRequest { id: id.to_owned() },
    )
}
pub(crate) async fn run(app: AppHandle, origin: String) -> Result<String, String> {
    let origin = Url::parse(&origin).map_err(|e| e.to_string())?;
    if origin.scheme() != "http"
        || origin.host_str() != Some("127.0.0.1")
        || app.try_state::<BrowserProbeDirectories>().is_none()
    {
        return Err("Popup fixture requires disposable loopback storage".into());
    }
    let source = origin
        .join("/scripts/sdk-oauth-popup-fixture.html")
        .unwrap();
    // A second loopback port is a real different origin without relying on
    // localhost DNS/IPv6 or a third-party login page's changing behavior.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let mut auth = source.clone();
    auth.set_port(Some(listener.local_addr().map_err(|e| e.to_string())?.port())).unwrap();
    let auth_server = tokio::spawn(async move {
        let router = axum::Router::new().route("/scripts/sdk-oauth-popup-fixture.html", axum::routing::get(|| async {
            axum::response::Html(include_str!("../../../scripts/sdk-oauth-popup-fixture.html"))
        }));
        let _ = axum::serve(listener, router).await;
    });
    let count = Arc::new(AtomicUsize::new(0));
    let events = count.clone();
    let listener = app.listen("misty://browser-popup", move |_| {
        events.fetch_add(1, Ordering::SeqCst);
    });
    let result = async {
        create_source(&app, "oauth-other-account", &source, Some("messenger"), "other-account").await?;
        for provider in ["x", "messenger"] {
            let id = format!("oauth-{provider}");
            create_source(&app, &id, &source, Some(provider), provider).await?;
            // Reproduces the screenshot: main is now a window containing multiple webviews.
            crate::platform::plugins::mac_rounded_corners::reveal_main_window(app.get_webview("main").unwrap()).await?;
            let popup = open_popup(&app, &id, "about:blank").await?;
            let state = eval(&app, &popup, "return JSON.stringify({opener:!!window.opener,account:localStorage.getItem('popup-account'),cookie:document.cookie});").await?;
            if state["opener"] != true || state["account"] != provider || !state["cookie"].as_str().unwrap_or("").contains(&format!("popup_account={provider}")) { return Err(format!("{provider}: lost opener or account: {state}")); }
            let popup_window = app.get_webview(&webview_label(&popup)?).unwrap().window();
            if popup_window.label() == "main" || !popup_window.is_visible().map_err(|e| e.to_string())? { return Err("Popup is not its own visible window".into()); }
            browser_webviews_hide_all(app.clone())?;
            browser_webviews_set_overlay_active(app.clone(), true)?;
            browser_webviews_set_overlay_active(app.clone(), false)?;
            if !popup_window.is_visible().map_err(|e| e.to_string())? { return Err("Workspace visibility hid authentication".into()); }
            eval(&app, &popup, &format!("location.href={:?}; return '{{}}';", auth.as_str())).await?;
            if let Err(error) = wait_for("cross-origin authentication page", || async { eval(&app, &popup, "return JSON.stringify({origin:location.origin,ready:document.body?.dataset.fixture==='ready',opener:!!window.opener});").await.ok().is_some_and(|v| v["origin"] == auth.origin().ascii_serialization() && v["ready"] == true && v["opener"] == true) }).await {
                return Err(format!("{error}: {:?}", eval(&app, &popup, "return JSON.stringify({url:location.href,ready:document.readyState,opener:!!window.opener,html:document.documentElement.outerHTML.slice(0,1200)});").await));
            }
            let mut callback = source.clone(); callback.set_query(Some("callback=1"));
            eval(&app, &popup, &format!("location.href={:?}; return '{{}}';", callback.as_str())).await?;
            wait_for("window.close notification", || async { app.get_webview(&webview_label(&popup).unwrap()).is_none() }).await?;
            wait_for("callback message and retained opener", || async { eval(&app, &id, "return JSON.stringify({received:window.fixtureResult?.account,draft:document.querySelector('textarea').value,closed:window.fixturePopup.closed});").await.ok().is_some_and(|v| v["received"] == provider && v["draft"] == "Retained draft" && v["closed"] == true) }).await?;
            let other = eval(&app, "oauth-other-account", "return JSON.stringify({account:localStorage.getItem('popup-account')});").await?;
            if other["account"] != "other-account" { return Err("Popup crossed account storage".into()); }
            // Cancelling and closing an integration must also release nested windows.
            let parent = open_popup(&app, &id, "about:blank").await?;
            let nested = open_popup(&app, &parent, "about:blank").await?;
            close(&app, &id)?;
            wait_for("nested popup cleanup", || async { [id.as_str(), &parent, &nested].iter().all(|id| app.get_webview(&webview_label(id).unwrap()).is_none()) }).await?;
            if count.load(Ordering::SeqCst) != 0 { return Err("Integration popup opened a Browser tab".into()); }
        }
        create_source(&app, "oauth-browser", &source, None, "browser").await?;
        eval(&app, "oauth-browser", "window.open('about:blank', '_blank'); return '{}';").await?;
        wait_for("ordinary Browser popup", || async { count.load(Ordering::SeqCst) == 1 }).await?;
        Ok("PASS: X and Messenger native popups preserve opener, isolated local storage/cookies, cross-origin redirect and postMessage callback, window.close, draft and source view; nested windows close with their integration; no Browser-tab events; ordinary Browser popups still dispatch; multi-webview main-window reveal succeeds. Disposable synthetic OAuth only.".to_owned())
    }.await;
    app.unlisten(listener);
    auth_server.abort();
    let ids = app
        .state::<BrowserSessionState>()
        .sessions
        .lock()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    for id in ids {
        let _ = close(&app, &id);
    }
    result
}

/// The signed provider harness uses the same popup lifecycle without creating a Browser tab.
pub(crate) async fn provider_popup_state(app: &AppHandle, id: &str, dismiss: bool) -> Result<Value, String> {
    let Some(popup) = children(app, id).first().cloned() else { return Ok(Value::Null); };
    if dismiss {
        eval(app, &popup, "window.close(); return '{}';").await?;
        wait_for("provider popup dismissal", || async { children(app, id).is_empty() }).await?;
        return Ok(json!({"closed": true}));
    }
    eval(app, &popup, "return JSON.stringify({marker:localStorage.getItem('misty-provider-probe'),opener:!!window.opener,origin:location.origin});").await
}
