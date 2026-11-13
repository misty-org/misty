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

    fn supported_permissions(&self) -> &'static [&'static str] {
        // Each `permission.asked` goes to Misty's gate, which answers "once" or "reject";
        // "bypass" replies "always" so matching asks stop round-tripping for the rest of the
        // session. "plan" selects the read-only plan agent in the prompt body.
        &["auto", "manual", "plan", "bypass"]
    }
}
