//! A short note for one model family. Every model gets the
//! same harness; this line only corrects a habit the family showed in the evals. It names the run it
//! came from, so it can be dropped once the evals no longer need it.
use std::sync::LazyLock;

use regex::Regex;

use super::js_regex::js_regex;

/// Baseline 2026-10-16: claude-haiku-5.5 named the group on screen but said it couldn't identify the
/// members instead of looking them up.
const ANTHROPIC_NOTE: &str = "When the person asks about something you can identify but need facts you don't have, look them up with your tools before saying you can't answer.";

/// Claude models under any provider: `anthropic/…`, `openrouter/anthropic/…`, `gateway/anthropic/…`.
static CLAUDE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"(^|\/)anthropic\/|(^|\/)claude-", true));

pub(crate) fn model_family_note(model_id: &str) -> &'static str {
    if CLAUDE.is_match(model_id) {
        ANTHROPIC_NOTE
    } else {
        ""
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_claude_models_their_correction_under_any_provider_and_others_none() {
        assert!(model_family_note("anthropic/claude-haiku-5.5").contains("look them up"));
        assert!(model_family_note("openrouter/anthropic/claude-sonnet-5.5").contains("look them up"));
        assert!(model_family_note("gateway/anthropic/claude-haiku-5.5").contains("look them up"));
        assert_eq!(model_family_note("openai/gpt-6-luna"), "");
        assert_eq!(model_family_note("xai/grok-5"), "");
    }
}
