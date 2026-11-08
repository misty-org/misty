//! One verification turn before a finish stands. Until October
//! 20 each guard sent a finish back on its own: unread citations, unbacked claims, proof tabs, the
//! requirements review, a plain answer that skipped the last refusal, and early give-ups up to eight
//! times. Stacked, they kept short questions working after their answer was written: an answer that
//! said one release date was unconfirmed went back to fetch the same site again and again. Now every
//! check runs together once, the run gets one note with all it found, and its next finish stands.
//! Sending a partial finish back to work is for long requests only.
use std::sync::LazyLock;

use regex::Regex;

use super::{
    citation_check::{citation_refusal, unread_citations},
    count_check::count_refusal,
    finish_check::{unbacked_completion, ReadOnly},
    js_regex::js_regex,
    ledger::{ledger_issue, open_rows_issue, LedgerRow},
    persistence_check::early_give_up,
    proof_tabs::{broken_proof_tabs, missing_site_tabs, proof_tabs_refusal},
    research_budget::{research_use, ResearchStage, ResearchTools},
    task_completion::{RemainingItem, TaskCompletion},
};
use crate::model_calls::Message;

pub(crate) struct FinishCheck<'a> {
    pub(crate) request: &'a str,
    pub(crate) report: &'a TaskCompletion,
    pub(crate) messages: &'a [Message],
    pub(crate) turn: i64,
    pub(crate) limit: i64,
    /// A long request (`requirements_review::worth_ledger`): many parts, worth persisting on.
    pub(crate) long: bool,
    pub(crate) research: &'a ResearchTools,
    /// browser.tab.list's model name, when the run has tabs of its own.
    pub(crate) tab_list: Option<&'a str>,
    /// browser_run's model name, when the run has programs: the run checks its tabs with one.
    pub(crate) program: Option<&'a str>,
    pub(crate) read_only: ReadOnly<'a>,
    /// Rows the run marked done that its calls do not back (`ledger.rs`).
    pub(crate) unbacked_rows: &'a [LedgerRow],
    /// The ledger's parts not yet done or skipped (`Ledger::remaining`).
    pub(crate) open_rows: &'a [RemainingItem],
}

/// Whether a finish may still be sent back: once, and only with turns left to act on it.
pub(crate) fn may_verify(verified: bool, turn: i64, limit: i64) -> bool {
    !verified && turn < limit - 2
}

/// What the checks that need no model call find, in the order the run should fix them.
pub(crate) fn finish_issues(check: &FinishCheck) -> Vec<String> {
    finish_findings(check).0
}

/// The issues, and whether one is a long request giving up with time left.
pub(crate) fn finish_findings(check: &FinishCheck) -> (Vec<String>, bool) {
    let mut issues = Vec::new();
    let unread = unread_citations(&check.report.summary, check.messages, check.research);
    if !unread.is_empty() {
        let has_fetch = check.research.fetch.as_deref().is_some_and(|fetch| !fetch.is_empty());
        let can_fetch = has_fetch && research_use(check.messages, check.research, 1).stage != ResearchStage::Closed;
        issues.push(citation_refusal(&unread, can_fetch, "finish"));
    }
    if let Some(unbacked) = unbacked_completion(check.report, check.messages, check.read_only) {
        issues.push(unbacked);
    }
    let tab_list = check.tab_list.filter(|name| !name.is_empty());
    let program = check.program.filter(|name| !name.is_empty());
    if tab_list.is_some() || program.is_some() {
        if let Some(proof) = proof_tabs_refusal(check.request, check.messages, tab_list, program) {
            issues.push(proof);
        }
    }
    // Checked on evidence, without a model call.
    let broken = broken_proof_tabs(check.messages);
    if !broken.is_empty() {
        issues.push(format!("Pages you kept as proof show an error or nothing: {}. Open each page again from a search or the site's own links, keep() the working page, and close or replace the broken one.", broken.join("; ")));
    }
    let missing = if program.is_some() { missing_site_tabs(check.request, check.messages) } else { Vec::new() };
    if !missing.is_empty() {
        let pronoun = if missing.len() == 1 { "it" } else { "them" };
        issues.push(format!("The request names {} and you visited {pronoun}, but no tab of yours is open there now. Open the page the request asks for there (the item itself, not a search page), keep() it, and use what it shows.", missing.join(", ")));
    }
    issues.extend(ledger_issue(check.unbacked_rows));
    issues.extend(open_rows_issue(check.report, check.open_rows));
    issues.extend(count_refusal(check.request, &check.report.summary));
    let give_up = if check.long { early_give_up(check.report, check.turn, check.limit) } else { None };
    let gave_up = give_up.is_some();
    issues.extend(give_up);
    (issues, gave_up)
}

