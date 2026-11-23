mod acl;
mod container;
mod drive;
mod helpers;
mod job;
mod launch;

pub use acl::Access;
pub use container::{Capability, Container};
pub use drive::{drive_for, is_substituted, Drive};
pub use helpers::{Limits, Workspace};
pub use job::{Job, JobLimits};
pub use launch::{command_line, environment_block, pipe, spawn, system_variables, Launch, Process};

use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
