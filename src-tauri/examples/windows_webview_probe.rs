//! Disposable WebView2 acceptance probe for Misty's Chrome DevTools Protocol
//! paths: trusted input, the native input lock, async evaluation, captures,
//! single-file page saves and tab muting. Run on Windows with the WebView2
//! runtime: cargo run --example windows_webview_probe
//! It loads one synthetic page from memory; no network or existing profile.
#[cfg(windows)]
#[allow(dead_code, reason = "the probe exercises part of the helper")]
#[path = "../src/infra/webview2.rs"]
mod webview2;

#[cfg(windows)]
mod probe {
    use super::webview2::{self, click, css_viewport, evaluate, MouseButton};
    use serde_json::{json, Value};
    use std::sync::{
        atomic::{AtomicI32, Ordering},
        Arc,
    };
    use tauri::{LogicalPosition, LogicalSize, Webview, WebviewBuilder, WebviewUrl};

    type Result<T> = std::result::Result<T, String>;

    const PAGE: &str = r#"<!doctype html><title>probe</title>
<input id="field" style="position:absolute;left:20px;top:20px;width:200px;height:30px">
<button id="button" style="position:absolute;left:20px;top:80px;width:120px;height:40px">Press</button>
<script>
window.events = [];
for (const type of ["mousedown","mouseup","click","contextmenu","keydown","wheel"])
  document.addEventListener(type, e => events.push({type, trusted: e.isTrusted, key: e.key || null}), true);
</script>"#;

    async fn page(view: &Webview, expression: &str) -> Result<Value> {
        evaluate(view, expression.to_owned(), None)
            .await
            .map_err(|error| format!("{expression}: {}", error.message()))
    }

    async fn events(view: &Webview) -> Result<Vec<Value>> {
        let value = page(
            view,
            "(() => { const e = window.events; window.events = []; return e; })()",
        )
        .await?;
        Ok(value.as_array().cloned().unwrap_or_default())
    }

    fn check(name: &str, ok: bool, detail: impl std::fmt::Display) -> Result<()> {
        if ok {
            println!("PASS: {name}");
            Ok(())
        } else {
            Err(format!("{name}: {detail}"))
        }
    }

