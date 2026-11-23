// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/codex_usage.rs.
//! Live token usage for `codex exec` runs.
//!
//! The exec JSON stream (thread.started / turn.* / item.*) carries no usage
//! while a turn runs: the only usage in it arrives with `turn.completed`, so
//! a codex turn that chats for an hour used to show up only once it ended.
//! The CLI does report usage as it goes — into its own session log under
//! `$CODEX_HOME/sessions/<y>/<m>/<d>/rollout-<ts>-<thread_id>.jsonl` — so the
//! stdout reader tails that file and injects `usage` events into the run.
//!
//! The log also carries `token_count` snapshots, which repeat the same
//! numbers until the next response and therefore only feed the context
//! window; `token_usage_record` is the once-per-response report this tail
//! emits, so a turn's usage is the sum of its records.
//!
//! The tail starts at the file's end: `codex exec resume` appends to the
//! rollout the thread wrote the first time, so byte 0 is the thread's whole
//! history — reading from there ledgers every past response again on every
//! launch.

use serde_json::Value;
#[allow(
    clippy::disallowed_types,
    reason = "tails Codex's own session log in place, wherever its home keeps it"
)]
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[allow(
    clippy::disallowed_types,
    reason = "tails Codex's own session log in place, wherever its home keeps it"
)]
#[derive(Debug)]
pub struct UsageTail {
    file: File,
    offset: u64,
    context_window: Option<i64>,
}

impl UsageTail {
    pub fn open(thread_id: &str) -> Option<Self> {
        let home = crate::engines::codex_home();
        Self::open_in(&home, thread_id)
    }

    #[allow(
        clippy::disallowed_types,
        reason = "tails Codex's own session log in place, wherever its home keeps it"
    )]
    fn open_in(home: &Path, thread_id: &str) -> Option<Self> {
        let mut file = File::open(rollout_path(home, thread_id)?).ok()?;
        let offset = file.seek(SeekFrom::End(0)).ok()?;
        Some(Self {
            file,
            offset,
            context_window: None,
        })
    }

    pub fn poll(&mut self) -> Vec<Value> {
        let mut out = Vec::new();
        if self.file.seek(SeekFrom::Start(self.offset)).is_err() {
            return out;
        }
        let mut text = String::new();
        if self.file.read_to_string(&mut text).is_err() {
            return out;
        }
        let Some(last_newline) = text.rfind('\n') else {
            return out;
        };
        self.offset += last_newline as u64 + 1;
        for line in text[..last_newline].lines() {
            let previous_window = self.context_window;
            if let Some(usage) = self.line_usage(line) {
                out.push(usage);
            } else if self.context_window != previous_window {
                if let (Some(window), Some(last)) = (self.context_window, out.last_mut()) {
                    if let Some(object) = last.as_object_mut() {
                        object.insert("model_context_window".into(), Value::from(window));
                    }
                }
            }
        }
        out
    }

    fn line_usage(&mut self, line: &str) -> Option<Value> {
        let value: Value = serde_json::from_str(line).ok()?;
        match value.get("type").and_then(Value::as_str)? {
            "token_usage_record" => {
                let usage = value.get("payload")?.get("usage")?;
                Some(self.with_window(usage))
            }
            "event_msg" => {
                let payload = value.get("payload")?;
                if payload.get("type").and_then(Value::as_str) != Some("token_count") {
                    return None;
                }
                self.context_window = payload
                    .get("info")
                    .and_then(|info| info.get("model_context_window"))
                    .and_then(Value::as_i64)
                    .or(self.context_window);
                None
            }
            _ => None,
        }
    }

    pub(super) fn with_window(&self, usage: &Value) -> Value {
        let mut usage = usage.clone();
        if let (Some(window), Some(object)) = (self.context_window, usage.as_object_mut()) {
            object
                .entry("model_context_window")
                .or_insert(Value::from(window));
        }
        usage
    }
}

