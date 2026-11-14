// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/agy.rs.
//! Antigravity CLI (`agy`) over the Agent Client Protocol: `agy acp`, on the same ACP driver as
//! Gemini CLI, Kimi, Grok and Hermes (`grok_acp.rs`). Print mode (`agy -p`) can't ask anyone
//! anything: it refuses every tool that needs approval and its model is told nobody will answer a
//! question. Over ACP each permission ask comes back as `session/request_permission`, which
//! Misty's gate answers, and the `ask_question` tool comes back as an `elicitation/create` form,
//! which becomes a question card (`agy_acp.rs`).
//!
//! Checked against agy 1.5.9: `initialize` lists `promptCapabilities.image`, `loadSession` and
//! `sessionCapabilities.resume`, and asks for no sign-in of its own (it reads the Google account
//! the CLI is signed in with). `session/new` lists the models `agy models` prints, the modes
//! `default`, `accept-edits`, `auto` and `plan`, and a `thought_level` option for the Gemini
//! models; the session id is the conversation id Antigravity keeps its history under.

use super::{command_for_binary, BuiltCommand, Engine, SendRequest};
use std::path::PathBuf;

#[path = "agy_acp.rs"]
mod acp;
pub(super) use acp::{
    answer_frame, attach_session, initialization, mcp_capable, park_question, report_session_state,
};
#[path = "agy_subagents.rs"]
mod subagents;
pub(super) use subagents::Subagents;

/// Antigravity CLI (`agy`) home: `$ANTIGRAVITY_HOME` or `~/.gemini/antigravity-cli`.
pub(crate) fn agy_home() -> PathBuf {
    crate::engines::engine_home(Some("ANTIGRAVITY_HOME"), ".gemini/antigravity-cli")
}

pub struct AgyEngine;

impl Engine for AgyEngine {
    fn id(&self) -> &'static str {
        "agy"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    fn host_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("acp");
        // The session's own folder is its `cwd`; the folders the person added join it.
        let mut seen = std::collections::HashSet::new();
        for dir in &req.additional_dirs {
            let dir = dir.trim();
            if dir.is_empty() || !seen.insert(dir) {
                continue;
            }
            cmd.arg("--add-dir");
            cmd.arg(dir);
        }
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            // The gate's answers and question replies are written to this pipe for the turn.
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn supports_mcp(&self) -> bool {
        true
    }

    /// Antigravity's ACP session modes: `default`, where each ask comes back through ACP,
    /// `accept-edits` and `plan`. Its `auto` isn't offered: it lets Auto mode's own review clear a
    /// command that leaves its terminal sandbox, and it has no sandbox that keeps its writes in
    /// the folder. Neither is `--dangerously-skip-permissions`, for the same reason.
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("default", "Default", Asks, "manual"),
            mode("accept-edits", "Accept edits", Edits, "auto"),
            mode("plan", "Plan", Plans, "plan"),
        ];
        MODES
    }
}

#[cfg(test)]
#[path = "agy_tests.rs"]
mod tests;
