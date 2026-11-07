//! One row per tool call, in `misty.db`, so a run that restarts never repeats a write it can't account
//! for, and the next turn can check what earlier runs wrote.
use misty_agent::runtime::local_tools::LocalToolOutcome;
use serde_json::{json, Value};

use super::local_tools::READ_ONLY;
use crate::infra::store::Store;

/// A finished call matters while its run can restart, however long that takes, and for this long to the
/// turns after it.
const JOURNAL_DAYS: i64 = 7;

const MAX_RECEIPTS: usize = 12;
const MAX_RECEIPT_TEXT: usize = 3000;

fn receipt(name: String, outcome: Option<String>) -> Value {
    let outcome: Option<Value> = outcome.and_then(|text| serde_json::from_str(&text).ok());
    let Some(outcome) = outcome else {
        return json!({ "tool": name, "state": "started", "result": "" });
    };
    if let Some(code) = outcome.get("code").and_then(Value::as_str) {
        return json!({ "tool": name, "state": "failed", "result": "", "error": code });
    }
    let mut result = outcome.get("result").cloned().unwrap_or(Value::Null);
    let uncertain = result["status"] == "uncertain";
    if let Some(fields) = result.as_object_mut() {
        fields.remove("image");
    }
    let text: String = result.to_string().chars().take(MAX_RECEIPT_TEXT).collect();
    json!({ "tool": name, "state": if uncertain { "uncertain" } else { "completed" }, "result": text })
}

/// The writes these runs made, newest first. A write that began and has no outcome counts as started,
/// which tells the next turn to look before repeating it.
pub(super) fn write_receipts(store: &Store, account: &str, run_ids: &[String]) -> Vec<Value> {
    let read = || -> rusqlite::Result<Vec<Value>> {
        let connection = store.connect()?;
        let mut statement = connection.prepare(
            "SELECT name, outcome FROM agent_tool_journal WHERE run_id = ?1 AND account = ?2 ORDER BY updated_at DESC",
        )?;
        let mut rows = Vec::new();
        for run_id in run_ids {
            for row in statement.query_map([run_id, &account.to_owned()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })? {
                let (name, outcome) = row?;
                if !READ_ONLY.contains(&name.as_str()) {
                    rows.push(receipt(name, outcome));
                }
            }
        }
        rows.truncate(MAX_RECEIPTS);
        Ok(rows)
    };
    read().unwrap_or_default()
}

/// Every call a run made, oldest first, for the judge's action history (debug builds only).
#[cfg(debug_assertions)]
pub(crate) fn run_record(store: &Store, run_id: &str) -> Vec<Value> {
    let read = || -> rusqlite::Result<Vec<Value>> {
        let connection = store.connect()?;
        let mut statement = connection.prepare(
            "SELECT call_id, name, outcome FROM agent_tool_journal WHERE run_id = ?1 ORDER BY updated_at",
        )?;
        let rows = statement.query_map([run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))
        })?;
        rows.map(|row| {
            let (call, name, outcome) = row?;
            // The journal keys a call by its turn too (`journal_call_id`); the transcript doesn't.
            let call = call.split_once(':').map_or(call.as_str(), |(_, id)| id).to_owned();
            let output = outcome
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .map(|value| value.get("result").cloned().unwrap_or(value))
                .unwrap_or(Value::Null);
            Ok(json!({ "tool_call_id": call, "tool_name": name, "output": output }))
        })
        .collect()
    };
    read().unwrap_or_default()
}

/// What the journal knew about a call as it began.
#[derive(Debug, PartialEq)]
pub(super) enum Begun {
    New,
    /// It began once and nobody saw it end.
    Interrupted,
    /// It ended. The same outcome is the answer.
    Replay(LocalToolOutcome),
    /// The same id was another tool's call.
    Conflict,
    /// The journal can't be read: a read may go on, a write may not.
    Unavailable,
}

