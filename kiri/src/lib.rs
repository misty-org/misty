//! Kiri (霧, "mist") is Misty's native web platform layer.
//!
//! OS webviews (WKWebView, WebView2, WebKitGTK) supply an engine, but not the
//! browser layer Chromium and Gecko build above theirs: permissions, WebAuthn,
//! device APIs, extension APIs. Kiri supplies that layer from Rust. Each
//! capability presents a web API to the page through a thin shim and does the
//! real work natively, behind one envelope check and one gate.

mod envelope;
mod error;
mod gate;
mod host;

pub mod capabilities;
pub mod content_filter;
#[cfg(feature = "tauri")]
pub mod channel;
#[cfg(feature = "tauri")]
pub mod engine;
pub mod extensions;
pub mod permissions;
#[cfg(feature = "tauri")]
mod plugin;

pub use capabilities::{Call, Capability, Reply};
pub use envelope::{Request, MAX_ARGS_BYTES, PROTOCOL_VERSION};
pub use error::KiriError;
pub use gate::Caller;
pub use host::{Host, Signal};
#[cfg(feature = "tauri")]
pub use plugin::init;

use serde_json::Value;
use std::{collections::HashMap, sync::Arc};
use url::Url;

pub struct Kiri {
    webview_prefix: String,
    host: Arc<dyn Host>,
    capabilities: HashMap<&'static str, Box<dyn Capability>>,
}

impl Kiri {
    /// Serves webviews whose labels start with `webview_prefix`, with every
    /// built-in capability.
    pub fn new(webview_prefix: impl Into<String>, host: impl Host) -> Self {
        Self {
            webview_prefix: webview_prefix.into(),
            host: Arc::new(host),
            capabilities: capabilities::builtin()
                .into_iter()
                .map(|capability| (capability.name(), capability))
                .collect(),
        }
    }

    /// Adds (or replaces) a capability, for embedder-specific APIs.
    pub fn with(mut self, capability: impl Capability) -> Self {
        self.capabilities.insert(capability.name(), Box::new(capability));
        self
    }

    /// Routes one page call. `webview` and `page_url` come from the engine:
    /// the webview that delivered the call and its committed top-level URL.
    pub async fn dispatch(
        &self,
        webview: &str,
        page_url: &Url,
        request: Request,
    ) -> Result<Value, KiriError> {
        request.validate()?;
        if !webview.starts_with(&self.webview_prefix) {
            return Err(KiriError::security("Kiri does not serve this view."));
        }
        let caller = Caller::from_page(webview, page_url)?;
        let capability = self
            .capabilities
            .get(request.cap.as_str())
            .ok_or_else(|| KiriError::not_supported(format!("{} is not available.", request.cap)))?;
        if capability.secure_context_only() && !caller.secure {
            return Err(KiriError::security(format!(
                "{} requires a secure context.",
                request.cap
            )));
        }
        if capability.needs_permission() && !self.host.allows(&caller, capability.name()) {
            return Err(KiriError::not_allowed(format!(
                "{} was not allowed for {}.",
                request.cap, caller.origin
            )));
        }
        capability
            .call(Call {
                caller,
                method: request.method,
                args: request.args,
                host: self.host.clone(),
            })
            .await
    }
}

/// The page-side script: the transport plus every capability's shim. Inject
/// it into top-level documents before site scripts run.
pub fn page_script() -> String {
    include_str!("page/transport.js").replace("__KIRI_CAPABILITIES__", &capabilities::shims().join("\n"))
}

#[cfg(test)]
mod tests;
