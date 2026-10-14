//! The few file operations that differ by platform. Each opens names one at
//! a time from the chosen folder and never follows a link.
#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub(crate) use unix::*;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(crate) use windows::*;
