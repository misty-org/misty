//! Warming up Tutor's engine while the person is still talking. The first spoken turn of a Tutor
//! session used to start Claude Code only once the turn was sent, so the CLI's start-up (its
//! handshake, MCP servers and session) came on top of every first answer. Now, when the talk keys
//! go down on a session that has no turn yet, Misty launches the CLI as that turn would, under a
//! session id of Misty's own (`--session-id`), writes no prompt, and parks the process as warm
//! for the session (`registry::set_warm_followup`). The turn, a moment later, goes into it the
//! way a chat's next message goes into its warm process (`deliver_to_idle_followup`).
//!
//! Until a session has had a turn, Claude Code has nothing saved for it, so it can't be resumed:
//! a launch for it starts it under the same id instead (`--session-id`, not `--resume`). That
//! covers a warm process that was let go (its idle timeout, or a launch that no longer matches).

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, MutexGuard};

/// Sessions Misty named that have had no turn yet.
static UNBORN: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
/// Sessions whose next launch is the warm-up itself, which writes no prompt.
static WARMING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

fn held(set: &'static LazyLock<Mutex<HashSet<String>>>) -> MutexGuard<'static, HashSet<String>> {
    set.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A new session of Misty's, whose first launch is a warm-up.
pub(crate) fn begin(session: &str) {
    held(&UNBORN).insert(session.to_string());
    held(&WARMING).insert(session.to_string());
}

/// Whether a session has had no turn yet, so a launch starts it rather than resuming it.
pub(crate) fn unborn(session: &str) -> bool {
    held(&UNBORN).contains(session)
}

/// Whether this launch of the session is its warm-up; asking takes the answer.
pub(crate) fn take_warming(session: &str) -> bool {
    held(&WARMING).remove(session)
}

/// The session's first turn has been sent: Claude Code keeps it from here, and later launches
/// resume it.
pub(crate) fn born(session: &str) {
    held(&UNBORN).remove(session);
    held(&WARMING).remove(session);
}
