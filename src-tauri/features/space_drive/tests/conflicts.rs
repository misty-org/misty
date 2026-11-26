#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod common;

use std::{sync::atomic::Ordering, time::Duration};

use common::*;
use space_drive::{Kind, NoticeKind};

fn lines(first: &str, last: &str) -> Vec<u8> {
    format!("{first}\n--\nmiddle\n--\n{last}\n").into_bytes()
}

fn content_at(server: &FakeServer, path: &str) -> Option<String> {
    let tree = server.live_tree();
    let (_, sha) = tree.get(path)?;
    let name = path.rsplit('/').next()?;
    let item = server.item_named(name).filter(|item| &item.sha256 == sha)?;
    Some(server.content_of(&item))
}

#[test]
fn non_overlapping_text_edits_from_two_computers_both_survive() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/Notes.md", &lines("one", "three"));
        settle(&server, &[a.clone(), b.clone()]).await;
        assert_eq!(
            b.read_bytes(&space(), "/Notes.md").await.unwrap(),
            lines("one", "three")
        );

        save(&a, "/Notes.md", &lines("ONE by Ana", "three"));
        save(&b, "/Notes.md", &lines("one", "THREE by Ben"));
        a.sync_now(&space()).await.unwrap();
        settle(&server, &[b.clone(), a.clone()]).await;

        let merged = String::from_utf8(lines("ONE by Ana", "THREE by Ben")).unwrap();
        assert_eq!(
            content_at(&server, "/Notes.md").as_deref(),
            Some(merged.as_str())
        );
        assert_eq!(
            local_tree(&b)
                .get("/Notes.md")
                .and_then(|(_, sha, _)| sha.clone()),
            Some(sha(merged.as_bytes())),
            "the merge is written back on the computer that made it"
        );
        assert!(
            server.replaced_copies().is_empty(),
            "a merge replaces nothing"
        );
    });
}

#[test]
fn of_two_saves_of_a_binary_file_the_last_wins_and_the_first_stays_beside_it() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        let id = save(&a, "/Report.pdf", b"v1\0");
        settle(&server, &[a.clone(), b.clone()]).await;

        save(&a, "/Report.pdf", b"ana's\0");
        save(&b, "/Report.pdf", b"ben's\0");
        a.sync_now(&space()).await.unwrap();
        b.sync_now(&space()).await.unwrap();
        settle(&server, &[a.clone(), b.clone()]).await;

        let tree = server.live_tree();
        assert_eq!(
            tree.get("/Report.pdf").and_then(|(_, sha)| sha.clone()),
            Some(sha(b"ben's\0"))
        );
        let kept: Vec<_> = server
            .replaced_copies()
            .into_iter()
            .filter(|item| item.replaced_of.as_ref() == Some(&id))
            .collect();
        assert_eq!(kept.len(), 1, "Ana's save is kept as a conflicted copy");
        assert_eq!(kept[0].sha256, Some(sha(b"ana's\0")));
        assert!(
            kept[0].name.contains(space_drive::CONFLICTED_MARK),
            "{}",
            kept[0].name
        );
        assert_eq!(
            tree.get(&format!("/{}", kept[0].name))
                .and_then(|(_, sha)| sha.clone()),
            Some(sha(b"ana's\0")),
            "the copy sits beside the file"
        );
        assert!(server.trashed_items().is_empty());
        let notices = ana.notices.lock().unwrap().clone();
        let notice = notices
            .iter()
            .find(|notice| notice.kind == NoticeKind::SaveReplaced)
            .expect("Ana hears her save was replaced");
        assert_eq!(notice.by.as_deref(), Some("Ben"));
        assert_eq!(notice.name, "Report.pdf");
        assert_eq!(notice.item_id.as_ref(), Some(&kept[0].id));
        assert!(!ben
            .notices
            .lock()
            .unwrap()
            .iter()
            .any(|notice| notice.kind == NoticeKind::SaveReplaced));
    });
}

