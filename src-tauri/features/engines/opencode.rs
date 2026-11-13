// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/opencode.rs.
//! OpenCode engine — managed-server variant.
//!
//! The built-in `question` tool parks server-side and is answered over HTTP,
//! so a one-shot `opencode run` (nobody to ask) was migrated to the managed
//! `opencode serve` ([`super::opencode_server`]): the turn runs as a server
//! session (create/resume → prompt_async → SSE events), projected in
//! [`super::opencode_session::run_server_turn`]. Verified live: `run --attach
//! --format json` prints NO transcript, so parsing a run child was never an
//! option — the server event stream is the only complete channel.

use super::Engine;

pub struct OpenCodeEngine;

impl Engine for OpenCodeEngine {
    fn id(&self) -> &'static str {
        "opencode"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    /// Never invoked on the virtual path (`send_host_stream` branches before
    /// the process spawn); a stub keeps the trait contract honest.
    fn supports_images(&self) -> bool {
        // prompt_async parts accept data-URL file parts; that IS the serve
        // image transport.
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }

    fn supports_mcp(&self) -> bool {
        true
    }

    /// OpenCode's primary agents, Build and Plan. Each `permission.asked` goes to Misty's gate.
    /// No no-asking mode: OpenCode has no sandbox that keeps it inside its folder.
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("build", "Build", Edits, "auto"),
            mode("plan", "Plan", Plans, "plan"),
        ];
        MODES
    }
}
