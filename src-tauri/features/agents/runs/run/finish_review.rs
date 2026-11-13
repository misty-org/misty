//! The one verification turn (`finish_verification.rs`): the note that sends a finish or a plain
//! answer back, or `None` when it stands. Only the first finish with turns left is checked.
use crate::finish_verification::{finish_findings, may_verify, report_only_issue, verification_note, FinishCheck};
use crate::js_json::JsValue;
use crate::persistence_check::persist_again;
use crate::requirements_review::{open_pages, review_answer, review_refusal, worth_ledger, worth_reviewing};
use crate::task_completion::TaskCompletion;
use crate::time_budget::result_prints;
use crate::tool_transport::{object, string};
use crate::model_calls::Message;

use super::{
    agent_run::{locked, RunShared},
    run_tools::RunTools,
};

pub(super) async fn verify_finish(shared: &RunShared, tools: &RunTools, report: &TaskCompletion, messages: &[Message]) -> Option<String> {
    let context = &shared.context;
    let (limit, model_turn) = (shared.limit(), shared.model_turn());
    let (catalog, research) = (&tools.catalog, &tools.research);
    // Done rows nothing in the run backs go back to pending, whether or not this finish is checked.
    let unbacked = locked(&shared.ledger).reconcile(messages, &report.summary);
    // Checked on every finish, twice at most: a report of the work is never the answer.
    {
        let mut finish = locked(&shared.finish);
        let reported_only = if finish.reported_only < 2 && model_turn < limit - 2 { report_only_issue(&report.summary) } else { None };
        if let Some(issue) = reported_only {
            finish.reported_only += 1;
            return verification_note(&[issue], false);
        }
    }
    let long = worth_ledger(&context.prompt);
    let (verified, persisted, persisted_at) = {
        let finish = locked(&shared.finish);
        (finish.verified, finish.persisted, finish.persisted_at.clone())
    };
    if !may_verify(verified, model_turn, limit) {
        // A long request that quits again with turns left goes back while it is still finding things
        // (persistence_check.rs); one that only repeats itself finishes.
        let persisted_at = persisted_at.filter(|_| long)?;
        let prints = result_prints(messages);
        let fresh = prints.iter().filter(|print| !persisted_at.contains(*print)).count();
        let again = persist_again(report, model_turn, limit, persisted, fresh);
        shared.deps.logger.line(
            "finish_persist",
            &object([
                ("run", string(shared.identity.misty_run_id.as_str())),
                ("turn", JsValue::Number(model_turn as f64)),
                ("refusals", JsValue::Number(persisted as f64)),
                ("fresh", JsValue::Number(fresh as f64)),
                ("sentBack", JsValue::Bool(again.is_some())),
            ]),
        );
        let again = again?;
        let mut finish = locked(&shared.finish);
        finish.persisted += 1;
        finish.persisted_at = Some(prints);
        return verification_note(&[again], true);
    }
    locked(&shared.finish).verified = true;
    let open_rows = locked(&shared.ledger).remaining();
    let read_only = |name: &str| catalog.read_only(name);
    let (mut issues, gave_up) = finish_findings(&FinishCheck {
        request: &context.prompt,
        report,
        messages,
        turn: model_turn,
        limit,
        long,
        research,
        program: catalog.model_name("browser.run"),
        read_only: &read_only,
        unbacked_rows: &unbacked,
        open_rows: &open_rows,
    });
    if gave_up {
        locked(&shared.finish).persisted_at = Some(result_prints(messages));
    }
    if long && worth_reviewing(&context.prompt, report, model_turn, limit) {
        let pages = open_pages(messages, research.open.as_deref(), catalog.model_name("browser.navigate"));
        let gaps = review_answer(shared, shared.deps.access.as_ref(), &context.model_id, &context.prompt, report, &pages).await;
        if !gaps.is_empty() {
            issues.push(review_refusal(&gaps));
        }
    }
    let note = verification_note(&issues, gave_up);
    shared.deps.logger.line(
        "finish_verified",
        &object([
            ("run", string(shared.identity.misty_run_id.as_str())),
            ("turn", JsValue::Number(model_turn as f64)),
            ("long", JsValue::Bool(long)),
            ("issues", JsValue::Number(issues.len() as f64)),
        ]),
    );
    note
}
