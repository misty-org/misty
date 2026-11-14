//! pi/omp rpc processes for the commands Misty runs out of turn, and the answer frames for
//! omp's rpc-ui dialogs.
use super::{attempt_error, report_commands, strip_terminal_codes, CONFIRM_YES_LABEL};
use crate::engines::command_for_binary;
use serde_json::Value;

/// An engine's own command in the chat's folder, with the environment a turn gives it (the
/// person's variables decide where its sessions and agent folder are) and piped output: the rpc
/// process here, and the plain subcommands Misty runs for a command (`omp cleanse`, `hermes
/// sessions export`). The binary's name comes back for errors.
pub(crate) fn cli_command(
    engine: &str,
    folder: &std::path::Path,
) -> Result<(tokio::process::Command, String), String> {
    crate::engines::support::config::ensure_engine_enabled(engine)?;
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, engine);
    let mut cmd = command_for_binary(&bin);
    for (key, value) in crate::engine_config::engine_env::env_for(engine)? {
        cmd.env(key, value);
    }
    for (key, value) in crate::engines::channels::env_for(engine) {
        cmd.env(key, value);
    }
    cmd.env("PATH", crate::engines::resolve::cli_search_path())
        .current_dir(folder)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    crate::engines::hide_console(&mut cmd);
    Ok((cmd, bin))
}

/// How long one out-of-turn call may take, startup included (omp loads its plugins and skills
/// before it reads stdin).
const RPC_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// A short-lived pi/omp rpc process opened on one of a chat's sessions, for the commands Misty
/// runs out of turn (`slash/pi/`). It opens the session the way a turn does (`--session` for
/// pi, `--resume` for omp, the same mode and environment), or a fork of it. Only `prompt`
/// reaches a model, for the side flows the person asked for. Calls go one at a time; the process
/// exits when this is dropped.
pub(crate) struct RpcSession {
    engine: String,
    child: tokio::process::Child,
    stdin: Option<tokio::process::ChildStdin>,
    lines: tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>,
    stderr: Option<tokio::task::JoinHandle<Vec<u8>>>,
    next_id: u64,
}

impl RpcSession {
    pub(crate) async fn open(
        engine: &str,
        folder: &std::path::Path,
        session: &str,
    ) -> Result<Self, String> {
        let flag = if engine == "omp" {
            "--resume"
        } else {
            "--session"
        };
        Self::spawn(engine, folder, session, &[flag, session]).await
    }

    /// An omp rpc process on a new copy of the chat's session (`--fork`), as omp's `/tan` and
    /// side flows clone it: the copy has the whole conversation so far and the chat's own
    /// session is never touched. `extra` adds launch flags (`--no-tools` for a side question).
    pub(crate) async fn fork(
        engine: &str,
        folder: &std::path::Path,
        session: &str,
        extra: &[&str],
    ) -> Result<Self, String> {
        if engine != "omp" {
            return Err(format!(
                "{engine} can't fork a session from the command line"
            ));
        }
        let mut args = vec!["--fork", session];
        args.extend_from_slice(extra);
        Self::spawn(engine, folder, session, &args).await
    }

