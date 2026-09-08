//! Named WKContentWorlds: Misty code that shares a page's DOM but not its
//! JavaScript, so page scripts can neither observe nor patch it.
use tauri::Webview;

/// Runs `function_body` in the named Misty content world. Each world shares the
/// DOM with the page but keeps its own globals, invisible to page scripts and
/// to other worlds, for as long as the page lives.
pub(crate) async fn evaluate_in_content_world(
    webview: Webview,
    world_name: &'static str,
    function_body: String,
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
                None,
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
