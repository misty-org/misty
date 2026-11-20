//! Randomized runs of several computers against the fake server, after Dropbox's testing of its
//! sync engine: random saves, renames and deletes on three computers of three people, with syncs
//! in between, computers going offline and coming back, and replies lost after the server applied
//! the change. Every file is a few lines of text, and each computer edits only its own line, so
//! two computers' edits never overlap. After everyone comes back and settles, each run checks:
//!
//! - no content is ever lost: every line a computer last wrote and didn't replace itself is on
//!   the server, in a live file (where a merge kept it beside the others' lines) or in the trash
//!   (a replaced copy, or what someone trashed);
//! - nothing trashed shows on any computer (a write after a trash brings the item back, so what
//!   shows is what the server has live);
//! - the server's order decides everything else: every computer shows the server's tree.
//!
//! `conflicts.rs` holds the same rules one scenario at a time: two computers' non-overlapping text
//! edits both surviving, a write after a trash reviving the file, a delete refused only while the
//! file is open.
//!
//! The network is simulated in the fake's `Http` rather than with `turmoil`: the sync core opens
//! no sockets of its own (the glue's `Http` does), so a socket-level simulator would have nothing
//! to intercept; dropped connections, offline computers and lost replies are injected where the
//! core meets the network instead.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod common;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;

use common::*;
use proptest::prelude::*;
use space_drive::{Drive, ItemId, Kind, LocalState, TrashBy};

const COMPUTERS: usize = 3;

#[derive(Clone, Debug)]
enum Action {
    Save { computer: usize, folder: u8, file: u8 },
    Rename { computer: usize, folder: u8, file: u8, to: u8 },
    Trash { computer: usize, folder: u8, file: u8 },
    TrashFolder { computer: usize },
    Sync { computer: usize },
    Offline { computer: usize, offline: bool },
    LoseReply { computer: usize },
}

fn action() -> impl Strategy<Value = Action> {
    let computer = 0..COMPUTERS;
    prop_oneof![
        4 => (computer.clone(), 0..2u8, 0..3u8)
            .prop_map(|(computer, folder, file)| Action::Save { computer, folder, file }),
        1 => (computer.clone(), 0..2u8, 0..3u8, 0..3u8)
            .prop_map(|(computer, folder, file, to)| Action::Rename { computer, folder, file, to }),
        1 => (computer.clone(), 0..2u8, 0..3u8)
            .prop_map(|(computer, folder, file)| Action::Trash { computer, folder, file }),
        1 => computer.clone().prop_map(|computer| Action::TrashFolder { computer }),
        4 => computer.clone().prop_map(|computer| Action::Sync { computer }),
        1 => (computer.clone(), any::<bool>())
            .prop_map(|(computer, offline)| Action::Offline { computer, offline }),
        1 => computer.prop_map(|computer| Action::LoseReply { computer }),
    ]
}

fn path(folder: u8, file: u8) -> String {
    if folder == 0 {
        format!("/f{file}.txt")
    } else {
        format!("/Folder/f{file}.txt")
    }
}

fn folder_path(folder: u8) -> &'static str {
    if folder == 0 {
        "/"
    } else {
        "/Folder"
    }
}

/// A file's lines: each computer's own line, with a line between them so edits never touch.
fn template() -> Vec<String> {
    let mut lines = Vec::new();
    for computer in 0..COMPUTERS {
        if computer > 0 {
            lines.push("--".to_owned());
        }
        lines.push(format!("c{computer} -"));
    }
    lines
}

/// The line computer `computer` owns in a file, as `content` has it.
fn own_line(content: &str, computer: usize) -> Option<String> {
    let prefix = format!("c{computer} ");
    content
        .lines()
        .find(|line| line.starts_with(&prefix))
        .map(str::to_owned)
}

/// The lines each computer last wrote and still means to keep.
#[derive(Default)]
struct Intent {
    must: HashSet<String>,
}

impl Intent {
    /// `computer` replaced its own line `before` (what it saw of the file) with `now`.
    fn wrote(&mut self, before: Option<&str>, now: String) {
        if let Some(before) = before {
            self.must.remove(before);
        }
        self.must.insert(now);
    }

    /// `computer` deleted `id`: a line of its own in a file that never went up is let go.
    async fn deleted(&mut self, computer: usize, drive: &Drive, id: &ItemId) {
        let mut queue = vec![id.clone()];
        while let Some(at) = queue.pop() {
            if let Ok(Some(node)) = drive.node(&space(), &at) {
                if node.kind == Kind::File && node.state == LocalState::Uploading {
                    if let Ok(bytes) = drive.read_bytes(&space(), &node.path).await {
                        if let Some(line) = own_line(&String::from_utf8_lossy(&bytes), computer) {
                            self.must.remove(&line);
                        }
                    }
                }
            }
            for child in drive.list(&space(), Some(&at)).unwrap_or_default() {
                queue.push(child.id);
            }
        }
    }
}

