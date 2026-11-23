#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(windows)]
pub(crate) mod windows;

#[cfg(target_os = "macos")]
const WORLD: &str = "misty-frames";
#[cfg(target_os = "macos")]
const HANDLER: &str = "mistyFrame";
#[cfg(target_os = "macos")]
const MAX_FRAMES: usize = 24;

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

    pub(crate) fn install(view: &WKWebView) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("Frames are prepared on the main thread.")?;
        unsafe {
            let controller = view.configuration().userContentController();
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

#[cfg(windows)]
use crate::browser::agent_pages::frames::windows as cdp_frames;
#[cfg(windows)]
pub(crate) use cdp_frames::{forget, target};

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
        receive.try_recv().unwrap_or(Ok(()))
    }
    #[cfg(windows)]
    {
        cdp_frames::install(webview)
    }
    #[cfg(target_os = "linux")]
    {
        let (send, receive) = std::sync::mpsc::channel();
        let label = webview.label().to_owned();
        webview
            .with_webview(move |platform| {
                let _ = send.send(linux::install(&platform.inner(), label));
            })
            .map_err(|error| error.to_string())?;
        return receive.try_recv().unwrap_or(Ok(()));
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = webview;
        Ok(())
    }
}

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
    #[cfg(windows)]
    {
        cdp_frames::list(webview).await
    }
    #[cfg(target_os = "linux")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        let label = webview.label().to_owned();
        if webview
            .with_webview(move |_| {
                let _ = send.send(linux::list(&label));
            })
            .is_err()
        {
            return Vec::new();
        }
        receive.await.unwrap_or_default()
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = webview;
        Vec::new()
    }
}
