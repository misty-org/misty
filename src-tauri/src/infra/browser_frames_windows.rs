//! Cross-origin frames on Windows (browser_frames.rs). The tab's DevTools session attaches
//! to each out-of-process frame, and each of those to its own (`Target.setAutoAttach` with
//! `flatten`). The frame trees of the tab and of those sessions say which frames are
//! cross-origin to the top document and which session runs each, so the page layer can
//! run in an isolated world of every one (browser_content_world.rs).
use super::browser_frames::Frame;
use crate::infra::webview2::{cdp, cdp_in_session, owned_string};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2_11},
};
use windows::core::{Interface, HSTRING};

mod tree;
use tree::cross_origin_frames;

/// Frames remembered per tab; the oldest are forgotten first.
const MAX_FRAMES: usize = 24;
/// Out-of-process frame sessions remembered per tab.
const MAX_SESSIONS: usize = 64;
/// Attach to out-of-process frames without pausing them.
const AUTO_ATTACH: &str = r#"{"autoAttach":true,"waitForDebuggerOnStart":false,"flatten":true,"filter":[{"type":"iframe"}]}"#;
const ATTACHED: &str = "Target.attachedToTarget";
const DETACHED: &str = "Target.detachedFromTarget";

/// Where the page layer reaches one frame: the target session that runs it (None for the
/// tab's own) and its CDP frame id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Target {
    pub session: Option<String>,
    pub frame: String,
}

/// One frame document. A frame that loads another document counts as new, as when it
/// announces itself again on macOS.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Found {
    target: Target,
    document: String,
    url: String,
}

#[derive(Clone, Debug)]
struct Entry {
    id: u64,
    found: Found,
}

#[derive(Default)]
struct Tab {
    /// Sessions of the tab's out-of-process frames, in the order they attached.
    sessions: Vec<String>,
    /// The top document's loader; a new one means a new page.
    document: String,
    frames: Vec<Entry>,
}

fn tabs() -> &'static Mutex<HashMap<String, Tab>> {
    static TABS: OnceLock<Mutex<HashMap<String, Tab>>> = OnceLock::new();
    TABS.get_or_init(Mutex::default)
}

fn next_id() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

impl Tab {
    /// Applies one Target event; returns the session of a frame that just attached.
    fn event(&mut self, event: &str, parameters: &Value) -> Option<String> {
        let session = parameters["sessionId"].as_str()?.to_owned();
        if event == DETACHED {
            self.sessions.retain(|known| *known != session);
            return None;
        }
        if event != ATTACHED || parameters["targetInfo"]["type"] != "iframe" {
            return None;
        }
        if !self.sessions.contains(&session) {
            if self.sessions.len() >= MAX_SESSIONS {
                self.sessions.remove(0);
            }
            self.sessions.push(session.clone());
        }
        Some(session)
    }

    /// Keeps the ids of frame documents still showing, gives new ones the next ids, and
    /// returns them oldest first.
    fn reconcile(&mut self, document: &str, found: Vec<Found>) -> Vec<Frame> {
        if self.document != document {
            self.document = document.to_owned();
            self.frames.clear();
        }
        let mut frames: Vec<Entry> = self
            .frames
            .iter()
            .filter(|entry| found.contains(&entry.found))
            .cloned()
            .collect();
        for found in found {
            if !frames.iter().any(|entry| entry.found == found) {
                frames.push(Entry {
                    id: next_id(),
                    found,
                });
            }
        }
        if frames.len() > MAX_FRAMES {
            frames.drain(..frames.len() - MAX_FRAMES);
        }
        self.frames = frames;
        self.frames
            .iter()
            .map(|entry| Frame {
                id: entry.id,
                url: entry.found.url.clone(),
            })
            .collect()
    }

    fn target(&self, id: u64) -> Option<Target> {
        self.frames
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.found.target.clone())
    }
}

