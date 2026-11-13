// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/qoder.rs.
//! Qoder engine — ACP host-session variant.
//!
//! `qodercli --acp` speaks the Agent Client Protocol (JSON-RPC over stdio)
//! and stays resident across requests, so the engine drives its own
//! transport ([`Engine::drives_own_transport`]): each send spawns one child
//! inside [`super::qoder_session::run_acp_turn`], which owns the handshake
//! (spawned in bypass mode → initialize → session/new|resume → set_model?
//! → set_mode bypassPermissions if not already → session/prompt) and
//! projects session/update notifications to engine events.

use std::path::Path;

use super::Engine;

/// Qoder ships two distributions with independent binaries and config dirs
/// (reference qoder_provider_profile.rs): Global (`qodercli`, `~/.qoder`)
/// and CN (`qoderclicn`, `~/.qoder-cn`). Each is a sibling engine id sharing
/// the one ACP driver — the pi/omp family pattern: sessions key off the
/// engine id, so `qoder/<id>` and `qoder-cn/<id>` never collide and no
/// profile-qualified identity is needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QoderDistribution {
    Global,
    Cn,
}

impl QoderDistribution {
    pub(crate) fn engine_id(self) -> &'static str {
        match self {
            Self::Global => "qoder",
            Self::Cn => "qoder-cn",
        }
    }

    /// CLI binary behind the engine id (the `qoder` binary is the IDE
    /// launcher and speaks no ACP).
    pub(crate) fn cli_name(self) -> &'static str {
        match self {
            Self::Global => "qodercli",
            Self::Cn => "qoderclicn",
        }
    }

    /// Default config/session home (the CLI's own default; sessions are
    /// scanned from `<home>/projects`).
    pub(crate) fn default_config_dir_name(self) -> &'static str {
        match self {
            Self::Global => ".qoder",
            Self::Cn => ".qoder-cn",
        }
    }
}

pub struct QoderEngine {
    distribution: QoderDistribution,
}

impl QoderEngine {
    pub(crate) fn new(distribution: QoderDistribution) -> Self {
        Self { distribution }
    }
}

impl Engine for QoderEngine {
    fn id(&self) -> &'static str {
        self.distribution.engine_id()
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    /// Never invoked on the virtual path (`send_host_stream` branches before
    /// the process spawn); a stub keeps the trait contract honest.
    fn supports_images(&self) -> bool {
        // session/prompt carries image content blocks (base64).
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }

    /// Its help lists the modes this install has (`modes::learn_reported`).
    fn modes_help_flag(&self) -> Option<&'static str> {
        Some("--permission-mode")
    }
    /// Qoder CLI's permission modes (`--permission-mode default | accept_edits`); each ask
    /// comes back over ACP and Misty's gate answers it. Its plan review isn't wired
    /// (`plan_approval`). It lists three more that aren't offered: `bypass_permissions` (no
    /// sandbox keeps it inside its folder), `auto` (its own reviewer approves commands without
    /// the person, outside any folder sandbox) and `dont_ask` (it refuses instead of asking,
    /// while Default already brings every ask to the person).
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("default", "Default", Asks, "manual"),
            mode("accept_edits", "Accept edits", Edits, "auto"),
        ];
        MODES
    }
    fn supports_mcp(&self) -> bool {
        true
    }

    /// Qoder's human plan review (ACP session/set_mode plan + the ExitPlanMode
    /// request_permission) has only documentation and binary-string evidence: the global CLI
    /// was not installed, the CN evidence comes from the qoderclicn 1.0.41 bundled with
    /// QoderWork CN.app cross-checked against the official docs, no ACP frames were captured
    /// live, and that bundled CLI's --help lists no --acp/plan entry (possibly gated). An
    /// explicit plan request must therefore be refused rather than run silently in another
    /// mode (wiring it needs a signed-in machine and the old and new CLI entry points
    /// confirmed). Both distributions stay Unavailable until each is verified.
    fn plan_approval(&self) -> super::plan_review::PlanApproval {
        super::plan_review::PlanApproval::Unavailable {
            reason: match self.distribution {
                QoderDistribution::Global => "Qoder (international) CLI is not installed on this machine; its ACP plan mode is documented but never verified against a live session. Install/login first — the app will not silently fall back to bypassPermissions",
                QoderDistribution::Cn => "Qoder CN plan approval is evidenced only by the QoderWork-bundled qoderclicn 1.0.41 and docs; its ACP plan messages were never captured on a live session, and the bundled CLI does not advertise --acp. The current driver always sets bypassPermissions, so a plan request would silently degrade",
            },
        }
    }
}

/// File stem of a bin path, lowercased (`/usr/local/bin/qodercli` → `qodercli`).
pub(crate) fn binary_file_stem(bin: &str) -> String {
    Path::new(bin.trim())
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(bin.trim())
        .to_ascii_lowercase()
}

/// The Qoder IDE launcher is also called `qoder` but speaks no ACP; only
/// the CLI (`qodercli`) works as an engine bin.
pub(crate) fn is_qoder_ide_launcher_bin(bin: &str) -> bool {
    binary_file_stem(bin) == "qoder"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distributions_carry_independent_identities() {
        assert_eq!(QoderDistribution::Global.engine_id(), "qoder");
        assert_eq!(QoderDistribution::Cn.engine_id(), "qoder-cn");
        assert_eq!(QoderDistribution::Global.cli_name(), "qodercli");
        assert_eq!(QoderDistribution::Cn.cli_name(), "qoderclicn");
        assert_eq!(
            QoderDistribution::Global.default_config_dir_name(),
            ".qoder"
        );
        assert_eq!(QoderDistribution::Cn.default_config_dir_name(), ".qoder-cn");
    }

    #[test]
    fn ide_launcher_stem_is_rejected() {
        assert!(is_qoder_ide_launcher_bin("/Applications/Qoder.app/qoder"));
        assert!(is_qoder_ide_launcher_bin("qoder"));
        assert!(!is_qoder_ide_launcher_bin("/usr/local/bin/qodercli"));
        assert!(!is_qoder_ide_launcher_bin("qodercli"));
    }
}
