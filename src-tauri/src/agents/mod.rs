//! Agents that run on this device. Misty agents delegate coding to the coding
//! command-line tools the person installed (Claude Code, Codex and others);
//! `runners` starts them, speaks each tool's protocol, answers their permission
//! questions through Misty's rules and reports their work back to the server.
pub mod project_diff;
pub mod project_root;
pub mod runners;
