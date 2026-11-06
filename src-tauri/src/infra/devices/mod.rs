//! This account's devices: identity, trust and the device channel.

#[cfg(desktop)]
pub mod admission;
#[cfg(desktop)]
pub mod channel;
#[cfg(desktop)]
pub mod http;
#[cfg(desktop)]
pub mod identity;
#[cfg(desktop)]
pub mod key;
#[cfg(desktop)]
pub mod records;
#[cfg(all(test, desktop))]
pub(super) mod records_fixture;
#[cfg(all(test, desktop))]
pub(super) mod server_e2e_tests;
#[cfg(desktop)]
pub mod trust;
