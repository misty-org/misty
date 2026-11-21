//! On-demand audio capture for Misty's dictation, live transcription and recording.
//!
//! Every source delivers 16 kHz mono PCM16 in [`PcmChunk`]s tagged with the
//! channel they came from; [`start_share`] is the one exception, the
//! computer's sound in stereo at 48 kHz for a shared screen. Microphone and system audio are never mixed: a
//! transcriber that keeps them as separate streams can tell "you" from
//! everyone else before it diarizes within each stream.
//!
//! The crate has no app framework coupling. Callers own permissions UX,
//! events and transport; this crate only opens devices and hands out PCM.

mod capture;
mod echo;
mod preroll;
mod resample;
mod router;
mod types;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod unsupported;
#[cfg(target_os = "windows")]
mod windows;

pub use capture::{capabilities, capture_sources, start, start_share, Capture};
pub use echo::EchoReducer;
pub use preroll::PreRoll;
pub use resample::Resampler;
pub use router::DuplexRouter;
pub use types::{
    AudioSource, Capabilities, CaptureError, CaptureSource, CaptureSources, Channel, Format,
    PcmChunk, SAMPLE_RATE, SHARE_SAMPLE_RATE,
};
