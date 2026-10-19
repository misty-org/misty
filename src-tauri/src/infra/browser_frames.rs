//! Cross-origin frames for the agent page layer (docs/plans/agentic-architecture-review.md,
//! K1). Embedded widgets such as class schedules, booking calendars and forms often live
//! in a frame from another origin, which the page layer's script in the top document can
//! neither read nor reach. Every frame of a tab announces itself from a private content
//! world, so pages cannot forge or see it, and Misty keeps each cross-origin frame's
//! handle to run the page layer inside it.

/// Content world of the announcement script and its handler.
#[cfg(target_os = "macos")]
const WORLD: &str = "misty-frames";
#[cfg(target_os = "macos")]
const HANDLER: &str = "mistyFrame";
/// Frames remembered per tab; the oldest are forgotten first.
#[cfg(target_os = "macos")]
const MAX_FRAMES: usize = 24;

/// Each frame says where it is when its document starts. The top document's announcement
/// means a new page, so the frames of the previous one are forgotten.
#[cfg(target_os = "macos")]
const ANNOUNCE: &str = r#"(() => {
  try {
    const handler = window.webkit?.messageHandlers?.mistyFrame;
    if (!handler) return;
    const top = window === window.top;
    let cross = false;
    if (!top) { try { void window.top.location.href; } catch { cross = true; } }
    if (!top && !cross) return;
    const send = () => handler.postMessage(JSON.stringify({ top, url: location.href }));
    send();
    if (!top) addEventListener("load", send, { once: true });
  } catch {}
})();"#;

