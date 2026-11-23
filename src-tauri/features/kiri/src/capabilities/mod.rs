use crate::{Caller, Host, KiriError};
use serde_json::Value;
use std::{future::Future, pin::Pin, sync::Arc};

pub mod webauthn;

pub type Reply = Pin<Box<dyn Future<Output = Result<Value, KiriError>> + Send>>;

pub struct Call {
    pub caller: Caller,
    pub method: String,
    pub args: Value,
    pub host: Arc<dyn Host>,
}

pub trait Capability: Send + Sync + 'static {
    fn name(&self) -> &'static str;

    fn secure_context_only(&self) -> bool {
        true
    }

    fn call(&self, call: Call) -> Reply;
}

pub fn ready(result: Result<Value, KiriError>) -> Reply {
    Box::pin(std::future::ready(result))
}

pub(crate) fn builtin() -> Vec<Box<dyn Capability>> {
    #[allow(unused_mut)]
    let mut capabilities: Vec<Box<dyn Capability>> = Vec::new();
    #[cfg(all(target_os = "macos", feature = "tauri"))]
    if webauthn::macos::available() {
        capabilities.push(Box::new(webauthn::WebAuthn::new(
            webauthn::macos::MacAuthenticator,
        )));
    }
    capabilities
}

pub(crate) fn shims() -> Vec<&'static str> {
    #[allow(unused_mut)]
    let mut shims = Vec::new();
    #[cfg(all(target_os = "macos", feature = "tauri"))]
    if webauthn::macos::available() {
        shims.push(webauthn::SHIM);
    }
    shims
}
