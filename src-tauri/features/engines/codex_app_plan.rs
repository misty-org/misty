use serde_json::{json, Map, Value};

use super::plan_review::{self, PlanDecision, PlanReview, PlanReviewKind};

pub(super) const EXECUTE_PLAN_PROMPT: &str = "The plan has been reviewed and approved. Leave plan mode and implement it exactly as approved: do not rewrite the plan, start executing now.";

pub(super) const DEFAULT_PLAN_TITLE: &str = "Codex plan";

pub(super) const PLAN_STALE_PREFIX: &str = "codex plan is stale:";

pub(super) fn plan_id_for(thread_id: &str) -> String {
    format!("{thread_id}/plan")
}

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

pub(super) fn collaboration_mode(mode: &str, model: &str, effort: Option<&str>) -> Value {
    let mut settings = Map::new();
    settings.insert("model".to_string(), json!(model));
    if let Some(effort) = effort.map(str::trim).filter(|e| !e.is_empty()) {
        settings.insert("reasoning_effort".to_string(), json!(effort));
    }
    json!({ "mode": mode, "settings": Value::Object(settings) })
}

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
