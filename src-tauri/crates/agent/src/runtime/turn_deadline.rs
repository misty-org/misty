//! The deliverable deadline. A long Odysseys task reached the turn
//! limit while still browsing and ended with no answer, losing every page it read. Two turns before
//! the limit the run is told to write its answer; on the last turn only agent_finish is offered, so
//! a run always reports what it found and what remains.
use super::transcript::said;
use crate::sdk::Message;

const MARKER: &str = "Turn budget";

/// The note to add before this turn, once, or `None`.
pub(crate) fn deadline_note(turn: i64, limit: i64, messages: &[Message]) -> Option<String> {
    let left = limit - turn;
    if limit < 6 || left > 2 || said(messages, MARKER) {
        return None;
    }
    let plural = if left == 1 { "" } else { "s" };
    Some(format!("{MARKER}: this run has {left} model turn{plural} left. Stop gathering. Write your final answer now with agent_finish from everything you found: give each finding with its source, and list in remaining what is still undone and why."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::transcript::user_message;

    #[test]
    fn asks_for_the_answer_two_turns_before_the_limit_once() {
        assert_eq!(deadline_note(10, 20, &[]), None);
        let note = deadline_note(18, 20, &[]).unwrap();
        assert!(note.contains("2 model turns left"));
        assert_eq!(deadline_note(19, 20, &[user_message(note)]), None);
    }

    #[test]
    fn leaves_very_short_runs_alone() {
        assert_eq!(deadline_note(3, 4, &[]), None);
    }
}
