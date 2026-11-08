// SPDX-License-Identifier: MIT
//! Public-API feasibility check: two extension controllers over WebKit's own classes, with
//! synthetic resources and no user browser data. Nothing of Misty's host is involved.
use super::support::{fail, json_of, require, string, Harness};
use block2::RcBlock;
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, ProtocolObject},
    DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_foundation::{NSError, NSObjectProtocol, NSPoint, NSRect, NSSize, NSURLRequest, NSURL};
use objc2_web_kit::{
    WKNavigation, WKNavigationDelegate, WKScriptMessage, WKScriptMessageHandler,
    WKUserContentController, WKWebExtension, WKWebExtensionContext,
    WKWebExtensionContextPermissionStatus, WKWebExtensionController,
    WKWebExtensionControllerConfiguration, WKWebView, WKWebsiteDataStore,
};
use serde_json::Value;
use std::{cell::RefCell, collections::VecDeque, rc::Rc};

type Inbox = Rc<RefCell<VecDeque<(usize, Value)>>>;

struct ProbeState {
    inbox: Inbox,
    /// The probe's pages, in the order their messages are told apart by.
    views: Rc<RefCell<Vec<Retained<WKWebView>>>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = ProbeState]
    struct ProbeHandler;

    unsafe impl NSObjectProtocol for ProbeHandler {}

    unsafe impl WKScriptMessageHandler for ProbeHandler {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn did_receive(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
            // SAFETY: reads the message's frame, page and body.
            let (main_frame, view, body) = unsafe {
                (
                    message.frameInfo().isMainFrame(),
                    message.webView(),
                    message.body(),
                )
            };
            let body = json_of(&body);
            if !main_frame || !body.is_object() {
                fail("Invalid bridge message");
            }
            let Some(view) = view else { return };
            let index = self
                .ivars()
                .views
                .borrow()
                .iter()
                .position(|candidate| std::ptr::eq(&**candidate, &*view));
            if let Some(index) = index {
                self.ivars().inbox.borrow_mut().push_back((index, body));
            }
        }
    }

    unsafe impl WKNavigationDelegate for ProbeHandler {
        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail(&self, _view: &WKWebView, _navigation: Option<&WKNavigation>, error: &NSError) {
            fail(error.localizedDescription());
        }
    }
);

pub fn run(root: &str) {
    let harness = Harness::new("probe");
    let mtm: MainThreadMarker = harness.mtm;
    let inbox: Inbox = Rc::default();
    let shared: Rc<RefCell<Vec<Retained<WKWebView>>>> = Rc::default();
    let handler: Retained<ProbeHandler> = {
        let this = mtm.alloc::<ProbeHandler>().set_ivars(ProbeState {
            inbox: inbox.clone(),
            views: shared.clone(),
        });
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    };
    let root = NSURL::fileURLWithPath_isDirectory(&string(root), true);
    let (mut controllers, mut contexts, mut views) = (Vec::new(), Vec::new(), Vec::new());
    for _ in 0..2 {
        let slot: Rc<RefCell<Option<Retained<WKWebExtension>>>> = Rc::default();
        let sink = slot.clone();
        let loaded = RcBlock::new(move |extension: *mut WKWebExtension, error: *mut NSError| {
            // SAFETY: WebKit passes live objects or null.
            match (unsafe { Retained::retain(extension) }, unsafe {
                error.as_ref()
            }) {
                (Some(extension), None) => *sink.borrow_mut() = Some(extension),
                (_, Some(error)) => fail(error),
                _ => fail("Extension was nil"),
            }
        });
        // SAFETY: the handler is retained by WebKit until called.
        unsafe {
            WKWebExtension::extensionWithResourceBaseURL_completionHandler(&root, &loaded, mtm)
        };
        harness.wait_until("the extension to load", 30.0, || slot.borrow().is_some());
        let extension = slot.borrow_mut().take().expect("extension");
        // SAFETY: WebKit extension setup on the main thread.
        unsafe {
            let config = WKWebExtensionControllerConfiguration::nonPersistentConfiguration(mtm);
            config
                .setDefaultWebsiteDataStore(Some(&WKWebsiteDataStore::nonPersistentDataStore(mtm)));
            let controller = WKWebExtensionController::initWithConfiguration(
                WKWebExtensionController::alloc(mtm),
                &config,
            );
            let context = WKWebExtensionContext::initForExtension(
                WKWebExtensionContext::alloc(mtm),
                &extension,
            );
            context.setUniqueIdentifier(&string("native-fixture@misty.test"));
            context.setHasAccessToPrivateData(true);
            for permission in extension.requestedPermissions().iter() {
                context.setPermissionStatus_forPermission(
                    WKWebExtensionContextPermissionStatus::GrantedExplicitly,
                    &permission,
                );
            }
            if let Err(error) = controller.loadExtensionContext_error(&context) {
                fail(error);
            }
            let view_config = context
                .webViewConfiguration()
                .unwrap_or_else(|| fail("no view configuration"));
            view_config
                .userContentController()
                .addScriptMessageHandler_name(
                    ProtocolObject::from_ref(&*handler),
                    &string("probe"),
                );
            let view = WKWebView::initWithFrame_configuration(
                WKWebView::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(400.0, 300.0)),
                &view_config,
            );
            view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*handler)));
            shared.borrow_mut().push(view.clone());
            let page = NSURL::URLWithString_relativeToURL(
                &string("bridge.html"),
                Some(&context.baseURL()),
            )
            .expect("bridge url");
            view.loadRequest(&NSURLRequest::requestWithURL(&page));
            controllers.push(controller);
            contexts.push(context);
            views.push(view);
        }
    }
    let set_probe = |view: &WKWebView| {
        let done = RcBlock::new(|_result: *mut AnyObject, error: *mut NSError| {
            // SAFETY: a live error or null.
            if let Some(error) = unsafe { error.as_ref() } {
                fail(error.localizedDescription());
            }
        });
        // SAFETY: a constant script; the handler is called once.
        unsafe {
            view.evaluateJavaScript_completionHandler(
                &string("browser.storage.sync.set({probe: 'first-device'}); void 0"),
                Some(&done),
            );
        }
    };
    let (mut ready, mut replicated) = (0, false);
    let mut deadline = 0;
    loop {
        harness.wait_until("the extension bridge", 30.0, || !inbox.borrow().is_empty());
        let (index, body) = inbox.borrow_mut().pop_front().expect("message");
        deadline += 1;
        require(deadline < 1000, "too many bridge messages");
        match body["event"].as_str() {
            Some("error") => fail(body["message"].as_str().unwrap_or("bridge error")),
            Some("ready") => {
                require(
                    body["reply"]["background"].as_bool() == Some(true),
                    "Background messaging failed",
                );
                require(
                    body["data"].as_object().is_none_or(|data| data.is_empty()),
                    "Nonpersistent storage was not empty",
                );
                ready += 1;
                if ready == 2 {
                    set_probe(&views[0]);
                }
            }
            Some("changed") if body["area"] == "sync" => {
                if index == 0 && !replicated {
                    replicated = true;
                    set_probe(&views[1]);
                } else if index == 1 && body["changes"]["probe"]["newValue"] == "first-device" {
                    println!("PASS: native extension loading, background messaging, extension-origin pages, isolated storage.sync, host replication and onChanged");
                    return;
                }
            }
            _ => {}
        }
    }
}
