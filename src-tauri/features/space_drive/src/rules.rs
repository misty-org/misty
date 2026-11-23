use crate::api::ApiError;
use crate::model::{InUseBy, Item, Kind};

pub const MAX_TEXT: u64 = 8 * 1024 * 1024;
pub const MERGE_TRIES: usize = 5;

pub fn is_text(bytes: &[u8]) -> bool {
    bytes.len() as u64 <= MAX_TEXT && !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

pub fn merge_text(base: &str, ours: &str, theirs: &str) -> Option<String> {
    if ours == theirs || theirs == base {
        return Some(ours.to_owned());
    }
    if ours == base {
        return Some(theirs.to_owned());
    }
    diffy::merge(base, ours, theirs).ok()
}

#[derive(Clone, Debug, PartialEq)]
pub enum UpdateOutcome {
    Accepted(Item),
    Stale(Item),
    PlaceInUse(Vec<InUseBy>),
    PlaceRefused(String),
    Gone,
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
        Err(ApiError::Server {
            status: 409,
            message,
        }) if place => UpdateOutcome::PlaceRefused(message),
        Err(error) => UpdateOutcome::Failed(error.to_string()),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum CreateOutcome {
    Accepted(Item),
    WriteInto(Item),
    SameFolder(Item),
    Renumber,
    ToRoot,
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

#[derive(Clone, Debug, PartialEq)]
pub enum TrashOutcome {
    Accepted(Option<Item>),
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

pub fn replaced_save(before: Option<&Item>, now: &Item, me: &str) -> bool {
    before.is_none()
        && now.replaced_of.is_some()
        && now.trashed
        && !now.deleted
        && now.modified_by == me
        && now.trashed_by.as_deref().is_some_and(|by| by != me)
}

pub fn revived(before: Option<&Item>, now: &Item, me: &str) -> bool {
    before.is_some_and(|before| before.trashed && before.trashed_by.as_deref() == Some(me))
        && now.is_live()
        && now.modified_by != me
}

pub fn in_use_line(who: &[InUseBy], name: &str) -> String {
    let names: Vec<&str> = who
        .iter()
        .map(|by| {
            if by.name.is_empty() {
                "Someone"
            } else {
                by.name.as_str()
            }
        })
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
        assert_eq!(
            merge_text(base, ours, "one\n--\ntwo\n--\nthree\n").as_deref(),
            Some(ours)
        );
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
            after_create(
                Kind::File,
                Err(ApiError::NameTaken(Some(Box::new(item(3, Kind::File)))))
            ),
            CreateOutcome::WriteInto(_)
        ));
        assert!(matches!(
            after_create(
                Kind::Folder,
                Err(ApiError::NameTaken(Some(Box::new(item(3, Kind::Folder)))))
            ),
            CreateOutcome::SameFolder(_)
        ));
        assert_eq!(
            after_create(
                Kind::Folder,
                Err(ApiError::NameTaken(Some(Box::new(item(3, Kind::File)))))
            ),
            CreateOutcome::Renumber
        );
    }

    #[test]
    fn a_stale_merge_merges_again_and_a_trash_is_refused_only_in_use() {
        assert!(matches!(
            after_update(
                Err(ApiError::VersionConflict(Box::new(item(8, Kind::File)))),
                false
            ),
            UpdateOutcome::Stale(_)
        ));
        assert!(matches!(
            after_update(Err(ApiError::InUse(Vec::new())), true),
            UpdateOutcome::PlaceInUse(_)
        ));
        assert_eq!(
            after_update(Err(ApiError::NotFound), false),
            UpdateOutcome::Gone
        );
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
