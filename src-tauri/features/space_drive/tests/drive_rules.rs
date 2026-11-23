#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod common;

use std::ffi::OsStr;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use common::*;
use space_drive::{CopyFlow, CopyFolder, CopyKind, CopySource, CopyStep, DriveError, Kind};

struct Local(PathBuf);

struct LocalFolder(PathBuf);

impl CopyFolder for LocalFolder {
    fn open(&self, name: &OsStr) -> io::Result<Box<dyn Read + '_>> {
        Ok(Box::new(std::fs::File::open(self.0.join(name))?))
    }
}

fn kind_of(path: &Path) -> CopyKind {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => CopyKind::File,
        Ok(meta) if meta.is_dir() => CopyKind::Folder,
        _ => CopyKind::Other,
    }
}

fn walk_local(
    folder: &Path,
    relative: &mut PathBuf,
    visit: &mut dyn FnMut(CopyStep<'_>) -> CopyFlow,
) -> io::Result<bool> {
    let here = LocalFolder(folder.to_path_buf());
    let mut items: Vec<_> = std::fs::read_dir(folder)?.flatten().collect();
    items.sort_by_key(|item| item.file_name());
    for item in items {
        let name = item.file_name();
        let path = item.path();
        let kind = kind_of(&path);
        relative.push(&name);
        let flow = visit(CopyStep {
            folder: &here,
            relative,
            name: &name,
            kind,
            modified: item.metadata().and_then(|meta| meta.modified()).ok(),
        });
        let stopped = match flow {
            CopyFlow::Stop => true,
            CopyFlow::Continue if kind == CopyKind::Folder => walk_local(&path, relative, visit)?,
            _ => false,
        };
        relative.pop();
        if stopped {
            return Ok(true);
        }
    }
    Ok(false)
}

impl CopySource for Local {
    fn name(&self) -> Option<&OsStr> {
        self.0.file_name()
    }
    fn kind(&self) -> CopyKind {
        kind_of(&self.0)
    }
    fn modified(&self) -> Option<SystemTime> {
        std::fs::metadata(&self.0)
            .and_then(|meta| meta.modified())
            .ok()
    }
    fn open(&self) -> io::Result<Box<dyn Read + '_>> {
        Ok(Box::new(std::fs::File::open(&self.0)?))
    }
    fn walk(&self, visit: &mut dyn FnMut(CopyStep<'_>) -> CopyFlow) -> io::Result<()> {
        walk_local(&self.0, &mut PathBuf::new(), visit).map(drop)
    }
}

#[test]
fn a_rename_onto_a_taken_name_says_so_unless_asked_to_replace() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/Notes.md", b"notes");
        let old = save(&a, "/Old.md", b"old");
        let refused = a.rename_checked(&space(), &old, None, "notes.MD", false);
        assert!(matches!(refused, Err(DriveError::Exists)), "{refused:?}");
        assert!(a.node_at(&space(), "/Old.md").unwrap().is_some());
        a.rename_checked(&space(), &old, None, "Notes.md", true)
            .unwrap();
        assert!(a.node_at(&space(), "/Old.md").unwrap().is_none());
    });
}

#[test]
fn a_pinned_blob_is_never_evicted() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/Big.bin", b"some bytes to keep");
        settle(&server, &[a.clone()]).await;
        let bytes = a
            .content_range(&space(), "/Big.bin", 5, 5)
            .expect("reads a range");
        assert_eq!(bytes, (b"bytes".to_vec(), 18));
        let pin = a.pin_blob(&sha(b"some bytes to keep"));
        a.set_cache_limit(0);
        a.remove_download(&space(), "/Big.bin").unwrap();
        assert!(a.local_content(&space(), "/Big.bin").unwrap().is_some());
        drop(pin);
        a.remove_download(&space(), "/Big.bin").unwrap();
        assert!(a.local_content(&space(), "/Big.bin").unwrap().is_none());
    });
}

