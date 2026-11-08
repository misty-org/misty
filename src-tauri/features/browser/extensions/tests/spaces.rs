// SPDX-License-Identifier: MIT
//! One extension controller per Space, both live at once, each bound to its Space's named
//! website data store: extension storage stays in its Space, survives a restart (the probe
//! runs three times as separate processes) and goes with the Space.
use super::support::{fail, require, string, url, Harness};
use block2::RcBlock;
use objc2::{rc::Retained, MainThreadOnly};
use objc2_foundation::{
    NSArray, NSError, NSPoint, NSRect, NSSize, NSURLComponents, NSURLQueryItem, NSURLRequest,
    NSURL, NSUUID,
};
use objc2_web_kit::{
    WKWebExtension, WKWebExtensionContext, WKWebExtensionContextPermissionStatus,
    WKWebExtensionController, WKWebExtensionControllerConfiguration, WKWebView,
    WKWebViewConfiguration, WKWebsiteDataStore,
};
use serde_json::json;
use std::{cell::Cell, rc::Rc};

fn uuid(text: &str) -> Retained<NSUUID> {
    NSUUID::from_string(&string(text)).unwrap_or_else(|| fail("Invalid UUID"))
}

pub fn run(root: &str, page: &str, mode: &str, ids: &[String]) {
    let harness = Harness::new("space");
    let mtm = harness.mtm;
    let (stores, controllers) = (&ids[0..2], &ids[2..4]);
    if mode == "cleanup" {
        // Removal must not be the first WebKit call in a process.
        // SAFETY: a throwaway view to start WebKit's processes.
        let _ = unsafe { WKWebView::initWithFrame(WKWebView::alloc(mtm), NSRect::ZERO) };
        let pending = Rc::new(Cell::new(4));
        // Blocks WebKit calls back later; they must outlive this scope's calls.
        let mut keep: Vec<Box<dyn std::any::Any>> = Vec::new();
        for index in 0..2 {
            // SAFETY: a controller over the Space's identifier, then removal of its stored data.
            unsafe {
                let config = WKWebExtensionControllerConfiguration::configurationWithIdentifier(
                    &uuid(&controllers[index]),
                    mtm,
                );
                let controller = WKWebExtensionController::initWithConfiguration(
                    WKWebExtensionController::alloc(mtm),
                    &config,
                );
                let types = WKWebExtensionController::allExtensionDataTypes(mtm);
                let (removing, again, count) = (controller.clone(), types.clone(), pending.clone());
                let fetched = RcBlock::new(
                    move |records: std::ptr::NonNull<
                        NSArray<objc2_web_kit::WKWebExtensionDataRecord>,
                    >| {
                        let count = count.clone();
                        let done = RcBlock::new(move || count.set(count.get() - 1));
                        removing.removeDataOfTypes_fromDataRecords_completionHandler(
                            &again,
                            records.as_ref(),
                            &done,
                        );
                    },
                );
                controller.fetchDataRecordsOfTypes_completionHandler(&types, &fetched);
                let count = pending.clone();
                let removed = RcBlock::new(move |error: *mut NSError| {
                    if let Some(error) = error.as_ref() {
                        fail(error.localizedDescription());
                    }
                    count.set(count.get() - 1);
                });
                WKWebsiteDataStore::removeDataStoreForIdentifier_completionHandler(
                    &uuid(&stores[index]),
                    &removed,
                    mtm,
                );
                keep.push(Box::new((controller, fetched, removed)));
            }
        }
        harness.wait_until("the stored data to go", 30.0, || pending.get() == 0);
        println!("PASS cleanup");
        return;
    }

    let slot: Rc<std::cell::RefCell<Option<Retained<WKWebExtension>>>> = Rc::default();
    let sink = slot.clone();
    let loaded = RcBlock::new(move |extension: *mut WKWebExtension, error: *mut NSError| {
        // SAFETY: WebKit passes live objects or null.
        match unsafe { Retained::retain(extension) } {
            Some(extension) => *sink.borrow_mut() = Some(extension),
            None => fail(
                unsafe { error.as_ref() }.map_or("Extension was nil".into(), |e| e.to_string()),
            ),
        }
    });
    let folder = NSURL::fileURLWithPath_isDirectory(&string(root), true);
    // SAFETY: the handler is retained by WebKit until called.
    unsafe {
        WKWebExtension::extensionWithResourceBaseURL_completionHandler(&folder, &loaded, mtm)
    };
    harness.wait_until("the extension to load", 30.0, || slot.borrow().is_some());
    let extension = slot.borrow_mut().take().expect("extension");
    let mut views = Vec::new();
    let mut windows = Vec::new();
    for index in 0..2 {
        // SAFETY: WebKit extension setup on the main thread; a Space's page has its own store,
        // its own controller, and its own window.
        unsafe {
            let store = WKWebsiteDataStore::dataStoreForIdentifier(&uuid(&stores[index]), mtm);
            let config = WKWebExtensionControllerConfiguration::configurationWithIdentifier(
                &uuid(&controllers[index]),
                mtm,
            );
            config.setDefaultWebsiteDataStore(Some(&store));
            let controller = WKWebExtensionController::initWithConfiguration(
                WKWebExtensionController::alloc(mtm),
                &config,
            );
            let context = WKWebExtensionContext::initForExtension(
                WKWebExtensionContext::alloc(mtm),
                &extension,
            );
            context.setUniqueIdentifier(&string("space-fixture@misty.test"));
            for permission in extension.requestedPermissions().iter() {
                context.setPermissionStatus_forPermission(
                    WKWebExtensionContextPermissionStatus::GrantedExplicitly,
                    &permission,
                );
            }
            for pattern in extension.allRequestedMatchPatterns().iter() {
                context.setPermissionStatus_forMatchPattern(
                    WKWebExtensionContextPermissionStatus::GrantedExplicitly,
                    &pattern,
                );
            }
            if let Err(error) = controller.loadExtensionContext_error(&context) {
                fail(error);
            }
            let view_config = WKWebViewConfiguration::new(mtm);
            view_config.setWebsiteDataStore(&store);
            view_config.setWebExtensionController(Some(&controller));
            let window = objc2_app_kit::NSWindow::initWithContentRect_styleMask_backing_defer(
                objc2_app_kit::NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(400.0, 300.0)),
                objc2_app_kit::NSWindowStyleMask::Titled,
                objc2_app_kit::NSBackingStoreType::Buffered,
                false,
            );
            window.setReleasedWhenClosed(false);
            let view = WKWebView::initWithFrame_configuration(
                WKWebView::alloc(mtm),
                window.contentView().expect("content").bounds(),
                &view_config,
            );
            window.setContentView(Some(&view));
            views.push((view, controller, context));
            windows.push(window);
        }
    }
    for (index, (view, _, _)) in views.iter().enumerate() {
        let space = if index == 0 { "a" } else { "b" };
        // The page address, with the Space's name as a query item.
        let address = {
            let components =
                NSURLComponents::componentsWithURL_resolvingAgainstBaseURL(&url(page), false)
                    .expect("components");
            components.setQueryItems(Some(&NSArray::from_retained_slice(&[
                NSURLQueryItem::queryItemWithName_value(&string("space"), Some(&string(space))),
            ])));
            components.URL().expect("address")
        };
        // SAFETY: loads the Space's page.
        unsafe { view.loadRequest(&NSURLRequest::requestWithURL(&address)) };
        let mut before = String::new();
        harness.wait_until("the content script", 10.0, || {
            let seen = harness
                .eval(
                    view,
                    "return [document.documentElement.dataset.ext, document.documentElement.dataset.before].join(',')",
                    &json!({}),
                )
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default();
            // The page ran its script once it says so; polling is a tenth of a second apart.
            harness.spin(0.1);
            match seen.strip_prefix("ran,") {
                Some(rest) => {
                    before = rest.to_owned();
                    true
                }
                None => false,
            }
        });
        // Write: B runs after A wrote, so "none" proves per-Space extension storage.
        // Verify (after restart): each Space finds only its own value.
        let expected = if mode == "write" { "none" } else { space };
        println!("{mode} space {space}: content script ran, extension storage held {before}");
        require(
            before == expected,
            format!("Space {space} expected {expected}"),
        );
    }
    println!("PASS {mode}: two live extension controllers, one per Space store");
}
