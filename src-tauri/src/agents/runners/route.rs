//! Picks the coding tool for a delegated task on this device: the person's
//! default, else their fallback, when it is installed, signed in, under the
//! usage cap they set and able to honor the run's mode. Nothing smarter. The
//! choice and its inputs stay on the device; the server only checks the
//! budget and the grants when it issues the lease.
use super::{detect::EngineStatus, events::RateLimit, EngineId, LaunchMode};

/// How far an engine can be trusted to ask before acting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Interactive,
    LaunchOnly,
    FullAccessOnly,
}

pub fn tier(engine: EngineId) -> Tier {
    match engine {
        EngineId::Claude
        | EngineId::Codex
        | EngineId::Minimax
        | EngineId::Kimi
        | EngineId::Omp
        | EngineId::Opencode => Tier::Interactive,
        EngineId::Grok | EngineId::Dsh => Tier::FullAccessOnly,
        EngineId::Pi | EngineId::Agy | EngineId::Qoder | EngineId::QoderCn => Tier::LaunchOnly,
    }
}

pub fn display_name(engine: EngineId) -> &'static str {
    match engine {
        EngineId::Claude => "Claude Code",
        EngineId::Codex => "Codex",
        EngineId::Kimi => "Kimi Code",
        EngineId::Minimax => "MiniMax Code",
        EngineId::Grok => "Grok",
        EngineId::Pi => "Pi",
        EngineId::Omp => "Oh My Pi",
        EngineId::Dsh => "DeepSeek Shell",
        EngineId::Agy => "Antigravity",
        EngineId::Opencode => "OpenCode",
        EngineId::Qoder => "Qoder",
        EngineId::QoderCn => "Qoder (China)",
    }
}

/// The person's device-local choices from Settings › Agents › Coding tools.
#[derive(Debug, Clone, Default)]
pub struct RoutePrefs {
    pub default: Option<EngineId>,
    pub fallback: Option<EngineId>,
    /// "Use up to N% of each tool's weekly limit"; None means no cap.
    pub cap_percent: Option<f64>,
}

/// What the delegated task needs.
#[derive(Debug, Clone)]
pub struct RouteNeed {
    pub mode: LaunchMode,
    /// The chat's Ask or Auto.
    pub permission: String,
    /// What the person remembered for this project and its remote.
    pub grants: Vec<String>,
}

/// Why an engine can't take this task, in plain language, or None when it can.
pub fn refusal(
    engine: EngineId,
    status: Option<&EngineStatus>,
    limit: Option<&RateLimit>,
    prefs: &RoutePrefs,
    need: &RouteNeed,
) -> Option<String> {
    let name = display_name(engine);
    if !super::supported(engine) {
        return Some(format!("{name} isn't supported in Misty yet."));
    }
    let Some(status) = status.filter(|status| status.installed) else {
        return Some(format!("{name} isn't installed on this computer."));
    };
    if !status.signed_in {
        return Some(format!(
            "{name} is signed out. Sign in to it in a terminal, then try again."
        ));
    }
    if let (Some(cap), Some(limit)) = (prefs.cap_percent, limit) {
        if limit.used_percent >= cap {
            return Some(format!(
                "{name} reached the limit you set ({cap:.0}% of its usage limit)."
            ));
        }
    }
    let auto = need.permission == "auto";
    match tier(engine) {
        Tier::Interactive => None,
        Tier::LaunchOnly if need.mode == LaunchMode::Plan || auto => None,
        Tier::LaunchOnly => Some(format!("{name} can't ask before acting, so in Ask it only plans. Switch the chat to Auto or pick another tool.")),
        // The server checks the remembered grants when it issues the lease;
        // the device only knows the chat must be in Auto and not planning.
        Tier::FullAccessOnly if auto && need.mode != LaunchMode::Plan => None,
        Tier::FullAccessOnly => Some(format!(
            "{name} can't ask before acting. It runs only in Auto, on a project where you remembered edits, installs and pushes."
        )),
    }
}

/// The engine to use, or the plain-language reason none qualifies.
pub fn route(
    prefs: &RoutePrefs,
    statuses: &[EngineStatus],
    limits: &[(EngineId, RateLimit)],
    need: &RouteNeed,
) -> Result<EngineId, String> {
    let status = |engine: EngineId| {
        statuses
            .iter()
            .find(|status| status.engine == engine.as_str())
    };
    let limit = |engine: EngineId| {
        limits
            .iter()
            .find(|(id, _)| *id == engine)
            .map(|(_, limit)| limit)
    };
    let candidates: Vec<EngineId> = [prefs.default, prefs.fallback]
        .into_iter()
        .flatten()
        .collect();
    if candidates.is_empty() {
        return Err("Pick a coding tool in Settings › Agents › Coding tools first.".into());
    }
    let mut reasons = Vec::new();
    for engine in candidates {
        match refusal(engine, status(engine), limit(engine), prefs, need) {
            None => return Ok(engine),
            Some(reason) => reasons.push(reason),
        }
    }
    Err(reasons.join(" "))
}
