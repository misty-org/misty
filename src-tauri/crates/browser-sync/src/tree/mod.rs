//! Tree protocol (v2): one end-to-end-encrypted tree per device plus an
//! account-wide shared tree, with a single driver per device tree.
pub mod codec;
pub mod merkle;
pub mod model;
pub mod protocol;
pub mod seal;
pub mod state;
pub mod sync;

#[cfg(test)]
mod tests;
