//! Desktop control on macOS: Misty works the desktop with its own cursor
//! (Accessibility and app-targeted key events), watches it through one
//! ScreenCaptureKit stream, and shows an island and a mist while it does.
mod ask;
mod capture;
mod control;
mod island;
mod requests;

pub(crate) use control::{island_text, prepare, renew, stop, yield_control};
pub(crate) use requests::{action, capture as capture_desktop};
