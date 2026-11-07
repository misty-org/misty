//! Take over: the person pauses the agent to use
//! its window themselves. The run waits at its boundary, polling every [`TAKEOVER_POLL_SECONDS`]
//! without model turns, for at most [`TAKEOVER_LIMIT`] polls; on resume its next turn starts from
//! what the window shows now, not from snapshots taken before.
use super::transcript::user_message;
use crate::sdk::Message;

pub(crate) const TAKEOVER_POLL_SECONDS: u64 = 10;
pub(crate) const TAKEOVER_LIMIT: u32 = 180;

pub(crate) const RESUME_NOTE: &str = "The person took over your window while you were paused and may have changed its pages, tabs or Space. Before acting, read your tabs again (browser_snapshot) and check your earlier steps against what they show now; do not repeat a step whose result you can't confirm.";

/// The resume note goes into the transcript once, after any messages the person sent.
pub(crate) fn after_takeover(messages: &[Message], sent: &[String]) -> Vec<Message> {
    let mut next = messages.to_vec();
    next.extend(sent.iter().map(|text| user_message(text.clone())));
    next.push(user_message(RESUME_NOTE));
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::transcript::user_string;

    #[test]
    fn resumes_with_the_persons_messages_then_a_note_to_read_the_window_again() {
        let next = after_takeover(&[user_message("Compare the plans")], &["Use the yearly price".to_owned()]);
        let texts: Vec<&str> = next.iter().filter_map(user_string).collect();
        assert_eq!(texts, ["Compare the plans", "Use the yearly price", RESUME_NOTE]);
        assert!(RESUME_NOTE.contains("read your tabs again"));
    }
}
