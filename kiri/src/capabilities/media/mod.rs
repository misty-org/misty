//! `media`: reports whether the page is audibly playing, so the browser can
//! show a speaker on its tab. Browsers know this from their media stack;
//! a bare webview does not expose it, so the page reports changes itself.
//!
//! It also carries the tab audio tap (`tap.js`): when the person asks to
//! transcribe a tab, the host starts the tap and the page sends its own
//! media's audio. Chunks are only forwarded for sessions the host started.

use super::{ready, Call, Capability, Reply};
use crate::{KiriError, Signal};
use serde::Deserialize;
use serde_json::Value;

pub(crate) const SHIM: &str = include_str!("shim.js");
/// The tab audio tap; idle until the host starts it.
pub(crate) const TAP_SHIM: &str = include_str!("tap.js");
/// One chunk is about a quarter second; a cap keeps a page from flooding.
const MAX_CHUNK_BASE64: usize = 64 * 1024;
/// Lets the host stop capture where the engine cannot (WebView2).
#[cfg(windows)]
pub(crate) const CAPTURE_SHIM: &str = include_str!("capture.js");

pub struct Media;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct State {
    audible: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Audio {
    session: u64,
    pcm: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Notice {
    session: u64,
    notice: String,
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
            "audio" => serde_json::from_value::<Audio>(call.args)
                .ok()
                .filter(|audio| audio.pcm.len() <= MAX_CHUNK_BASE64 && audio.pcm.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'='))
                .ok_or_else(|| KiriError::type_error("media.audio expects { session: number, pcm: base64 }."))
                .map(|audio| {
                    call.host.signal(&call.caller, Signal::MediaAudio { session: audio.session, pcm: audio.pcm });
                    Value::Null
                }),
            "notice" => serde_json::from_value::<Notice>(call.args)
                .ok()
                .filter(|notice| notice.notice.len() <= 200)
                .ok_or_else(|| KiriError::type_error("media.notice expects { session: number, notice: string }."))
                .map(|notice| {
                    call.host.signal(&call.caller, Signal::MediaTapNotice { session: notice.session, notice: notice.notice });
                    Value::Null
                }),
            other => Err(KiriError::not_supported(format!("media.{other} does not exist."))),
        })
    }
}
