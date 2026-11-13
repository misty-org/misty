//! The confined helpers, embedded in the app by `build.rs`.

/// One helper's bytes. They're part of the signed Misty binary, never downloaded or resolved from a
/// user-controlled folder.
pub(crate) fn builtin_worker(service: &str, protocol: u32) -> Result<&'static [u8], String> {
    include!(concat!(env!("OUT_DIR"), "/builtin_workers.rs"))
}

#[cfg(all(test, windows))]
// Tests build their fixtures directly, outside the file gate.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
#[path = "embedded_workers_tests.rs"]
mod documents_tests;
