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

/// Whether the top document's script can't reach the frame. An opaque origin ("null"),
/// as a sandboxed frame has, is cross-origin to everything.
fn cross_origin(frame: &Value, top: &str) -> bool {
    match frame["securityOrigin"].as_str() {
        Some("null") | None => true,
        Some(origin) => origin != top || top == "null",
    }
}

fn walk<'a>(node: &'a Value, out: &mut Vec<&'a Value>) {
    out.push(&node["frame"]);
    for child in node["childFrames"].as_array().into_iter().flatten() {
        walk(child, out);
    }
}

/// The top document's loader and its cross-origin frame documents, from the tab's frame
/// tree and those of its frame sessions. A frame runs in the session whose tree holds it,
/// not the tab's.
fn cross_origin_frames(top: &Value, sessions: &[(String, Value)]) -> Option<(String, Vec<Found>)> {
    let root = &top["frameTree"];
    let document = root["frame"]["loaderId"].as_str()?.to_owned();
    let top_origin = root["frame"]["securityOrigin"].as_str().unwrap_or("null");
    let mut remote = HashSet::new();
    let mut placed: Vec<(Option<&str>, &Value)> = Vec::new();
    for (session, tree) in sessions {
        let mut frames = Vec::new();
        walk(&tree["frameTree"], &mut frames);
        for frame in frames {
            if let Some(id) = frame["id"].as_str() {
                remote.insert(id);
            }
            placed.push((Some(session.as_str()), frame));
        }
    }
    let mut own = Vec::new();
    for child in root["childFrames"].as_array().into_iter().flatten() {
        walk(child, &mut own);
    }
    let own = own
        .into_iter()
        .filter(|frame| frame["id"].as_str().is_some_and(|id| !remote.contains(id)))
        .map(|frame| (None, frame));
    let found = own
        .chain(placed)
        .filter_map(|(session, frame)| {
            let url = frame["url"].as_str()?;
            if !(url.starts_with("https://") || url.starts_with("http://"))
                || url.len() > 2_048
                || !cross_origin(frame, top_origin)
            {
                return None;
            }
            Some(Found {
                target: Target {
                    session: session.map(str::to_owned),
                    frame: frame["id"].as_str()?.to_owned(),
                },
                document: frame["loaderId"].as_str()?.to_owned(),
                url: url.to_owned(),
            })
        })
        .collect();
    Some((document, found))
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
mod tests {
    use super::*;

    fn frame(id: &str, loader: &str, url: &str, origin: &str) -> Value {
        json!({"id": id, "loaderId": loader, "url": url, "securityOrigin": origin})
    }

    fn found(session: Option<&str>, frame: &str, document: &str, url: &str) -> Found {
        Found {
            target: Target {
                session: session.map(str::to_owned),
                frame: frame.into(),
            },
            document: document.into(),
            url: url.into(),
        }
    }

    #[test]
    fn lists_cross_origin_frames_where_they_run() {
        let top = json!({"frameTree": {
            "frame": frame("top", "L0", "https://studio.example/schedule", "https://studio.example"),
            "childFrames": [
                {"frame": frame("same", "L1", "https://studio.example/nav", "https://studio.example")},
                {"frame": frame("site", "L2", "https://book.studio.example/w", "https://book.studio.example"),
                 "childFrames": [{"frame": frame("blank", "L3", "about:blank", "https://book.studio.example")}]},
                {"frame": frame("oopif", "L4", "https://widget.example/x", "https://widget.example")},
                {"frame": frame("sandbox", "L5", "https://studio.example/sandboxed", "null")}
            ]
        }});
        let sessions = [(
            "S1".to_owned(),
            json!({"frameTree": {
                "frame": frame("oopif", "L6", "https://widget.example/x", "https://widget.example"),
                "childFrames": [{"frame": frame("inner", "L7", "https://widget.example/inner", "https://widget.example")}]
            }}),
        )];
        let (document, frames) = cross_origin_frames(&top, &sessions).unwrap();
        assert_eq!(document, "L0");
        assert_eq!(
            frames,
            vec![
                found(None, "site", "L2", "https://book.studio.example/w"),
                found(None, "sandbox", "L5", "https://studio.example/sandboxed"),
                found(Some("S1"), "oopif", "L6", "https://widget.example/x"),
                found(Some("S1"), "inner", "L7", "https://widget.example/inner"),
            ],
            "same-origin and non-web frames are left out, and a frame runs in its own session"
        );
        assert!(cross_origin_frames(&json!({}), &[]).is_none());
    }

    #[test]
    fn frame_ids_last_as_long_as_their_document() {
        let mut tab = Tab::default();
        let a = found(None, "a", "L1", "https://a.example/");
        let b = found(Some("S1"), "b", "L2", "https://b.example/");
        let first = tab.reconcile("top-1", vec![a.clone(), b.clone()]);
        let again = tab.reconcile("top-1", vec![b.clone(), a.clone()]);
        assert_eq!(first, again, "ids and order hold while the documents do");
        let reloaded = found(None, "a", "L9", "https://a.example/");
        let after = tab.reconcile("top-1", vec![reloaded, b.clone()]);
        assert_eq!(after[0], first[1]);
        assert!(
            after[1].id > first[1].id,
            "a reloaded frame counts as the newest"
        );
        assert_eq!(tab.target(after[0].id), Some(b.target.clone()));
        assert_eq!(tab.target(first[0].id), None);
        let next_page = tab.reconcile("top-2", vec![b]);
        assert!(next_page[0].id > after[1].id, "a new page starts afresh");
        let many: Vec<_> = (0..30)
            .map(|n| {
                found(
                    None,
                    &format!("f{n}"),
                    "L",
                    &format!("https://{n}.example/"),
                )
            })
            .collect();
        let capped = tab.reconcile("top-2", many);
        assert_eq!(capped.len(), MAX_FRAMES);
        assert_eq!(capped[0].url, "https://6.example/", "the oldest go first");
    }

    #[test]
    fn follows_frame_sessions_as_they_attach_and_detach() {
        let mut tab = Tab::default();
        let attached = |session: &str, kind: &str| json!({"sessionId": session, "targetInfo": {"type": kind, "targetId": "T"}, "waitingForDebugger": false});
        assert_eq!(
            tab.event(ATTACHED, &attached("S1", "iframe")),
            Some("S1".into())
        );
        assert_eq!(tab.event(ATTACHED, &attached("S2", "worker")), None);
        assert_eq!(
            tab.event(ATTACHED, &attached("S3", "iframe")),
            Some("S3".into())
        );
        assert_eq!(
            tab.event(ATTACHED, &attached("S1", "iframe")),
            Some("S1".into())
        );
        assert_eq!(tab.sessions, ["S1", "S3"]);
        assert_eq!(
            tab.event(DETACHED, &json!({"sessionId": "S1", "targetId": "T"})),
            None
        );
        assert_eq!(tab.sessions, ["S3"]);
        for n in 0..MAX_SESSIONS + 5 {
            tab.event(ATTACHED, &attached(&format!("N{n}"), "iframe"));
        }
        assert_eq!(tab.sessions.len(), MAX_SESSIONS);
        assert_eq!(tab.sessions.last().map(String::as_str), Some("N68"));
    }
}
