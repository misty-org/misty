// SPDX-License-Identifier: MIT
//! What the person approved for each extension on this computer.
//!
//! An extension's install list can change without the person: the profile's `extensions`
//! collection follows other computers, and anything that can write to the vault can write to it.
//! So what an extension may do is recorded here, in `misty.db`, only when the person answers
//! Misty's own review or an extension's permission request. It never syncs. Nothing runs without
//! a record, and nothing runs wider than it.
use super::{package::Review, Installation};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Mutex, OnceLock},
};

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Approval {
    pub(super) permissions: BTreeSet<String>,
    pub(super) hosts: BTreeSet<String>,
}

impl Approval {
    /// Whether the person has already approved everything this package asks for at install.
    /// Optional access isn't counted: the extension has to ask for that while running.
    pub(super) fn covers(&self, review: &Review) -> bool {
        let (permissions, hosts) = self.added(review);
        permissions.is_empty() && hosts.is_empty()
    }

    /// What this package asks for that the person hasn't approved.
    pub(super) fn added(&self, review: &Review) -> (Vec<String>, Vec<String>) {
        let new = |asked: &[String], approved: &BTreeSet<String>| {
            asked
                .iter()
                .filter(|value| !approved.contains(*value))
                .cloned()
                .collect()
        };
        (
            new(&review.permissions, &self.permissions),
            new(&review.hosts, &self.hosts),
        )
    }
}

/// Whether a package has to wait for the person. No record at all means it does.
pub(super) fn needs_review(approval: Option<&Approval>, review: &Review) -> bool {
    review.blocked || !approval.is_some_and(|approval| approval.covers(review))
}

/// The installation as the runtime gets it. The list it starts from says what the person left
/// switched on; this caps it to what they approved and to what this version declares, so a
/// list edited by anything else can't widen an extension. Private tabs also need the manifest
/// to allow them, as WebView2 has no check of its own.
pub(super) fn effective(
    installation: &Installation,
    approval: &Approval,
    review: &Review,
) -> Installation {
    let keep = |listed: &[String], approved: &BTreeSet<String>, declared: [&[String]; 2]| {
        listed
            .iter()
            .filter(|value| approved.contains(*value))
            .filter(|value| declared.iter().any(|list| list.contains(value)))
            .cloned()
            .collect()
    };
    Installation {
        permissions: keep(
            &installation.permissions,
            &approval.permissions,
            [&review.permissions, &review.optional_permissions],
        ),
        hosts: keep(
            &installation.hosts,
            &approval.hosts,
            [&review.hosts, &review.optional_hosts],
        ),
        private_access: installation.private_access && review.private_allowed,
        ..installation.clone()
    }
}

fn db() -> Result<Connection, String> {
    let home =
        crate::infra::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
    crate::infra::store::Store::at(home.join(".local").join("data").join("misty.db"))
        .connect()
        .map_err(|e| e.to_string())
}

fn read_from(connection: &Connection, scope: &str, id: &str) -> Result<Option<Approval>, String> {
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT permissions, hosts FROM extension_approvals WHERE scope = ?1 AND extension = ?2",
            [scope, id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    row.map(|(permissions, hosts)| {
        Ok(Approval {
            permissions: serde_json::from_str(&permissions).map_err(|e| e.to_string())?,
            hosts: serde_json::from_str(&hosts).map_err(|e| e.to_string())?,
        })
    })
    .transpose()
}

fn add_to(
    connection: &Connection,
    scope: &str,
    id: &str,
    permissions: &[String],
    hosts: &[String],
) -> Result<(), String> {
    let mut approval = read_from(connection, scope, id)?.unwrap_or_default();
    approval.permissions.extend(permissions.iter().cloned());
    approval.hosts.extend(hosts.iter().cloned());
    connection
        .execute(
            "INSERT OR REPLACE INTO extension_approvals (scope, extension, permissions, hosts)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                scope,
                id,
                serde_json::to_string(&approval.permissions).map_err(|e| e.to_string())?,
                serde_json::to_string(&approval.hosts).map_err(|e| e.to_string())?,
            ],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub(super) fn read(scope: &str, id: &str) -> Result<Option<Approval>, String> {
    read_from(&db()?, scope, id)
}

/// Adds to what the person approved. Call this only with the answer to Misty's own question.
pub(super) fn approve(
    scope: &str,
    id: &str,
    permissions: &[String],
    hosts: &[String],
) -> Result<(), String> {
    add_to(&db()?, scope, id, permissions, hosts)
}

/// The extension was removed, so adding it again starts over.
pub(super) fn forget(scope: &str, id: &str) -> Result<(), String> {
    db()?
        .execute(
            "DELETE FROM extension_approvals WHERE scope = ?1 AND extension = ?2",
            [scope, id],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The profile is gone from this computer.
pub(super) fn forget_scope(scope: &str) -> Result<(), String> {
    db()?
        .execute("DELETE FROM extension_approvals WHERE scope = ?1", [scope])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// What an extension's running permission request asked for, held until the person answers.
/// WebKit raised the event, so the renderer's answer can only say yes or no to these.
struct Asked {
    guid: String,
    permissions: Vec<String>,
    hosts: Vec<String>,
}

fn asked() -> &'static Mutex<BTreeMap<String, Asked>> {
    static ASKED: OnceLock<Mutex<BTreeMap<String, Asked>>> = OnceLock::new();
    ASKED.get_or_init(Default::default)
}

const MAX_ASKED: usize = 64;

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

/// Follows the requests the native host raises. Only macOS raises them.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn observe_request(event: &Value) {
    let Some(request) = event["requestId"].as_str() else {
        return;
    };
    let Ok(mut pending) = asked().lock() else {
        return;
    };
    if event["kind"] == "permission-expired" {
        pending.remove(request);
    } else if event["kind"] == "permission-request" {
        if let Some(guid) = event["guid"].as_str() {
            while pending.len() >= MAX_ASKED {
                pending.pop_first();
            }
            pending.insert(
                request.to_owned(),
                Asked {
                    guid: guid.to_owned(),
                    permissions: strings(&event["permissions"]),
                    hosts: strings(&event["hosts"]),
                },
            );
        }
    }
}

/// The request the person just answered: its extension's identity and what it asked for.
pub(super) fn take_request(request: &str) -> Option<(String, Vec<String>, Vec<String>)> {
    let asked = asked().lock().ok()?.remove(request)?;
    Some((asked.guid, asked.permissions, asked.hosts))
}

#[cfg(test)]
mod tests;
