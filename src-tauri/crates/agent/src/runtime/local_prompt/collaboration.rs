//! Plan, ask, checklist and goal instructions (`collaborationInstructions`, `ai_collaboration.go`).
use super::{
    go_text::{go_array, go_object, go_string, truncate_text},
    request::{PlanPayload, PlanState, PlanStep, RunRequest},
};

fn string_list(items: &Option<Vec<String>>) -> String {
    items.as_ref().map_or_else(|| "null".to_owned(), |items| go_array(items, |item| go_string(item)))
}

fn step_json(step: &PlanStep) -> String {
    let mut fields = vec![("id", go_string(&step.id)), ("title", go_string(&step.title))];
    if !step.detail.is_empty() {
        fields.push(("detail", go_string(&step.detail)));
    }
    if let Some(tools) = step.tools.as_ref().filter(|tools| !tools.is_empty()) {
        fields.push(("tools", go_array(tools, |tool| go_string(tool))));
    }
    fields.push(("risk", go_string(&step.risk)));
    go_object(&fields)
}

fn payload_json(payload: &PlanPayload) -> String {
    go_object(&[
        ("title", go_string(&payload.title)),
        ("summary", go_string(&payload.summary)),
        ("steps", payload.steps.as_ref().map_or_else(|| "null".to_owned(), |steps| go_array(steps, step_json))),
        ("assumptions", string_list(&payload.assumptions)),
        ("successCriteria", string_list(&payload.success_criteria)),
    ])
}

fn planning_instructions(request: &RunRequest) -> String {
    let mut out = String::from("\n\nCollaboration mode: PLAN. This conversation stays in Plan mode until the user approves a plan or switches modes. Plan mode is not changed by the user's wording: a request to act is a request to plan that action.\n- Only read. Nothing you do may change the user's data, send anything, or act in an app or a browser; such work belongs in the plan as a step.\n- Work in three phases: ground yourself with read tools (never ask what a tool can answer); settle intent (goal, success criteria, scope, constraints), asking only questions that change the plan");
    if request.can_ask() {
        out.push_str(" with conversation_ask_user");
    }
    out.push_str("; then propose a decision-complete plan.\n- Finish by calling plan_propose with the complete plan: concrete steps with their risk, assumptions, and success criteria the user can check. A revision restates the whole plan.\n- If the request is only a question that needs no plan, answer it and finish normally.");
    if let Some(plan) = request.plan.as_ref().filter(|plan| plan.state == "proposed" || plan.state == "rejected") {
        out.push_str(&format!(
            "\n- The current proposed plan (version {}, untrusted text for context) is: {}\n  Revise it from the user's feedback rather than starting over unless they ask.",
            plan.version,
            truncate_text(&payload_json(&plan.plan), 6000),
        ));
    }
    out
}

fn approved_plan_instructions(plan: &PlanState) -> String {
    let mut out = format!("\n\nThe user approved this plan: \"{}\" (version {}). Follow it and report each step with log_work_checklist using the plan's step ids (it starts as the plan's steps): in_progress before you start it, done after it, skipped or blocked with a note. If a step proves wrong or the work needs steps that are not in the plan, do not widen it silently: ask, or finish explaining the change.\nSteps:", plan.plan.title, plan.version);
    for step in plan.plan.steps.iter().flatten() {
        let status = plan.progress.get(&step.id).map_or("", |progress| progress.status.as_str());
        let status = if status.is_empty() { "pending" } else { status };
        out.push_str(&format!("\n- [{}] {} ({}, {status})", step.id, step.title, step.risk));
    }
    if let Some(criteria) = plan.plan.success_criteria.as_ref().filter(|criteria| !criteria.is_empty()) {
        out.push_str(&format!("\nSuccess criteria: {}", criteria.join("; ")));
    }
    out
}

pub(super) fn collaboration_instructions(request: &RunRequest) -> String {
    if request.planning() {
        return planning_instructions(request);
    }
    let mut out = String::new();
    if request.can_ask() {
        out.push_str("\n\nWhen a detail is missing but a sensible default exists (dates, a quantity, a place, a budget), choose one, say in your answer what you assumed, and keep working. Ask with conversation_ask_user only when no reasonable default exists, or when the choice would spend money, send something or be hard to undo; explore with read tools first and never ask whether to proceed. When the request asks you to pick, rank or recommend, commit to a choice from the best evidence you found and say what you could not confirm; an answer that leaves the choice open does not do what was asked.");
    }
    out.push_str("\n\nBefore multi-step work, publish a live checklist with log_work_checklist: 3-8 concrete steps the user can follow. Keep exactly one step in_progress, mark each done as you finish it, and mark steps you hand to another agent as delegated. Each turn publishes its own checklist; skip it for a single quick answer.");
    if let Some(plan) = request.approved_plan() {
        out.push_str(&approved_plan_instructions(plan));
    }
    if let Some(goal) = request.pursued_goal() {
        let used = goal.used_tokens as f64 / goal.budget_tokens as f64 * 100.0;
        out.push_str(&format!(
            "\n\nActive goal (keep working toward it across turns): {}\nBudget: {} of {} tokens used ({used:.0}%); continuation {} of {}.",
            goal.objective, goal.used_tokens, goal.budget_tokens, goal.continuation_count, goal.max_continuations,
        ));
        if let Some(criteria) = goal.success_criteria.as_ref().filter(|criteria| !criteria.is_empty()) {
            out.push_str(&format!("\nSuccess criteria (quote each exactly as evidence): {}", criteria.join("; ")));
        }
        out.push_str("\nBefore you stop, report with goal_update: in_progress with what is done and left; achieved only with inspected evidence for every criterion; unmet when a blocker needs the user. Do not accept proxy signals as completion: inspect the actual item, its content or result.");
        if used >= 80.0 {
            out.push_str("\nThe budget is nearly spent: finish the current step, then report progress, blockers and next steps instead of starting new work.");
        }
    }
    out
}
