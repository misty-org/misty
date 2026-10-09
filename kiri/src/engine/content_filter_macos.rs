//! WebKit on macOS: the content filter as a compiled `WKContentRuleList` on
//! each tab's user content controller. Compiling happens once per filter
//! configuration; tabs that ask meanwhile get the list when it is ready.
//! Everything here runs on the main thread, where WebKit calls back.
//!
//! A page that is loading while the list compiles, with no list yet, is stopped
//! and loaded again once the list is in place, so its first load is filtered
//! too. What each tab
//! holds is attached to its user content controller, so it goes away with it.

use objc2::{
    class,
    ffi::{objc_getAssociatedObject, objc_setAssociatedObject, OBJC_ASSOCIATION_RETAIN_NONATOMIC},
    msg_send,
    rc::Retained,
    runtime::AnyObject,
};
use objc2_foundation::NSString;
use objc2_web_kit::WKWebView;
use std::cell::RefCell;
use tauri::{AppHandle, Webview};

/// On a controller: the rule list Misty put on it.
static INSTALLED: u8 = 0;

unsafe fn associated(object: &AnyObject, key: &'static u8) -> Option<Retained<AnyObject>> {
    let value = objc_getAssociatedObject(object, (key as *const u8).cast());
    Retained::retain(value.cast_mut())
}

unsafe fn associate(object: &AnyObject, key: &'static u8, value: Option<&AnyObject>) {
    objc_setAssociatedObject(
        (object as *const AnyObject).cast_mut(),
        (key as *const u8).cast(),
        value.map_or(std::ptr::null_mut(), |value| {
            (value as *const AnyObject).cast_mut()
        }),
        OBJC_ASSOCIATION_RETAIN_NONATOMIC,
    );
}

/// A tab waiting for the list being compiled, and the load held for it.
struct Waiting {
    controller: Retained<AnyObject>,
    /// The web view and the address (an `NSURL`) it was loading.
    held: Option<(Retained<AnyObject>, Retained<AnyObject>)>,
}

#[derive(Default)]
struct State {
    /// Configuration the cached `list` was built for.
    generation: u64,
    /// `None` when blocking is off or the rules failed to compile.
    list: Option<Retained<AnyObject>>,
    compiling: Option<u64>,
    /// Tabs waiting for the list being compiled.
    pending: Vec<Waiting>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::default();
}

fn identifier(generation: u64) -> Retained<NSString> {
    NSString::from_str(&format!("misty-content-filter-{generation}"))
}

/// Puts `list` (or nothing) on a controller, removing only Misty's previous list
/// so extension rule lists on the same controller stay.
unsafe fn set(controller: &Retained<AnyObject>, list: Option<&Retained<AnyObject>>) {
    let previous = associated(controller, &INSTALLED);
    if let (Some(previous), Some(list)) = (&previous, list) {
        if Retained::as_ptr(previous) == Retained::as_ptr(list) {
            return;
        }
    }
    if let Some(previous) = previous {
        let _: () = msg_send![&**controller, removeContentRuleList: &*previous];
    }
    if let Some(list) = list {
        let _: () = msg_send![&**controller, addContentRuleList: &**list];
    }
    associate(controller, &INSTALLED, list.map(|list| &**list));
}

/// Puts the list (or none) on each waiting tab, then lets held loads go.
unsafe fn release(waiting: Vec<Waiting>, list: Option<&Retained<AnyObject>>) {
    for tab in &waiting {
        set(&tab.controller, list);
    }
    for tab in waiting {
        let Some((view, url)) = tab.held else {
            continue;
        };
        // Resume only if nothing else navigated the tab meanwhile.
        let current: Option<Retained<AnyObject>> = msg_send![&*view, URL];
        let untouched = current.is_none_or(|current| {
            let same: bool = msg_send![&*current, isEqual: &*url];
            let blank: bool = {
                let text: Option<Retained<NSString>> = msg_send![&*current, absoluteString];
                text.is_some_and(|text| text.to_string() == "about:blank")
            };
            same || blank
        });
        if untouched {
            let request: Retained<AnyObject> =
                msg_send![class!(NSURLRequest), requestWithURL: &*url];
            let _: Option<Retained<AnyObject>> = msg_send![&*view, loadRequest: &*request];
        }
    }
}

unsafe fn compile(generation: u64, rules: String) {
    let store: *mut AnyObject = msg_send![class!(WKContentRuleListStore), defaultStore];
    if store.is_null() {
        finish(generation, None);
        return;
    }
    let done = block2::RcBlock::new(move |list: *mut AnyObject, _error: *mut AnyObject| {
        // SAFETY: WebKit hands back a valid list (or nil) on the main thread.
        unsafe {
            let list = if list.is_null() {
                None
            } else {
                Retained::retain(list)
            };
            finish(generation, list);
        }
    });
    let _: () = msg_send![
        store,
        compileContentRuleListForIdentifier: &*identifier(generation),
        encodedContentRuleList: &*NSString::from_str(&rules),
        completionHandler: &*done
    ];
}

