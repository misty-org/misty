//! The drive's rules, as few as there can be. The server puts every change in one order, the order
//! changes reach it, and that order decides; never a clock.
//!
//! 1. **Text merges.** Live editing in an app's room merges through Yjs. A whole-file save of a
//!    text file (UTF-8, no NUL bytes, at most 8 MiB, on both sides) made against an older
//!    version is merged three ways (the version it started from, the save, the server's current
//!    copy) with `diffy`, and the merge goes up with `If-Match` on the version it merged with. If
//!    that moved meanwhile, it merges again, at most `MERGE_TRIES` times, then rule 2 applies.
//! 2. **Otherwise the last save wins.** Binary files, text whose merge overlaps and text with no
//!    saved base replace the file on the server in arrival order, with `base_version` saying what
//!    the save came from. Nothing is lost: when a save replaces content its sender never saw, the
//!    server keeps that content as a trashed copy beside it (`Report (replaced 2026-11-20
//!    1405).pdf`), restorable for 30 days, and the person whose save it was gets a notice.
//! 3. **A file can't be deleted while anyone has it open** (`423 in_use`, for it or anything in a
//!    folder). Opening, editing and writing are never blocked.
//!
//! Everything else is last write wins too: a delete needs no version and trashes whatever the
//! file is by then; a write to something trashed brings it back; a new file whose name is taken
//! is written into the file that has it, a new folder is that folder; a rename onto a taken name
//! trashes the item that held it (`replace`).
use crate::api::ApiError;
use crate::model::{InUseBy, Item, Kind};

/// The most a text file may be, on each side, to be merged.
pub const MAX_TEXT: u64 = 8 * 1024 * 1024;
/// How many times a merge is made again when the server moved on meanwhile.
pub const MERGE_TRIES: usize = 5;