/// The one note that sends a finish back, or `None` when it stands. `persist` is a long request that
/// gave up with time left: it is told to keep working, since a later give-up goes back again while
/// it is still finding things (`persistence_check.rs`).
pub(crate) fn verification_note(issues: &[String], persist: bool) -> Option<String> {
    if issues.is_empty() {
        return None;
    }
    let body = match issues {
        [only] => only.clone(),
        _ => issues.iter().enumerate().map(|(index, issue)| format!("{}. {issue}", index + 1)).collect::<Vec<_>>().join("\n\n"),
    };
    let close = if persist {
        "Keep working on the open parts, then finish with agent_finish when they are done or truly blocked. Report partial only for what needs the person or what the sites do not have."
    } else {
        "Fix what you can, then finish with agent_finish. This check runs only once: your next finish stands as you send it, so say plainly in it what is still unconfirmed rather than looking for it again."
    };
    let once = if persist { "" } else { "once " };
    Some(format!("Before your answer goes out, Misty checked it {once}against the request and this run:\n\n{body}\n\n{close}"))
}

/// An answer that says the work was delivered ("Completed all 26 requirements", "Delivered a
/// side-by-side comparison") in place of the comparison itself.
static REPORT_ONLY: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\b(completed|met|satisfied|fulfilled|addressed) all (\d+ )?(requirements|parts|items|steps)\b|\bdelivered (a |the )?(side-by-side |full |final )?(comparison|summary|recommendation|answer|report)\b", true));

