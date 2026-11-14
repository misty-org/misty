//! Antigravity's sub-agents on the ACP turn. `invoke_subagent` (`/teamwork`, `/browser`, `/goal`
//! and the model's own hand-offs) reaches ACP as one tool call with only `Prompt`, `Role` and
//! `TypeName`, and finishes as soon as the sub-agent starts: the sub-agent works on in the
//! background, and its steps go only to its own conversation's transcript. This reads them from
//! there and shows them nested under the row that started it, the way Claude Code's Task shows.
//!
//! Checked against agy 1.5.9: each sub-agent the conversation starts is recorded in
//! `brain/<conversation>/.system_generated/subagents/<child>.json` (`conversationId`,
//! `spawnStepIndex`, `subagentDescriptor`), and the child writes its steps to
//! `brain/<child>/.system_generated/logs/transcript.jsonl`, one JSON step per line.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use crate::engines::{tool_call_message_with_id, tool_result_patch_with_id, EngineEvent};

/// How often the sub-agents' files are read while the turn's own stream is busy.
const POLL: Duration = Duration::from_millis(400);
/// After the prompt has answered, how long the turn waits on a sub-agent that hasn't reported
/// back, with nothing new from it or the main agent: a model's turn can think this long.
const QUIET_WORKING: Duration = Duration::from_secs(90);
/// And once every sub-agent has reported back. agy 1.5.9 doesn't stream the main agent's answer
/// to the report over ACP (it runs in the conversation, unsent), so this is only slack.
const QUIET_REPORTED: Duration = Duration::from_secs(5);

/// The sub-agents one turn starts, and how far each one's transcript has been read.
pub(crate) struct Subagents {
    brain: PathBuf,
    /// `brain/<conversation>/.system_generated/subagents`.
    folder: PathBuf,
    /// Sub-agents already shown, and those an earlier turn started, which this one leaves alone.
    seen: HashSet<String>,
    /// `invoke_subagent` rows no sub-agent has been matched to yet, oldest first.
    rows: VecDeque<String>,
    /// The parent's step that started sub-agents -> the row they nest under: one call can start
    /// several, and each records the same `spawnStepIndex`.
    spawns: HashMap<i64, String>,
    logs: Vec<ChildLog>,
    polled: Option<Instant>,
}

/// One sub-agent's transcript, read as it grows.
struct ChildLog {
    /// The `invoke_subagent` row its own rows nest under.
    row: String,
    conversation: String,
    path: PathBuf,
    /// Bytes of the transcript already read (whole lines only).
    offset: u64,
    /// Calls whose result step hasn't been read yet, oldest first: the transcript runs a planner
    /// step's calls in the steps after it, in order.
    pending: VecDeque<(String, String)>,
    /// Its last step sent the main agent a message (`send_message`), which is how a sub-agent
    /// hands back its work.
    reported: bool,
}

impl Subagents {
    /// The sub-agents of the conversation `session_id`, in Antigravity's own home.
    pub(crate) fn of(session_id: &str) -> Self {
        Self::in_brain(super::agy_home().join("brain"), session_id)
    }

    pub(crate) fn in_brain(brain: PathBuf, session_id: &str) -> Self {
        let folder = brain
            .join(session_id)
            .join(".system_generated")
            .join("subagents");
        let seen = records(&folder)
            .into_iter()
            .map(|(conversation, _)| conversation)
            .collect();
        Self {
            brain,
            folder,
            seen,
            rows: VecDeque::new(),
            spawns: HashMap::new(),
            logs: Vec::new(),
            polled: None,
        }
    }

    /// Follows one `session/update`. An `invoke_subagent` call is remembered as the row its
    /// sub-agent nests under, and comes back with its input named the way the chat reads a
    /// sub-agent's goal off its Task (`description`, `prompt`, `subagent_type`).
    pub(crate) fn update(&mut self, params: &Value) -> Option<Value> {
        let update = &params["update"];
        if update["sessionUpdate"] != "tool_call" || update["name"] != "invoke_subagent" {
            return None;
        }
        let id = update["toolCallId"].as_str().filter(|id| !id.is_empty())?;
        if !self.rows.iter().any(|row| row == id) && !self.spawns.values().any(|row| row == id) {
            self.rows.push_back(id.to_string());
            // Look for its sub-agent on the next line.
            self.polled = None;
        }
        let input = update.get("rawInput").and_then(Value::as_object)?;
        let mut named = input.clone();
        for (from, to) in [
            ("Role", "description"),
            ("Prompt", "prompt"),
            ("TypeName", "subagent_type"),
        ] {
            if let Some(text) = input.get(from).and_then(Value::as_str) {
                named.insert(to.into(), Value::String(text.into()));
            }
        }
        let mut params = params.clone();
        params["update"]["rawInput"] = Value::Object(named);
        Some(params)
    }

    /// What the sub-agents have done since the last look, at most every `POLL` unless `now`:
    /// each one's rows inside a `Scope` naming the row that started it.
    pub(crate) fn poll(&mut self, now: bool) -> Vec<EngineEvent> {
        if (self.rows.is_empty() && self.logs.is_empty())
            || (!now && self.polled.is_some_and(|at| at.elapsed() < POLL))
        {
            return Vec::new();
        }
        self.polled = Some(Instant::now());
        self.adopt();
        let mut out = Vec::new();
        for log in &mut self.logs {
            let mut nested = Vec::new();
            log.read(&mut nested);
            if !nested.is_empty() {
                out.push(EngineEvent::Scope {
                    parent: Some(log.row.clone()),
                });
                out.append(&mut nested);
                out.push(EngineEvent::Scope { parent: None });
            }
        }
        out
    }

    /// Whether this turn started a sub-agent.
    pub(crate) fn started_any(&self) -> bool {
        !self.rows.is_empty() || !self.logs.is_empty()
    }

