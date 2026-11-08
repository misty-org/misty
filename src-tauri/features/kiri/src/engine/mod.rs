//! Engine hooks: requests the engine raises on its own (camera, microphone and
//! location prompts) and controls only the engine has (stopping capture). One file per
//! OS; the rules they apply live in `permissions`.

use crate::permissions::{MediaKind, PermissionKind, Verdict};
use std::{
    sync::{Arc, OnceLock},
    time::Duration,
};
use tauri::Webview;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod macos_location;
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

/// A request for the device's location, with origins canonicalized.
#[derive(Clone, Debug)]
pub struct LocationRequest {
    /// The embedder's label for the tab.
    pub webview: String,
    pub top_origin: Option<String>,
    /// The frame that asked. Engines that cannot tell report the top origin.
    pub requester_origin: Option<String>,
    pub store: Option<StoreScope>,
}

/// A request the policy answered `Verdict::Prompt`, for a host that asks in its own interface.
#[derive(Clone, Debug)]
pub struct PermissionAsk {
    /// The embedder's label for the tab.
    pub webview: String,
    pub top_origin: Option<String>,
    /// The frame that asked. Engines that cannot tell report the top origin.
    pub requester_origin: Option<String>,
    pub kinds: Vec<PermissionKind>,
    pub store: Option<StoreScope>,
}

/// The engine's held decision. Dropping it unanswered refuses the request, as WebKit requires
/// every decision to be answered. It may only be answered or dropped on the main thread.
pub struct AskAnswer(Option<Box<dyn FnOnce(bool)>>);

// The engine's handler is only ever touched on the main thread, as the type's rule says.
unsafe impl Send for AskAnswer {}

impl AskAnswer {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn new(answer: impl FnOnce(bool) + 'static) -> Self {
        Self(Some(Box::new(answer)))
    }

    pub fn answer(mut self, allow: bool) {
        if let Some(answer) = self.0.take() {
            answer(allow);
        }
    }
}

impl Drop for AskAnswer {
    fn drop(&mut self) {
        if let Some(answer) = self.0.take() {
            answer(false);
        }
    }
}

/// The host's answer to permission requests, normally backed by its
/// site-permission store and `permissions::media_verdict` /
/// `permissions::location_verdict`.
pub trait SitePolicy: Send + Sync + 'static {
    fn media_verdict(&self, request: &MediaRequest) -> Verdict;
    fn location_verdict(&self, request: &LocationRequest) -> Verdict;

    /// Asks the person in the host's own interface. Handing the answer back leaves the question
    /// to the engine, which on macOS shows WebKit's own dialog.
    fn ask(&self, _request: PermissionAsk, answer: AskAnswer) -> Result<(), AskAnswer> {
        Err(answer)
    }
}

static SITE_POLICY: OnceLock<Arc<dyn SitePolicy>> = OnceLock::new();

/// Installs the host's policy. The first call wins.
pub fn set_site_policy(policy: impl SitePolicy) {
    let _ = SITE_POLICY.set(Arc::new(policy));
}

/// Without a policy the engine keeps its own behavior: it asks.
pub(crate) fn media_verdict(request: &MediaRequest) -> Verdict {
    SITE_POLICY
        .get()
        .map_or(Verdict::Prompt, |policy| policy.media_verdict(request))
}

pub(crate) fn location_verdict(request: &LocationRequest) -> Verdict {
    SITE_POLICY
        .get()
        .map_or(Verdict::Prompt, |policy| policy.location_verdict(request))
}

/// Whether the host asks for itself. `None` means it took the answer.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn ask(request: PermissionAsk, answer: AskAnswer) -> Option<AskAnswer> {
    match SITE_POLICY.get() {
        Some(policy) => policy.ask(request, answer).err(),
        None => Some(answer),
    }
}

/// Whether the system refuses this app the device's location, so a site's grant reaches nothing.
/// Only macOS can tell; call it on the main thread.
pub fn location_blocked_by_system() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_location::blocked_by_system()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Routes the tab's camera, microphone and location requests through the
/// policy. Safe to call again for the same tab.
pub fn install_site_permissions(webview: &Webview) -> Result<(), String> {
    platform::install_site_permissions(webview)
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
