//! Which chats may change which shared folders: "Allow changes", kept here rather than in a window.
//! An answer is only written after the person says yes in a native dialog
//! (`agents_allow_folder_changes`), and every command asks again, so turning it off takes effect on
//! the next command and a compromised page can't give itself write access.
use std::collections::BTreeSet;

use rusqlite::{params, Connection, OptionalExtension};

/// `profile_state` refuses `grant:` scopes, so a window can't write this.
const SCOPE: &str = "grant:agent-folder-changes";
/// A new chat's choice, before the chat has an id.
pub const DRAFT_KEY: &str = "draft";
/// A scheduled workflow's choice, which each of its runs takes on.
pub const WORKFLOW_PREFIX: &str = "workflow:";

type Answers = BTreeSet<(String, String)>;

fn read(connection: &Connection) -> rusqlite::Result<Answers> {
    let document: Option<String> = connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope = ?1",
            [SCOPE],
            |row| row.get(0),
        )
        .optional()?;
    // A file that can't be read means no one has said yes.
    Ok(document
        .and_then(|document| serde_json::from_str(&document).ok())
        .unwrap_or_default())
}

fn write(connection: &Connection, answers: &Answers) -> rusqlite::Result<()> {
    let document = serde_json::to_string(answers)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    connection.execute(
        "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, ?2)
         ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
        params![SCOPE, document],
    )?;
    Ok(())
}

/// One change, whole: two at once mustn't lose either, least of all someone taking an answer back.
fn change(connection: &Connection, work: impl FnOnce(&mut Answers)) -> rusqlite::Result<()> {
    connection.execute_batch("BEGIN IMMEDIATE")?;
    let done = read(connection).and_then(|mut answers| {
        work(&mut answers);
        write(connection, &answers)
    });
    match done {
        Ok(()) => connection.execute_batch("COMMIT"),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

pub(in crate::agents) fn allow(
    connection: &Connection,
    key: &str,
    folder: &str,
) -> rusqlite::Result<()> {
    change(connection, |answers| {
        answers.insert((key.to_owned(), folder.to_owned()));
    })
}

/// Takes it back from a chat, for one folder or for all of them.
pub(in crate::agents) fn stop(
    connection: &Connection,
    key: &str,
    folder: Option<&str>,
) -> rusqlite::Result<()> {
    change(connection, |answers| {
        answers.retain(|(held, scope)| held != key || folder.is_some_and(|folder| folder != scope));
    })
}

/// A folder that stopped being shared loses every chat's answer.
pub(in crate::agents) fn forget_folder(
    connection: &Connection,
    folder: &str,
) -> rusqlite::Result<()> {
    change(connection, |answers| {
        answers.retain(|(_, scope)| scope != folder)
    })
}

pub(in crate::agents) fn allowed(
    connection: &Connection,
    key: &str,
    folder: &str,
) -> rusqlite::Result<bool> {
    Ok(read(connection)?.contains(&(key.to_owned(), folder.to_owned())))
}

/// A new chat takes its draft's answer, which is then spent, and a scheduled run copies its
/// workflow's. Nothing else can be passed on, so one chat's answer can't reach another chat.
pub(in crate::agents) fn adopt(
    connection: &Connection,
    from: &str,
    chat: &str,
) -> rusqlite::Result<()> {
    let from_draft = from == DRAFT_KEY;
    if !from_draft && !from.starts_with(WORKFLOW_PREFIX) {
        return Ok(());
    }
    if chat.is_empty() || chat == DRAFT_KEY || chat.starts_with(WORKFLOW_PREFIX) {
        return Ok(());
    }
    change(connection, |answers| {
        let adopted: Vec<_> = answers
            .iter()
            .filter(|(key, _)| key == from)
            .map(|(_, folder)| (chat.to_owned(), folder.clone()))
            .collect();
        if from_draft {
            answers.retain(|(key, _)| key != from);
        }
        answers.extend(adopted);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE settings_state (scope TEXT PRIMARY KEY, revision INTEGER, document TEXT)",
            )
            .unwrap();
        connection
    }

    #[test]
    fn says_no_until_the_person_says_yes_and_after_they_take_it_back() {
        let db = connection();
        assert!(!allowed(&db, "chat", "folder").unwrap());
        allow(&db, "chat", "folder").unwrap();
        assert!(allowed(&db, "chat", "folder").unwrap());
        assert!(!allowed(&db, "other-chat", "folder").unwrap());
        assert!(!allowed(&db, "chat", "other-folder").unwrap());
        stop(&db, "chat", Some("folder")).unwrap();
        assert!(!allowed(&db, "chat", "folder").unwrap());
    }

    #[test]
    fn stopping_a_chat_leaves_other_chats_alone() {
        let db = connection();
        allow(&db, "chat", "a").unwrap();
        allow(&db, "chat", "b").unwrap();
        allow(&db, "other", "a").unwrap();
        stop(&db, "chat", None).unwrap();
        assert!(!allowed(&db, "chat", "a").unwrap() && !allowed(&db, "chat", "b").unwrap());
        assert!(allowed(&db, "other", "a").unwrap());
        forget_folder(&db, "a").unwrap();
        assert!(!allowed(&db, "other", "a").unwrap());
    }

    #[test]
    fn a_draft_is_spent_and_a_workflow_is_copied() {
        let db = connection();
        allow(&db, DRAFT_KEY, "folder").unwrap();
        adopt(&db, DRAFT_KEY, "chat").unwrap();
        assert!(allowed(&db, "chat", "folder").unwrap());
        adopt(&db, DRAFT_KEY, "second-chat").unwrap();
        assert!(!allowed(&db, "second-chat", "folder").unwrap());

        allow(&db, "workflow:nightly", "folder").unwrap();
        adopt(&db, "workflow:nightly", "run-1").unwrap();
        adopt(&db, "workflow:nightly", "run-2").unwrap();
        assert!(
            allowed(&db, "run-1", "folder").unwrap() && allowed(&db, "run-2", "folder").unwrap()
        );
    }

    #[test]
    fn one_chats_answer_cant_be_passed_to_another() {
        let db = connection();
        allow(&db, "chat", "folder").unwrap();
        adopt(&db, "chat", "stolen").unwrap();
        assert!(!allowed(&db, "stolen", "folder").unwrap());
        allow(&db, DRAFT_KEY, "folder").unwrap();
        adopt(&db, DRAFT_KEY, "workflow:widen").unwrap();
        assert!(!allowed(&db, "workflow:widen", "folder").unwrap());
    }
}
