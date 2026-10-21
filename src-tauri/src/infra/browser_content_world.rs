//! Named script worlds: Misty code that shares a page's DOM but not its
//! JavaScript, so page scripts can neither observe nor patch it. WebKit calls
//! them content worlds; Chromium calls them isolated worlds.
use tauri::Webview;

/// Runs `function_body` in the named Misty content world. Each world shares the
/// DOM with the page but keeps its own globals, invisible to page scripts and
/// to other worlds, for as long as the page lives.
#[cfg(target_os = "macos")]
pub(crate) async fn evaluate_in_content_world(
    webview: Webview,
    world_name: &'static str,
    function_body: String,
) -> Result<String, String> {
    evaluate_in(webview, world_name, function_body, None).await
}

/// Runs `function_body` in the named world of one cross-origin frame the tab announced
/// (browser_frames.rs). A frame that no longer answers is forgotten.
#[cfg(target_os = "macos")]
pub(crate) async fn evaluate_in_frame(
    webview: Webview,
    world_name: &'static str,
    function_body: String,
    frame: u64,
) -> Result<String, String> {
    let result = evaluate_in(webview.clone(), world_name, function_body, Some(frame)).await;
    if result.is_err() {
        let _ = webview.with_webview(move |platform| unsafe {
            super::browser_frames::forget(&*platform.inner().cast(), frame);
        });
    }
    result
}

/// Runs `function_body` in the named isolated world of one cross-origin frame the tab
/// listed (browser_frames_windows.rs), through the session that runs the frame. A frame
/// that no longer answers is forgotten.
#[cfg(windows)]
pub(crate) async fn evaluate_in_frame(
    webview: Webview,
    world_name: &'static str,
    function_body: String,
    frame: u64,
) -> Result<String, String> {
    use crate::infra::webview2::{cdp, cdp_in_session, evaluate, evaluate_in_session, CdpError};
    use serde_json::json;

    let target =
        super::browser_frames::target(webview.label(), frame).ok_or("The frame is gone.")?;
    let session = target.session.as_deref();
    let result = async {
        // A frame keeps one world per name for as long as its document lives, so asking
        // again returns the same world and the globals left in it.
        let parameters =
            json!({ "frameId": target.frame, "worldName": world_name, "grantUniveralAccess": false });
        let created = match session {
            Some(session) => {
                cdp_in_session(&webview, session, "Page.createIsolatedWorld", &parameters).await?
            }
            None => cdp(&webview, "Page.createIsolatedWorld", &parameters).await?,
        };
        let context = created["executionContextId"]
            .as_i64()
            .ok_or(CdpError::Invalid)?;
        let expression = format!("(async () => {{\n{function_body}\n}})()");
        match session {
            Some(session) => evaluate_in_session(&webview, session, expression, context).await,
            None => evaluate(&webview, expression, Some(context)).await,
        }
    }
    .await;
    let result = answer(result);
    if result.is_err() {
        super::browser_frames::forget(webview.label(), frame);
    }
    result
}

#[cfg(windows)]
fn answer(
    result: Result<serde_json::Value, crate::infra::webview2::CdpError>,
) -> Result<String, String> {
    use serde_json::Value;
    match result {
        Ok(Value::String(value)) => Ok(value),
        Ok(Value::Null) => Ok("null".to_owned()),
        Ok(_) => Err("The page returned an invalid answer.".to_owned()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(target_os = "macos")]
async fn evaluate_in(
    webview: Webview,
    world_name: &'static str,
    function_body: String,
    frame: Option<u64>,
) -> Result<String, String> {
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentWorld, WKWebView};
    use std::{cell::RefCell, collections::HashMap, sync::Mutex, time::Duration};

    thread_local! {
        static WORLDS: RefCell<HashMap<&'static str, Retained<WKContentWorld>>> = RefCell::new(HashMap::new());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    let finish = move |result: Result<String, String>| {
        if let Some(sender) = sender.lock().ok().and_then(|mut s| s.take()) {
            let _ = sender.send(result);
        }
    };
    let finish = std::sync::Arc::new(finish);
    let fail = finish.clone();
    webview
        .with_webview(move |platform_webview| unsafe {
            let Some(mtm) = MainThreadMarker::new() else {
                fail(Err("Page state must run on the main thread.".to_owned()));
                return;
            };
            let view: &WKWebView = &*platform_webview.inner().cast();
            let world = WORLDS.with(|worlds| {
                worlds
                    .borrow_mut()
                    .entry(world_name)
                    .or_insert_with(|| {
                        WKContentWorld::worldWithName(&NSString::from_str(world_name), mtm)
                    })
                    .clone()
            });
            let frame = match frame {
                Some(id) => match super::browser_frames::info(view, id) {
                    Some(info) => Some(info),
                    None => {
                        fail(Err("The frame is gone.".to_owned()));
                        return;
                    }
                },
                None => None,
            };
            let done = finish.clone();
            let handler = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err("The page could not run page-state code.".to_owned())
                } else if value.is_null() {
                    Ok("null".to_owned())
                } else if let Some(value) = (&*value).downcast_ref::<NSString>() {
                    Ok(value.to_string())
                } else {
                    Err("The page returned an invalid page state.".to_owned())
                };
                done(result);
            });
            view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(&function_body),
                None,
                frame.as_deref(),
                &world,
                Some(&*handler),
            );
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "Page state timed out.".to_owned())?
        .map_err(|_| "Page state was canceled.".to_owned())?
}

/// Runs `function_body` in the named Misty isolated world of the page's main
/// frame. Each world shares the DOM with the page but keeps its own globals,
/// invisible to page scripts and to other worlds, for as long as the document
/// lives: a world is created once per document and reused until it navigates.
#[cfg(windows)]
pub(crate) async fn evaluate_in_content_world(
    webview: Webview,
    world_name: &'static str,
    function_body: String,
) -> Result<String, String> {
    use crate::infra::webview2::{cdp, evaluate, CdpError};
    use serde_json::json;
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
    };

    /// (view, world) -> (document loader, execution context)
    type Worlds = HashMap<(String, &'static str), (String, i64)>;
    static WORLDS: OnceLock<Mutex<Worlds>> = OnceLock::new();
    let worlds = WORLDS.get_or_init(Mutex::default);

    let tree = cdp(&webview, "Page.getFrameTree", &json!({})).await?;
    let frame = &tree["frameTree"]["frame"];
    let (frame_id, loader) = match (frame["id"].as_str(), frame["loaderId"].as_str()) {
        (Some(frame), Some(loader)) => (frame.to_owned(), loader.to_owned()),
        _ => return Err(CdpError::Invalid.into()),
    };
    let key = (webview.label().to_owned(), world_name);
    let cached = worlds
        .lock()
        .ok()
        .and_then(|worlds| worlds.get(&key).cloned())
        .filter(|(document, _)| *document == loader)
        .map(|(_, context)| context);
    let context = match cached {
        Some(context) => context,
        None => {
            let created = cdp(
                &webview,
                "Page.createIsolatedWorld",
                &json!({ "frameId": frame_id, "worldName": world_name, "grantUniveralAccess": false }),
            )
            .await?;
            let context = created["executionContextId"]
                .as_i64()
                .ok_or(CdpError::Invalid)?;
            if let Ok(mut worlds) = worlds.lock() {
                // Forget worlds of views that closed or navigated away.
                worlds.retain(|(view, _), _| view != webview.label());
                worlds.insert(key, (loader, context));
            }
            context
        }
    };
    let expression = format!("(async () => {{\n{function_body}\n}})()");
    answer(evaluate(&webview, expression, Some(context)).await)
}
