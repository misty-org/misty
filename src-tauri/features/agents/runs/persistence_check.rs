use std::sync::LazyLock;

use regex::Regex;

use super::{
    js_regex::js_regex,
    task_completion::{Outcome, TaskCompletion},
};

static NEEDS_PERSON: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"\b(sign[ -]?in|log[ -]?in|password|account|captcha|verification|verify|2fa|one-time code|payment|pay|purchase|checkout|paywall|subscri)",
        true,
    )
});

pub(crate) const MAX_PERSIST: usize = 3;
const PERSIST_PROGRESS: usize = 2;

pub(crate) fn persist_again(
    report: &TaskCompletion,
    turn: i64,
    limit: i64,
    refusals: usize,
    new_results: usize,
) -> Option<String> {
    if refusals >= MAX_PERSIST || new_results < PERSIST_PROGRESS {
        return None;
    }
    early_give_up(report, turn, limit)
}

pub(crate) fn early_give_up(report: &TaskCompletion, turn: i64, limit: i64) -> Option<String> {
    if report.outcome == Outcome::Completed || report.remaining.is_empty() {
        return None;
    }
    if turn >= limit - 10 {
        return None;
    }
    let open: Vec<String> = report
        .remaining
        .iter()
        .filter(|item| !NEEDS_PERSON.is_match(&format!("{} {}", item.requirement, item.reason)))
        .map(|item| format!("- {}", item.requirement))
        .collect();
    if open.is_empty() {
        return None;
    }
    Some(format!(
        "Not finished yet, and this run still has time. These parts remain:\n{}\n{}",
        open.join("\n"),
        concat!(
            "Work each one another way before reporting: find the right page with a web search (add site: and the domain), open it in a tab of your own and read it (one browser_run program can open and read several pages), and use the site's own search, filters and links. A page or tool that failed is a reason to try another route, not to stop. ",
            "If a part stays open only because you asked for more than the request did (a written guide, an official page), drop that extra condition: open the best result you have, even a video, read its page text and report it. ",
            "Report partial only for parts that need the person (a sign-in, a payment, a CAPTCHA) or that the sites truly do not have, and say what you tried."
        )
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_completion::RemainingItem;

    fn partial(requirement: &str, reason: &str) -> TaskCompletion {
        TaskCompletion {
            outcome: Outcome::Partial,
            summary: "Some of it.".to_owned(),
            remaining: vec![RemainingItem {
                requirement: requirement.to_owned(),
                reason: reason.to_owned(),
            }],
        }
    }

    #[test]
    fn sends_an_early_partial_finish_back_to_work() {
        assert!(early_give_up(
            &partial("Tecovas boot options", "the search page returned an error"),
            6,
            120
        )
        .unwrap()
        .contains("Tecovas boot options"));
    }

    #[test]
    fn lets_a_finish_stand_when_it_is_complete_late_or_blocked_on_the_person() {
        let done = TaskCompletion {
            outcome: Outcome::Completed,
            summary: "Done.".to_owned(),
            remaining: Vec::new(),
        };
        assert_eq!(early_give_up(&done, 3, 120), None);
        assert!(
            early_give_up(&partial("Tecovas boot options", "the page failed"), 70, 120)
                .unwrap()
                .contains("Tecovas boot options")
        );
        assert_eq!(
            early_give_up(
                &partial("Tecovas boot options", "the page failed"),
                111,
                120
            ),
            None
        );
        assert_eq!(
            early_give_up(
                &partial("Order history", "needs the person to sign in"),
                3,
                120
            ),
            None
        );
    }

    #[test]
    fn sends_a_later_give_up_back_only_while_the_run_keeps_finding_new_things() {
        let quit = partial(
            "Ten Raleigh pediatricians verified",
            "only four profiles were read",
        );
        assert!(persist_again(&quit, 37, 200, 0, 5)
            .unwrap()
            .contains("Ten Raleigh pediatricians"));
        assert_eq!(persist_again(&quit, 37, 200, 0, 1), None);
        assert_eq!(persist_again(&quit, 37, 200, MAX_PERSIST, 9), None);
        assert_eq!(persist_again(&quit, 195, 200, 0, 9), None);
    }
}