#[test]
fn an_edit_after_a_delete_keeps_the_file_in_the_trash_with_the_edit() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        let id = save(&a, "/Report.pdf", b"first\0");
        settle(&server, &[a.clone(), b.clone()]).await;

        ben.offline.store(true, Ordering::SeqCst);
        save(&b, "/Report.pdf", b"ben's edit\0");
        a.trash(&space(), &id).unwrap();
        a.sync_now(&space()).await.unwrap();
        assert!(!server.live_tree().contains_key("/Report.pdf"));

        ben.offline.store(false, Ordering::SeqCst);
        settle(&server, &[b.clone(), a.clone()]).await;

        assert!(!server.live_tree().contains_key("/Report.pdf"));
        let report = server
            .trashed_items()
            .into_iter()
            .find(|item| item.id == id)
            .expect("still in the trash");
        assert_eq!(report.sha256, Some(sha(b"ben's edit\0")), "with Ben's edit");
        assert_eq!(report.parent_id.map(|parent| parent.0), server.trash_id());
        for drive in [&a, &b] {
            assert!(!local_tree(drive).contains_key("/Report.pdf"));
            assert_eq!(
                local_tree(drive)
                    .get("/.trash/Report.pdf")
                    .and_then(|(_, sha, _)| sha.clone()),
                Some(sha(b"ben's edit\0"))
            );
        }
        assert!(!ana
            .notices
            .lock()
            .unwrap()
            .iter()
            .any(|notice| notice.kind == NoticeKind::Revived));
    });
}

#[test]
fn a_delete_after_an_edit_trashes_the_edited_file() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        let id = save(&a, "/Report.pdf", b"v1");
        settle(&server, &[a.clone(), b.clone()]).await;

        save(&a, "/Report.pdf", b"v2");
        a.sync_now(&space()).await.unwrap();
        ana.offline.store(true, Ordering::SeqCst);
        b.trash_now(&space(), &id).await.unwrap();
        ana.offline.store(false, Ordering::SeqCst);
        settle(&server, &[a.clone(), b.clone()]).await;

        assert!(!server.live_tree().contains_key("/Report.pdf"));
        let trashed = server.trashed_items();
        let report = trashed
            .iter()
            .find(|item| item.id == id)
            .expect("in the trash");
        assert_eq!(report.sha256, Some(sha(b"v2")), "restorable as Ana left it");
        assert!(!local_tree(&a).contains_key("/Report.pdf"));
        assert!(
            local_tree(&a).contains_key("/.trash/Report.pdf"),
            "Ana sees it in the Space's trash"
        );
    });
}

#[test]
fn a_new_file_in_a_deleted_folder_lands_in_the_trash_with_it() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/Docs/old.txt", b"old");
        settle(&server, &[a.clone(), b.clone()]).await;

        ben.offline.store(true, Ordering::SeqCst);
        save(&b, "/Docs/new.txt", b"new");
        let docs = a.node_at(&space(), "/Docs").unwrap().unwrap();
        a.trash(&space(), &docs.id).unwrap();
        a.sync_now(&space()).await.unwrap();

        ben.offline.store(false, Ordering::SeqCst);
        settle(&server, &[b.clone(), a.clone()]).await;

        let tree = server.live_tree();
        assert!(!tree.contains_key("/Docs"), "{tree:?}");
        let whole = server.whole_tree();
        assert!(matches!(whole.get("/.trash/Docs"), Some((Kind::Folder, _))));
        assert_eq!(
            whole
                .get("/.trash/Docs/new.txt")
                .and_then(|(_, sha)| sha.clone()),
            Some(sha(b"new"))
        );
        assert!(whole.contains_key("/.trash/Docs/old.txt"));
        for drive in [&a, &b] {
            let local = local_tree(drive);
            assert!(!local.contains_key("/Docs"));
            assert!(
                local.contains_key("/.trash/Docs/new.txt"),
                "everyone sees it in the trash"
            );
        }
    });
}

#[test]
fn two_new_files_by_one_name_are_one_file_and_the_first_stays_beside_it() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/Notes.md", b"ana");
        save(&b, "/Notes.md", b"ben");
        a.sync_now(&space()).await.unwrap();
        settle(&server, &[b.clone(), a.clone()]).await;
        let tree = server.live_tree();
        assert_eq!(tree.len(), 2, "{tree:?}");
        assert_eq!(
            tree.get("/Notes.md").and_then(|(_, sha)| sha.clone()),
            Some(sha(b"ben"))
        );
        let copy = server
            .replaced_copies()
            .into_iter()
            .find(|item| item.sha256 == Some(sha(b"ana")))
            .expect("Ana's file is kept as a conflicted copy");
        assert!(tree.contains_key(&format!("/{}", copy.name)), "{tree:?}");
        let content = |tree: std::collections::HashMap<
            String,
            (Kind, Option<String>, space_drive::LocalState),
        >| {
            tree.into_iter()
                .map(|(path, (kind, sha, _))| (path, (kind, sha)))
                .collect::<std::collections::HashMap<_, _>>()
        };
        assert_eq!(content(local_tree(&a)), content(local_tree(&b)));
    });
}