    async fn exercise(view: &Webview) -> Result<()> {
        for _ in 0..100 {
            if page(view, "document.readyState").await.ok() == Some(json!("complete")) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let html = serde_json::to_string(PAGE).expect("page source");
        page(view, &format!("(() => {{ document.open(); document.write({html}); document.close(); return true; }})()")).await?;
        let (width, height) = css_viewport(view)
            .await
            .map_err(|e| e.message().to_owned())?;
        check(
            "viewport is measured",
            width > 300.0 && height > 150.0,
            format!("{width}x{height}"),
        )?;

        let answer = page(
            view,
            "(async () => { await new Promise(r => setTimeout(r, 10)); return 'awaited'; })()",
        )
        .await?;
        check(
            "async evaluation awaits promises",
            answer == json!("awaited"),
            &answer,
        )?;

        click(view, 120.0, 35.0, MouseButton::Left, 1)
            .await
            .map_err(|e| e.message().to_owned())?;
        let seen = events(view).await?;
        let trusted = seen
            .iter()
            .any(|e| e["type"] == "click" && e["trusted"] == true);
        check("CDP clicks arrive as trusted events", trusted, json!(seen))?;
        let focused = page(view, "document.activeElement && document.activeElement.id").await?;
        check(
            "a click focuses the field",
            focused == json!("field"),
            &focused,
        )?;

        webview2::cdp(view, "Input.insertText", &json!({"text": "héllo wörld"}))
            .await
            .map_err(|e| e.message().to_owned())?;
        let value = page(view, "document.getElementById('field').value").await?;
        check(
            "insertText types into the focused field",
            value == json!("héllo wörld"),
            &value,
        )?;

        for kind in ["keyDown", "keyUp"] {
            let mut event = json!({"type": kind, "key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "modifiers": 2});
            if kind == "keyDown" {
                event["commands"] = json!(["selectAll"]);
                event["type"] = json!("rawKeyDown");
            }
            webview2::cdp(view, "Input.dispatchKeyEvent", &event)
                .await
                .map_err(|e| e.message().to_owned())?;
        }
        let selected = page(view, "(() => { const f = document.getElementById('field'); return f.selectionEnd - f.selectionStart; })()").await?;
        check(
            "Ctrl+A with the selectAll command selects the field",
            selected == json!(11),
            &selected,
        )?;

        click(view, 60.0, 100.0, MouseButton::Right, 1)
            .await
            .map_err(|e| e.message().to_owned())?;
        let seen = events(view).await?;
        check(
            "right clicks raise a trusted contextmenu",
            seen.iter()
                .any(|e| e["type"] == "contextmenu" && e["trusted"] == true),
            json!(seen),
        )?;

        // The native input lock drops every event while it is on, so Misty
        // lifts it for just the agent's own event.
        let ignore = |value: bool| async move {
            webview2::cdp(
                view,
                "Input.setIgnoreInputEvents",
                &json!({ "ignore": value }),
            )
            .await
        };
        ignore(true).await.map_err(|e| e.message().to_owned())?;
        click(view, 60.0, 100.0, MouseButton::Left, 1)
            .await
            .map_err(|e| e.message().to_owned())?;
        let blocked = events(view).await?;
        check(
            "the input lock drops events",
            !blocked.iter().any(|e| e["type"] == "click"),
            json!(blocked),
        )?;
        ignore(false).await.map_err(|e| e.message().to_owned())?;
        click(view, 60.0, 100.0, MouseButton::Left, 1)
            .await
            .map_err(|e| e.message().to_owned())?;
        ignore(true).await.map_err(|e| e.message().to_owned())?;
        let lifted = events(view).await?;
        check(
            "an agent event lands while the lock is lifted for it",
            lifted
                .iter()
                .any(|e| e["type"] == "click" && e["trusted"] == true),
            json!(lifted),
        )?;
        ignore(false).await.map_err(|e| e.message().to_owned())?;

        webview2::cdp(
            view,
            "Input.dispatchMouseEvent",
            &json!({"type": "mouseWheel", "x": 100, "y": 100, "deltaX": 0, "deltaY": 120}),
        )
        .await
        .map_err(|e| e.message().to_owned())?;
        let seen = events(view).await?;
        check(
            "wheel events reach the page",
            seen.iter()
                .any(|e| e["type"] == "wheel" && e["trusted"] == true),
            json!(seen),
        )?;

        let tree = webview2::cdp(view, "Page.getFrameTree", &json!({}))
            .await
            .map_err(|e| e.message().to_owned())?;
        let world = webview2::cdp(
            view,
            "Page.createIsolatedWorld",
            &json!({"frameId": tree["frameTree"]["frame"]["id"], "worldName": "misty-probe"}),
        )
        .await
        .map_err(|e| e.message().to_owned())?;
        let context = world["executionContextId"].as_i64();
        let in_world = |expression: &str| evaluate(view, expression.to_owned(), context);
        in_world("globalThis.mistySecret = 'kept'; document.body.dataset.touched = 'yes'; true")
            .await
            .map_err(|e| e.message().to_owned())?;
        let kept = in_world("globalThis.mistySecret")
            .await
            .map_err(|e| e.message().to_owned())?;
        let hidden = page(view, "typeof globalThis.mistySecret").await?;
        let shared = page(view, "document.body.dataset.touched").await?;
        check(
            "isolated worlds keep their globals from the page but share its DOM",
            kept == json!("kept") && hidden == json!("undefined") && shared == json!("yes"),
            json!([kept, hidden, shared]),
        )?;

        let shot = webview2::cdp(view, "Page.captureScreenshot", &json!({"format": "png", "clip": {"x": 0, "y": 0, "width": 200, "height": 100, "scale": 1}}))
            .await
            .map_err(|e| e.message().to_owned())?;
        check(
            "screenshots return image data",
            shot["data"].as_str().is_some_and(|d| d.len() > 100),
            "no data",
        )?;

        let snapshot = webview2::cdp(view, "Page.captureSnapshot", &json!({"format": "mhtml"}))
            .await
            .map_err(|e| e.message().to_owned())?;
        check(
            "pages save as single-file MHTML",
            snapshot["data"]
                .as_str()
                .is_some_and(|d| d.contains("MIME-Version")),
            "no MHTML",
        )?;
        Ok(())
    }

    pub fn run() -> i32 {
        let status = Arc::new(AtomicI32::new(1));
        let output = status.clone();
        let root = tempfile::tempdir().expect("create a disposable profile");
        let data = root.path().to_path_buf();
        tauri::Builder::default()
            .setup(move |app| {
                let window = tauri::WindowBuilder::new(app, "windows-webview-probe")
                    .title("Misty WebView2 probe")
                    .inner_size(640.0, 400.0)
                    .build()?;
                let view = window.add_child(
                    WebviewBuilder::new("probe", WebviewUrl::External("about:blank".parse()?))
                        .data_directory(data),
                    LogicalPosition::new(0.0, 0.0),
                    LogicalSize::new(640.0, 400.0),
                )?;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let result =
                        tokio::time::timeout(std::time::Duration::from_secs(60), exercise(&view))
                            .await
                            .unwrap_or(Err("probe timeout".into()));
                    if let Err(message) = &result {
                        eprintln!("FAIL: {message}");
                    }
                    let code = if result.is_ok() { 0 } else { 1 };
                    status.store(code, Ordering::SeqCst);
                    handle.exit(code);
                });
                Ok(())
            })
            .build(tauri::generate_context!(
                "examples/cookie-store-probe/tauri.conf.json"
            ))
            .expect("build the WebView2 probe")
            .run_return(|_, _| {});
        let code = output.load(Ordering::SeqCst);
        // WebView2 keeps profile files open briefly after the views close.
        for _ in 0..50 {
            if std::fs::remove_dir_all(root.path()).is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if code == 0 {
            println!("WINDOWS WEBVIEW PROBE: all passed");
        }
        code
    }
}

#[cfg(windows)]
fn main() {
    std::process::exit(probe::run());
}

#[cfg(not(windows))]
fn main() {
    eprintln!("This probe requires Windows and WebView2");
    std::process::exit(1);
}
