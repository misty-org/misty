use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, MutexGuard};

use super::manifest::{AppManifest, Permission};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Need {
    Nothing,
    Permission(Permission),
    Unknown,
}

pub fn required(kind: Kind, name: &str) -> Need {
    use Permission::*;
    let needed = match (kind, name) {
        (_, "hello") => None,
        (Kind::Call, "route.navigate") => None,
        (Kind::Subscribe, "theme" | "route" | "agents.control") => None,
        (Kind::Call, "members.list" | "members.mentionables") => Some(Members),
        (Kind::Subscribe, "members.presence") => Some(Members),
        (Kind::Call, "chat.post" | "chat.open" | "chat.notify") => Some(ChatPost),
        (Kind::Call, name) if name.starts_with("files.") => Some(Files),
        (Kind::Subscribe, "files.watch") => Some(Files),
        (
            Kind::Call,
            "room.update" | "room.awareness" | "room.sync" | "room.serialized" | "room.option"
            | "room.frame" | "room.read" | "room.change",
        ) => Some(Rooms),
        (Kind::Subscribe, "room" | "room.frames") => Some(Rooms),
        (Kind::Subscribe, FILE_ROOM) => Some(Files),
        (Kind::Call, "calls.join" | "calls.leave" | "calls.mute") => Some(Calls),
        (Kind::Subscribe, "calls.channels" | "calls.current") => Some(Calls),
        _ => return Need::Unknown,
    };
    needed.map_or(Need::Nothing, Need::Permission)
}

pub const FILE_ROOM: &str = "room.file";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Call,
    Subscribe,
}

