//! The person took over a run's page. Misty's own runs wait at their next step (`pause_local`); an
//! outside engine can't be paused mid-turn, so while the person holds the page its browser tools are
//! refused here, natively, and the model reads why. Handing the page back lets them through again.

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, PoisonError};

/// What the model reads when it reaches for the browser while the person holds it.
pub(crate) const TAKEN_OVER: &str = "The person has taken over this page. Don't use Misty's \
browser until they hand it back; carry on with other work or wait.";

/// What the model reads on its first browser result after the person hands the page back.
pub(crate) const HANDED_BACK: &str = "The person had this page and handed it back; they may have \
changed it. Read it again (browser_snapshot) before acting on refs from before.";

static HELD: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
/// Runs whose page came back from the person, until the model hears so once.
static RETURNED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn held() -> std::sync::MutexGuard<'static, HashSet<String>> {
    HELD.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The person took the run's page (`true`) or handed it back (`false`).
pub(crate) fn hold(run_id: &str, taken: bool) {
    if taken {
        held().insert(run_id.to_owned());
    } else if held().remove(run_id) {
        RETURNED
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(run_id.to_owned());
    }
}

/// Whether the person handed this run's page back since the model last heard so; asking clears
/// it, so the model hears it once (the idea of page-agent's user-takeover observation).
pub(crate) fn take_returned(run_id: &str) -> bool {
    RETURNED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(run_id)
}

/// The run ended: nothing of it is held any more.
pub(crate) fn release(run_id: &str) {
    held().remove(run_id);
    take_returned(run_id);
}

pub(crate) fn is_held(run_id: &str) -> bool {
    held().contains(run_id)
}

/// Whether `tool` drives Misty's browser: its pages and tabs.
fn drives_browser(tool: &str) -> bool {
    tool.starts_with("browser.") || tool.starts_with("screen.")
}

/// The refusal for a browser call of a run whose page the person holds, or nothing.
pub(crate) fn refusal(run_id: &str, tool: &str) -> Option<&'static str> {
    (drives_browser(tool) && is_held(run_id)).then_some(TAKEN_OVER)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_held_run_is_refused_the_browser_until_handed_back() {
        let run = "take_over_test_run";
        assert_eq!(refusal(run, "browser.steps"), None);
        hold(run, true);
        assert_eq!(refusal(run, "browser.steps"), Some(TAKEN_OVER));
        assert_eq!(refusal(run, "screen.open"), Some(TAKEN_OVER));
        // Space tools aren't the page: they go on.
        assert_eq!(refusal(run, "file.read"), None);
        // Another run's page isn't held.
        assert_eq!(refusal("take_over_other_run", "browser.steps"), None);
        hold(run, false);
        assert_eq!(refusal(run, "browser.steps"), None);
        // The model hears once that the page came back.
        assert!(take_returned(run));
        assert!(!take_returned(run));
    }

    #[test]
    fn an_ended_run_holds_nothing() {
        let run = "take_over_ended_run";
        hold(run, true);
        release(run);
        assert!(!is_held(run));
    }
}
