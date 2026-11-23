pub(crate) fn builtin_worker(service: &str, protocol: u32) -> Result<&'static [u8], String> {
    include!(concat!(env!("OUT_DIR"), "/builtin_workers.rs"))
}

#[cfg(all(test, windows))]
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
#[path = "embedded_workers_tests.rs"]
mod documents_tests;