#[test]
fn copying_in_leaves_secrets_behind() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().join("drive"), runtime.handle().clone());
        let source = tempfile::tempdir().unwrap();
        let project = source.path().join("project");
        std::fs::create_dir_all(project.join("keys")).unwrap();
        std::fs::write(project.join("readme.md"), "hello").unwrap();
        std::fs::write(project.join(".env"), "TOKEN=x").unwrap();
        std::fs::write(project.join("keys/server.pem"), "secret").unwrap();
        std::fs::write(project.join(".gitignore"), "*.log\n").unwrap();
        std::fs::write(project.join("run.log"), "noise").unwrap();
        let project = std::fs::canonicalize(project).unwrap();
        let (entry, report) = a.copy_in(&space(), &Local(project.clone()), "/").unwrap();
        assert_eq!(entry.kind, Kind::Folder);
        assert!(a.node_at(&space(), "/project/readme.md").unwrap().is_some());
        assert!(a
            .node_at(&space(), "/project/.gitignore")
            .unwrap()
            .is_some());
        assert!(a.node_at(&space(), "/project/.env").unwrap().is_none());
        assert!(a
            .node_at(&space(), "/project/keys/server.pem")
            .unwrap()
            .is_none());
        assert!(a.node_at(&space(), "/project/run.log").unwrap().is_none());
        assert!(report.skipped >= 3, "{report:?}");

        let single = source.path().join("one.txt");
        std::fs::write(&single, "just one").unwrap();
        let single = std::fs::canonicalize(single).unwrap();
        let (file, _) = a.copy_in(&space(), &Local(single), "/").unwrap();
        assert_eq!(file.kind, Kind::File);
        let secret = std::fs::canonicalize(project.join(".env")).unwrap();
        assert!(a.copy_in(&space(), &Local(secret), "/").is_err());
    });
}

#[test]
fn a_file_over_the_large_file_limit_waits_until_it_is_synced() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().to_path_buf(), runtime.handle().clone());
        a.set_large_file_limit(8);
        save(&a, "/Small.txt", b"small");
        save(&a, "/Big.bin", b"more than eight bytes");
        settle(&server, &[a.clone()]).await;
        assert!(server.item_named("Small.txt").is_some());
        assert!(server.item_named("Big.bin").is_none());
        let waiting = a.entry(&space(), "/Big.bin").unwrap().unwrap();
        assert!(waiting.waits_large);
        assert_eq!(waiting.state, space_drive::LocalState::NotSynced);
        a.sync_large(&space(), "/Big.bin").unwrap();
        settle(&server, &[a.clone()]).await;
        assert!(server.item_named("Big.bin").is_some());
        assert!(!a.entry(&space(), "/Big.bin").unwrap().unwrap().waits_large);
    });
}

#[test]
fn the_root_mistyignore_comes_back_when_deleted_on_the_computer() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().to_path_buf(), runtime.handle().clone());
        let id = save(&a, "/.mistyignore", b"*.log\n");
        settle(&server, &[a.clone()]).await;
        let refused = a.trash(&space(), &id, space_drive::TrashBy::Person);
        assert!(matches!(refused, Err(DriveError::Fixed(_))), "{refused:?}");
        a.trash_from_os(&space(), &id).unwrap();
        settle(&server, &[a.clone()]).await;
        assert!(server.trashed_ids().is_empty());
        assert!(a.node_at(&space(), "/.mistyignore").unwrap().is_some());
    });
}

#[test]
fn heavy_folders_stay_on_the_computer() {
    let runtime = runtime();
    runtime.block_on(async {
        let server = FakeServer::new();
        let dir = tempfile::tempdir().unwrap();
        let ana = server.computer("ana", "Ana", "Ana's Mac");
        let a = server.open_drive(&ana, dir.path().to_path_buf(), runtime.handle().clone());
        save(&a, "/site/package.json", b"{}");
        save(&a, "/site/node_modules/left-pad/index.js", b"pad");
        settle(&server, &[a.clone()]).await;
        assert!(server.item_named("package.json").is_some());
        assert!(server.item_named("index.js").is_none());
        let kept = a
            .entry(&space(), "/site/node_modules/left-pad/index.js")
            .unwrap()
            .unwrap();
        assert_eq!(kept.state, space_drive::LocalState::NotSynced);
    });
}
