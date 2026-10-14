//! Confined processes on Windows, the counterpart of `sandbox-exec` on macOS.
//!
//! A process runs as an AppContainer with no capabilities: no network, and no
//! access to the person's files, registry or other processes beyond what the
//! [`Container`] and the [`Capability`]s it holds are granted. A [`Job`] bounds its memory, CPU time and process
//! count, takes its UI access away, and ends the whole tree when it closes.
//! [`spawn`] passes on only the handles and environment it is given.
#![cfg(windows)]

mod acl;
mod container;
mod drive;
mod job;
mod launch;

pub use acl::Access;
pub use container::{Capability, Container};
pub use drive::{drive_for, is_substituted, Drive};
pub use job::{Job, JobLimits};
pub use launch::{command_line, environment_block, pipe, spawn, system_variables, Launch, Process};

use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

/// A NUL-terminated UTF-16 copy of `value`.
fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
