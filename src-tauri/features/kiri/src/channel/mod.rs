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

pub(crate) const MAX_MESSAGE_BYTES: usize = 400_000;

#[cfg(windows)]
pub(crate) const WIRE_PREFIX: &str = "\u{1}kiri-host\u{1}";

#[cfg_attr(windows, allow(dead_code))]
const HANDLER_NAME: &str = "kiriHost";

pub struct HostMessage<'a> {
    pub webview: &'a str,
    pub main_frame: bool,
    pub body: &'a str,
}

pub trait HostChannel: Send + Sync + 'static {
    fn receive(&self, message: HostMessage<'_>);
}

static CHANNEL: OnceLock<Arc<dyn HostChannel>> = OnceLock::new();

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

pub fn install_host_channel(webview: &Webview) -> Result<(), String> {
    platform::install(webview)
}

pub fn forget_host_channel(webview: &str) {
    platform::forget(webview);
}

pub fn sender_script() -> &'static str {
    platform::SENDER_SCRIPT
}
