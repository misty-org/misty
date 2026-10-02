mod cache;
#[cfg(test)]
pub(crate) use cache::ClipboardCache;
mod service;
mod types;

pub use service::{ClipboardService, NativeClipboard, SharedClipboardClient};
pub use types::{
    ClipboardFileRef, ClipboardImage, ClipboardOrigin, ClipboardPayload, ClipboardPayloadKind,
};