/// Asks a session (None: the tab's own) to attach to its out-of-process frames.
fn auto_attach(core: &ICoreWebView2, session: Option<&str>) {
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
    let method = HSTRING::from("Target.setAutoAttach");
    let parameters = HSTRING::from(AUTO_ATTACH);
    // SAFETY: a live view on its UI thread; the handler owns no state.
    let _ = unsafe {
        match session {
            None => core.CallDevToolsProtocolMethod(&method, &parameters, &handler),
            Some(session) => core.cast::<ICoreWebView2_11>().and_then(|core| {
                core.CallDevToolsProtocolMethodForSession(
                    &HSTRING::from(session),
                    &method,
                    &parameters,
                    &handler,
                )
            }),
        }
    };
}

/// Follows the tab's frame sessions as they attach and detach, then starts attaching.
pub(crate) fn install(webview: &tauri::Webview) -> Result<(), String> {
    let label = webview.label().to_owned();
    webview
        .with_webview(move |platform| {
            // SAFETY: the controller is live during this UI-thread callback.
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                return;
            };
            for event in [ATTACHED, DETACHED] {
                let label = label.clone();
                let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(
                    move |core, args| {
                        let (Some(core), Some(args)) = (core, args) else {
                            return Ok(());
                        };
                        // SAFETY: event arguments are valid for the handler's duration.
                        let Some(parameters) =
                            (unsafe { owned_string(|value| args.ParameterObjectAsJson(value)) })
                        else {
                            return Ok(());
                        };
                        let Ok(parameters) = serde_json::from_str::<Value>(&parameters) else {
                            return Ok(());
                        };
                        let attached = tabs().lock().ok().and_then(|mut tabs| {
                            // Closed tabs leave their entries behind; past this many, start afresh.
                            if tabs.len() > 256 && !tabs.contains_key(&label) {
                                tabs.clear();
                            }
                            tabs.entry(label.clone())
                                .or_default()
                                .event(event, &parameters)
                        });
                        // A frame's own out-of-process frames attach through its session.
                        if let Some(session) = attached {
                            auto_attach(&core, Some(&session));
                        }
                        Ok(())
                    },
                ));
                let mut token = Default::default();
                // SAFETY: as above.
                let _ = unsafe {
                    core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event))
                        .and_then(|receiver| {
                            receiver.add_DevToolsProtocolEventReceived(&handler, &mut token)
                        })
                };
            }
            auto_attach(&core, None);
        })
        .map_err(|error| error.to_string())
}

/// The tab's cross-origin frames, oldest first.
pub(crate) async fn list(view: &tauri::Webview) -> Vec<Frame> {
    let Ok(top) = cdp(view, "Page.getFrameTree", &json!({})).await else {
        return Vec::new();
    };
    let label = view.label();
    let sessions = tabs()
        .lock()
        .ok()
        .and_then(|tabs| tabs.get(label).map(|tab| tab.sessions.clone()))
        .unwrap_or_default();
    let trees = futures_util::future::join_all(sessions.into_iter().map(|session| async move {
        let tree = cdp_in_session(view, &session, "Page.getFrameTree", &json!({}))
            .await
            .ok()?;
        Some((session, tree))
    }))
    .await
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let Some((document, found)) = cross_origin_frames(&top, &trees) else {
        return Vec::new();
    };
    let Ok(mut tabs) = tabs().lock() else {
        return Vec::new();
    };
    tabs.entry(label.to_owned())
        .or_default()
        .reconcile(&document, found)
}

/// Where one listed frame runs, to run script inside it.
pub(crate) fn target(label: &str, id: u64) -> Option<Target> {
    tabs().lock().ok()?.get(label)?.target(id)
}

/// Forgets a frame that no longer answers, such as one its page removed.
pub(crate) fn forget(label: &str, id: u64) {
    if let Ok(mut tabs) = tabs().lock() {
        if let Some(tab) = tabs.get_mut(label) {
            tab.frames.retain(|entry| entry.id != id);
        }
    }
}

#[cfg(test)]
mod tests;