struct Session {
    app_id: String,
    space_id: String,
    webview: String,
    allowed: HashSet<Permission>,
    paid: bool,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Session>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn sessions() -> MutexGuard<'static, HashMap<String, Session>> {
    SESSIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

static CLOSINGS: LazyLock<Mutex<HashMap<String, u64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn closings() -> MutexGuard<'static, HashMap<String, u64>> {
    CLOSINGS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn window_generation(webview: &str) -> u64 {
    closings().get(webview).copied().unwrap_or(0)
}

pub fn open(
    manifest: &AppManifest,
    space_id: &str,
    webview: &str,
    approved: &[Permission],
) -> Result<String, String> {
    open_since(
        manifest,
        space_id,
        webview,
        approved,
        window_generation(webview),
    )
}

pub fn open_since(
    manifest: &AppManifest,
    space_id: &str,
    webview: &str,
    approved: &[Permission],
    generation: u64,
) -> Result<String, String> {
    if space_id.is_empty() || space_id.len() > 200 {
        return Err("That isn't a Space.".into());
    }
    let asked: HashSet<Permission> = manifest.permissions.iter().copied().collect();
    if approved
        .iter()
        .any(|permission| !asked.contains(permission))
    {
        return Err("A mod approved more than the app asks for.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut sessions = sessions();
    if window_generation(webview) != generation {
        return Err("The window reloaded while the app was opening. Open it again.".into());
    }
    sessions.insert(
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

pub fn check(session: &str, webview: &str, kind: Kind, name: &str) -> Result<(), String> {
    let sessions = sessions();
    let session = sessions
        .get(session)
        .filter(|session| session.webview == webview)
        .ok_or_else(|| "This app isn't running.".to_owned())?;
    if kind == Kind::Subscribe && name == FILE_ROOM && !session.allowed.contains(&Permission::Rooms)
    {
        return Err(format!(
            "{} wasn't approved for live documents.",
            session.app_id
        ));
    }
    match required(kind, name) {
        Need::Nothing => Ok(()),
        Need::Permission(permission) if session.allowed.contains(&permission) => Ok(()),
        Need::Permission(_) => Err(format!("{} wasn't approved for {name}.", session.app_id)),
        Need::Unknown => Err(format!("{name} isn't something apps can do.")),
    }
}

pub fn identity(session: &str, webview: &str) -> Option<(String, String)> {
    sessions()
        .get(session)
        .filter(|session| session.webview == webview)
        .map(|session| (session.app_id.clone(), session.space_id.clone()))
}

pub fn reaches_paid_host(session: &str, webview: &str) -> bool {
    sessions()
        .get(session)
        .is_some_and(|found| found.webview == webview && found.paid)
}

pub fn close_window(webview: &str) {
    let mut sessions = sessions();
    *closings().entry(webview.to_owned()).or_insert(0) += 1;
    sessions.retain(|_, session| session.webview != webview);
}

pub fn close(session: &str, webview: &str) {
    let mut sessions = sessions();
    if sessions
        .get(session)
        .is_some_and(|found| found.webview == webview)
    {
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
        let session = open(
            &manifest(r#"["files","members"]"#),
            "space-1",
            "window-a",
            &[Permission::Files],
        )
        .unwrap();
        assert!(check(&session, "window-a", Kind::Call, "files.save").is_ok());
        assert!(check(&session, "window-a", Kind::Subscribe, "files.watch").is_ok());
        assert!(check(&session, "window-a", Kind::Call, "members.list").is_err());
        assert!(check(&session, "window-a", Kind::Call, "chat.post").is_err());
        assert!(check(&session, "window-a", Kind::Call, "route.navigate").is_ok());
        assert!(check(&session, "window-a", Kind::Subscribe, "theme").is_ok());
        assert!(check(&session, "window-a", Kind::Call, "shell.run").is_err());
        assert!(check(&session, "window-a", Kind::Call, "tasks.create").is_err());
        assert!(check(&session, "window-a", Kind::Call, "store.set").is_err());
        assert!(check(&session, "window-a", Kind::Subscribe, "files.save").is_err());
        assert!(check(&session, "window-a", Kind::Call, "theme").is_err());
        close(&session, "window-a");
        assert!(check(&session, "window-a", Kind::Call, "files.list").is_err());
    }

    #[test]
    fn a_file_room_needs_files_as_well_as_rooms() {
        let both = open(
            &manifest(r#"["files","rooms"]"#),
            "space-1",
            "window-a",
            &[Permission::Rooms],
        )
        .unwrap();
        assert!(check(&both, "window-a", Kind::Subscribe, "room").is_ok());
        assert!(check(&both, "window-a", Kind::Subscribe, FILE_ROOM).is_err());
        close(&both, "window-a");
        let files_only = open(
            &manifest(r#"["files","rooms"]"#),
            "space-1",
            "window-a",
            &[Permission::Files],
        )
        .unwrap();
        assert!(check(&files_only, "window-a", Kind::Subscribe, FILE_ROOM).is_err());
        close(&files_only, "window-a");
        let approved = open(
            &manifest(r#"["files","rooms"]"#),
            "space-1",
            "window-a",
            &[Permission::Files, Permission::Rooms],
        )
        .unwrap();
        assert!(check(&approved, "window-a", Kind::Subscribe, FILE_ROOM).is_ok());
        close(&approved, "window-a");
    }

    #[test]
    fn a_session_cannot_exceed_its_manifest_or_be_used_by_another_window() {
        assert!(open(
            &manifest(r#"["members"]"#),
            "s",
            "window-a",
            &[Permission::Files]
        )
        .is_err());
        let session = open(
            &manifest(r#"["files"]"#),
            "s",
            "window-a",
            &[Permission::Files],
        )
        .unwrap();
        assert!(check(&session, "other", Kind::Call, "files.list").is_err());
        assert_eq!(
            identity(&session, "window-a"),
            Some(("sketch".into(), "s".into()))
        );
        assert_eq!(identity(&session, "other"), None);
        close(&session, "other");
        assert!(check(&session, "window-a", Kind::Call, "files.list").is_ok());
        close(&session, "window-a");
    }

    #[test]
    fn an_open_that_outlives_its_window_leaves_no_session() {
        let before = window_generation("window-reloading");
        close_window("window-reloading");
        assert!(open_since(
            &manifest(r#"["files"]"#),
            "s",
            "window-reloading",
            &[Permission::Files],
            before,
        )
        .is_err());
        let now = window_generation("window-reloading");
        let session = open_since(
            &manifest(r#"["files"]"#),
            "s",
            "window-reloading",
            &[Permission::Files],
            now,
        )
        .unwrap();
        assert!(check(&session, "window-reloading", Kind::Call, "files.list").is_ok());
        close_window("window-reloading");
        assert!(check(&session, "window-reloading", Kind::Call, "files.list").is_err());
    }

    #[test]
    fn every_call_and_topic_the_sdk_has_is_known() {
        let calls = [
            "hello",
            "members.list",
            "members.mentionables",
            "chat.post",
            "chat.open",
            "chat.notify",
            "files.pick",
            "files.open",
            "files.save",
            "files.list",
            "files.upload",
            "files.download",
            "route.navigate",
            "room.update",
            "room.awareness",
            "room.sync",
            "room.serialized",
            "room.option",
            "room.frame",
            "room.read",
            "room.change",
            "calls.join",
            "calls.leave",
            "calls.mute",
        ];
        for call in calls {
            assert_ne!(required(Kind::Call, call), Need::Unknown, "{call}");
        }
        for topic in [
            "theme",
            "route",
            "members.presence",
            "files.watch",
            "room",
            "room.frames",
            "calls.channels",
            "calls.current",
            "agents.control",
        ] {
            assert_ne!(required(Kind::Subscribe, topic), Need::Unknown, "{topic}");
        }
    }
}
