// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/dsh.rs.
//! DeepSeek Harness (dsh) engine — host-session variant.
//!
//! 0.1.2's durable streaming lives on the host (`/api/remote.mux` follow
//! stream with the `assistantStream` opt-in), so the engine drives its own
//! transport ([`Engine::drives_own_transport`]) instead of spawning a child
//! process: the turn runs as a host session (create → prompt → deltas),
//! projected in [`super::dsh_session::run_host_turn`]. The host itself is
//! probed/adopted/spawned by [`crate::engines::support::dsh_host`].

use super::Engine;

pub struct DshEngine;

impl Engine for DshEngine {
    fn id(&self) -> &'static str {
        "dsh"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    /// Never invoked on the virtual path (`send_host_stream` branches before
    /// the process spawn); a stub keeps the trait contract honest.
    fn supports_images(&self) -> bool {
        // Images go out as `session/prompt` image content parts (base64) —
        // that IS the dsh image transport; `dsh_images` declares the
        // input modality on hand-declared llm-pi-ai routes first.
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }

    /// DSH's human plan review enters through commands/execute "/plan" and waits on a
    /// plan-review presentation intent (the full protocol is confirmed in the 0.1.5-rc.1
    /// source; the adapter is dsh_session::park_plan_review / enter_plan_mode).
    fn plan_approval(&self) -> super::plan_review::PlanApproval {
        super::plan_review::PlanApproval::Typed {
            review_kind: super::plan_review::PlanReviewKind::NativeRequest,
            evidence: "dsh 0.1.5-rc.1 dsh-plan-mode plan-review intent + commands/execute /plan",
            limitations: "the host must include the plan-mode plugin (probed at runtime); plan mode is soft guidance, not a read-only sandbox; a pending review is lost when the host restarts",
        }
    }

    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "plan"]
    }
}