    async fn spawn(
        engine: &str,
        folder: &std::path::Path,
        session: &str,
        args: &[&str],
    ) -> Result<Self, String> {
        use tokio::io::AsyncBufReadExt;
        if !matches!(engine, "pi" | "omp") {
            return Err(format!("{engine} has no rpc mode"));
        }
        // A leading dash would be read as a flag.
        if session.trim().is_empty() || session.starts_with('-') {
            return Err("This chat has no session to open yet.".into());
        }
        let (mut cmd, bin) = cli_command(engine, folder)?;
        cmd.args(["--mode", if engine == "omp" { "rpc-ui" } else { "rpc" }]);
        cmd.args(args);
        cmd.stdin(std::process::Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to run {bin}: {e}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{engine} gave no output pipe"))?;
        // Drained alongside, so a chatty stderr can't fill its pipe and stall the process; kept
        // to explain an early exit (omp prints "Session … not found" there).
        let stderr = child.stderr.take().map(|mut stderr| {
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut buf = Vec::new();
                let _ = stderr.read_to_end(&mut buf).await;
                buf
            })
        });
        Ok(Self {
            engine: engine.to_string(),
            stdin: child.stdin.take(),
            lines: tokio::io::BufReader::new(stdout).lines(),
            child,
            stderr,
            next_id: 0,
        })
    }

    /// Sends `{type, ...fields}` and waits for its response; the response's `data` (Null when it
    /// has none). Frames that pass meanwhile are only read for the commands they report.
    pub(crate) async fn call(&mut self, kind: &str, fields: Value) -> Result<Value, String> {
        use tokio::io::AsyncWriteExt;
        self.next_id += 1;
        let id = format!("misty-{}", self.next_id);
        let mut frame = match fields {
            Value::Object(map) => Value::Object(map),
            _ => serde_json::json!({}),
        };
        frame["id"] = Value::String(id.clone());
        frame["type"] = Value::String(kind.to_string());
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| format!("{} is closed", self.engine))?;
        let mut line = frame.to_string();
        line.push('\n');
        if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
            return Err(self.exit_error().await);
        }
        let deadline = tokio::time::Instant::now() + RPC_CALL_TIMEOUT;
        loop {
            let next = tokio::time::timeout_at(deadline, self.lines.next_line())
                .await
                .map_err(|_| format!("{} didn't answer {kind} in time", self.engine))?;
            let Ok(Some(line)) = next else {
                return Err(self.exit_error().await);
            };
            if line.contains("\"type\":\"available_commands_update\"") {
                report_commands(&self.engine, &line);
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(answer) = rpc_answer(&value, &id, kind) {
                return answer
                    .map_err(|error| format!("{} couldn't run {kind}: {error}", self.engine));
            }
        }
    }

    /// Sends `message` as a prompt and waits, up to `limit`, for the agent's last answer to end
    /// (omp marks it `isTerminal`). Nobody is there to answer an ask out of turn, so each one is
    /// cancelled. Errs with the turn's own error when it failed.
    pub(crate) async fn prompt(
        &mut self,
        message: &str,
        limit: std::time::Duration,
    ) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;
        self.call("prompt", serde_json::json!({ "message": message }))
            .await?;
        let deadline = tokio::time::Instant::now() + limit;
        loop {
            let next = tokio::time::timeout_at(deadline, self.lines.next_line())
                .await
                .map_err(|_| format!("{} didn't finish in time", self.engine))?;
            let Ok(Some(line)) = next else {
                return Err(self.exit_error().await);
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match value.get("type").and_then(Value::as_str) {
                Some("extension_ui_request") => {
                    let (Some(id), Some(method)) = (
                        value.get("id").and_then(Value::as_str),
                        value.get("method").and_then(Value::as_str),
                    ) else {
                        continue;
                    };
                    let mut frame = extension_ui_answer_frame(method, id, None).to_string();
                    frame.push('\n');
                    if let Some(stdin) = self.stdin.as_mut() {
                        let _ = stdin.write_all(frame.as_bytes()).await;
                        let _ = stdin.flush().await;
                    }
                }
                Some("agent_end")
                    if value.get("isTerminal").and_then(Value::as_bool) != Some(false)
                        && value.get("willRetry").and_then(Value::as_bool) != Some(true) =>
                {
                    return match attempt_error(&value) {
                        Some(error) => Err(error),
                        None => Ok(()),
                    };
                }
                _ => {}
            }
        }
    }

    /// Why the process stopped answering: its own words on stderr when it left any.
    async fn exit_error(&mut self) -> String {
        self.stdin = None;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), self.child.wait()).await;
        let said = match self.stderr.take() {
            Some(task) => tokio::time::timeout(std::time::Duration::from_secs(2), task)
                .await
                .ok()
                .and_then(Result::ok)
                .map(|buf| strip_terminal_codes(&String::from_utf8_lossy(&buf)))
                .unwrap_or_default(),
            None => String::new(),
        };
        let said = said
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(|line| line.trim_start_matches("Error:").trim().to_string());
        match said {
            Some(said) => format!("{} stopped: {said}", self.engine),
            None => format!("{} stopped before it answered", self.engine),
        }
    }

    /// Closes stdin so the engine saves the session and exits on its own; killed if it lingers.
    pub(crate) async fn close(mut self) {
        self.stdin = None;
        if tokio::time::timeout(std::time::Duration::from_secs(10), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
        }
    }
}

/// The answer to call `id` (a `kind` command) in one rpc frame: its `data` (Null when it has
/// none), its error, or None when the frame answers something else. omp 18 answers a command it
/// doesn't know with no id at all (`{"type":"response","command":"get_tree","success":false,
/// "error":"Unknown command: get_tree"}`), so a failure naming the command counts as the answer
/// rather than leaving the call to time out.
fn rpc_answer(value: &Value, id: &str, kind: &str) -> Option<Result<Value, String>> {
    if value.get("type").and_then(Value::as_str) != Some("response") {
        return None;
    }
    let succeeded = value.get("success").and_then(Value::as_bool) == Some(true);
    match value.get("id").and_then(Value::as_str) {
        Some(answered) if answered == id => {}
        None if !succeeded && value.get("command").and_then(Value::as_str) == Some(kind) => {}
        _ => return None,
    }
    Some(if succeeded {
        Ok(value.get("data").cloned().unwrap_or(Value::Null))
    } else {
        Err(value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown error")
            .to_string())
    })
}