#[test]
fn two_new_folders_by_one_name_are_one_folder() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/Plans/a.md", b"a");
        save(&b, "/Plans/b.md", b"b");
        a.sync_now(&space()).await.unwrap();
        settle(&server, &[b.clone(), a.clone()]).await;
        let tree = server.live_tree();
        assert_eq!(tree.len(), 3, "{tree:?}");
        assert!(tree.contains_key("/Plans/a.md") && tree.contains_key("/Plans/b.md"));
    });
}

#[test]
fn of_two_renames_the_last_wins() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        let id = save(&a, "/Plan.md", b"plan");
        settle(&server, &[a.clone(), b.clone()]).await;
        a.rename(&space(), &id, None, "Ana's plan.md").unwrap();
        b.rename(&space(), &id, None, "Ben's plan.md").unwrap();
        a.sync_now(&space()).await.unwrap();
        b.sync_now(&space()).await.unwrap();
        settle(&server, &[a.clone(), b.clone()]).await;
        let tree = server.live_tree();
        assert!(tree.contains_key("/Ben's plan.md"));
        assert!(!tree.contains_key("/Ana's plan.md"));
        assert!(local_tree(&a).contains_key("/Ben's plan.md"));
    });
}

#[test]
fn a_rename_onto_a_taken_name_trashes_the_item_that_held_it_unless_it_is_open() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        let draft = save(&b, "/Draft.md", b"draft");
        settle(&server, &[a.clone(), b.clone()]).await;

        ben.offline.store(true, Ordering::SeqCst);
        let final_md = save(&a, "/Final.md", b"ana's final");
        a.sync_now(&space()).await.unwrap();
        b.rename(&space(), &draft, None, "Final.md").unwrap();
        a.open(&space(), &final_md, false).await.unwrap();
        tokio::time::sleep(space_drive::in_use::REPORT_AFTER + Duration::from_millis(500)).await;
        ben.offline.store(false, Ordering::SeqCst);
        b.sync_now(&space()).await.unwrap();
        settle(&server, &[a.clone(), b.clone()]).await;
        let tree = server.live_tree();
        assert!(
            tree.contains_key("/Draft.md") && tree.contains_key("/Final.md"),
            "{tree:?}"
        );
        assert!(ben
            .notices
            .lock()
            .unwrap()
            .iter()
            .any(|notice| notice.kind == NoticeKind::DeleteRefusedInUse));

        a.close(&space(), &final_md, false).await;
    });
}

#[test]
fn a_rename_onto_a_taken_name_takes_it_and_the_holder_waits_in_the_trash() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        let draft = save(&b, "/Draft.md", b"draft");
        settle(&server, &[a.clone(), b.clone()]).await;

        ben.offline.store(true, Ordering::SeqCst);
        let final_md = save(&a, "/Final.md", b"ana's final");
        a.sync_now(&space()).await.unwrap();
        b.rename(&space(), &draft, None, "Final.md").unwrap();
        ben.offline.store(false, Ordering::SeqCst);
        settle(&server, &[b.clone(), a.clone()]).await;

        let tree = server.live_tree();
        assert_eq!(tree.len(), 1, "{tree:?}");
        assert_eq!(
            tree.get("/Final.md").and_then(|(_, sha)| sha.clone()),
            Some(sha(b"draft"))
        );
        assert!(
            server.trashed_ids().contains(final_md.as_str()),
            "Ana's file waits in the trash"
        );
        assert!(local_tree(&a)
            .get("/Final.md")
            .is_some_and(|(_, held, _)| held == &Some(sha(b"draft"))));
    });
}

#[test]
fn a_file_moved_over_another_here_keeps_the_one_it_replaced_in_the_trash() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/Notes.md", b"notes");
        let old = save(&a, "/Old.md", b"old");
        settle(&server, &[a.clone()]).await;

        a.rename(&space(), &old, None, "Notes.md").unwrap();
        settle(&server, &[a.clone()]).await;

        let tree = server.live_tree();
        assert_eq!(
            tree.get("/Notes.md").and_then(|(_, sha)| sha.clone()),
            Some(sha(b"old")),
            "{tree:?}"
        );
        assert!(!tree.contains_key("/Old.md"));
        assert!(
            server
                .all_contents()
                .iter()
                .any(|content| content == "notes"),
            "what it replaced waits in the trash"
        );
    });
}

