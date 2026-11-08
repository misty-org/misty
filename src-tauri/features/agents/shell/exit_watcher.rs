//! Commands stop when Misty does, even when Misty crashes and never gets to stop them.
//!
//! macOS can't tie a process's life to its parent's, so a small shell waits beside each command,
//! reading a pipe only Misty holds. The system closes that pipe however Misty dies, and the shell
//! then kills the command's process group. Nothing is written to disk, so there's no stale process
//! id to get wrong at the next launch, and it works even if Misty is never opened again.
//!
//! A process that left the group with `setsid()` is the one thing this misses. `process_tree` stops
//! those while Misty is alive; after a crash one stays inside the sandbox with its CPU time capped,
//! though one that mostly sleeps can go on until the computer restarts.
use std::process::Stdio;

use tokio::process::{Child, Command};

/// Takes only the group's number. No part of a command reaches this script.
const WATCH_SCRIPT: &str = r#"read -r _line; kill -9 -- "-$1""#;

pub(super) struct ExitWatcher(Child);

impl ExitWatcher {
    /// Starts watching for Misty's exit on behalf of process group `group`. If this value is dropped
    /// without `stop`, the pipe closes and the group is killed, so a cancelled run cleans up too.
    pub(super) fn start(group: i32) -> std::io::Result<Self> {
        Command::new("/bin/sh")
            .args(["-c", WATCH_SCRIPT, "exit-watcher"])
            .arg(group.to_string())
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            // Its own group, so stopping the command, or the command signalling its group, leaves
            // the watcher alone.
            .process_group(0)
            .spawn()
            .map(Self)
    }

    /// The command has ended, so the group's number means nothing now and must not be killed later.
    pub(super) async fn stop(mut self) {
        let _ = self.0.kill().await;
    }
}
