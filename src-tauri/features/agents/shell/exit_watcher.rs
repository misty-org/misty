use std::process::Stdio;

use tokio::process::{Child, Command};

const WATCH_SCRIPT: &str = r#"read -r _line; kill -9 -- "-$1""#;

pub(crate) struct ExitWatcher(Child);

impl ExitWatcher {
    pub(crate) fn start(group: i32) -> std::io::Result<Self> {
        Command::new("/bin/sh")
            .args(["-c", WATCH_SCRIPT, "exit-watcher"])
            .arg(group.to_string())
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map(Self)
    }

    pub(crate) async fn stop(mut self) {
        let _ = self.0.kill().await;
    }
}
