//! The agent's native macOS drawings and screen reads: Misty's pointer on the
//! desktop, the control mist and its pulse, precise pointing for the cursor
//! companion, and the stills it captures. AppKit, Core Animation,
//! ScreenCaptureKit and Accessibility, called through the `objc2` bindings.
pub(crate) mod accessibility;
pub(crate) mod companion_capture;
pub(crate) mod companion_pointing;
mod mist;
pub(crate) mod pointer;
pub(crate) mod pointer_actions;
pub(crate) mod ring;
pub(crate) mod ring_views;
pub(crate) mod screen_capture;
pub(crate) mod support;

#[cfg(test)]
#[path = "checks/agent_pointer.rs"]
mod agent_pointer_check;
