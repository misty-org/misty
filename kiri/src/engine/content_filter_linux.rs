//! WebKitGTK on Linux: the content filter as a compiled user content filter on
//! each tab's user content manager. The Rust bindings leave the filter store
//! out, so it is called through the C API. Everything runs on the GTK thread.
//!
//! Compiling is asynchronous. A page that is loading while it runs, with no
//! filter yet, is stopped and loaded again once the filter is in place, so its
//! first load is filtered too. What each tab holds is stored on its user content manager, so it goes
//! away with the tab.

use std::{
    cell::RefCell,
    ffi::{c_void, CString},
};
use tauri::{AppHandle, Webview};
use webkit2gtk::{
    ffi, gio, glib, glib::prelude::ObjectExt, glib::translate::ToGlibPtr, UserContentManager,
    WebView, WebViewExt,
};

/// On a user content manager: the id of the filter Misty put on it.
const INSTALLED: &str = "misty-content-filter";

/// Filters are replaced by id, so each configuration compiles under its own.
fn filter_id(generation: u64) -> String {
    format!("misty-content-filter-{generation}")
}

/// A tab waiting for the filter being compiled, and the load held for it.
struct Waiting {
    manager: UserContentManager,
    held: Option<(WebView, String)>,
}

#[derive(Default)]
struct State {
    generation: u64,
    /// The compiled filter for `generation`; null when blocking is off or failed.
    filter: Option<*mut ffi::WebKitUserContentFilter>,
    compiling: Option<u64>,
    pending: Vec<Waiting>,
    store: Option<*mut ffi::WebKitUserContentFilterStore>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::default();
}

unsafe fn installed(manager: &UserContentManager) -> Option<String> {
    manager
        .data::<String>(INSTALLED)
        .map(|id| id.as_ref().clone())
}

unsafe fn set(
    manager: &UserContentManager,
    generation: u64,
    filter: Option<*mut ffi::WebKitUserContentFilter>,
) {
    use webkit2gtk::UserContentManagerExt;
    let next = filter.map(|_| filter_id(generation));
    let previous = installed(manager);
    if previous == next {
        return;
    }
    if let Some(previous) = previous {
        manager.remove_filter_by_id(&previous);
        manager.steal_data::<String>(INSTALLED);
    }
    if let (Some(filter), Some(id)) = (filter, next) {
        ffi::webkit_user_content_manager_add_filter(manager.to_glib_none().0, filter);
        manager.set_data(INSTALLED, id);
    }
}

/// Puts the filter (or none) on each waiting tab, then lets held loads go.
unsafe fn release(
    waiting: Vec<Waiting>,
    generation: u64,
    filter: Option<*mut ffi::WebKitUserContentFilter>,
) {
    for tab in &waiting {
        set(&tab.manager, generation, filter);
    }
    for tab in waiting {
        if let Some((view, uri)) = tab.held {
            // Resume only if nothing else navigated the tab meanwhile.
            let current = view.uri().map(|uri| uri.to_string()).unwrap_or_default();
            if current.is_empty() || current == "about:blank" || current == uri {
                view.load_uri(&uri);
            }
        }
    }
}

unsafe extern "C" fn compiled(
    source: *mut glib::gobject_ffi::GObject,
    result: *mut gio::ffi::GAsyncResult,
    data: *mut c_void,
) {
    let generation = *Box::from_raw(data.cast::<u64>());
    let mut error = std::ptr::null_mut();
    let filter =
        ffi::webkit_user_content_filter_store_save_finish(source.cast(), result, &mut error);
    if !error.is_null() {
        glib::ffi::g_error_free(error);
    }
    finish(generation, (!filter.is_null()).then_some(filter));
}

unsafe fn finish(generation: u64, filter: Option<*mut ffi::WebKitUserContentFilter>) {
    let waiting = STATE.with(|state| {
        let mut state = state.borrow_mut();
        if state.compiling != Some(generation) {
            if let Some(filter) = filter {
                ffi::webkit_user_content_filter_unref(filter);
            }
            return None;
        }
        state.compiling = None;
        state.generation = generation;
        if let Some(old) = state.filter.take() {
            ffi::webkit_user_content_filter_unref(old);
        }
        state.filter = filter;
        Some(std::mem::take(&mut state.pending))
    });
    if let Some(waiting) = waiting {
        release(waiting, generation, filter);
    }
}

unsafe fn store() -> Option<*mut ffi::WebKitUserContentFilterStore> {
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        if state.store.is_none() {
            let path = std::env::temp_dir().join("misty-content-filters");
            let path = CString::new(path.to_string_lossy().as_bytes()).ok()?;
            let store = ffi::webkit_user_content_filter_store_new(path.as_ptr());
            if !store.is_null() {
                state.store = Some(store);
            }
        }
        state.store
    })
}

unsafe fn compile(generation: u64, rules: String) {
    let (Some(store), Ok(id)) = (store(), CString::new(filter_id(generation))) else {
        finish(generation, None);
        return;
    };
    let bytes = glib::ffi::g_bytes_new(rules.as_ptr().cast(), rules.len());
    ffi::webkit_user_content_filter_store_save(
        store,
        id.as_ptr(),
        bytes,
        std::ptr::null_mut(),
        Some(compiled),
        Box::into_raw(Box::new(generation)).cast(),
    );
    glib::ffi::g_bytes_unref(bytes);
}

/// Stops a tab's load while its filter compiles; the load resumes in
/// `release`. A tab that already has a filter keeps it until the new one is
/// ready, so it is never held.
unsafe fn hold(manager: &UserContentManager, view: WebView) -> Option<(WebView, String)> {
    if installed(manager).is_some() || !view.is_loading() {
        return None;
    }
    let uri = view.uri()?.to_string();
    if uri.is_empty() || uri == "about:blank" {
        return None;
    }
    view.stop_loading();
    Some((view, uri))
}

/// Brings `tab` (or, with none, just the compiled filter) up to the current
/// configuration.
unsafe fn apply(tab: Option<(UserContentManager, WebView)>) {
    let generation = crate::content_filter::generation();
    enum Next {
        Set(Option<*mut ffi::WebKitUserContentFilter>),
        Wait,
        Compile(String),
        /// Blocking is off: this tab and any still waiting lose their filter.
        Clear(Vec<Waiting>),
    }
    let next = STATE.with(|state| {
        let mut state = state.borrow_mut();
        if state.generation == generation && state.compiling.is_none() {
            return Next::Set(state.filter);
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
                if let Some(old) = state.filter.take() {
                    ffi::webkit_user_content_filter_unref(old);
                }
                Next::Clear(std::mem::take(&mut state.pending))
            }
        }
    });
    match next {
        Next::Set(filter) => {
            if let Some((manager, _)) = tab {
                set(&manager, generation, filter);
            }
        }
        Next::Clear(mut waiting) => {
            if let Some((manager, _)) = tab {
                waiting.push(Waiting {
                    manager,
                    held: None,
                });
            }
            release(waiting, generation, None);
        }
        Next::Wait | Next::Compile(_) => {
            if let Some((manager, view)) = tab {
                // Stop the load outside the state borrow: it emits signals.
                let held = hold(&manager, view);
                STATE.with(|state| state.borrow_mut().pending.push(Waiting { manager, held }));
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
            let view = native.inner();
            if let Some(manager) = view.user_content_manager() {
                apply(Some((manager, view)));
            }
        })
        .map_err(|error| error.to_string())
}

pub(super) fn prepare_content_filter(app: &AppHandle) -> Result<(), String> {
    app.run_on_main_thread(|| unsafe { apply(None) })
        .map_err(|error| error.to_string())
}
