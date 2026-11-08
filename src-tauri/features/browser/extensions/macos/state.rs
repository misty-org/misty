// SPDX-License-Identifier: MIT
//! What one Space's extension host keeps.
use super::{
    native_connection::NativeConnection,
    popup_delegate::PopupWindowDelegate,
    tabs::{MistyExtensionTab, MistyExtensionWindow},
};

use objc2::rc::{Retained, Weak};
use objc2_app_kit::{NSView, NSWindow};
use objc2_foundation::{NSError, NSRect};
use objc2_web_kit::{
    WKWebExtensionContext, WKWebExtensionController, WKWebView, WKWebsiteDataStore,
};
use serde_json::Value;
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    rc::Rc,
};

pub(super) type OpenDone =
    Box<dyn FnOnce(Option<Retained<MistyExtensionTab>>, Option<Retained<NSError>>)>;
/// A compatibility answer: a result, or an error message.
pub(super) type CompatReply = Box<dyn FnOnce(Option<Value>, Option<String>)>;

pub(super) struct HostState {
    /// The Space this host belongs to. Every event it raises names it.
    pub space: String,
    pub account: Option<String>,
    pub controller_identifier: String,
    pub controller: Option<Retained<WKWebExtensionController>>,
    pub store: Option<Retained<WKWebsiteDataStore>>,
    pub contexts: HashMap<String, Retained<WKWebExtensionContext>>,
    pub descriptors: HashMap<String, Value>,
    pub load_tokens: HashMap<String, String>,
    pub tabs: HashMap<String, Retained<MistyExtensionTab>>,
    pub windows: HashMap<String, Retained<MistyExtensionWindow>>,
    pub bridges: HashMap<String, Retained<WKWebView>>,
    pub compat_views: HashMap<String, Retained<WKWebView>>,
    pub compat_replies: HashMap<String, CompatReply>,
    pub pending: HashMap<String, Box<dyn FnOnce(bool)>>,
    pub open_requests: HashMap<String, OpenDone>,
    pub opening_tabs: HashMap<String, String>,
    pub options_windows: Vec<Retained<NSWindow>>,
    pub popup_windows: Vec<Retained<NSWindow>>,
    pub native_connections: HashMap<String, Vec<Rc<NativeConnection>>>,
    pub active_tab: Option<String>,
    pub popup_tab: Option<String>,
    pub restored: HashSet<String>,
    pub popup_anchor: NSRect,
    pub popup_parent: Weak<NSView>,
    /// Navigation and UI delegate of this host's extension popup windows.
    pub popup_window_delegate: Option<Retained<PopupWindowDelegate>>,
}

impl HostState {
    pub(super) fn new(space: &str) -> Self {
        Self {
            space: space.to_owned(),
            account: None,
            controller_identifier: String::new(),
            controller: None,
            store: None,
            contexts: HashMap::new(),
            descriptors: HashMap::new(),
            load_tokens: HashMap::new(),
            tabs: HashMap::new(),
            windows: HashMap::new(),
            bridges: HashMap::new(),
            compat_views: HashMap::new(),
            compat_replies: HashMap::new(),
            pending: HashMap::new(),
            open_requests: HashMap::new(),
            opening_tabs: HashMap::new(),
            options_windows: Vec::new(),
            popup_windows: Vec::new(),
            native_connections: HashMap::new(),
            active_tab: None,
            popup_tab: None,
            restored: HashSet::new(),
            popup_anchor: NSRect::ZERO,
            popup_parent: Weak::default(),
            popup_window_delegate: None,
        }
    }
}

pub(super) struct HostIvars {
    pub(super) state: RefCell<HostState>,
}