/// Builds the omp rpc-ui answer frame. answers is the UI's map (question text → the chosen
/// label or free text); omp's fallback chain asks one question at a time, so the one value is
/// taken. None = the person dismissed it (cancelled; the CLI carries on as cancelled).
pub(crate) fn extension_ui_answer_frame(
    method: &str,
    request_id: &str,
    answers: Option<&Value>,
) -> Value {
    let answer = answers
        .and_then(Value::as_object)
        .and_then(|map| map.values().next());
    let Some(answer) = answer else {
        return serde_json::json!({
            "type": "extension_ui_response",
            "id": request_id,
            "cancelled": true,
        });
    };
    // select/input/editor answers are single strings; an array can only come from the UI's
    // multi-select card (omp's select frame is single choice), so it is joined as a fallback.
    let text = match answer {
        Value::String(s) => s.clone(),
        Value::Array(labels) => labels
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", "),
        other => other.to_string(),
    };
    if method == "confirm" {
        return serde_json::json!({
            "type": "extension_ui_response",
            "id": request_id,
            "confirmed": text == CONFIRM_YES_LABEL,
        });
    }
    serde_json::json!({
        "type": "extension_ui_response",
        "id": request_id,
        "value": text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Frames captured from omp 18.0.3 and pi 1.5.2 in rpc mode.
    #[test]
    fn rpc_answers_match_by_id_or_by_an_unknown_command_without_one() {
        let ok = serde_json::json!({"id":"misty-1","type":"response","command":"get_branch_messages",
            "success":true,"data":{"messages":[{"entryId":"bccb0406","text":"hello probe"}]}});
        assert_eq!(
            rpc_answer(&ok, "misty-1", "get_branch_messages")
                .unwrap()
                .unwrap()["messages"][0]["entryId"],
            "bccb0406"
        );
        assert!(rpc_answer(&ok, "misty-2", "get_branch_messages").is_none());
        // pi's set_session_name answers with no data.
        let bare = serde_json::json!({"id":"misty-3","type":"response","command":"set_session_name","success":true});
        assert_eq!(
            rpc_answer(&bare, "misty-3", "set_session_name").unwrap(),
            Ok(Value::Null)
        );
        // omp drops the id when it doesn't know the command.
        let unknown = serde_json::json!({"type":"response","command":"get_tree","success":false,
            "error":"Unknown command: get_tree"});
        assert_eq!(
            rpc_answer(&unknown, "misty-4", "get_tree").unwrap(),
            Err("Unknown command: get_tree".to_string())
        );
        assert!(rpc_answer(&unknown, "misty-4", "get_state").is_none());
        // pi keeps it.
        let pi_unknown = serde_json::json!({"id":"misty-5","type":"response","command":"bogus","success":false,
            "error":"Unknown command: bogus"});
        assert!(rpc_answer(&pi_unknown, "misty-5", "bogus")
            .unwrap()
            .is_err());
        assert!(rpc_answer(
            &serde_json::json!({"type":"command_output","text":"x"}),
            "misty-1",
            "prompt"
        )
        .is_none());
    }

    #[test]
    fn extension_ui_answer_frame_builds_the_response_per_method() {
        // select: the value is returned as it is (the CLI matches labels exactly, and free text
        // falls back to the chosen item).
        let frame = extension_ui_answer_frame(
            "select",
            "r1",
            Some(&serde_json::json!({ "Deploy where?": "prod" })),
        );
        assert_eq!(frame["type"], "extension_ui_response");
        assert_eq!(frame["id"], "r1");
        assert_eq!(frame["value"], "prod");

        // Free text goes in value too.
        let frame = extension_ui_answer_frame(
            "editor",
            "r2",
            Some(&serde_json::json!({ "q": "anything" })),
        );
        assert_eq!(frame["value"], "anything");

        // confirm maps to the confirmed boolean.
        let yes = extension_ui_answer_frame(
            "confirm",
            "r3",
            Some(&serde_json::json!({ "q": CONFIRM_YES_LABEL })),
        );
        assert_eq!(yes["confirmed"], true);
        let no =
            extension_ui_answer_frame("confirm", "r3", Some(&serde_json::json!({ "q": "Cancel" })));
        assert_eq!(no["confirmed"], false);

        // Dismissed = cancelled.
        let cancel = extension_ui_answer_frame("select", "r4", None);
        assert_eq!(cancel["cancelled"], true);
    }
}
