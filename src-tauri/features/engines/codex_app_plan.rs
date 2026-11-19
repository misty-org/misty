//! Plan review (next_turn) for the Codex app-server: the review's identity and card title, the
//! `collaborationMode` each planning or decision turn starts in, what a user decision becomes,
//! and the check that the reviewed plan item is still in the thread unchanged.

use serde_json::{json, Map, Value};

use super::plan_review::{self, PlanDecision, PlanReview, PlanReviewKind};

/// The fixed execution instruction carried by an approval: the decision
/// itself transports no user text, so everything the model needs to start
/// executing lives in this one constant — any user text on the approve path
/// would blur what exactly was approved.
pub(super) const EXECUTE_PLAN_PROMPT: &str = "The plan has been reviewed and approved. Leave plan mode and implement it exactly as approved: do not rewrite the plan, start executing now.";

/// Card title when the plan body carries no markdown heading.
pub(super) const DEFAULT_PLAN_TITLE: &str = "Codex plan";

/// Staleness marker on verification errors: the plan item changed or vanished
/// while awaiting review, so the claimed revision must be expired (not just
/// reverted to awaiting_review — it may not keep waiting with a stale body).
pub(super) const PLAN_STALE_PREFIX: &str = "codex plan is stale:";

/// Stable review identity: one thread has at most one plan awaiting review at
/// a time, so thread id + a fixed suffix suffices; a revised plan lands as the
/// next revision of the same planId (record_review supersedes the old one).
pub(super) fn plan_id_for(thread_id: &str) -> String {
    format!("{thread_id}/plan")
}

/// Review card title: the first ATX heading of the plan body, else a fixed
/// default. A `#` not followed by whitespace is not a heading.
pub(super) fn plan_title(content: &str) -> String {
    for line in content.lines() {
        let line = line.trim_start();
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if hashes == 0 || hashes > 6 {
            continue;
        }
        let rest = &line[hashes..];
        if !rest.starts_with(' ') && !rest.starts_with('\t') {
            continue;
        }
        let title = rest.trim();
        if !title.is_empty() {
            return title.chars().take(80).collect();
        }
    }
    DEFAULT_PLAN_TITLE.to_string()
}

/// `collaborationMode` params (0.154.0 schema, EXPERIMENTAL): `settings.model`
/// is a REQUIRED field, `reasoning_effort` rides along only when it has a
/// value. The caller fails closed when it cannot name a model — sending a
/// settings object without its required field would be an invalid request,
/// not a negotiation.
pub(super) fn collaboration_mode(mode: &str, model: &str, effort: Option<&str>) -> Value {
    let mut settings = Map::new();
    settings.insert("model".to_string(), json!(model));
    if let Some(effort) = effort.map(str::trim).filter(|e| !e.is_empty()) {
        settings.insert("reasoning_effort".to_string(), json!(effort));
    }
    json!({ "mode": mode, "settings": Value::Object(settings) })
}

/// collaborationMode for the initial planning turn: the request's explicit
/// model wins, else the thread's reported model; neither is fail-closed.
pub(super) fn plan_collaboration(
    req_model: Option<&str>,
    thread_model: Option<&str>,
    effort: Option<&str>,
) -> Result<Value, String> {
    let model = req_model
        .filter(|m| !m.trim().is_empty())
        .or_else(|| thread_model.filter(|m| !m.trim().is_empty()))
        .ok_or_else(|| {
            "codex plan mode needs a model for collaborationMode.settings, but neither the request nor the thread reported one".to_string()
        })?;
    Ok(collaboration_mode("plan", model, effort))
}

/// collaborationMode for a decision turn: the thread metadata carries no
/// mode field, so the client must restate it explicitly (P0: "the client must
/// restate the mode"); settings inherit the thread's current model/effort as
/// reported by thread/resume.
pub(super) fn decision_collaboration(
    mode: &'static str,
    thread_model: Option<&str>,
    thread_effort: Option<&str>,
) -> Result<Value, String> {
    let model = thread_model
        .filter(|m| !m.trim().is_empty())
        .ok_or_else(|| {
            "thread/resume reported no model; cannot restate collaborationMode settings".to_string()
        })?;
    Ok(collaboration_mode(mode, model, thread_effort))
}

/// What a user decision becomes: the new turn's collaboration mode, input
/// text and permission, plus the native item id to verify against. Every
/// check runs before the transport is touched, so the failure paths need no
/// process at all.
pub(super) struct DecisionSpec {
    pub(super) mode: &'static str,
    pub(super) prompt: String,
    pub(super) permission: String,
    pub(super) native_plan_id: String,
}

pub(super) fn decision_spec(
    review: &PlanReview,
    decision: PlanDecision,
    feedback: Option<&str>,
) -> Result<DecisionSpec, String> {
    if review.review_kind != PlanReviewKind::NextTurn {
        return Err("codex only executes next_turn plan decisions".to_string());
    }
    if review.session_id.trim().is_empty() {
        return Err("the plan review lost its codex thread id".to_string());
    }
    let native_plan_id = review
        .native_plan_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "the plan review lost its native plan item id".to_string())?
        .to_string();
    let (mode, prompt, permission) = match decision {
        PlanDecision::Approve => {
            let permission = review.exec_permission.trim();
            if permission.is_empty() {
                return Err("the plan review lost its execution permission snapshot".to_string());
            }
            (
                "default",
                EXECUTE_PLAN_PROMPT.to_string(),
                permission.to_string(),
            )
        }
        PlanDecision::RequestChanges => {
            let feedback = feedback
                .map(str::trim)
                .filter(|f| !f.is_empty())
                .ok_or_else(|| "request_changes requires non-empty feedback".to_string())?;
            ("plan", feedback.to_string(), "plan".to_string())
        }
        PlanDecision::Defer => {
            return Err("defer is settled locally; it never starts a codex turn".to_string())
        }
    };
    Ok(DecisionSpec {
        mode,
        prompt,
        permission,
        native_plan_id,
    })
}

/// Find the reviewed final plan item inside one `thread/turns/list`
/// (itemsView=full) page and compare bodies: id AND text hash must match the
/// record. A mismatch or a missing item is staleness (PLAN_STALE_PREFIX —
/// the version gets expired); a malformed page is a plain error (the claim
/// reverts, the version stays open for a retry).
pub(super) fn check_plan_item(
    page: &Value,
    native_plan_id: &str,
    expected_hash: &str,
) -> Result<(), String> {
    let turns = page
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "thread/turns/list returned no turn page".to_string())?;
    for turn in turns {
        let Some(items) = turn.get("items").and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            let is_plan = item.get("type").and_then(Value::as_str) == Some("plan");
            let matches = item.get("id").and_then(Value::as_str) == Some(native_plan_id);
            if !is_plan || !matches {
                continue;
            }
            let Some(text) = item.get("text").and_then(Value::as_str) else {
                return Err(format!(
                    "{PLAN_STALE_PREFIX} the thread's plan item carries no text"
                ));
            };
            return if plan_review::content_hash(text) == expected_hash {
                Ok(())
            } else {
                Err(format!(
                    "{PLAN_STALE_PREFIX} plan content changed while awaiting review"
                ))
            };
        }
    }
    Err(format!(
        "{PLAN_STALE_PREFIX} the reviewed plan item is no longer in the thread"
    ))
}