/// One row per call, in `misty.db`, so a run that restarts never repeats a write it can't account for.
pub(super) struct ToolJournal {
    store: Store,
    account: String,
    /// Runs whose requests are still saved, whose rows stay whatever their age.
    saved_runs: Vec<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

fn outcome_json(outcome: &LocalToolOutcome) -> String {
    match outcome {
        LocalToolOutcome::Result(result) => json!({ "result": result }),
        LocalToolOutcome::Rejected { code, message } => {
            json!({ "code": code, "message": message })
        }
    }
    .to_string()
}

fn outcome_of(text: &str) -> Option<LocalToolOutcome> {
    let value: Value = serde_json::from_str(text).ok()?;
    if let Some(result) = value.get("result") {
        return Some(LocalToolOutcome::Result(result.clone()));
    }
    Some(LocalToolOutcome::Rejected {
        code: value.get("code")?.as_str()?.to_owned(),
        message: value.get("message")?.as_str()?.to_owned(),
    })
}

/// Forgets rows past their time, unless their run can still resume.
fn prune(connection: &rusqlite::Connection, saved_runs: &[String]) -> rusqlite::Result<()> {
    let oldest = now_ms() - JOURNAL_DAYS * 24 * 60 * 60 * 1000;
    for table in ["agent_tool_journal", "agent_run_taint"] {
        let mut statement = connection.prepare(&format!("SELECT DISTINCT run_id FROM {table} WHERE updated_at < ?1"))?;
        let old = statement.query_map([oldest], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        for run in old.iter().filter(|run| !saved_runs.contains(run)) {
            connection.execute(&format!("DELETE FROM {table} WHERE run_id = ?1 AND updated_at < ?2"), rusqlite::params![run, oldest])?;
        }
    }
    Ok(())
}

impl ToolJournal {
    pub(super) fn new(store: Store, account: &str, saved_runs: Vec<String>) -> Self {
        Self { store, account: account.to_owned(), saved_runs }
    }

    pub(super) async fn begin(&self, run_id: &str, call_id: &str, name: &str) -> Begun {
        let store = self.store.clone();
        let saved_runs = self.saved_runs.clone();
        let account = self.account.clone();
        let (run_id, call_id, name) = (run_id.to_owned(), call_id.to_owned(), name.to_owned());
        tokio::task::spawn_blocking(move || -> rusqlite::Result<Begun> {
            let connection = store.connect()?;
            prune(&connection, &saved_runs)?;
            let found: Option<(String, Option<String>)> = connection
                .query_row(
                    "SELECT name, outcome FROM agent_tool_journal WHERE run_id = ?1 AND call_id = ?2",
                    [&run_id, &call_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map(Some)
                .or_else(|error| match error {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(other),
                })?;
            match found {
                Some((recorded, _)) if recorded != name => Ok(Begun::Conflict),
                Some((_, Some(text))) => Ok(outcome_of(&text).map_or(Begun::Interrupted, Begun::Replay)),
                Some((_, None)) => Ok(Begun::Interrupted),
                None => {
                    connection.execute(
                        "INSERT INTO agent_tool_journal (run_id, call_id, name, outcome, updated_at, account)
                         VALUES (?1, ?2, ?3, NULL, ?4, ?5)",
                        rusqlite::params![run_id, call_id, name, now_ms(), account],
                    )?;
                    Ok(Begun::New)
                }
            }
        })
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(Begun::Unavailable)
    }

    pub(super) async fn finish(&self, run_id: &str, call_id: &str, outcome: &LocalToolOutcome) {
        let store = self.store.clone();
        let (run_id, call_id, text) = (run_id.to_owned(), call_id.to_owned(), outcome_json(outcome));
        let _ = tokio::task::spawn_blocking(move || -> rusqlite::Result<()> {
            store.connect()?.execute(
                "UPDATE agent_tool_journal SET outcome = ?1, updated_at = ?2
                 WHERE run_id = ?3 AND call_id = ?4",
                rusqlite::params![text, now_ms(), run_id, call_id],
            )?;
            Ok(())
        })
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn journal() -> (tempfile::TempDir, ToolJournal) {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        (directory, ToolJournal::new(store, "a", Vec::new()))
    }

    #[tokio::test]
    async fn a_new_call_begins_and_an_unfinished_one_reads_as_interrupted() {
        let (_directory, journal) = journal();
        assert_eq!(journal.begin("r", "c", "browser.run").await, Begun::New);
        assert_eq!(
            journal.begin("r", "c", "browser.run").await,
            Begun::Interrupted
        );
        assert_eq!(journal.begin("r", "other", "browser.run").await, Begun::New);
        assert_eq!(journal.begin("other", "c", "browser.run").await, Begun::New);
    }

    #[tokio::test]
    async fn a_finished_call_replays_its_outcome_and_never_runs_again() {
        let (_directory, journal) = journal();
        journal.begin("r", "c", "browser.run").await;
        let done = LocalToolOutcome::Result(json!({ "ok": true }));
        journal.finish("r", "c", &done).await;
        assert_eq!(
            journal.begin("r", "c", "browser.run").await,
            Begun::Replay(done)
        );
        journal.begin("r", "d", "browser.run").await;
        let refused = LocalToolOutcome::Rejected {
            code: "site_blocked".into(),
            message: "No.".into(),
        };
        journal.finish("r", "d", &refused).await;
        assert_eq!(
            journal.begin("r", "d", "browser.run").await,
            Begun::Replay(refused)
        );
    }

    #[tokio::test]
    async fn receipts_keep_writes_and_say_how_each_ended() {
        let (_directory, journal) = journal();
        journal.begin("r", "a", "note.update").await;
        journal.finish("r", "a", &LocalToolOutcome::Result(json!({ "ok": true, "image": "x" }))).await;
        journal.begin("r", "b", "note.read").await;
        journal.finish("r", "b", &LocalToolOutcome::Result(json!({ "text": "y" }))).await;
        journal.begin("r", "c", "message.send").await;
        let rows = write_receipts(&journal.store, "a", &["r".to_owned()]);
        assert!(write_receipts(&journal.store, "someone-else", &["r".to_owned()]).is_empty());
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row["tool"] == "message.send" && row["state"] == "started"));
        let done = rows.iter().find(|row| row["tool"] == "note.update").unwrap();
        assert_eq!(done["state"], "completed");
        assert!(!done["result"].as_str().unwrap().contains("image"));
    }

    #[tokio::test]
    async fn an_id_used_for_another_tool_is_never_replayed() {
        let (_directory, journal) = journal();
        journal.begin("r", "c", "browser.navigate").await;
        journal.finish("r", "c", &LocalToolOutcome::Result(json!({ "ok": true }))).await;
        assert_eq!(journal.begin("r", "c", "message.send").await, Begun::Conflict);
    }

    #[tokio::test]
    async fn a_journal_that_cant_be_read_says_so() {
        let directory = tempfile::tempdir().unwrap();
        // A folder where the database should be.
        let store = Store::at(directory.path().to_path_buf());
        let journal = ToolJournal::new(store, "a", Vec::new());
        assert_eq!(journal.begin("r", "c", "message.send").await, Begun::Unavailable);
    }

    #[tokio::test]
    async fn old_rows_stay_while_their_run_can_resume() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let journal = ToolJournal::new(store.clone(), "a", vec!["kept".to_owned()]);
        let old = now_ms() - (JOURNAL_DAYS + 1) * 24 * 60 * 60 * 1000;
        for run in ["kept", "gone"] {
            store
                .connect()
                .unwrap()
                .execute(
                    "INSERT INTO agent_tool_journal (run_id, call_id, name, outcome, updated_at, account) VALUES (?1, 'c', 'message.send', NULL, ?2, 'a')",
                    rusqlite::params![run, old],
                )
                .unwrap();
        }
        journal.begin("new", "c", "note.read").await;
        assert_eq!(journal.begin("kept", "c", "message.send").await, Begun::Interrupted);
        assert_eq!(journal.begin("gone", "c", "message.send").await, Begun::New);
    }
}