#[allow(
    clippy::disallowed_methods,
    reason = "finds Codex's own session log in place, wherever its home keeps it"
)]
fn rollout_path(home: &Path, thread_id: &str) -> Option<PathBuf> {
    let suffix = format!("{thread_id}.jsonl");
    for root in [home.join("sessions"), home.join("archived_sessions")] {
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    stack.push(path);
                } else if path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(&suffix))
                {
                    return Some(path);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn scratch(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ccgui-codex-usage-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn record_line(input: i64, output: i64, total: i64) -> String {
        format!(
            "{}\n",
            serde_json::json!({
                "timestamp": "2026-09-11T01:00:00Z",
                "type": "token_usage_record",
                "payload": {
                    "thread_id": "t-1",
                    "usage": {
                        "input_tokens": input,
                        "cached_input_tokens": 400,
                        "cache_write_input_tokens": 500,
                        "output_tokens": output,
                        "total_tokens": total,
                    },
                    "turn_token_usage": { "input_tokens": input, "output_tokens": output },
                },
            })
        )
    }

    fn token_count_line(input: i64, output: i64, total: i64, window: i64) -> String {
        format!(
            "{}\n",
            serde_json::json!({
                "timestamp": "2026-09-11T01:00:00Z",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": { "input_tokens": 900, "output_tokens": 900 },
                        "last_token_usage": {
                            "input_tokens": input,
                            "output_tokens": output,
                            "total_tokens": total,
                        },
                        "model_context_window": window,
                    },
                },
            })
        )
    }

    fn tail_over(dir: &Path, thread_id: &str) -> (UsageTail, PathBuf) {
        let day = dir.join("sessions").join("2026").join("09").join("11");
        std::fs::create_dir_all(&day).unwrap();
        let path = day.join(format!("rollout-2026-09-11T01-00-00-{thread_id}.jsonl"));
        std::fs::File::create(&path).unwrap();
        let tail = UsageTail::open_in(dir, thread_id).expect("tail opens");
        (tail, path)
    }

    fn append(path: &Path, text: &str) {
        let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        file.write_all(text.as_bytes()).unwrap();
        file.flush().unwrap();
    }

    #[test]
    fn each_response_record_is_reported_once() {
        let dir = scratch("records");
        let (mut tail, path) = tail_over(&dir, "t-1");
        assert!(tail.poll().is_empty(), "nothing yet");

        append(&path, &record_line(1000, 40, 1040));
        append(&path, &record_line(2000, 60, 2060));
        let polled = tail.poll();
        assert_eq!(polled.len(), 2, "one report per response");
        assert_eq!(polled[0]["input_tokens"], 1000);
        assert_eq!(polled[0]["cached_input_tokens"], 400);
        assert_eq!(polled[0]["cache_write_input_tokens"], 500);
        assert_eq!(polled[1]["output_tokens"], 60);
        assert!(tail.poll().is_empty(), "already read");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn history_already_in_the_rollout_is_not_reported() {
        let dir = scratch("resume");
        let day = dir.join("sessions").join("2026").join("09").join("11");
        std::fs::create_dir_all(&day).unwrap();
        let path = day.join("rollout-2026-09-11T01-00-00-t-4.jsonl");
        std::fs::write(
            &path,
            format!(
                "{}{}",
                record_line(9_000, 500, 9_500),
                record_line(8_000, 400, 8_400)
            ),
        )
        .unwrap();

        let mut tail = UsageTail::open_in(&dir, "t-4").expect("tail opens");
        assert!(
            tail.poll().is_empty(),
            "earlier turns are not this run's usage"
        );

        append(&path, &record_line(1_000, 40, 1_040));
        let polled = tail.poll();
        assert_eq!(polled.len(), 1, "only what was appended after open");
        assert_eq!(polled[0]["input_tokens"], 1_000);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn repeated_token_counts_do_not_become_reports() {
        let dir = scratch("counts");
        let (mut tail, path) = tail_over(&dir, "t-2");
        append(&path, &token_count_line(500, 10, 510, 258_400));
        append(&path, &token_count_line(500, 10, 510, 258_400));
        assert!(
            tail.poll().is_empty(),
            "token_count is a window update, not a report"
        );
        assert_eq!(tail.context_window, Some(258_400));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_record_carries_the_window_and_a_half_written_line_waits() {
        let dir = scratch("window");
        let (mut tail, path) = tail_over(&dir, "t-3");
        append(&path, &token_count_line(1, 1, 2, 258_400));
        let line = record_line(700, 30, 730);
        append(&path, &line[..line.len() - 6]);
        assert!(tail.poll().is_empty(), "partial line is not a report");

        append(&path, &line[line.len() - 6..]);
        let polled = tail.poll();
        assert_eq!(polled.len(), 1);
        assert_eq!(polled[0]["total_tokens"], 730);
        assert_eq!(polled[0]["model_context_window"], 258_400);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn following_token_count_attaches_one_million_window_without_double_billing() {
        let dir = scratch("million");
        let (mut tail, path) = tail_over(&dir, "t-million");
        append(&path, &record_line(89_000, 1_000, 90_000));
        append(&path, &token_count_line(89_000, 1_000, 90_000, 1_000_000));
        let reports = tail.poll();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0]["model_context_window"], 1_000_000);
        assert!(tail.poll().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_rollout_is_found_by_thread_id_in_any_day() {
        let dir = scratch("lookup");
        let day = dir.join("sessions").join("2026").join("01").join("02");
        std::fs::create_dir_all(&day).unwrap();
        let wanted = day.join("rollout-2026-01-02T03-04-05-thread-abc.jsonl");
        std::fs::write(&wanted, "").unwrap();
        std::fs::write(day.join("rollout-2026-01-02T03-04-05-other.jsonl"), "").unwrap();
        assert_eq!(rollout_path(&dir, "thread-abc"), Some(wanted));
        assert_eq!(rollout_path(&dir, "missing"), None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