/// Text that merges: UTF-8 with no NUL byte, at most `MAX_TEXT`.
pub fn is_text(bytes: &[u8]) -> bool {
    bytes.len() as u64 <= MAX_TEXT && !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

/// A three-way merge: the merged text, or `None` when the two sides' changes overlap.
pub fn merge_text(base: &str, ours: &str, theirs: &str) -> Option<String> {
    if ours == theirs || theirs == base {
        return Some(ours.to_owned());
    }
    if ours == base {
        return Some(theirs.to_owned());
    }
    diffy::merge(base, ours, theirs).ok()
}

/// What a `PATCH` came to.
#[derive(Clone, Debug, PartialEq)]
pub enum UpdateOutcome {
    /// The server took it.
    Accepted(Item),
    /// Sent with `If-Match` (a merge), and the server moved on: merge again against this.
    Stale(Item),
    /// A rename or move onto a taken name couldn't trash the item that held it: someone has it
    /// (or something in it) open. The rename is undone here.
    PlaceInUse(Vec<InUseBy>),
    /// A rename or move the server refused otherwise (the name is taken by something it won't
    /// replace, a folder into itself): it is undone here.
    PlaceRefused(String),
    /// The item was purged: what this computer has of it becomes a new item at its path.
    Gone,
    /// Nothing decided: try again later, unchanged.
    Retry(String),
    Failed(String),
}

pub fn after_update(answer: Result<Item, ApiError>, place: bool) -> UpdateOutcome {
    match answer {
        Ok(item) => UpdateOutcome::Accepted(item),
        Err(ApiError::VersionConflict(server)) => UpdateOutcome::Stale(*server),
        Err(ApiError::InUse(who)) if place => UpdateOutcome::PlaceInUse(who),
        Err(ApiError::NotFound) => UpdateOutcome::Gone,
        Err(error) if error.is_transient() || matches!(error, ApiError::SignedOut) => {
            UpdateOutcome::Retry(error.to_string())
        }
        Err(error @ (ApiError::NameTaken(_) | ApiError::ParentMissing)) if place => {
            UpdateOutcome::PlaceRefused(error.to_string())
        }
        Err(ApiError::Server { status: 409, message }) if place => {
            UpdateOutcome::PlaceRefused(message)
        }
        Err(error) => UpdateOutcome::Failed(error.to_string()),
    }
}

/// What a `POST /drive/items` came to.
#[derive(Clone, Debug, PartialEq)]
pub enum CreateOutcome {
    Accepted(Item),
    /// A new file whose name a file in that folder has: it is written into that file.
    WriteInto(Item),
    /// A new folder whose name a folder in that folder has: it is that folder.
    SameFolder(Item),
    /// The name is taken by something of the other kind: it takes a numbered name.
    Renumber,
    /// The folder it goes in is gone for good: it goes to the drive's root.
    ToRoot,
    /// The id is already the server's: an earlier try of this create went through with other
    /// fields. Read the item and carry on from it.
    Adopt,
    Retry(String),
    Failed(String),
}

pub fn after_create(kind: Kind, answer: Result<Item, ApiError>) -> CreateOutcome {
    match answer {
        Ok(item) => CreateOutcome::Accepted(item),
        Err(ApiError::NameTaken(Some(holder))) if holder.kind == kind && holder.is_live() => {
            match kind {
                Kind::File => CreateOutcome::WriteInto(*holder),
                Kind::Folder => CreateOutcome::SameFolder(*holder),
            }
        }
        Err(ApiError::NameTaken(_)) => CreateOutcome::Renumber,
        Err(ApiError::ParentMissing) => CreateOutcome::ToRoot,
        Err(ApiError::IdTaken) => CreateOutcome::Adopt,
        Err(error) if error.is_transient() || matches!(error, ApiError::SignedOut) => {
            CreateOutcome::Retry(error.to_string())
        }
        Err(error) => CreateOutcome::Failed(error.to_string()),
    }
}

/// What a trash move came to.
#[derive(Clone, Debug, PartialEq)]
pub enum TrashOutcome {
    /// Trashed (or already trashed, or gone).
    Accepted(Option<Item>),
    /// Someone has it, or something in the folder, open.
    RefusedInUse(Vec<InUseBy>),
    Retry(String),
    Failed(String),
}

pub fn after_trash(answer: Result<Item, ApiError>) -> TrashOutcome {
    match answer {
        Ok(item) => TrashOutcome::Accepted(Some(item)),
        Err(ApiError::Trashed(server)) => TrashOutcome::Accepted(Some(*server)),
        Err(ApiError::NotFound) => TrashOutcome::Accepted(None),
        Err(ApiError::InUse(who)) => TrashOutcome::RefusedInUse(who),
        Err(error) if error.is_transient() || matches!(error, ApiError::SignedOut) => {
            TrashOutcome::Retry(error.to_string())
        }
        Err(error) => TrashOutcome::Failed(error.to_string()),
    }
}

/// A change from the feed that is a trashed copy of the person's own save, replaced unseen by
/// someone else's (`replaced_of`, made by the person, trashed by another). Only as it first
/// appears: a copy restored or seen before says nothing new.
pub fn replaced_save(before: Option<&Item>, now: &Item, me: &str) -> bool {
    before.is_none()
        && now.replaced_of.is_some()
        && now.trashed
        && !now.deleted
        && now.modified_by == me
        && now.trashed_by.as_deref().is_some_and(|by| by != me)
}

/// A change from the feed that brings back an item the person trashed, made by someone else.
pub fn revived(before: Option<&Item>, now: &Item, me: &str) -> bool {
    before.is_some_and(|before| before.trashed && before.trashed_by.as_deref() == Some(me))
        && now.is_live()
        && now.modified_by != me
}

/// "Ben has Report.pdf open", "Ben and Ana have Report.pdf open", "Ben and 2 others…".
pub fn in_use_line(who: &[InUseBy], name: &str) -> String {
    let names: Vec<&str> = who
        .iter()
        .map(|by| if by.name.is_empty() { "Someone" } else { by.name.as_str() })
        .collect();
    match names.as_slice() {
        [] => format!("Someone has {name} open"),
        [one] => format!("{one} has {name} open"),
        [one, two] => format!("{one} and {two} have {name} open"),
        [one, rest @ ..] => format!("{one} and {} others have {name} open", rest.len()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ItemId, Seq, SpaceId, Version};

    fn item(version: i64, kind: Kind) -> Item {
        Item {
            id: ItemId("drv_x".into()),
            space_id: SpaceId("s".into()),
            parent_id: None,
            name: "Report.txt".into(),
            kind,
            sha256: Some("a".into()),
            size: 1,
            mtime_ms: 0,
            version: Version(version),
            seq: Seq(version),
            modified_by: "ana".into(),
            modified_by_name: "Ana".into(),
            modified_at: String::new(),
            trashed: false,
            trashed_at: None,
            trashed_by: None,
            trash_hold: false,
            deleted: false,
            replaced_of: None,
        }
    }

    #[test]
    fn edits_on_different_lines_merge() {
        let base = "one\n--\ntwo\n--\nthree\n";
        let ours = "ONE\n--\ntwo\n--\nthree\n";
        let theirs = "one\n--\ntwo\n--\nTHREE\n";
        assert_eq!(
            merge_text(base, ours, theirs).as_deref(),
            Some("ONE\n--\ntwo\n--\nTHREE\n")
        );
        assert_eq!(merge_text(base, ours, "one\n--\ntwo\n--\nthree\n").as_deref(), Some(ours));
        assert!(merge_text(base, "x\n--\ntwo\n--\nthree\n", "y\n--\ntwo\n--\nthree\n").is_none());
    }

    #[test]
    fn only_text_merges() {
        assert!(is_text(b"notes\n"));
        assert!(!is_text(b"a\0b"));
        assert!(!is_text(&[0xff, 0xfe]));
    }

    #[test]
    fn a_taken_name_is_written_into_or_joined() {
        assert!(matches!(
            after_create(Kind::File, Err(ApiError::NameTaken(Some(Box::new(item(3, Kind::File)))))),
            CreateOutcome::WriteInto(_)
        ));
        assert!(matches!(
            after_create(Kind::Folder, Err(ApiError::NameTaken(Some(Box::new(item(3, Kind::Folder)))))),
            CreateOutcome::SameFolder(_)
        ));
        assert_eq!(
            after_create(Kind::Folder, Err(ApiError::NameTaken(Some(Box::new(item(3, Kind::File)))))),
            CreateOutcome::Renumber
        );
    }

    #[test]
    fn a_stale_merge_merges_again_and_a_trash_is_refused_only_in_use() {
        assert!(matches!(
            after_update(Err(ApiError::VersionConflict(Box::new(item(8, Kind::File)))), false),
            UpdateOutcome::Stale(_)
        ));
        assert!(matches!(
            after_update(Err(ApiError::InUse(Vec::new())), true),
            UpdateOutcome::PlaceInUse(_)
        ));
        assert_eq!(after_update(Err(ApiError::NotFound), false), UpdateOutcome::Gone);
        assert!(matches!(
            after_trash(Err(ApiError::InUse(Vec::new()))),
            TrashOutcome::RefusedInUse(_)
        ));
        assert!(matches!(
            after_trash(Err(ApiError::Trashed(Box::new(item(9, Kind::File))))),
            TrashOutcome::Accepted(Some(_))
        ));
    }

    #[test]
    fn notices_come_from_the_feed() {
        let mut copy = item(1, Kind::File);
        copy.modified_by = "ben".into();
        copy.trashed = true;
        copy.trashed_by = Some("ana".into());
        copy.replaced_of = Some(ItemId("drv_y".into()));
        assert!(replaced_save(None, &copy, "ben"));
        assert!(!replaced_save(Some(&copy), &copy, "ben"), "seen before");
        assert!(!replaced_save(None, &copy, "ana"));

        let mut before = item(4, Kind::File);
        before.trashed = true;
        before.trashed_by = Some("ben".into());
        let now = item(5, Kind::File);
        assert!(revived(Some(&before), &now, "ben"));
        assert!(!revived(Some(&before), &now, "ana"));
    }

    #[test]
    fn says_who_has_it_open() {
        let ben = InUseBy {
            user_id: "b".into(),
            name: "Ben".into(),
            device_name: "Mac".into(),
            editing: false,
        };
        assert_eq!(in_use_line(&[ben], "Report.pdf"), "Ben has Report.pdf open");
    }
}
