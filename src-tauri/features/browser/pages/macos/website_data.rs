//! Removing website data from a profile's WebKit store.

/// Removes the chosen kinds of website data changed since `since_ms` from one
/// profile's store, leaving the store itself in place.
#[cfg(target_os = "macos")]
pub(crate) async fn clear_browser_website_data(
    app: &tauri::AppHandle,
    identifier: [u8; 16],
    data_types: Vec<&'static str>,
    since_ms: i64,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::{runtime::AnyObject, MainThreadMarker};
    use objc2_foundation::{NSArray, NSDate, NSString, NSUUID};
    use objc2_web_kit::WKWebsiteDataStore;
    use std::sync::Mutex;
    let (sender, receiver) = tokio::sync::oneshot::channel::<()>();
    app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let sender = Mutex::new(Some(sender));
        unsafe {
            let store =
                WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(identifier), mtm);
            let names = data_types
                .iter()
                .map(|name| NSString::from_str(name))
                .collect::<Vec<_>>();
            let array = NSArray::from_retained_slice(&names);
            let types: *mut AnyObject =
                objc2::msg_send![objc2::class!(NSSet), setWithArray: &*array];
            let since = NSDate::dateWithTimeIntervalSince1970(since_ms.max(0) as f64 / 1000.0);
            let retained_store = store.clone();
            let handler = RcBlock::new(move || {
                let _keep_alive = &retained_store;
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send(());
                }
            });
            let _: () = objc2::msg_send![
                &*store,
                removeDataOfTypes: types,
                modifiedSince: &*since,
                completionHandler: &*handler
            ];
        }
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(60), receiver)
        .await
        .map_err(|_| "Clearing website data timed out.".to_owned())?
        .map_err(|_| "Clearing website data was cancelled.".to_owned())
}
