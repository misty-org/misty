use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use crate::engines::{tool_call_message_with_id, tool_result_patch_with_id, EngineEvent};

const POLL: Duration = Duration::from_millis(400);
const QUIET_WORKING: Duration = Duration::from_secs(90);
const QUIET_REPORTED: Duration = Duration::from_secs(5);

pub(crate) struct Subagents {
    brain: PathBuf,
    folder: PathBuf,
    seen: HashSet<String>,
    rows: VecDeque<String>,
    spawns: HashMap<i64, String>,
    logs: Vec<ChildLog>,
    polled: Option<Instant>,
}

struct ChildLog {
    row: String,
    conversation: String,
    path: PathBuf,
    offset: u64,
    pending: VecDeque<(String, String)>,
    reported: bool,
}

impl Subagents {
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

    pub(crate) fn update(&mut self, params: &Value) -> Option<Value> {
        let update = &params["update"];
        if update["sessionUpdate"] != "tool_call" || update["name"] != "invoke_subagent" {
            return None;
        }
        let id = update["toolCallId"].as_str().filter(|id| !id.is_empty())?;
        if !self.rows.iter().any(|row| row == id) && !self.spawns.values().any(|row| row == id) {
            self.rows.push_back(id.to_string());
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

    pub(crate) fn started_any(&self) -> bool {
        !self.rows.is_empty() || !self.logs.is_empty()
    }

    pub(crate) fn quiet_after(&self) -> Duration {
        if self.rows.is_empty() && self.logs.iter().all(|log| log.reported) {
            QUIET_REPORTED
        } else {
            QUIET_WORKING
        }
    }

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

#[allow(
    clippy::disallowed_methods,
    reason = "reads agy's own subagent records in place, under its home, which ANTIGRAVITY_HOME may move outside the engine folders the gate grants"
)]
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
    #[allow(
        clippy::disallowed_types,
        reason = "tails agy's own subagent transcript in place, under its home, which ANTIGRAVITY_HOME may move outside the engine folders the gate grants"
    )]
    fn read(&mut self, out: &mut Vec<EngineEvent>) {
        use std::io::{Read, Seek, SeekFrom};
        let Ok(mut file) = std::fs::File::open(&self.path) else {
            return;
        };
        let length = file.metadata().map(|m| m.len()).unwrap_or(0);
        if length < self.offset {
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

fn failure(message: &str) -> Value {
    json!({ "isError": true, "content": message })
}

fn without_timestamps(text: &str) -> String {
    let mut rest = text;
    while rest.starts_with("Created At:") || rest.starts_with("Completed At:") {
        rest = rest.split_once('\n').map_or("", |(_, tail)| tail);
    }
    rest.to_string()
}

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
