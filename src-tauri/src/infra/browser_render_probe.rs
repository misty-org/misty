//! Native rendering diagnostics in the disposable debug harness only.
use super::*;

async fn inspect(view: &Webview) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| unsafe {
        use objc2_app_kit::NSView;
        fn tree(view: &NSView) -> Value {
            json!({
                "class": objc2::runtime::AnyObject::class(view).name().to_string_lossy(),
                "redraw": view.layerContentsRedrawPolicy().0,
                "layer": view.wantsLayer(),
                "displayHz": view.window().and_then(|w|w.screen()).map(|s| s.maximumFramesPerSecond()),
                "children": view.subviews().iter().map(|v| tree(&v)).collect::<Vec<_>>()
            })
        }
        let view: &NSView = &*platform.inner().cast();
        let _ = tx.send(tree(view));
    }).map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())
}

async fn measure(view: &Webview, fixture: bool) -> Result<Value, String> {
    let mut loaded = false;
    for _ in 0..100 {
        let ready = evaluate_browser_async_javascript(view.clone(), if fixture { "return JSON.stringify(document.body?.dataset.ready === 'true');" } else { "return JSON.stringify(document.readyState === 'complete' && Boolean(document.body?.innerText));" }.into()).await?;
        if ready == "true" {
            loaded = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if !loaded {
        return Err("Rendering fixture did not load".into());
    }
    let raw = evaluate_browser_async_javascript(view.clone(), r#"
        return await new Promise(resolve => {
            const intervals = []; let last = 0, start = 0;
            const frame = now => {
                if (!start) start = now;
                if (last) intervals.push(now - last); last = now;
                window.scrollBy(0, 1);
                if (now - start < 2500) requestAnimationFrame(frame);
                else resolve(JSON.stringify({frames:intervals.length, max:Math.max(...intervals), slow:intervals.filter(ms=>ms>25).length, scrollY, width:innerWidth, height:innerHeight}));
            }; requestAnimationFrame(frame);
        });
    "#.into()).await?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub(crate) async fn run(app: AppHandle, origin: String) -> Result<String, String> {
    let url = Url::parse(&origin)
        .map_err(|e| e.to_string())?
        .join("/scripts/browser-render-fixture.html")
        .map_err(|e| e.to_string())?;
    if !matches!(url.host_str(), Some("localhost" | "127.0.0.1")) {
        return Err("Loopback fixture required".into());
    }
    let window = app.get_window("main").ok_or("Missing main window")?;
    let plain = window
        .add_child(
            WebviewBuilder::new("render-control", WebviewUrl::External(url.clone())),
            LogicalPosition::new(0., 60.),
            LogicalSize::new(1000., 500.),
        )
        .map_err(|e| e.to_string())?;
    let plain_frames = measure(&plain, true).await?;
    let before = inspect(&plain).await?;
    configure_browser_webview(&plain, true)?;
    let configured_frames = measure(&plain, true).await?;
    let after = inspect(&plain).await?;
    let website = std::env::var("MISTY_BROWSER_RENDER_WEBSITE")
        .ok()
        .map(|value| Url::parse(&value))
        .transpose()
        .map_err(|e| e.to_string())?;
    if website.as_ref().is_some_and(|url| {
        url.scheme() != "http" || !matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
    }) {
        return Err("Website comparison requires an explicit loopback URL".into());
    }
    let website_before = if let Some(url) = &website {
        plain.navigate(url.clone()).map_err(|e| e.to_string())?;
        tokio::time::sleep(Duration::from_secs(4)).await;
        Some(measure(&plain, false).await?)
    } else {
        None
    };
    plain.close().map_err(|e| e.to_string())?;
    let request: BrowserWebviewCreateRequest = serde_json::from_value(json!({"id":"render-production", "url":url.as_str(), "scopeId":"render-probe", "x":0, "y":60, "width":1000, "height":500, "nativeLiveResize":true})).map_err(|e|e.to_string())?;
    browser_webview_create(app.clone(), app.state::<BrowserSessionState>(), request).await?;
    let production = app
        .get_webview("misty-browser-render-production")
        .ok_or("Missing production view")?;
    let production_frames = measure(&production, true).await?;
    let production_tree = inspect(&production).await?;

    let website_frames = if let Some(url) = &website {
        production
            .navigate(url.clone())
            .map_err(|e| e.to_string())?;
        tokio::time::sleep(Duration::from_secs(4)).await;
        Some(measure(&production, false).await?)
    } else {
        None
    };
    let display_hz = production_tree["displayHz"].as_u64().unwrap_or(60);
    // A physical ProMotion run should materially exceed the old 60 Hz pace.
    // Allow scheduling noise; 60 Hz displays still validate geometry below.
    if display_hz >= 100 && production_frames["frames"].as_u64().unwrap_or(0) < 200 {
        return Err(format!("Page updates did not exceed 80 fps on a {display_hz} Hz display: {production_frames}. Check Low Power Mode and system load."));
    }
    if production_frames["width"] != 1000
        || production_frames["height"] != 500
        || production_frames["scrollY"].as_u64().unwrap_or(0) == 0
    {
        return Err(format!(
            "Browser geometry or scrolling changed: {production_frames}"
        ));
    }
    browser_webview_close(
        app.clone(),
        app.state::<BrowserSessionState>(),
        BrowserWebviewIdRequest {
            id: "render-production".into(),
        },
    )?;
    let result = json!({"plain":before,"configured":after,"production":production_tree,"frames":{"plain":plain_frames,"configured":configured_frames,"production":production_frames,"websiteBefore":website_before,"website":website_frames}});
    println!("RENDER_PROBE {result}");
    Ok(result.to_string())
}
