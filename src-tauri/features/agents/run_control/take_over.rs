use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, PoisonError};

pub(crate) const TAKEN_OVER: &str = "The person has taken over this page. Don't use Misty's \
browser until they hand it back; carry on with other work or wait.";

pub(crate) const HANDED_BACK: &str = "The person had this page and handed it back; they may have \
changed it. Read it again (browser_snapshot) before acting on refs from before.";

static HELD: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
static RETURNED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn held() -> std::sync::MutexGuard<'static, HashSet<String>> {
    HELD.lock().unwrap_or_else(PoisonError::into_inner)
}

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

pub(crate) fn take_returned(run_id: &str) -> bool {
    RETURNED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(run_id)
}

pub(crate) fn release(run_id: &str) {
    held().remove(run_id);
    take_returned(run_id);
}

pub(crate) fn is_held(run_id: &str) -> bool {
    held().contains(run_id)
}

fn drives_browser(tool: &str) -> bool {
    tool.starts_with("browser.") || tool.starts_with("screen.")
}

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
        assert_eq!(refusal(run, "file.read"), None);
        assert_eq!(refusal("take_over_other_run", "browser.steps"), None);
        hold(run, false);
        assert_eq!(refusal(run, "browser.steps"), None);
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
