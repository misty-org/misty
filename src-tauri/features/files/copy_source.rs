use std::ffi::OsStr;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use file_access::disk::fs_disk;
use file_access::disk::walk::{walk, WalkFlow, WalkFor};
use file_access::disk::{CheckedDir, ItemKind};
use file_access::Access;
use space_drive::{CopyFlow, CopyFolder, CopyKind, CopySource, CopyStep};

pub(crate) struct LocalCopy {
    path: PathBuf,
    kind: CopyKind,
    modified: Option<SystemTime>,
}

struct Folder<'a>(&'a CheckedDir);

impl CopyFolder for Folder<'_> {
    fn open(&self, name: &OsStr) -> io::Result<Box<dyn Read + '_>> {
        Ok(Box::new(self.0.open_file(name)?))
    }
}

fn kind_of(kind: ItemKind) -> CopyKind {
    match kind {
        ItemKind::File => CopyKind::File,
        ItemKind::Dir => CopyKind::Folder,
        ItemKind::Link | ItemKind::Other => CopyKind::Other,
    }
}

fn flow_of(flow: CopyFlow) -> WalkFlow {
    match flow {
        CopyFlow::Continue => WalkFlow::Continue,
        CopyFlow::SkipFolder => WalkFlow::SkipDir,
        CopyFlow::Stop => WalkFlow::Stop,
    }
}

pub(crate) fn real_local(asked: &Path) -> io::Result<(PathBuf, CopyKind)> {
    let real = fs_disk::canonicalize(asked)?;
    let kind = if fs_disk::is_dir(&real) {
        CopyKind::Folder
    } else if fs_disk::is_file(&real) {
        CopyKind::File
    } else {
        CopyKind::Other
    };
    Ok((real, kind))
}

impl LocalCopy {
    pub(crate) fn open(path: &Path) -> Result<LocalCopy, String> {
        let meta = fs_disk::symlink_metadata(path).map_err(|error| error.to_string())?;
        let kind = if meta.is_file() {
            CopyKind::File
        } else if meta.is_dir() {
            CopyKind::Folder
        } else {
            CopyKind::Other
        };
        Ok(LocalCopy {
            path: path.to_path_buf(),
            kind,
            modified: meta.modified().ok(),
        })
    }
}

impl CopySource for LocalCopy {
    fn name(&self) -> Option<&OsStr> {
        self.path.file_name()
    }

    fn kind(&self) -> CopyKind {
        self.kind
    }

    fn modified(&self) -> Option<SystemTime> {
        self.modified
    }

    fn open(&self) -> io::Result<Box<dyn Read + '_>> {
        let (folder, name) = super::gated::parent(&self.path, Access::Read)?;
        Ok(Box::new(folder.open_file(&name)?))
    }

    fn walk(&self, visit: &mut dyn FnMut(CopyStep<'_>) -> CopyFlow) -> io::Result<()> {
        walk(&self.path, Access::Read, WalkFor::Person, &mut |step| {
            let flow = visit(CopyStep {
                folder: &Folder(step.dir),
                relative: step.relative,
                name: &step.item.name,
                kind: kind_of(step.item.kind),
                modified: step.item.modified,
            });
            Ok(flow_of(flow))
        })
    }
}
