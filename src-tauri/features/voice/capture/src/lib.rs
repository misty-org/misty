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
