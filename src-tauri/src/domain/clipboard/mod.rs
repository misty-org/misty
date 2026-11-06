mod service;
mod types;

pub use types::PasteItem;

pub use service::{ClipboardService, NativeClipboard, SharedClipboardClient};
pub use types::{
    ClipboardFileRef, ClipboardImage, ClipboardOrigin, ClipboardPayload, ClipboardPayloadKind,
};
