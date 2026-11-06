//! Misty's agent, in the app's own process (docs/plans/app-permissions.md).
//!
//! - [`sdk`] talks to model providers: what Misty uses from the Vercel AI SDK, and nothing more.
//! - [`runtime`] runs agents on top of it. It depends on `sdk`, never the other way round
//!   (`tests/boundaries.rs`).
//!
//! The crate knows nothing about Tauri. The app gives it what it needs through small interfaces.

pub mod runtime;
pub mod sdk;
