//! What a running app may call. A session starts when the page opens an app: the app's manifest is read
//! here, and the permissions the Space's mod approved must be among the ones it asked for. Every SDK call
//! the page relays is then checked against the session, so a page that is wrong about what an app may do
//! still can't give it more than its manifest named.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, MutexGuard};

use super::manifest::{AppManifest, Permission};

/// What a method or topic needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Need {
    /// Open to every app.
    Nothing,
    Permission(Permission),
    /// A name this host doesn't know, refused rather than allowed.
    Unknown,
}

pub fn required(kind: Kind, name: &str) -> Need {
    use Permission::*;
    let needed = match (kind, name) {
        (_, "hello") => None,
        (Kind::Call, "route.navigate") => None,
        (Kind::Subscribe, "theme" | "route") => None,
        (Kind::Call, "members.list" | "members.mentionables") => Some(Members),
        (Kind::Subscribe, "members.presence") => Some(Members),
        (Kind::Call, "chat.post" | "chat.open" | "chat.notify") => Some(ChatPost),
        (Kind::Call, name) if name.starts_with("files.") => Some(Files),
        (Kind::Subscribe, "files.watch") => Some(Files),
        (Kind::Call, "room.update" | "room.awareness") => Some(Rooms),
        (Kind::Subscribe, "room") => Some(Rooms),
        (Kind::Call, "calls.join" | "calls.leave" | "calls.mute") => Some(Calls),
        (Kind::Subscribe, "calls.channels" | "calls.current") => Some(Calls),
        _ => return Need::Unknown,
    };
    needed.map_or(Need::Nothing, Need::Permission)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Call,
    Subscribe,
}

struct Session {
    app_id: String,
    space_id: String,
    /// The webview the session belongs to, so another window can't use it.
    webview: String,
    allowed: HashSet<Permission>,
    /// The app's manifest names a paid host it may reach.
    paid: bool,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Session>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn sessions() -> MutexGuard<'static, HashMap<String, Session>> {
    SESSIONS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Starts a session. `approved` is what the mod approved; it may not exceed what the manifest asks.
pub fn open(
    manifest: &AppManifest,
    space_id: &str,
    webview: &str,
    approved: &[Permission],
) -> Result<String, String> {
    if space_id.is_empty() || space_id.len() > 200 {
        return Err("That isn't a Space.".into());
    }
    let asked: HashSet<Permission> = manifest.permissions.iter().copied().collect();
    if approved.iter().any(|permission| !asked.contains(permission)) {
        return Err("A mod approved more than the app asks for.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    sessions().insert(
        id.clone(),
        Session {
            app_id: manifest.id.clone(),
            space_id: space_id.to_owned(),
            webview: webview.to_owned(),
            allowed: approved.iter().copied().collect(),
            paid: manifest.network.iter().any(|host| host.paid),
        },
    );
    Ok(id)
}

/// Checks one call or subscription. The error is the reason, in words fit for the app's `permission_denied`.
pub fn check(session: &str, webview: &str, kind: Kind, name: &str) -> Result<(), String> {
    let sessions = sessions();
    let session = sessions
        .get(session)
        .filter(|session| session.webview == webview)
        .ok_or_else(|| "This app isn't running.".to_owned())?;
    match required(kind, name) {
        Need::Nothing => Ok(()),
        Need::Permission(permission) if session.allowed.contains(&permission) => Ok(()),
        Need::Permission(_) => Err(format!("{} wasn't approved for {name}.", session.app_id)),
        Need::Unknown => Err(format!("{name} isn't something apps can do."))
    }
}

/// The app and Space a session belongs to, for the host to scope its work.
pub fn identity(session: &str, webview: &str) -> Option<(String, String)> {
    sessions()
        .get(session)
        .filter(|session| session.webview == webview)
        .map(|session| (session.app_id.clone(), session.space_id.clone()))
}

/// Whether the session's app may reach a host its manifest marks as paid.
pub fn reaches_paid_host(session: &str, webview: &str) -> bool {
    sessions().get(session).is_some_and(|found| found.webview == webview && found.paid)
}

pub fn close(session: &str, webview: &str) {
    let mut sessions = sessions();
    if sessions.get(session).is_some_and(|found| found.webview == webview) {
        sessions.remove(session);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(permissions: &str) -> AppManifest {
        AppManifest::parse(
            format!(
                r#"{{"id":"sketch","name":"Sketch","version":"1.0.0","logo":"l.svg","entry":"i.html","permissions":{permissions}}}"#
            )
            .as_bytes(),
        )
        .unwrap()
    }

    #[test]
    fn a_call_needs_the_permission_its_area_names() {
        let session = open(&manifest(r#"["files","members"]"#), "space-1", "window-a", &[Permission::Files]).unwrap();
        assert!(check(&session, "window-a", Kind::Call, "files.save").is_ok());
        assert!(check(&session, "window-a", Kind::Subscribe, "files.watch").is_ok());
        // Asked for in the manifest, but the mod didn't approve it.
        assert!(check(&session, "window-a", Kind::Call, "members.list").is_err());
        assert!(check(&session, "window-a", Kind::Call, "chat.post").is_err());
        // Open to every app.
        assert!(check(&session, "window-a", Kind::Call, "route.navigate").is_ok());
        assert!(check(&session, "window-a", Kind::Subscribe, "theme").is_ok());
        // Unknown names (the old records and store calls among them), and a call used as a subscription, fail closed.
        assert!(check(&session, "window-a", Kind::Call, "shell.run").is_err());
        assert!(check(&session, "window-a", Kind::Call, "tasks.create").is_err());
        assert!(check(&session, "window-a", Kind::Call, "store.set").is_err());
        assert!(check(&session, "window-a", Kind::Subscribe, "files.save").is_err());
        assert!(check(&session, "window-a", Kind::Call, "theme").is_err());
        close(&session, "window-a");
        assert!(check(&session, "window-a", Kind::Call, "files.list").is_err());
    }

    #[test]
    fn a_session_cannot_exceed_its_manifest_or_be_used_by_another_window() {
        assert!(open(&manifest(r#"["members"]"#), "s", "window-a", &[Permission::Files]).is_err());
        let session = open(&manifest(r#"["files"]"#), "s", "window-a", &[Permission::Files]).unwrap();
        assert!(check(&session, "other", Kind::Call, "files.list").is_err());
        assert_eq!(identity(&session, "window-a"), Some(("sketch".into(), "s".into())));
        assert_eq!(identity(&session, "other"), None);
        close(&session, "other");
        assert!(check(&session, "window-a", Kind::Call, "files.list").is_ok());
        close(&session, "window-a");
    }

    #[test]
    fn every_call_and_topic_the_sdk_has_is_known() {
        // Mirrors `Methods` and `Topics` in misty-sdk's protocol.ts; add to both together.
        let calls = [
            "hello", "members.list", "members.mentionables", "chat.post", "chat.open", "chat.notify",
            "files.pick", "files.open", "files.save", "files.list", "files.upload", "files.download",
            "route.navigate", "room.update", "room.awareness", "calls.join", "calls.leave", "calls.mute",
        ];
        for call in calls {
            assert_ne!(required(Kind::Call, call), Need::Unknown, "{call}");
        }
        for topic in ["theme", "route", "members.presence", "files.watch", "room", "calls.channels", "calls.current"] {
            assert_ne!(required(Kind::Subscribe, topic), Need::Unknown, "{topic}");
        }
    }
}
