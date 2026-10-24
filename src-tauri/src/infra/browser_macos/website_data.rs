//! Removing website data from a profile's WebKit store.

#[cfg(target_os = "macos")]
pub(in crate::infra) async fn remove_browser_data_store(
    app: &tauri::AppHandle,
    identifier: [u8; 16],
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSDate, NSUUID};
    use objc2_web_kit::WKWebsiteDataStore;
    use std::sync::Mutex;
    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("main thread");
        let sender = Mutex::new(Some(sender));
        unsafe {
            // WebKit may retain a just-closed WKWebView. Clearing the named store
            // works even then, whereas deleting its identifier reports "in use".
            // Never touch the default store or another account's identifier.
            let store =
                WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(identifier), mtm);
            let retained_store = store.clone();
            let handler = RcBlock::new(move || {
                let _keep_alive = &retained_store;
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Ok(()));
                    }
                }
            });
            store.removeDataOfTypes_modifiedSince_completionHandler(
                &WKWebsiteDataStore::allWebsiteDataTypes(mtm),
                &NSDate::distantPast(),
                &handler,
            );
        }
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(30), receiver)
        .await
        .map_err(|_| "Website account removal timed out. Retry removal.".to_owned())?
        .map_err(|_| "Website account removal was canceled.".to_owned())?
}
/// Removes the chosen kinds of website data changed since `since_ms` from one
/// profile's store, leaving the store itself in place.
#[cfg(target_os = "macos")]
pub(in crate::infra) async fn clear_browser_website_data(
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