unsafe fn finish(generation: u64, list: Option<Retained<AnyObject>>) {
    let (pending, previous_generation) = STATE.with(|state| {
        let mut state = state.borrow_mut();
        // A newer configuration started compiling; it will serve the waiters.
        if state.compiling != Some(generation) {
            return (None, None);
        }
        state.compiling = None;
        let previous = std::mem::replace(&mut state.generation, generation);
        state.list = list.clone();
        (Some(std::mem::take(&mut state.pending)), Some(previous))
    });
    if let Some(pending) = pending {
        release(pending, list.as_ref());
    }
    // Drop the superseded compiled list from WebKit's on-disk store.
    if let Some(previous) = previous_generation.filter(|previous| *previous != generation) {
        let store: *mut AnyObject = msg_send![class!(WKContentRuleListStore), defaultStore];
        if !store.is_null() {
            let ignore = block2::RcBlock::new(|_error: *mut AnyObject| {});
            let _: () = msg_send![
                store,
                removeContentRuleListForIdentifier: &*identifier(previous),
                completionHandler: &*ignore
            ];
        }
    }
}

/// Stops a tab's load while its list compiles; the load resumes in `release`.
/// A tab that already has a list keeps it until the new one is ready, so it is
/// never held.
unsafe fn hold(
    controller: &Retained<AnyObject>,
    view: Retained<AnyObject>,
) -> Option<(Retained<AnyObject>, Retained<AnyObject>)> {
    let loading: bool = msg_send![&*view, isLoading];
    if associated(controller, &INSTALLED).is_some() || !loading {
        return None;
    }
    let url: Option<Retained<AnyObject>> = msg_send![&*view, URL];
    let url = url?;
    let text: Option<Retained<NSString>> = msg_send![&*url, absoluteString];
    if text.is_none_or(|text| text.to_string() == "about:blank") {
        return None;
    }
    let _: () = msg_send![&*view, stopLoading];
    Some((view, url))
}

/// Brings `tab` (or, with none, just the compiled list) up to the current
/// configuration.
unsafe fn apply(tab: Option<(Retained<AnyObject>, Retained<AnyObject>)>) {
    let generation = crate::content_filter::generation();
    enum Next {
        Set(Option<Retained<AnyObject>>),
        Wait,
        Compile(String),
        /// Blocking is off: this tab and any still waiting lose their list.
        Clear(Vec<Waiting>),
    }
    let next = STATE.with(|state| {
        let mut state = state.borrow_mut();
        if state.generation == generation && state.compiling.is_none() {
            return Next::Set(state.list.clone());
        }
        if state.compiling == Some(generation) {
            return Next::Wait;
        }
        match crate::content_filter::webkit_rules() {
            Some(rules) => {
                state.compiling = Some(generation);
                Next::Compile(rules)
            }
            None => {
                state.compiling = None;
                state.generation = generation;
                state.list = None;
                Next::Clear(std::mem::take(&mut state.pending))
            }
        }
    });
    match next {
        Next::Set(list) => {
            if let Some((controller, _)) = tab {
                set(&controller, list.as_ref());
            }
        }
        Next::Clear(mut waiting) => {
            if let Some((controller, _)) = tab {
                waiting.push(Waiting {
                    controller,
                    held: None,
                });
            }
            release(waiting, None);
        }
        Next::Wait | Next::Compile(_) => {
            if let Some((controller, view)) = tab {
                // Stop the load outside the state borrow: it calls the navigation delegate.
                let held = hold(&controller, view);
                STATE.with(|state| {
                    state
                        .borrow_mut()
                        .pending
                        .push(Waiting { controller, held })
                });
            }
            if let Next::Compile(rules) = next {
                compile(generation, rules);
            }
        }
    }
}

pub(super) fn install_content_filter(webview: &Webview) -> Result<(), String> {
    webview
        .with_webview(|native| unsafe {
            let view: &WKWebView = &*native.inner().cast();
            let configuration = view.configuration();
            let controller: Option<Retained<AnyObject>> =
                msg_send![&*configuration, userContentController];
            let view: Option<Retained<AnyObject>> = Retained::retain(native.inner().cast());
            if let (Some(controller), Some(view)) = (controller, view) {
                apply(Some((controller, view)));
            }
        })
        .map_err(|error| error.to_string())
}

pub(super) fn prepare_content_filter(app: &AppHandle) -> Result<(), String> {
    app.run_on_main_thread(|| unsafe { apply(None) })
        .map_err(|error| error.to_string())
}
