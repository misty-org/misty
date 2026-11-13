//! Cross-origin frames on WebKitGTK. WebKitGTK can only run script in a page's main frame from
//! the app, so each cross-origin frame comes to Misty instead: a script in Misty's private script
//! world of every frame asks Misty, through a reply-carrying message handler that exists only in
//! that world, for the next thing to run, runs it there, and brings the answer with its next
//! request. Pages can neither see the world nor reach the handler, so they cannot forge a frame
//! or read what Misty runs in it.
use super::Frame;
use gtk::glib::{self, prelude::*, translate::ToGlibPtr};
use javascriptcore::ValueExt;
use serde::Deserialize;
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, VecDeque},
    time::Duration,
};
use webkit2gtk::{UserContentManagerExt, WebViewExt};

/// The page layer's world (page_agent/mod.rs), so a frame's commands share its globals.
const WORLD: &str = "misty-agent-page";
const HANDLER: &str = "mistyFrame";
/// Frames remembered per tab; the oldest are forgotten first.
const MAX_FRAMES: usize = 24;
/// Marks a content manager that already carries the frame script.
const INSTALLED: &str = "misty-frames";

/// Each frame says where it is when its document starts. The top document's word means a new
/// page, so the frames of the previous one are forgotten. A cross-origin frame then keeps one
/// request open with Misty, which answers it with the next script to run in the frame.
const ANNOUNCE: &str = r#"(() => {
  try {
    const handler = window.webkit?.messageHandlers?.mistyFrame;
    if (!handler) return;
    const top = window === window.top;
    if (top) { handler.postMessage(JSON.stringify({ kind: "top" })).catch(() => {}); return; }
    try { void window.top.location.href; return; } catch {}
    const token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const AsyncFunction = (async () => {}).constructor;
    (async () => {
      let answer = null;
      for (;;) {
        let reply;
        try {
          reply = await handler.postMessage(JSON.stringify({ kind: "poll", token, url: location.href, answer }));
        } catch { return; }
        answer = null;
        let command;
        try { command = JSON.parse(reply); } catch { return; }
        if (!command || command.stop) return;
        if (!command.id) continue;
        try {
          const value = await new AsyncFunction(command.body)();
          answer = { id: command.id, ok: true, value: typeof value === "string" ? value : JSON.stringify(value ?? null) };
        } catch (error) {
          answer = { id: command.id, ok: false, error: String(error?.message || error) };
        }
      }
    })();
  } catch {}
})();"#;

/// A frame's open request, answered once.
struct Reply {
    reply: *mut webkit2gtk::ffi::WebKitScriptMessageReply,
    /// The message's value, whose context the answer is made in.
    value: javascriptcore::Value,
}

impl Reply {
    fn answer(mut self, text: &str) {
        if let Some(context) = self.value.context() {
            let value = javascriptcore::Value::new_string(&context, Some(text));
            // SAFETY: `reply` holds the reference taken when the message arrived.
            unsafe {
                webkit2gtk::ffi::webkit_script_message_reply_return_value(
                    self.reply,
                    value.to_glib_none().0,
                );
            }
        }
        self.release();
    }

    fn release(&mut self) {
        if !self.reply.is_null() {
            // SAFETY: drops the reference taken when the message arrived, once.
            unsafe { webkit2gtk::ffi::webkit_script_message_reply_unref(self.reply) };
            self.reply = std::ptr::null_mut();
        }
    }
}

impl Drop for Reply {
    fn drop(&mut self) {
        if !self.reply.is_null() {
            // A request nobody answers ends the frame's loop.
            // SAFETY: as in `answer`.
            unsafe {
                webkit2gtk::ffi::webkit_script_message_reply_return_error_message(
                    self.reply,
                    c"closed".as_ptr(),
                );
            }
            self.release();
        }
    }
}

type Answer = tokio::sync::oneshot::Sender<Result<String, String>>;

struct Entry {
    id: u64,
    url: String,
    token: String,
    open: Option<Reply>,
    queue: VecDeque<(u64, String)>,
    pending: HashMap<u64, Answer>,
}