/// The note that sends a report-only answer back, or `None`.
pub(crate) fn report_only_issue(summary: &str) -> Option<String> {
    if !REPORT_ONLY.is_match(summary) {
        return None;
    }
    Some("Your answer describes the work (what was completed or delivered) instead of giving it. The person reads only this answer: write the comparison, summary and recommendation themselves, in full and formatted for them, with the details and links, and leave out the bookkeeping. Then finish.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::{Ledger, RowState, SentRow};
    use crate::task_completion::Outcome;

    fn research() -> ResearchTools {
        ResearchTools { search: Some("web_search".to_owned()), fetch: Some("web_fetch".to_owned()), open: Some("screen_open".to_owned()) }
    }

    fn unconfirmed() -> TaskCompletion {
        TaskCompletion {
            outcome: Outcome::Partial,
            summary: "Palace's Winter drop began October 4. A Jordan 11 Low is listed for October 23, but I couldn't confirm the date.".to_owned(),
            remaining: vec![RemainingItem { requirement: "Confirm the Jordan 11 Low release date".to_owned(), reason: "the article doesn't give it".to_owned() }],
        }
    }

    fn check<'a>(request: &'a str, report: &'a TaskCompletion, research: &'a ResearchTools, long: bool) -> FinishCheck<'a> {
        FinishCheck {
            request,
            report,
            messages: &[],
            turn: 6,
            limit: 90,
            long,
            research,
            tab_list: None,
            program: None,
            read_only: &|_| true,
            unbacked_rows: &[],
            open_rows: &[],
        }
    }

    const STREETWEAR: &str = "What's dropping this week in streetwear?";

    #[test]
    fn lets_a_short_requests_honest_partial_answer_stand() {
        let (report, research) = (unconfirmed(), research());
        assert!(finish_issues(&check(STREETWEAR, &report, &research, false)).is_empty());
    }

    #[test]
    fn sends_a_long_requests_early_give_up_back() {
        let (report, research) = (unconfirmed(), research());
        let (issues, gave_up) = finish_findings(&check(STREETWEAR, &report, &research, true));
        assert!(issues.join("\n").contains("Confirm the Jordan 11 Low release date"));
        assert!(gave_up);
    }

    #[test]
    fn gathers_every_checks_finding_into_one_list() {
        let report = TaskCompletion { outcome: Outcome::Completed, summary: "I've drafted the email.".to_owned(), remaining: Vec::new() };
        let research = research();
        let request = "Draft an email in Gmail to my team with this week's drops, and keep each source open in its own tab.";
        let issues = finish_issues(&FinishCheck { tab_list: Some("browser_tab_list"), ..check(request, &report, &research, true) });
        assert_eq!(issues.len(), 2);
        let note = verification_note(&issues, false).unwrap();
        assert!(note.starts_with("Before your answer goes out"));
        let (first, second, last) = (note.find("1. No tool call").unwrap(), note.find("2. The person asked for pages").unwrap(), note.find("runs only once").unwrap());
        assert!(first < second && second < last);
    }

    #[test]
    fn verifies_once_with_turns_left() {
        assert!(may_verify(false, 10, 90));
        assert!(!may_verify(true, 10, 90));
        assert!(!may_verify(false, 88, 90));
    }

    #[test]
    fn the_note_is_none_when_nothing_was_found() {
        assert_eq!(verification_note(&[], false), None);
    }

    #[test]
    fn tells_a_long_run_that_gave_up_to_keep_working_not_to_stop_looking() {
        let note = verification_note(&["Not finished yet.".to_owned()], true).unwrap();
        assert!(note.contains("Keep working on the open parts"));
        assert!(!note.contains("runs only once"));
        assert!(!note.contains("rather than looking for it again"));
    }

    fn pending_row(requirement: &str, state: RowState) -> SentRow {
        SentRow { requirement: requirement.to_owned(), state, ..SentRow::default() }
    }

    #[test]
    fn raises_a_finish_issue_for_rows_nothing_backs() {
        let mut ledger = Ledger::default();
        ledger.update(vec![pending_row("A", RowState::Done)]);
        let unbacked_rows = ledger.reconcile(&[], "");
        let report = TaskCompletion { outcome: Outcome::Completed, summary: "done".to_owned(), remaining: Vec::new() };
        let research = ResearchTools::default();
        let issues = finish_issues(&FinishCheck {
            read_only: &|_| false,
            turn: 1,
            limit: 30,
            unbacked_rows: &unbacked_rows,
            ..check("do A", &report, &research, false)
        });
        assert!(issues.join("\n").contains("marked done"));
    }

    #[test]
    fn sends_a_completed_finish_back_while_its_ledger_has_open_rows() {
        let mut ledger = Ledger::default();
        ledger.update(vec![
            pending_row("Find A", RowState::Pending),
            SentRow { reason: Some("not asked".to_owned()), ..pending_row("Find B", RowState::Skipped) },
        ]);
        let open_rows = ledger.remaining();
        let research = ResearchTools::default();
        let outcome_issues = |outcome| {
            let report = TaskCompletion { outcome, summary: "A is 1".to_owned(), remaining: Vec::new() };
            finish_issues(&FinishCheck {
                read_only: &|_| false,
                turn: 1,
                limit: 30,
                open_rows: &open_rows,
                ..check("find A and B", &report, &research, false)
            })
            .join("\n")
        };
        assert!(outcome_issues(Outcome::Completed).contains(r#"1 part as not done ("Find A")"#));
        assert_eq!(outcome_issues(Outcome::Partial), "");
    }

    #[test]
    fn sends_back_an_answer_that_reports_the_work_instead_of_giving_it() {
        assert!(report_only_issue("Completed all 26 requirements. Delivered side-by-side comparison.").unwrap().contains("describes the work"));
        assert_eq!(report_only_issue("## Stockeld Park vs Harrogate\n| | Stockeld | Funland |"), None);
    }
}