    /// How long the turn may go with nothing new before it ends, once its prompt has answered.
    pub(crate) fn quiet_after(&self) -> Duration {
        if self.rows.is_empty() && self.logs.iter().all(|log| log.reported) {
            QUIET_REPORTED
        } else {
            QUIET_WORKING
        }
    }

    /// Starts reading each new sub-agent, under the row of the call that started it. One seen
    /// before its call's row arrived waits for the next look.
    fn adopt(&mut self) {
        let mut found: Vec<(String, i64)> = records(&self.folder)
            .into_iter()
            .filter(|(conversation, _)| !self.seen.contains(conversation))
            .collect();
        found.sort_by_key(|(conversation, step)| (*step, conversation.clone()));
        for (conversation, step) in found {
            let row = match self.spawns.get(&step) {
                Some(row) => row.clone(),
                None => {
                    let Some(row) = self.rows.pop_front() else {
                        continue;
                    };
                    self.spawns.insert(step, row.clone());
                    row
                }
            };
            let path = self
                .brain
                .join(&conversation)
                .join(".system_generated")
                .join("logs")
                .join("transcript.jsonl");
            self.seen.insert(conversation.clone());
            self.logs.push(ChildLog {
                row,
                conversation,
                path,
                offset: 0,
                pending: VecDeque::new(),
                reported: false,
            });
        }
    }
}

/// Each sub-agent record in the folder: its conversation id and the parent's step that started
/// it. A record still being written is left for the next look.
fn records(folder: &std::path::Path) -> Vec<(String, i64)> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .filter_map(|entry| {
            let record: Value = serde_json::from_slice(&std::fs::read(entry.path()).ok()?).ok()?;
            let conversation = record["conversationId"]
                .as_str()
                .filter(|id| !id.is_empty() && !id.contains(['/', '\\']) && *id != "..")?;
            let step = record["spawnStepIndex"].as_i64().unwrap_or(-1);
            Some((conversation.to_string(), step))
        })
        .collect()
}

impl ChildLog {
    fn read(&mut self, out: &mut Vec<EngineEvent>) {
        use std::io::{Read, Seek, SeekFrom};
        let Ok(mut file) = std::fs::File::open(&self.path) else {
            return;
        };
        let length = file.metadata().map(|m| m.len()).unwrap_or(0);
        if length < self.offset {
            // Rewritten from the start: read it again (rows already shown keep their ids).
            self.offset = 0;
            self.pending.clear();
        }
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_err() {
            return;
        }
        // A line still being written waits for the next look.
        let Some(end) = bytes.iter().rposition(|b| *b == b'\n') else {
            return;
        };
        self.offset += end as u64 + 1;
        for line in bytes[..end].split(|b| *b == b'\n') {
            if let Ok(step) = serde_json::from_slice::<Value>(line) {
                self.step(&step, out);
            }
        }
    }

    /// One transcript step: a `PLANNER_RESPONSE` lists the calls it makes in `tool_calls` (each
    /// argument JSON-encoded as a string), and each call's outcome is a later step, `DONE` with
    /// its output in `content` or `ERROR` with `error`.
    fn step(&mut self, step: &Value, out: &mut Vec<EngineEvent>) {
        let index = step["step_index"].as_i64().unwrap_or(-1);
        match step["type"].as_str().unwrap_or("") {
            "PLANNER_RESPONSE" => {
                for (n, call) in step["tool_calls"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .enumerate()
                {
                    let name = call["name"].as_str().unwrap_or("tool").to_string();
                    let args = call.get("args").map(decoded_args);
                    let id = format!("{}:{index}:{n}", self.conversation);
                    out.push(tool_call_message_with_id(&name, args.as_ref(), Some(&id)));
                    self.pending.push_back((id, name));
                    self.reported = false;
                }
            }
            "USER_INPUT" | "SYSTEM_MESSAGE" => {}
            _ => {
                let status = step["status"].as_str().unwrap_or("");
                if !matches!(status, "DONE" | "ERROR") {
                    return;
                }
                let Some((id, name)) = self.pending.pop_front() else {
                    return;
                };
                let result = match step["error"].as_str() {
                    Some(error) => failure(error),
                    None if status == "ERROR" => {
                        failure("Antigravity reported that this step failed.")
                    }
                    None => {
                        Value::String(without_timestamps(step["content"].as_str().unwrap_or("")))
                    }
                };
                self.reported = name == "send_message" && self.pending.is_empty();
                out.push(tool_result_patch_with_id(&name, Some(&result), Some(&id)));
            }
        }
    }
}

/// A failed tool result, the shape every adapter settles a row as failed with.
fn failure(message: &str) -> Value {
    json!({ "isError": true, "content": message })
}

/// Tool output opens with agy's own `Created At:` / `Completed At:` lines, which say nothing the
/// row's timing doesn't.
fn without_timestamps(text: &str) -> String {
    let mut rest = text;
    while rest.starts_with("Created At:") || rest.starts_with("Completed At:") {
        rest = rest.split_once('\n').map_or("", |(_, tail)| tail);
    }
    rest.to_string()
}

/// A transcript's tool-call arguments are each JSON-encoded (`"\"ls -la\""`); decoded here so the
/// row shows the values themselves.
fn decoded_args(args: &Value) -> Value {
    match args {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| {
                    let value = value
                        .as_str()
                        .and_then(|text| serde_json::from_str::<Value>(text).ok())
                        .unwrap_or_else(|| value.clone());
                    (key.clone(), value)
                })
                .collect::<Map<_, _>>(),
        ),
        other => other.clone(),
    }
}

#[cfg(test)]
#[path = "agy_subagents_tests.rs"]
mod tests;