#[test]
fn a_file_someone_has_open_is_not_deleted() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let ben = server.computer("ben", "Ben", "Ben's PC");
        let a = server.open_drive(&ana, dir_a.path().to_path_buf(), runtime.handle().clone());
        let b = server.open_drive(&ben, dir_b.path().to_path_buf(), runtime.handle().clone());
        let id = save(&a, "/Report.pdf", b"v1");
        settle(&server, &[a.clone(), b.clone()]).await;
        b.open(&space(), &id, false).await.unwrap();
        let refused = a.trash_now(&space(), &id).await;
        assert!(
            matches!(refused, Err(space_drive::DriveError::InUse(_))),
            "{refused:?}"
        );
        assert!(a.node(&space(), &id).unwrap().is_some(), "it comes back");
        assert!(server.live_tree().contains_key("/Report.pdf"));
        assert!(ana
            .notices
            .lock()
            .unwrap()
            .iter()
            .any(|notice| notice.kind == NoticeKind::DeleteRefusedInUse));
        b.close(&space(), &id, false).await;
        a.trash_now(&space(), &id).await.unwrap();
        assert!(
            !server.live_tree().contains_key("/Report.pdf"),
            "closed, it goes"
        );
    });
}

#[test]
fn one_person_edits_on_two_computers_like_anyone() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let (dir_1, dir_2) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let mac = server.computer("ana", "Ana", "MacBook");
        let pc = server.computer("ana", "Ana", "Desktop");
        let one = server.open_drive(&mac, dir_1.path().to_path_buf(), runtime.handle().clone());
        let two = server.open_drive(&pc, dir_2.path().to_path_buf(), runtime.handle().clone());
        let id = save(&one, "/Notes.md", &lines("one", "three"));
        settle(&server, &[one.clone(), two.clone()]).await;
        two.read_bytes(&space(), "/Notes.md").await.unwrap();
        one.open(&space(), &id, true).await.unwrap();
        two.open(&space(), &id, true).await.unwrap();
        save(&one, "/Notes.md", &lines("ONE", "three"));
        save(&two, "/Notes.md", &lines("one", "THREE"));
        settle(&server, &[one.clone(), two.clone()]).await;
        let merged = String::from_utf8(lines("ONE", "THREE")).unwrap();
        assert_eq!(
            content_at(&server, "/Notes.md").as_deref(),
            Some(merged.as_str())
        );
        one.close(&space(), &id, true).await;
        two.close(&space(), &id, true).await;
    });
}

#[test]
fn a_delete_moves_the_item_into_the_spaces_trash_where_it_can_be_put_back_or_purged() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().to_path_buf(), runtime.handle().clone());
        let id = save(&a, "/draft.md", b"draft");
        settle(&server, &[a.clone()]).await;
        a.trash(&space(), &id).unwrap();
        a.sync_now(&space()).await.unwrap();
        let item = server.item_named("draft.md").unwrap();
        assert_eq!(item.id, id);
        assert_eq!(item.parent_id.map(|parent| parent.0), server.trash_id());
        assert!(item.trashed_at.is_some());
        assert_eq!(item.trashed_by.as_deref(), Some("ana"));
        assert!(server.trashed_ids().contains(id.as_str()));
        assert!(a.in_trash(&space(), &id).unwrap());
        assert!(local_tree(&a).contains_key("/.trash/draft.md"));
        assert!(!local_tree(&a).contains_key("/draft.md"));

        a.restore(&space(), &id).await.unwrap();
        settle(&server, &[a.clone()]).await;
        let item = server.item_named("draft.md").unwrap();
        assert!(item.parent_id.is_none() && item.trashed_at.is_none());
        assert!(server.live_tree().contains_key("/draft.md"));
        assert!(!a.in_trash(&space(), &id).unwrap());
        assert!(local_tree(&a).contains_key("/draft.md"));

        a.trash_now(&space(), &id).await.unwrap();
        assert!(a.in_trash(&space(), &id).unwrap());
        a.trash_now(&space(), &id).await.unwrap();
        assert!(
            server
                .item_named("draft.md")
                .is_some_and(|item| item.deleted),
            "a delete inside the trash is for good"
        );
        assert!(a.node(&space(), &id).unwrap().is_none());
        assert!(server.trash_id().is_some(), "the trash folder stays");
    });
}

#[test]
fn a_lost_reply_never_makes_a_copy_of_ones_own_change() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/a.txt", b"one");
        ana.lose_next_reply.store(true, Ordering::SeqCst);
        let _ = a.sync_now(&space()).await;
        settle(&server, &[a.clone()]).await;
        save(&a, "/a.txt", b"two");
        ana.lose_next_reply.store(true, Ordering::SeqCst);
        let _ = a.sync_now(&space()).await;
        settle(&server, &[a.clone()]).await;
        let tree = server.live_tree();
        assert_eq!(tree.len(), 1, "{tree:?}");
        assert_eq!(
            tree.get("/a.txt").and_then(|(_, sha)| sha.clone()),
            Some(sha(b"two"))
        );
        assert!(
            server.replaced_copies().is_empty() && server.trashed_items().is_empty(),
            "nothing of one's own is replaced"
        );
    });
}
