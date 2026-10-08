//! Capability modules. Each one owns a web API surface: a `shim.js` that
//! presents the spec-shaped API to the page, and Rust that does the work.
//! Platform-specific code lives beside it in `macos.rs`, `windows.rs` and
//! `linux.rs` when a capability needs it.

use crate::{Caller, Host, KiriError};
use serde_json::Value;
use std::{future::Future, pin::Pin, sync::Arc};

pub mod media;
pub mod webauthn;

pub type Reply = Pin<Box<dyn Future<Output = Result<Value, KiriError>> + Send>>;

/// One routed call, after the envelope and the gate have accepted it.
pub struct Call {
    pub caller: Caller,
    pub method: String,
    pub args: Value,
    pub host: Arc<dyn Host>,
}

pub trait Capability: Send + Sync + 'static {
    /// The name pages use in `Kiri.call(name, …)`.
    fn name(&self) -> &'static str;

    /// Whether only secure contexts may call it, as the web platform requires
    /// for powerful features. Defaults to true; opt out only for page state.
    fn secure_context_only(&self) -> bool {
        true
    }

    /// Whether the host must have granted the caller's origin (`Host::allows`).
    fn needs_permission(&self) -> bool {
        false
    }

    fn call(&self, call: Call) -> Reply;
}

/// A reply that is already known, for capabilities with nothing to await.
pub fn ready(result: Result<Value, KiriError>) -> Reply {
    Box::pin(std::future::ready(result))
}

pub(crate) fn builtin() -> Vec<Box<dyn Capability>> {
    #[allow(unused_mut)]
    let mut capabilities: Vec<Box<dyn Capability>> = vec![Box::new(media::Media)];
    // WebView2 reaches Windows Hello itself; WKWebView needs Kiri for any site.
    #[cfg(all(target_os = "macos", feature = "tauri"))]
    if webauthn::macos::available() {
        capabilities.push(Box::new(webauthn::WebAuthn::new(webauthn::macos::MacAuthenticator)));
    }
    capabilities
}

/// Page-side shims for this platform, in the order they are installed.
pub(crate) fn shims() -> Vec<&'static str> {
    #[allow(unused_mut)]
    let mut shims = vec![media::SHIM];
    #[cfg(windows)]
    shims.push(media::CAPTURE_SHIM);
    #[cfg(all(target_os = "macos", feature = "tauri"))]
    if webauthn::macos::available() {
        shims.push(webauthn::SHIM);
    }
    shims
}
