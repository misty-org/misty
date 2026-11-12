//! Names other programs chose that happen to be "main". None is a window label: Misty's windows
//! are named only in `browser/app_windows`, which a contract test holds every other file to.

/// A Git repository's usual default branch, when a skill repository names none.
pub const DEFAULT_BRANCH: &str = "main";
/// The branch older repositories use instead.
pub const OLD_DEFAULT_BRANCH: &str = "master";
/// The folder Kimi keeps its primary agent's transcript in: `agents/main/wire.jsonl`.
pub const KIMI_PRIMARY_AGENT: &str = "main";
