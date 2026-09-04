//! `media`: reports whether the page is audibly playing, so the browser can
//! show a speaker on its tab. Browsers know this from their media stack;
//! a bare webview does not expose it, so the page reports changes itself.

use super::{ready, Call, Capability, Reply};
use crate::{KiriError, Signal};
use serde::Deserialize;
use serde_json::Value;

pub(crate) const SHIM: &str = include_str!("shim.js");
/// Lets the host stop capture where the engine cannot (WebView2).
#[cfg(windows)]
pub(crate) const CAPTURE_SHIM: &str = include_str!("capture.js");

pub struct Media;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct State {
    audible: bool,
}

impl Capability for Media {
    fn name(&self) -> &'static str {
        "media"
    }

    // Page state, not a powerful feature: plain-HTTP pages play audio too.
    fn secure_context_only(&self) -> bool {
        false
    }

    fn call(&self, call: Call) -> Reply {
        ready(match call.method.as_str() {
            "state" => serde_json::from_value::<State>(call.args)
                .map_err(|_| KiriError::type_error("media.state expects { audible: boolean }."))
                .map(|state| {
                    call.host.signal(&call.caller, Signal::MediaAudible(state.audible));
                    Value::Null
                }),
            other => Err(KiriError::not_supported(format!("media.{other} does not exist."))),
        })
    }
}
