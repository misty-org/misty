//! Workspace protocol (v2): one end-to-end-encrypted workspace per device plus an
//! account-wide shared workspace, with a single driver per workspace.
pub mod codec;
pub mod merkle;
pub mod model;
pub mod protocol;
pub mod seal;
pub mod signin;
pub mod state;
pub mod sync;

#[cfg(test)]
mod tests;