/// One cross-origin frame of a tab, as the page layer reaches it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Frame {
    pub id: u64,
    pub url: String,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{Frame, ANNOUNCE, HANDLER, MAX_FRAMES, WORLD};
    use objc2::{
        define_class, msg_send,
        rc::Retained,
        runtime::{NSObject, ProtocolObject},
        MainThreadMarker, MainThreadOnly,
    };
    use objc2_foundation::{NSObjectProtocol, NSString};
    use objc2_web_kit::{
        WKContentWorld, WKFrameInfo, WKScriptMessage, WKScriptMessageHandler,
        WKUserContentController, WKUserScript, WKUserScriptInjectionTime, WKWebView,
    };
    use std::{
        cell::{Cell, RefCell},
        collections::HashMap,
    };

    struct Entry {
        id: u64,
        url: String,
        info: Retained<WKFrameInfo>,
    }

    thread_local! {
        /// Web view → its cross-origin frames, newest last. Main thread only.
        static FRAMES: RefCell<HashMap<usize, Vec<Entry>>> = RefCell::new(HashMap::new());
        static NEXT: Cell<u64> = const { Cell::new(1) };
    }

    #[derive(serde::Deserialize)]
    struct Announcement {
        top: bool,
        url: String,
    }

    fn remember(view: usize, announcement: Announcement, info: Retained<WKFrameInfo>) {
        FRAMES.with(|frames| {
            let mut frames = frames.borrow_mut();
            if announcement.top {
                frames.remove(&view);
                return;
            }
            let url = announcement.url;
            if !(url.starts_with("https://") || url.starts_with("http://")) || url.len() > 2_048 {
                return;
            }
            // Closed tabs leave their entries behind; past this many tabs, start afresh.
            if frames.len() > 256 && !frames.contains_key(&view) {
                frames.clear();
            }
            let list = frames.entry(view).or_default();
            list.retain(|entry| entry.url != url);
            if list.len() >= MAX_FRAMES {
                list.remove(0);
            }
            let id = NEXT.with(|next| {
                let id = next.get();
                next.set(id + 1);
                id
            });
            list.push(Entry { id, url, info });
        });
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        struct MistyFrameAnnouncements;

        unsafe impl NSObjectProtocol for MistyFrameAnnouncements {}

        unsafe impl WKScriptMessageHandler for MistyFrameAnnouncements {
            #[unsafe(method(userContentController:didReceiveScriptMessage:))]
            fn did_receive(
                &self,
                _controller: &WKUserContentController,
                message: &WKScriptMessage,
            ) {
                unsafe {
                    let Ok(body) = message.body().downcast::<NSString>() else {
                        return;
                    };
                    let Ok(announcement) = serde_json::from_str::<Announcement>(&body.to_string())
                    else {
                        return;
                    };
                    let Some(view) = message.webView() else {
                        return;
                    };
                    remember(
                        Retained::as_ptr(&view) as usize,
                        announcement,
                        message.frameInfo(),
                    );
                }
            }
        }
    );

    impl MistyFrameAnnouncements {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            let this = mtm.alloc::<Self>().set_ivars(());
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Adds the announcement script and its handler to the view's content controller.
    pub(crate) fn install(view: &WKWebView) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("Frames are prepared on the main thread.")?;
        unsafe {
            let controller = view.configuration().userContentController();
            // A controller announces frames once; the script's presence says so even when a
            // closed tab's controller address is reused by a new one.
            if controller
                .userScripts()
                .iter()
                .any(|script| script.source().to_string() == ANNOUNCE)
            {
                return Ok(());
            }
            let world = WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm);
            let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
                WKUserScript::alloc(mtm),
                &NSString::from_str(ANNOUNCE),
                WKUserScriptInjectionTime::AtDocumentStart,
                false,
                &world,
            );
            controller.addUserScript(&script);
            let handler = MistyFrameAnnouncements::new(mtm);
            controller.addScriptMessageHandler_contentWorld_name(
                ProtocolObject::from_ref(&*handler),
                &world,
                &NSString::from_str(HANDLER),
            );
        }
        Ok(())
    }

    /// The view's cross-origin frames, oldest first.
    pub(crate) fn list(view: &WKWebView) -> Vec<Frame> {
        let key = view as *const WKWebView as usize;
        FRAMES.with(|frames| {
            frames
                .borrow()
                .get(&key)
                .map(|list| {
                    list.iter()
                        .map(|entry| Frame {
                            id: entry.id,
                            url: entry.url.clone(),
                        })
                        .collect()
                })
                .unwrap_or_default()
        })
    }

    /// The handle of one remembered frame, to run script inside it.
    pub(crate) fn info(view: &WKWebView, id: u64) -> Option<Retained<WKFrameInfo>> {
        let key = view as *const WKWebView as usize;
        FRAMES.with(|frames| {
            frames.borrow().get(&key).and_then(|list| {
                list.iter()
                    .find(|entry| entry.id == id)
                    .map(|entry| entry.info.clone())
            })
        })
    }

    /// Forgets a frame that no longer answers, such as one its page removed.
    pub(crate) fn forget(view: &WKWebView, id: u64) {
        let key = view as *const WKWebView as usize;
        FRAMES.with(|frames| {
            if let Some(list) = frames.borrow_mut().get_mut(&key) {
                list.retain(|entry| entry.id != id);
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub(crate) use macos::{forget, info};

/// Starts announcing a tab's frames; call it when the tab's web view is created.
pub(crate) fn install(webview: &tauri::Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = std::sync::mpsc::channel();
        webview
            .with_webview(move |platform| unsafe {
                let view: &objc2_web_kit::WKWebView = &*platform.inner().cast();
                let _ = send.send(macos::install(view));
            })
            .map_err(|error| error.to_string())?;
        // with_webview runs on the main thread; from there it has already run.
        return receive.try_recv().unwrap_or(Ok(()));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Ok(())
    }
}

/// The tab's cross-origin frames that have announced themselves, oldest first.
pub(crate) async fn list(webview: &tauri::Webview) -> Vec<Frame> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        if webview
            .with_webview(move |platform| unsafe {
                let view: &objc2_web_kit::WKWebView = &*platform.inner().cast();
                let _ = send.send(macos::list(view));
            })
            .is_err()
        {
            return Vec::new();
        }
        receive.await.unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Vec::new()
    }
}
