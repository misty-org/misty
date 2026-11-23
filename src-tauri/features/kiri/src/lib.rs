mod envelope;
mod error;
mod gate;
mod host;

pub mod capabilities;
#[cfg(feature = "tauri")]
pub mod channel;
#[cfg(feature = "tauri")]
pub mod engine;
#[cfg(feature = "tauri")]
mod plugin;

pub use capabilities::{Call, Capability, Reply};
pub use envelope::Request;
pub use error::KiriError;
pub use gate::Caller;
pub use host::Host;
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

    pub fn with(mut self, capability: impl Capability) -> Self {
        self.capabilities
            .insert(capability.name(), Box::new(capability));
        self
    }

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
        let capability = self.capabilities.get(request.cap.as_str()).ok_or_else(|| {
            KiriError::not_supported(format!("{} is not available.", request.cap))
        })?;
        if capability.secure_context_only() && !caller.secure {
            return Err(KiriError::security(format!(
                "{} requires a secure context.",
                request.cap
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

pub fn page_script() -> String {
    include_str!("page/transport.js")
        .replace("__KIRI_CAPABILITIES__", &capabilities::shims().join("\n"))
}

#[cfg(test)]
mod tests;