fn ids(drive: &Drive) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut queue: Vec<Option<ItemId>> = vec![None];
    while let Some(folder) = queue.pop() {
        for node in drive.list(&space(), folder.as_ref()).unwrap() {
            if node.kind == Kind::Folder {
                queue.push(Some(node.id.clone()));
            }
            out.insert(node.id.0.clone());
        }
    }
    out
}

fn run(actions: Vec<Action>) {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let people = [("ana", "Ana"), ("ben", "Ben"), ("cy", "Cy")];
        let dirs: Vec<tempfile::TempDir> = (0..COMPUTERS).map(|_| tempfile::tempdir().unwrap()).collect();
        let computers: Vec<_> = people
            .iter()
            .map(|(user, name)| server.computer(user, name, &format!("{name}'s computer")))
            .collect();
        let drives: Vec<Drive> = computers
            .iter()
            .zip(&dirs)
            .map(|(computer, dir)| server.open_drive(computer, dir.path().to_path_buf(), runtime.handle().clone()))
            .collect();
        let mut intent = Intent::default();
        let mut counter = 0u64;
        for action in actions {
            match action {
                Action::Save { computer, folder, file } => {
                    let drive = &drives[computer];
                    let at = path(folder, file);
                    // A person edits what they can open: the file as this computer has it, or a
                    // new one. A file they can't open (offline, not downloaded) isn't edited.
                    let current = match drive.node_at(&space(), &at).unwrap() {
                        Some(node) if node.kind == Kind::File => {
                            match drive.read_bytes(&space(), &at).await {
                                Ok(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
                                Err(_) => continue,
                            }
                        }
                        Some(_) => continue,
                        None => None,
                    };
                    counter += 1;
                    let line = format!("c{computer} v{counter}");
                    let mut lines: Vec<String> = match &current {
                        Some(text) if text.lines().count() == template().len() => {
                            text.lines().map(str::to_owned).collect()
                        }
                        _ => template(),
                    };
                    let before = current.as_deref().and_then(|text| own_line(text, computer));
                    for slot in lines.iter_mut() {
                        if slot.starts_with(&format!("c{computer} ")) {
                            *slot = line.clone();
                        }
                    }
                    let bytes = format!("{}\n", lines.join("\n")).into_bytes();
                    save(drive, &at, &bytes);
                    intent.wrote(before.as_deref(), line);
                }
                Action::Rename { computer, folder, file, to } => {
                    let drive = &drives[computer];
                    let Some(node) = drive.node_at(&space(), &path(folder, file)).unwrap() else {
                        continue;
                    };
                    let target = path(folder, to);
                    if drive.node_at(&space(), &target).unwrap().is_some() {
                        continue;
                    }
                    let folder_id = folder_id(drive, folder_path(folder));
                    let _ = drive.rename(&space(), &node.id, folder_id.as_ref(), &format!("f{to}.txt"));
                }
                Action::Trash { computer, folder, file } => {
                    let drive = &drives[computer];
                    if let Some(node) = drive.node_at(&space(), &path(folder, file)).unwrap() {
                        intent.deleted(computer, drive, &node.id).await;
                        drive.trash(&space(), &node.id, TrashBy::Person).unwrap();
                    }
                }
                Action::TrashFolder { computer } => {
                    let drive = &drives[computer];
                    if let Some(node) = drive.node_at(&space(), "/Folder").unwrap() {
                        intent.deleted(computer, drive, &node.id).await;
                        drive.trash(&space(), &node.id, TrashBy::Person).unwrap();
                    }
                }
                Action::Sync { computer } => {
                    let _ = drives[computer].sync_now(&space()).await;
                }
                Action::Offline { computer, offline } => {
                    computers[computer].offline.store(offline, Ordering::SeqCst);
                }
                Action::LoseReply { computer } => {
                    computers[computer].lose_next_reply.store(true, Ordering::SeqCst);
                }
            }
        }
        for computer in &computers {
            computer.offline.store(false, Ordering::SeqCst);
            computer.lose_next_reply.store(false, Ordering::SeqCst);
        }
        settle(&server, &drives).await;

        // No content is ever lost: every line someone meant to keep is in a live file or in the
        // trash.
        let contents = server.all_contents();
        for line in &intent.must {
            assert!(
                contents.iter().any(|content| content.lines().any(|held| held == line)),
                "{line} was lost"
            );
        }
        // Nothing trashed shows on any computer.
        let trashed = server.trashed_ids();
        for drive in &drives {
            assert!(ids(drive).is_disjoint(&trashed), "a trashed item shows on a computer");
        }
        // The server's order decides the rest: every computer shows the server's tree.
        let wanted = server.live_tree();
        for drive in &drives {
            let shown: HashMap<String, (Kind, Option<String>)> = local_tree(drive)
                .into_iter()
                .map(|(path, (kind, sha, _))| (path, (kind, sha)))
                .collect();
            assert_eq!(shown, wanted);
        }
    });
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 32, ..ProptestConfig::default() })]

    #[test]
    fn many_computers_never_lose_a_change(actions in proptest::collection::vec(action(), 1..40)) {
        run(actions);
    }
}
