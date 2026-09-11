//! Code projects for Misty agents (docs/plans/agent-code-projects.md).
//!
//! A project is a folder the person shared with write access. Agents read and
//! edit files through [`files`], run commands through [`exec`] inside a
//! Seatbelt sandbox ([`sandbox`]), keep dev servers running through
//! [`processes`], preview the result through [`preview`], and every run's
//! changes can be undone through [`checkpoint`]. Package installs reach the
//! internet only through the allowlisting [`proxy`].
#![cfg(any(unix, windows))]

pub mod beneath;
pub mod checkpoint;
pub mod diff;
pub mod exec;
pub mod files;
pub mod git;
pub mod output;
pub mod preview;
pub mod processes;
pub mod proxy;
pub mod run_diff;
pub mod sandbox;
mod service;
#[cfg(unix)]
pub mod tree;
mod walk;

pub use service::{CodeService, Project, GIT_TRANSFER_OPERATIONS, OPERATIONS};

use serde_json::{json, Value};

/// Why a code tool did not do what was asked.
#[derive(Debug)]
pub enum CodeError {
    /// The model can correct the call: a missing file, an edit that didn't
    /// match, a bad pattern. Returned to it as a failed result.
    Fix(String),
    /// The call reached outside what the grant allows. No effect happened.
    Scope(String),
    /// This computer can't run code tools (no sandbox on this platform).
    Unavailable(String),
}

impl CodeError {
    pub fn fix(message: impl Into<String>) -> Self {
        Self::Fix(message.into())
    }
}

impl std::fmt::Display for CodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Fix(message) | Self::Scope(message) | Self::Unavailable(message) => {
                f.write_str(message)
            }
        }
    }
}

/// The shape every code tool returns. A `Fix` becomes a failed result the
/// runtime hands back to the model; the others are job errors.
pub fn outcome(result: Result<Value, CodeError>) -> Result<Value, String> {
    match result {
        Ok(value) => Ok(value),
        Err(CodeError::Fix(message)) => Ok(json!({
            "status": "failure",
            "tool_error": { "message": message },
        })),
        Err(CodeError::Scope(message)) => Err(format!("invalid_device_scope: {message}")),
        Err(CodeError::Unavailable(message)) => Err(format!("code_sandbox_unavailable: {message}")),
    }
}

/// A path as people write it: Windows' verbatim prefix (`\\?\`, which
/// canonicalizing adds) removed. Unchanged elsewhere.
pub fn plain_path(path: &std::path::Path) -> std::path::PathBuf {
    if !cfg!(windows) {
        return path.to_path_buf();
    }
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}").into(),
        None => text.strip_prefix(r"\\?\").unwrap_or(&text).into(),
    }
}

pub(crate) fn io_fix(action: &str, error: std::io::Error) -> CodeError {
    use std::io::ErrorKind;
    let reason = match error.kind() {
        ErrorKind::NotFound => "it doesn't exist".to_owned(),
        ErrorKind::PermissionDenied => "permission was denied".to_owned(),
        ErrorKind::AlreadyExists => "it already exists".to_owned(),
        _ if beneath::is_link_refusal(&error) => {
            "it is a symlink, and agents don't follow symlinks".to_owned()
        }
        _ if beneath::is_not_folder(&error) => "part of the path is not a folder".to_owned(),
        _ => error.to_string(),
    };
    CodeError::Fix(format!("Could not {action}: {reason}."))
}
