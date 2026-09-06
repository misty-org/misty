//! Engine hooks: requests the engine raises on its own (camera and microphone
//! prompts) and controls only the engine has (stopping capture). One file per
//! OS; the rules they apply live in `crate::permissions`.

use crate::permissions::{MediaKind, Verdict};
use std::{
    sync::{Arc, OnceLock},
    time::Duration,
};
use tauri::Webview;

#[cfg(target_os = "linux")]
mod content_filter_linux;
#[cfg(target_os = "macos")]
mod content_filter_macos;
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

/// The website-data store a tab uses. Permission choices live per store.
/// Only WebKit on macOS reports one; elsewhere the host derives it from the
/// profile it created the tab with.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum StoreScope {
    /// A named, persistent store.
    Persistent(String),
    /// A throwaway store, identified for as long as it lives.
    Temporary(usize),
}

/// A capture request as the engine raised it, with origins canonicalized.
#[derive(Clone, Debug)]
pub struct MediaRequest {
    /// The embedder's label for the tab.
    pub webview: String,
    pub top_origin: Option<String>,
    /// The frame that asked. Engines that cannot tell report the top origin.
    pub requester_origin: Option<String>,
    pub kind: Option<MediaKind>,
    pub store: Option<StoreScope>,
}

/// The host's answer to capture requests, normally backed by its
/// site-permission store and `permissions::media_verdict`.
pub trait MediaPolicy: Send + Sync + 'static {
    fn media_verdict(&self, request: &MediaRequest) -> Verdict;
}

static MEDIA_POLICY: OnceLock<Arc<dyn MediaPolicy>> = OnceLock::new();

/// Installs the host's policy. The first call wins.
pub fn set_media_policy(policy: impl MediaPolicy) {
    let _ = MEDIA_POLICY.set(Arc::new(policy));
}

/// Without a policy the engine keeps its own behavior: it asks.
pub(crate) fn media_verdict(request: &MediaRequest) -> Verdict {
    MEDIA_POLICY
        .get()
        .map_or(Verdict::Prompt, |policy| policy.media_verdict(request))
}

/// Routes the tab's camera and microphone requests through the policy.
/// Safe to call again for the same tab.
pub fn install_media_permissions(webview: &Webview) -> Result<(), String> {
    platform::install_media_permissions(webview)
}

/// Applies the built-in content filter (`crate::content_filter`) to the tab.
/// Call it for each new tab and again for every tab after the filter's
/// configuration changes; repeated calls only swap what changed.
pub fn install_content_filter(webview: &Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return content_filter_macos::install_content_filter(webview);
    #[cfg(target_os = "linux")]
    return content_filter_linux::install_content_filter(webview);
    #[cfg(windows)]
    return webview2::install_content_filter(webview);
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = webview;
        Ok(())
    }
}

/// Starts building the filter for the current configuration before any tab
/// asks for it, so pages opened next get it at once. Call it after
/// `content_filter::configure` changes something. WebView2 checks each request
/// as it is made and needs nothing built.
pub fn prepare_content_filter(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return content_filter_macos::prepare_content_filter(app);
    #[cfg(target_os = "linux")]
    return content_filter_linux::prepare_content_filter(app);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = app;
        Ok(())
    }
}

/// What the engine knows about the tab's current page.
#[derive(Clone, Debug)]
pub struct PageFacts {
    pub url: String,
    /// HTTPS with no insecure subresources, as far as the engine reports.
    pub secure: bool,
    pub store: Option<StoreScope>,
}

pub async fn page_facts(webview: &Webview) -> Result<PageFacts, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    platform::page_facts(webview, send)?;
    receive
        .await
        .map_err(|_| "The browser closed while reading the page.".to_owned())?
}

/// Stops camera and/or microphone capture in the tab. On macOS only tabs on
/// `store` are touched; elsewhere the caller chooses the tabs.
pub async fn stop_capture(
    webview: &Webview,
    store: Option<&StoreScope>,
    camera: bool,
    microphone: bool,
) -> Result<(), String> {
    if !camera && !microphone {
        return Ok(());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    platform::stop_capture(webview, store.cloned(), camera, microphone, send)?;
    tokio::time::timeout(Duration::from_secs(5), receive)
        .await
        .map_err(|_| "Stopping capture timed out. Close affected tabs.".to_owned())?
        .map_err(|_| "The tab closed while stopping capture.".to_owned())
}

/// Sends `value` once, from whichever engine callback finishes first.
pub(crate) type Reply<T> = tokio::sync::oneshot::Sender<T>;

/// Editing commands the embedder's own menus run in a tab.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditCommand {
    Copy,
    Cut,
    Paste,
}

/// Runs an editing command on the tab's selection or focused field, as the
/// engine's own context menu would. Focus the tab first.
pub fn edit(webview: &Webview, command: EditCommand) -> Result<(), String> {
    platform::edit(webview, command)
}
