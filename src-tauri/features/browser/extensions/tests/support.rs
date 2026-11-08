// SPDX-License-Identifier: MIT
//! What the native extension probes share: a main-thread run loop they wait on, the
//! production host's request and event channel, and views wired the way Misty wires them.
use block2::{DynBlock, RcBlock};
use misty_native::browser::extensions::macos;
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject},
    MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSWindow, NSWindowStyleMask,
};
use objc2_foundation::{
    NSArray, NSData, NSDate, NSError, NSJSONReadingOptions, NSJSONSerialization, NSObjectProtocol,
    NSPoint, NSRect, NSRunLoop, NSSize, NSString, NSURLRequest, NSURL,
};
use objc2_web_kit::{
    WKContentWorld, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKWebView,
    WKWebViewConfiguration, WKWebsiteDataStore,
};
use serde_json::Value;
use std::{
    cell::{Cell, RefCell},
    collections::VecDeque,
    rc::Rc,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// Every probe runs as one Space with its own named store.
pub const PROBE_STORE: &str = "6D697374-7900-4000-8000-70726F626573";

pub fn fail(message: impl std::fmt::Display) -> ! {
    eprintln!("FAIL: {message}");
    std::process::exit(1)
}

pub fn require(condition: bool, message: impl std::fmt::Display) {
    if !condition {
        fail(message);
    }
}

pub fn string(text: &str) -> Retained<NSString> {
    NSString::from_str(text)
}

pub fn url(text: &str) -> Retained<NSURL> {
    NSURL::URLWithString(&string(text)).unwrap_or_else(|| fail(format!("invalid URL {text}")))
}

/// A Foundation object (a script message body or WebKit's answer) as JSON.
pub fn json_of(object: &AnyObject) -> Value {
    let wrapper = NSArray::from_slice(&[object]);
    // SAFETY: validity is checked before serializing.
    unsafe {
        if !NSJSONSerialization::isValidJSONObject(&wrapper) {
            return Value::Null;
        }
        let Ok(data) = NSJSONSerialization::dataWithJSONObject_options_error(
            &wrapper,
            objc2_foundation::NSJSONWritingOptions(0),
        ) else {
            return Value::Null;
        };
        match serde_json::from_slice::<Value>(&data.to_vec()) {
            Ok(Value::Array(mut items)) if items.len() == 1 => items.remove(0),
            _ => Value::Null,
        }
    }
}

/// A JSON object as an `NSDictionary` of script arguments.
pub fn arguments(value: &Value) -> Retained<objc2_foundation::NSDictionary<NSString, AnyObject>> {
    let bytes = serde_json::to_vec(value).expect("json");
    // SAFETY: parses bytes serde_json produced; a JSON object has string keys.
    unsafe {
        let parsed = NSJSONSerialization::JSONObjectWithData_options_error(
            &NSData::with_bytes(&bytes),
            NSJSONReadingOptions(0),
        )
        .expect("parse");
        Retained::cast_unchecked(
            parsed
                .downcast::<objc2_foundation::NSDictionary>()
                .expect("object"),
        )
    }
}

define_class!(
    /// Hands navigations to the production host, as Misty's web view delegate does.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    pub struct FixtureNavigation;

    unsafe impl NSObjectProtocol for FixtureNavigation {}

    unsafe impl WKNavigationDelegate for FixtureNavigation {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide(
            &self,
            view: &WKWebView,
            action: &WKNavigationAction,
            done: &DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            let handled = macos::navigation(view, action);
            done.call((if handled {
                WKNavigationActionPolicy::Cancel
            } else {
                WKNavigationActionPolicy::Allow
            },));
        }
    }
);

type EventHandler = Rc<dyn Fn(&Harness, &Value)>;

pub struct Harness {
    pub mtm: MainThreadMarker,
    pub account: String,
    pub window: Retained<NSWindow>,
    pub views: RefCell<Vec<Retained<WKWebView>>>,
    navigation: Retained<FixtureNavigation>,
    events: Arc<Mutex<VecDeque<Value>>>,
    seen: Cell<usize>,
    handler: RefCell<Option<EventHandler>>,
}

impl Harness {
    pub fn new(prefix: &str) -> Self {
        let mtm =
            MainThreadMarker::new().unwrap_or_else(|| fail("native probes run on the main thread"));
        if !macos::supported() {
            eprintln!("SKIP: extensions need macOS 15.4 or later");
            std::process::exit(0);
        }
        let app = NSApplication::sharedApplication(mtm);
        app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        // SAFETY: AppKit window construction on the main thread.
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(80.0, 80.0), NSSize::new(500.0, 400.0)),
                NSWindowStyleMask::Titled,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        window.makeKeyAndOrderFront(None);
        let events = Arc::new(Mutex::new(VecDeque::new()));
        let sink = events.clone();
        macos::set_events(move |event| {
            eprintln!("event: {}", event["kind"].as_str().unwrap_or_default());
            sink.lock().unwrap().push_back(event);
        });
        let navigation = {
            let this = mtm.alloc::<FixtureNavigation>().set_ivars(());
            // SAFETY: NSObject's designated initializer.
            unsafe { msg_send![super(this), init] }
        };
        Self {
            mtm,
            account: format!("{prefix}-{}", objc2_foundation::NSUUID::new().UUIDString()),
            window,
            views: RefCell::default(),
            navigation,
            events,
            seen: Cell::new(0),
            handler: RefCell::default(),
        }
    }

    /// Runs `handler` for every event the host raises while the probe waits: the app's side
    /// of requests the host forwards.
    pub fn on_event(&self, handler: impl Fn(&Harness, &Value) + 'static) {
        *self.handler.borrow_mut() = Some(Rc::new(handler));
    }

    fn pump(&self) {
        let handler = self.handler.borrow().clone();
        loop {
            let event = self.events.lock().unwrap().get(self.seen.get()).cloned();
            let Some(event) = event else { return };
            self.seen.set(self.seen.get() + 1);
            if let Some(handler) = &handler {
                handler(self, &event);
            }
        }
    }

    /// Runs the main run loop for a while, answering events as they arrive.
    pub fn spin(&self, seconds: f64) {
        let end = Instant::now() + Duration::from_secs_f64(seconds);
        while Instant::now() < end {
            NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.01));
            self.pump();
        }
    }

    pub fn wait_until(&self, what: &str, seconds: f64, mut done: impl FnMut() -> bool) {
        let end = Instant::now() + Duration::from_secs_f64(seconds);
        while !done() {
            if Instant::now() > end {
                fail(format!("timed out waiting for {what}"));
            }
            NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.01));
            self.pump();
        }
    }

    /// Takes the first event the predicate accepts, waiting for it if it has not come yet.
    pub fn wait_event(&self, what: &str, seconds: f64, accept: impl Fn(&Value) -> bool) -> Value {
        let mut found = None;
        self.wait_until(what, seconds, || {
            let mut events = self.events.lock().unwrap();
            let Some(index) = events.iter().position(&accept) else {
                return false;
            };
            found = events.remove(index);
            // The handler's cursor counts events in the queue.
            if index < self.seen.get() {
                self.seen.set(self.seen.get() - 1);
            }
            true
        });
        found.expect("event")
    }

    /// Sends the host a request and waits for its answer; an error answer fails the probe.
    pub fn request(&self, input: Value) -> Value {
        let slot = Rc::new(RefCell::new(None));
        self.send(input, {
            let slot = slot.clone();
            Box::new(move |value| *slot.borrow_mut() = Some(value))
        });
        self.wait_until("an extension host answer", 45.0, || slot.borrow().is_some());
        let value = slot.borrow_mut().take().expect("answer");
        if let Some(message) = value["error"].as_str() {
            fail(message);
        }
        value
    }

    /// The same, without waiting (the answer is not needed).
    pub fn fire(&self, input: Value) {
        self.send(input, Box::new(|_| {}));
    }

    fn send(&self, mut input: Value, reply: macos::Reply) {
        let object = input.as_object_mut().expect("request object");
        object
            .entry("account")
            .or_insert_with(|| self.account.clone().into());
        object.entry("space").or_insert_with(|| "probe".into());
        macos::request(input, reply);
    }

    /// Runs a script in a page's world and waits for its result.
    pub fn eval(&self, view: &WKWebView, script: &str, args: &Value) -> Result<Value, String> {
        let slot: Rc<RefCell<Option<Result<Value, String>>>> = Rc::default();
        let sink = slot.clone();
        let done = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
            // SAFETY: WebKit passes live objects or null.
            let answer = match unsafe { error.as_ref() } {
                Some(error) => Err(error.localizedDescription().to_string()),
                None => Ok(unsafe { result.as_ref() }.map_or(Value::Null, json_of)),
            };
            *sink.borrow_mut() = Some(answer);
        });
        // SAFETY: the handler is called once.
        unsafe {
            view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &string(script),
                Some(&arguments(args)),
                None,
                &WKContentWorld::pageWorld(self.mtm),
                Some(&done),
            );
        }
        self.wait_until("a page script", 30.0, || slot.borrow().is_some());
        let answer = slot.borrow_mut().take().expect("result");
        answer
    }

    /// A page in the probe window, configured and registered as the production host expects.
    pub fn view_for(
        &self,
        page: &str,
        identifier: &str,
        private: bool,
        store: &WKWebsiteDataStore,
        load: bool,
    ) -> Retained<WKWebView> {
        // SAFETY: WebKit configuration on the main thread.
        let original = unsafe { WKWebViewConfiguration::new(self.mtm) };
        unsafe { original.setWebsiteDataStore(store) };
        self.view_with(&original, page, identifier, private, load)
    }

    pub fn view_with(
        &self,
        original: &WKWebViewConfiguration,
        page: &str,
        identifier: &str,
        private: bool,
        load: bool,
    ) -> Retained<WKWebView> {
        let configuration = macos::configuration(self.mtm, "probe", original, page)
            .unwrap_or_else(|| fail("Native configuration was not returned"));
        // SAFETY: a view over the host's configuration, in the probe window.
        let view = unsafe {
            WKWebView::initWithFrame_configuration(
                WKWebView::alloc(self.mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(500.0, 300.0)),
                &configuration,
            )
        };
        unsafe {
            view.setNavigationDelegate(Some(objc2::runtime::ProtocolObject::from_ref(
                &*self.navigation,
            )))
        };
        self.views.borrow_mut().push(view.clone());
        self.window
            .contentView()
            .expect("content view")
            .addSubview(&view);
        macos::register_tab("probe", &view, identifier, private, page);
        if load {
            // SAFETY: loads the page the probe named.
            unsafe { view.loadRequest(&NSURLRequest::requestWithURL(&url(page))) };
        }
        view
    }

    pub fn named_store(&self, uuid: &str) -> Retained<WKWebsiteDataStore> {
        let id = objc2_foundation::NSUUID::from_string(&string(uuid))
            .unwrap_or_else(|| fail("invalid store id"));
        // SAFETY: looks up a named store on the main thread.
        unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&id, self.mtm) }
    }

    pub fn random_origin() -> String {
        objc2_foundation::NSUUID::new()
            .UUIDString()
            .to_string()
            .to_lowercase()
    }

    /// Wires Kiri's real extension transport into the host, as the app does at start.
    pub fn use_kiri_transport() {
        struct Channel;
        impl kiri::extensions::bridge::ExtensionChannel for Channel {
            unsafe fn receive(&self, message: *mut std::ffi::c_void, reply: *mut std::ffi::c_void) {
                // SAFETY: Kiri's contract for `receive` is the host's contract for `compat_message`.
                unsafe { macos::compat_message(message, reply) }
            }
        }
        kiri::extensions::bridge::set_extension_channel(Channel);
        macos::set_compat_channel(|controller| {
            // SAFETY: the host passes a live user content controller on the main thread.
            unsafe { kiri::extensions::bridge::install(controller) }
        });
    }
}