impl Entry {
    fn fail_all(&mut self) {
        for (_, answer) in self.pending.drain() {
            let _ = answer.send(Err("The frame is gone.".to_owned()));
        }
        if let Some(open) = self.open.take() {
            open.answer(r#"{"stop":true}"#);
        }
    }

    /// Hands the frame its next command if it is waiting for one.
    fn pump(&mut self) {
        if self.open.is_none() {
            return;
        }
        if let Some((id, body)) = self.queue.pop_front() {
            let command = serde_json::json!({ "id": id, "body": body }).to_string();
            if let Some(open) = self.open.take() {
                open.answer(&command);
            }
        }
    }
}

thread_local! {
    /// Tab label → its cross-origin frames, newest last. GTK thread only.
    static FRAMES: RefCell<HashMap<String, Vec<Entry>>> = RefCell::new(HashMap::new());
    static NEXT: Cell<u64> = const { Cell::new(1) };
}

fn next_id() -> u64 {
    NEXT.with(|next| {
        let id = next.get();
        next.set(id + 1);
        id
    })
}

#[derive(Deserialize)]
struct Message {
    kind: String,
    #[serde(default)]
    token: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    answer: Option<FrameAnswer>,
}

#[derive(Deserialize)]
struct FrameAnswer {
    id: u64,
    ok: bool,
    #[serde(default)]
    value: String,
    #[serde(default)]
    error: String,
}

fn received(label: &str, message: Message, reply: Reply) {
    FRAMES.with(|frames| {
        let mut frames = frames.borrow_mut();
        if message.kind == "top" {
            if let Some(mut list) = frames.remove(label) {
                list.iter_mut().for_each(Entry::fail_all);
            }
            reply.answer("{}");
            return;
        }
        let url = message.url;
        if message.kind != "poll"
            || message.token.is_empty()
            || !(url.starts_with("https://") || url.starts_with("http://"))
            || url.len() > 2_048
        {
            reply.answer(r#"{"stop":true}"#);
            return;
        }
        // Closed tabs leave their entries behind; past this many tabs, start afresh.
        if frames.len() > 256 && !frames.contains_key(label) {
            for list in frames.values_mut() {
                list.iter_mut().for_each(Entry::fail_all);
            }
            frames.clear();
        }
        let list = frames.entry(label.to_owned()).or_default();
        let index = match list.iter().position(|entry| entry.token == message.token) {
            Some(index) => index,
            None => {
                if list.len() >= MAX_FRAMES {
                    list.remove(0).fail_all();
                }
                list.push(Entry {
                    id: next_id(),
                    url: url.clone(),
                    token: message.token.clone(),
                    open: None,
                    queue: VecDeque::new(),
                    pending: HashMap::new(),
                });
                list.len() - 1
            }
        };
        let entry = &mut list[index];
        entry.url = url;
        if let Some(answer) = message.answer {
            if let Some(waiter) = entry.pending.remove(&answer.id) {
                let _ = waiter.send(if answer.ok {
                    Ok(answer.value)
                } else {
                    Err(format!(
                        "The frame could not run page-state code: {}",
                        answer.error
                    ))
                });
            }
        }
        // A frame keeps one request open at a time.
        if let Some(stale) = entry.open.replace(reply) {
            stale.answer("{}");
        }
        entry.pump();
    });
}

/// Adds the frame script and its reply handler to the view's content manager.
pub(crate) fn install(view: &webkit2gtk::WebView, label: String) -> Result<(), String> {
    let manager = view
        .user_content_manager()
        .ok_or("The page has no content manager.")?;
    // SAFETY: the key only ever holds `bool`.
    if unsafe { manager.data::<bool>(INSTALLED) }.is_some() {
        return Ok(());
    }
    if !manager.register_script_message_handler_with_reply(HANDLER, WORLD) {
        return Err("Couldn't prepare the page's frames.".into());
    }
    unsafe { manager.set_data(INSTALLED, true) };
    let source = std::ffi::CString::new(ANNOUNCE).map_err(|error| error.to_string())?;
    let world = std::ffi::CString::new(WORLD).map_err(|error| error.to_string())?;
    // SAFETY: plain constructor calls; the script is owned by `script` once wrapped.
    let script: webkit2gtk::UserScript = unsafe {
        glib::translate::from_glib_full(webkit2gtk::ffi::webkit_user_script_new_for_world(
            source.as_ptr(),
            webkit2gtk::ffi::WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
            webkit2gtk::ffi::WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
            world.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
        ))
    };
    manager.add_script(&script);
    manager.connect_local(
        &format!("script-message-with-reply-received::{HANDLER}"),
        false,
        move |values| {
            let value = values.get(1)?.get::<javascriptcore::Value>().ok()?;
            let reply = values.get(2)?;
            // SAFETY: the signal's third argument is the boxed WebKitScriptMessageReply; one
            // reference is taken here and dropped once the frame is answered.
            let reply = unsafe {
                let boxed = glib::gobject_ffi::g_value_get_boxed(reply.to_glib_none().0)
                    as *mut webkit2gtk::ffi::WebKitScriptMessageReply;
                if boxed.is_null() {
                    return Some(false.to_value());
                }
                webkit2gtk::ffi::webkit_script_message_reply_ref(boxed)
            };
            let reply = Reply {
                reply,
                value: value.clone(),
            };
            match serde_json::from_str::<Message>(&value.to_str()) {
                Ok(message) => received(&label, message, reply),
                Err(_) => reply.answer(r#"{"stop":true}"#),
            }
            Some(true.to_value())
        },
    );
    Ok(())
}

/// The tab's cross-origin frames, oldest first. GTK thread.
pub(crate) fn list(label: &str) -> Vec<Frame> {
    FRAMES.with(|frames| {
        frames
            .borrow()
            .get(label)
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

/// Forgets a frame that no longer answers, such as one its page removed. GTK thread.
pub(crate) fn forget(label: &str, id: u64) {
    FRAMES.with(|frames| {
        if let Some(list) = frames.borrow_mut().get_mut(label) {
            if let Some(index) = list.iter().position(|entry| entry.id == id) {
                list.remove(index).fail_all();
            }
        }
    });
}

/// Runs `function_body` as an async function in Misty's world of one frame and returns the
/// string it resolves to. A frame that doesn't answer in time is forgotten.
pub(crate) async fn evaluate(
    webview: &tauri::Webview,
    frame: u64,
    function_body: String,
) -> Result<String, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let label = webview.label().to_owned();
    let queued_label = label.clone();
    webview
        .with_webview(move |_| {
            FRAMES.with(|frames| {
                let mut frames = frames.borrow_mut();
                let Some(entry) = frames
                    .get_mut(&queued_label)
                    .and_then(|list| list.iter_mut().find(|entry| entry.id == frame))
                else {
                    let _ = send.send(Err("The frame is gone.".to_owned()));
                    return;
                };
                let command = next_id();
                entry.pending.insert(command, send);
                entry.queue.push_back((command, function_body));
                entry.pump();
            });
        })
        .map_err(|error| error.to_string())?;
    let result = match tokio::time::timeout(Duration::from_secs(10), receive).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("The frame is gone.".to_owned()),
        Err(_) => Err("Page state timed out.".to_owned()),
    };
    if result.is_err() {
        let _ = webview.with_webview(move |_| forget(&label, frame));
    }
    result
}
