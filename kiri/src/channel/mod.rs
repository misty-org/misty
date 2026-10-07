//! The host channel: one-way messages from the embedder's own injected
//! scripts (its browser chrome) to native code, over each engine's native
//! message handler.
//!
//! Unlike `plugin:kiri|call`, which any page may use, the sender here is
//! captured by the embedder's script before site scripts run, and nothing a
//! site can patch sits between that capture and the engine. A secret the
//! embedder keeps in its script's closure (such as a per-tab token) therefore
//! never passes through page-controlled code. Kiri delivers the raw string;
//! the embedder parses and authenticates it.

use std::sync::{Arc, OnceLock};
use tauri::Webview;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod unsupported;
#[cfg(windows)]
mod webview2;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
use unsupported as platform;
#[cfg(windows)]
use webview2 as platform;

/// Larger messages are dropped before the embedder sees them.
pub const MAX_MESSAGE_BYTES: usize = 400_000;

/// Marks host messages on WebView2, where every message shares one event.
/// Misty's vendored wry skips messages that start with it, so they never
/// reach Tauri's IPC parser.
pub const WIRE_PREFIX: &str = "\u{1}kiri-host\u{1}";

/// The script message handler name on WebKit engines.
#[cfg_attr(windows, allow(dead_code))]
const HANDLER_NAME: &str = "kiriHost";

pub struct HostMessage<'a> {
    /// The embedder's label for the tab.
    pub webview: &'a str,
    /// Whether the top-level document sent it. WebView2 delivers only those;
    /// WebKitGTK cannot tell and reports true, so authenticate every message.
    pub main_frame: bool,
    pub body: &'a str,
}

pub trait HostChannel: Send + Sync + 'static {
    fn receive(&self, message: HostMessage<'_>);
}

static CHANNEL: OnceLock<Arc<dyn HostChannel>> = OnceLock::new();

/// Installs the embedder's receiver. The first call wins.
pub fn set_host_channel(channel: impl HostChannel) {
    let _ = CHANNEL.set(Arc::new(channel));
}

pub(crate) fn deliver(webview: &str, main_frame: bool, body: &str) {
    if body.len() > MAX_MESSAGE_BYTES {
        return;
    }
    if let Some(channel) = CHANNEL.get() {
        channel.receive(HostMessage {
            webview,
            main_frame,
            body,
        });
    }
}

/// Registers the channel's native handler on the tab. Safe to call again.
pub fn install_host_channel(webview: &Webview) -> Result<(), String> {
    platform::install(webview)
}

/// Drops what Kiri remembers about a closed tab.
pub fn forget_host_channel(webview: &str) {
    platform::forget(webview);
}

/// JavaScript for a function that returns this engine's sender (a function
/// taking one string), or null while the handler is not installed yet. Embed
/// it in a script that runs before site scripts and call it from there.
pub fn sender_script() -> &'static str {
    platform::SENDER_SCRIPT
}
