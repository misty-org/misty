//! The Linux face: each Space is a FUSE file system at `~/.misty/mnt/<Space>` (`mnt-dev` in debug
//! builds), answered by Misty through `fuser` (MIT). It holds names only: listing and lookup read
//! `drive.db`; a read fetches the file into the content cache first. Every open, write and close
//! passes through here, so in-use marks are exact: an open for writing is editing. Nothing is
//! ever made read-only: two computers' saves merge or the last one wins. Writes gather in a work
//! file and become the item's new content on `fsync` and on the last close; `unlink`
//! and `rmdir` are trash moves, `rename` a move.
//!
//! `fuser` runs one session thread per mount. A call that has to wait for the network (opening a
//! file not downloaded yet, or the in-use mark) blocks that Space's file system meanwhile; other
//! Spaces and the rest of Misty go on.
use std::{
    collections::HashMap,
    ffi::OsStr,
    io::Write,
    os::unix::fs::FileExt,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use fuser::{
    FileAttr, FileType, Filesystem, KernelConfig, MountOption, ReplyAttr, ReplyCreate, ReplyData,
    ReplyDirectory, ReplyEmpty, ReplyEntry, ReplyOpen, ReplyStatfs, ReplyWrite, Request,
    TimeOrNow,
};

use crate::{
    lock, Drive, DriveError, Item, ItemId, Kind, NewNode, Node, OsFace, SpaceId, SpaceMount,
};

/// How long the kernel may keep names and attributes before asking again. Short, so changes from
/// the server show within a second.
const TTL: Duration = Duration::from_secs(1);
const ROOT_INO: u64 = 1;
const BLOCK: u32 = 4096;

/// The face of every Space on this computer: one FUSE mount each.
pub struct FuseFace {
    drive: Drive,
    sessions: Mutex<HashMap<SpaceId, fuser::BackgroundSession>>,
}

impl FuseFace {
    pub fn new(drive: Drive) -> Arc<Self> {
        Arc::new(Self {
            drive,
            sessions: Mutex::new(HashMap::new()),
        })
    }
}

/// A mount left behind by a Misty that didn't quit cleanly answers "transport endpoint is not
/// connected"; `fusermount3 -u -z` takes it down so the Space can mount again.
fn clear_stale_mount(path: &std::path::Path) {
    if let Err(error) = file_access::fs::metadata(path) {
        if error.raw_os_error() == Some(libc::ENOTCONN) {
            let _ = std::process::Command::new("fusermount3")
                .arg("-u")
                .arg("-z")
                .arg(path)
                .status();
        }
    }
}

impl OsFace for FuseFace {
    fn mount(&self, space: &SpaceMount) -> Result<(), DriveError> {
        clear_stale_mount(&space.path);
        file_access::fs::create_dir_all(&space.path).map_err(DriveError::io)?;
        let fs = DriveFs {
            drive: self.drive.clone(),
            space: space.space.clone(),
            handles: HashMap::new(),
            next_handle: 1,
            uid: unsafe { libc::getuid() },
            gid: unsafe { libc::getgid() },
        };
        let options = [
            MountOption::FSName("misty".to_owned()),
            MountOption::Subtype("misty-drive".to_owned()),
            MountOption::DefaultPermissions,
            MountOption::NoAtime,
            MountOption::RW,
        ];
        let session = fuser::spawn_mount2(fs, &space.path, &options).map_err(|error| {
            DriveError::Face(format!(
                "Misty couldn't mount the drive. Check that fuse3 is installed. ({error})"
            ))
        })?;
        lock(&self.sessions).insert(space.space.clone(), session);
        Ok(())
    }

    fn unmount(&self, space: &SpaceId) -> Result<(), DriveError> {
        // Dropping the session unmounts it.
        let session = lock(&self.sessions).remove(space);
        drop(session);
        Ok(())
    }

    fn changed(&self, _space: &SpaceId, _items: &[Item]) {
        // Names and attributes live for `TTL`, then the kernel asks again.
    }

    fn evict(&self, _space: &SpaceId, _item: &ItemId) -> Result<(), DriveError> {
        // Content lives in the cache, which the drive frees itself.
        Ok(())
    }
}

struct Handle {
    id: ItemId,
    file: Option<file_access::fs::File>,
    /// Writes gather here; `None` for a read.
    work: Option<std::path::PathBuf>,
    dirty: bool,
    editing: bool,
}

struct DriveFs {
    drive: Drive,
    space: SpaceId,
    handles: HashMap<u64, Handle>,
    next_handle: u64,
    uid: u32,
    gid: u32,
}

fn time_of(ms: i64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(ms.max(0) as u64)
}

fn ms_of(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

impl DriveFs {
    fn errno(error: &DriveError) -> i32 {
        error.errno()
    }

    fn attr_of(&self, node: &Node) -> FileAttr {
        let folder = node.kind == Kind::Folder;
        let at = time_of(node.mtime_ms);
        let perm = if folder { 0o755 } else { 0o644 };
        FileAttr {
            ino: node.ino + 1,
            size: node.size,
            blocks: node.size.div_ceil(512),
            atime: at,
            mtime: at,
            ctime: at,
            crtime: at,
            kind: if folder {
                FileType::Directory
            } else {
                FileType::RegularFile
            },
            perm,
            nlink: if folder { 2 } else { 1 },
            uid: self.uid,
            gid: self.gid,
            rdev: 0,
            blksize: BLOCK,
            flags: 0,
        }
    }

    fn root_attr(&self) -> FileAttr {
        let at = SystemTime::now();
        FileAttr {
            ino: ROOT_INO,
            size: 0,
            blocks: 0,
            atime: at,
            mtime: at,
            ctime: at,
            crtime: at,
            kind: FileType::Directory,
            perm: 0o755,
            nlink: 2,
            uid: self.uid,
            gid: self.gid,
            rdev: 0,
            blksize: BLOCK,
            flags: 0,
        }
    }

    /// The node behind an inode, if it is this Space's.
    fn node(&self, ino: u64) -> Result<Node, i32> {
        if ino == ROOT_INO {
            return Err(libc::EISDIR);
        }
        match self.drive.node_by_ino(ino - 1) {
            Ok(Some(node)) if node.space == self.space => Ok(node),
            Ok(_) => Err(libc::ENOENT),
            Err(error) => Err(Self::errno(&error)),
        }
    }

    /// The folder an inode names: `None` for the root.
    fn folder(&self, ino: u64) -> Result<Option<ItemId>, i32> {
        if ino == ROOT_INO {
            return Ok(None);
        }
        let node = self.node(ino)?;
        if node.kind != Kind::Folder {
            return Err(libc::ENOTDIR);
        }
        Ok(Some(node.id))
    }

    fn child(&self, parent: u64, name: &OsStr) -> Result<Node, i32> {
        let folder = self.folder(parent)?;
        let name = name.to_str().ok_or(libc::EINVAL)?;
        match self.drive.lookup(&self.space, folder.as_ref(), name) {
            Ok(Some(node)) => Ok(node),
            Ok(None) => Err(libc::ENOENT),
            Err(error) => Err(Self::errno(&error)),
        }
    }

    fn add_handle(&mut self, handle: Handle) -> u64 {
        let fh = self.next_handle;
        self.next_handle += 1;
        self.handles.insert(fh, handle);
        fh
    }

    /// Opens `node` for writing: its content is copied into a work file (empty when truncated).
    fn open_for_writing(&mut self, node: &Node, truncate: bool) -> Result<u64, i32> {
        self.drive
            .block_on(self.drive.open(&self.space, &node.id, true))
            .map_err(|error| Self::errno(&error))?;
        let fh = self.next_handle;
        let work = self.drive.work_path(node.ino, fh);
        let prepared = (|| -> Result<file_access::fs::File, DriveError> {
            if !truncate && node.size > 0 {
                let cached = self.drive.block_on(self.drive.content(&self.space, &node.id))?;
                file_access::fs::copy(&cached, &work).map_err(DriveError::io)?;
            } else {
                file_access::fs::File::create(&work).map_err(DriveError::io)?;
            }
            file_access::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&work)
                .map_err(DriveError::io)
        })();
        match prepared {
            Ok(file) => Ok(self.add_handle(Handle {
                id: node.id.clone(),
                file: Some(file),
                work: Some(work),
                dirty: truncate && node.size > 0,
                editing: true,
            })),
            Err(error) => {
                self.drive
                    .block_on(self.drive.close(&self.space, &node.id, true));
                Err(Self::errno(&error))
            }
        }
    }

    /// `unlink` and `rmdir`: a trash move in the Space. It doesn't wait for the server, since
    /// `rm -r` unlinks every file one by one and each answer waits on every computer's in-use
    /// check: the item leaves at once, and if the server refuses (someone has it open) it comes
    /// back with a notice that says why. Past the delete guard's limit it stays (`EPERM`).
    fn trash(&self, node: &Node) -> Result<(), i32> {
        self.drive
            .trash_from_os(&self.space, &node.id)
            .map_err(|error| Self::errno(&error))
    }

    /// Hands a handle's gathered writes to the drive as the item's new content.
    fn commit(&mut self, fh: u64) -> Result<(), i32> {
        let Some(handle) = self.handles.get_mut(&fh) else {
            return Ok(());
        };
        if !handle.dirty {
            return Ok(());
        }
        let Some(work) = handle.work.clone() else {
            return Ok(());
        };
        if let Some(file) = handle.file.as_mut() {
            file.flush().map_err(|_| libc::EIO)?;
        }
        let staged = self.drive.temp_path();
        file_access::fs::copy(&work, &staged).map_err(|_| libc::EIO)?;
        let id = handle.id.clone();
        handle.dirty = false;
        let mtime = ms_of(SystemTime::now());
        self.drive
            .write(&self.space, &id, &staged, mtime)
            .map(|_| ())
            .map_err(|error| Self::errno(&error))
    }
}

impl Filesystem for DriveFs {
    fn init(&mut self, _req: &Request<'_>, _config: &mut KernelConfig) -> Result<(), libc::c_int> {
        Ok(())
    }

    fn lookup(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEntry) {
        match self.child(parent, name) {
            Ok(node) => reply.entry(&TTL, &self.attr_of(&node), 0),
            Err(errno) => reply.error(errno),
        }
    }

    fn getattr(&mut self, _req: &Request<'_>, ino: u64, _fh: Option<u64>, reply: ReplyAttr) {
        if ino == ROOT_INO {
            return reply.attr(&TTL, &self.root_attr());
        }
        match self.node(ino) {
            Ok(node) => reply.attr(&TTL, &self.attr_of(&node)),
            Err(errno) => reply.error(errno),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn setattr(
        &mut self,
        _req: &Request<'_>,
        ino: u64,
        _mode: Option<u32>,
        _uid: Option<u32>,
        _gid: Option<u32>,
        size: Option<u64>,
        _atime: Option<TimeOrNow>,
        _mtime: Option<TimeOrNow>,
        _ctime: Option<SystemTime>,
        fh: Option<u64>,
        _crtime: Option<SystemTime>,
        _chgtime: Option<SystemTime>,
        _bkuptime: Option<SystemTime>,
        _flags: Option<u32>,
        reply: ReplyAttr,
    ) {
        if ino == ROOT_INO {
            return reply.attr(&TTL, &self.root_attr());
        }
        let node = match self.node(ino) {
            Ok(node) => node,
            Err(errno) => return reply.error(errno),
        };
        if let Some(size) = size {
            if node.kind == Kind::Folder {
                return reply.error(libc::EISDIR);
            }
            let open_handle = fh.filter(|fh| {
                self.handles
                    .get(fh)
                    .is_some_and(|handle| handle.work.is_some())
            });
            let result = match open_handle {
                Some(fh) => {
                    let handle = self.handles.get_mut(&fh).expect("checked above");
                    let truncated = handle
                        .file
                        .as_ref()
                        .map(|file| file.set_len(size))
                        .transpose()
                        .map_err(|_| libc::EIO);
                    handle.dirty = true;
                    truncated.map(|_| ())
                }
                None => {
                    // `truncate(2)` with no open file: open, cut, commit, close.
                    match self.open_for_writing(&node, size == 0) {
                        Ok(fh) => {
                            let cut = self
                                .handles
                                .get_mut(&fh)
                                .and_then(|handle| {
                                    handle.dirty = true;
                                    handle.file.as_ref().map(|file| file.set_len(size))
                                })
                                .transpose()
                                .map_err(|_| libc::EIO)
                                .and_then(|_| self.commit(fh));
                            if let Some(handle) = self.handles.remove(&fh) {
                                if let Some(work) = handle.work {
                                    let _ = file_access::fs::remove_file(work);
                                }
                            }
                            self.drive
                                .block_on(self.drive.close(&self.space, &node.id, true));
                            cut
                        }
                        Err(errno) => Err(errno),
                    }
                }
            };
            if let Err(errno) = result {
                return reply.error(errno);
            }
            let mut attr = self.attr_of(&node);
            attr.size = size;
            return reply.attr(&TTL, &attr);
        }
        match self.node(ino) {
            Ok(node) => reply.attr(&TTL, &self.attr_of(&node)),
            Err(errno) => reply.error(errno),
        }
    }

    fn mkdir(
        &mut self,
        _req: &Request<'_>,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        reply: ReplyEntry,
    ) {
        let folder = match self.folder(parent) {
            Ok(folder) => folder,
            Err(errno) => return reply.error(errno),
        };
        let Some(name) = name.to_str() else {
            return reply.error(libc::EINVAL);
        };
        let made = self.drive.create(
            &self.space,
            NewNode {
                parent: folder,
                name: name.to_owned(),
                kind: Kind::Folder,
                content: None,
                mtime_ms: ms_of(SystemTime::now()),
                id: None,
            },
        );
        match made {
            Ok(node) => reply.entry(&TTL, &self.attr_of(&node), 0),
            Err(error) => reply.error(Self::errno(&error)),
        }
    }

    fn unlink(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let node = match self.child(parent, name) {
            Ok(node) => node,
            Err(errno) => return reply.error(errno),
        };
        if node.kind == Kind::Folder {
            return reply.error(libc::EISDIR);
        }
        match self.trash(&node) {
            Ok(()) => reply.ok(),
            Err(errno) => reply.error(errno),
        }
    }

    fn rmdir(&mut self, _req: &Request<'_>, parent: u64, name: &OsStr, reply: ReplyEmpty) {
        let node = match self.child(parent, name) {
            Ok(node) => node,
            Err(errno) => return reply.error(errno),
        };
        if node.kind != Kind::Folder {
            return reply.error(libc::ENOTDIR);
        }
        match self.drive.list(&self.space, Some(&node.id)) {
            Ok(children) if !children.is_empty() => return reply.error(libc::ENOTEMPTY),
            Ok(_) => {}
            Err(error) => return reply.error(Self::errno(&error)),
        }
        match self.trash(&node) {
            Ok(()) => reply.ok(),
            Err(errno) => reply.error(errno),
        }
    }

    fn rename(
        &mut self,
        _req: &Request<'_>,
        parent: u64,
        name: &OsStr,
        newparent: u64,
        newname: &OsStr,
        flags: u32,
        reply: ReplyEmpty,
    ) {
        // RENAME_EXCHANGE has no meaning for a drive item's identity.
        const RENAME_NOREPLACE: u32 = 1;
        const RENAME_EXCHANGE: u32 = 2;
        if flags & RENAME_EXCHANGE != 0 {
            return reply.error(libc::EINVAL);
        }
        let node = match self.child(parent, name) {
            Ok(node) => node,
            Err(errno) => return reply.error(errno),
        };
        let folder = match self.folder(newparent) {
            Ok(folder) => folder,
            Err(errno) => return reply.error(errno),
        };
        let Some(newname) = newname.to_str() else {
            return reply.error(libc::EINVAL);
        };
        if flags & RENAME_NOREPLACE != 0
            && self
                .drive
                .lookup(&self.space, folder.as_ref(), newname)
                .ok()
                .flatten()
                .is_some_and(|other| other.id != node.id)
        {
            return reply.error(libc::EEXIST);
        }
        match self
            .drive
            .rename(&self.space, &node.id, folder.as_ref(), newname)
        {
            Ok(_) => reply.ok(),
            Err(error) => reply.error(Self::errno(&error)),
        }
    }

    fn open(&mut self, _req: &Request<'_>, ino: u64, flags: i32, reply: ReplyOpen) {
        let node = match self.node(ino) {
            Ok(node) => node,
            Err(errno) => return reply.error(errno),
        };
        if node.kind == Kind::Folder {
            return reply.error(libc::EISDIR);
        }
        let writing = flags & libc::O_ACCMODE != libc::O_RDONLY;
        if writing {
            return match self.open_for_writing(&node, flags & libc::O_TRUNC != 0) {
                Ok(fh) => reply.opened(fh, 0),
                Err(errno) => reply.error(errno),
            };
        }
        if let Err(error) = self
            .drive
            .block_on(self.drive.open(&self.space, &node.id, false))
        {
            // Nothing was opened, so there is nothing to close.
            return reply.error(Self::errno(&error));
        }
        let opened = (|| -> Result<file_access::fs::File, DriveError> {
            let cached = self.drive.block_on(self.drive.content(&self.space, &node.id))?;
            file_access::fs::File::open(cached).map_err(DriveError::io)
        })();
        match opened {
            Ok(file) => {
                let fh = self.add_handle(Handle {
                    id: node.id.clone(),
                    file: Some(file),
                    work: None,
                    dirty: false,
                    editing: false,
                });
                reply.opened(fh, 0);
            }
            Err(error) => {
                self.drive
                    .block_on(self.drive.close(&self.space, &node.id, false));
                reply.error(Self::errno(&error));
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn read(
        &mut self,
        _req: &Request<'_>,
        _ino: u64,
        fh: u64,
        offset: i64,
        size: u32,
        _flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyData,
    ) {
        let Some(file) = self.handles.get(&fh).and_then(|handle| handle.file.as_ref()) else {
            return reply.error(libc::EBADF);
        };
        let mut buffer = vec![0u8; size as usize];
        let mut filled = 0usize;
        let start = offset.max(0) as u64;
        while filled < buffer.len() {
            match file.read_at(&mut buffer[filled..], start + filled as u64) {
                Ok(0) => break,
                Ok(count) => filled += count,
                Err(_) => return reply.error(libc::EIO),
            }
        }
        reply.data(&buffer[..filled]);
    }

    #[allow(clippy::too_many_arguments)]
    fn write(
        &mut self,
        _req: &Request<'_>,
        _ino: u64,
        fh: u64,
        offset: i64,
        data: &[u8],
        _write_flags: u32,
        _flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyWrite,
    ) {
        let Some(handle) = self.handles.get_mut(&fh) else {
            return reply.error(libc::EBADF);
        };
        if handle.work.is_none() {
            return reply.error(libc::EBADF);
        }
        let Some(file) = handle.file.as_ref() else {
            return reply.error(libc::EBADF);
        };
        match file.write_all_at(data, offset.max(0) as u64) {
            Ok(()) => {
                handle.dirty = true;
                reply.written(data.len() as u32);
            }
            Err(_) => reply.error(libc::EIO),
        }
    }

    fn flush(&mut self, _req: &Request<'_>, _ino: u64, fh: u64, _lock_owner: u64, reply: ReplyEmpty) {
        match self.commit(fh) {
            Ok(()) => reply.ok(),
            Err(errno) => reply.error(errno),
        }
    }

    fn fsync(&mut self, _req: &Request<'_>, _ino: u64, fh: u64, _datasync: bool, reply: ReplyEmpty) {
        match self.commit(fh) {
            Ok(()) => reply.ok(),
            Err(errno) => reply.error(errno),
        }
    }

    fn release(
        &mut self,
        _req: &Request<'_>,
        _ino: u64,
        fh: u64,
        _flags: i32,
        _lock_owner: Option<u64>,
        _flush: bool,
        reply: ReplyEmpty,
    ) {
        let committed = self.commit(fh);
        if let Some(handle) = self.handles.remove(&fh) {
            drop(handle.file);
            if let Some(work) = handle.work {
                let _ = file_access::fs::remove_file(work);
            }
            self.drive
                .block_on(self.drive.close(&self.space, &handle.id, handle.editing));
        }
        match committed {
            Ok(()) => reply.ok(),
            Err(errno) => reply.error(errno),
        }
    }

    fn create(
        &mut self,
        _req: &Request<'_>,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        _flags: i32,
        reply: ReplyCreate,
    ) {
        let folder = match self.folder(parent) {
            Ok(folder) => folder,
            Err(errno) => return reply.error(errno),
        };
        let Some(name) = name.to_str() else {
            return reply.error(libc::EINVAL);
        };
        let made = self.drive.create(
            &self.space,
            NewNode {
                parent: folder,
                name: name.to_owned(),
                kind: Kind::File,
                content: None,
                mtime_ms: ms_of(SystemTime::now()),
                id: None,
            },
        );
        let node = match made {
            Ok(node) => node,
            Err(error) => return reply.error(Self::errno(&error)),
        };
        match self.open_for_writing(&node, true) {
            Ok(fh) => reply.created(&TTL, &self.attr_of(&node), 0, fh, 0),
            Err(errno) => reply.error(errno),
        }
    }

    fn opendir(&mut self, _req: &Request<'_>, ino: u64, _flags: i32, reply: ReplyOpen) {
        match self.folder(ino) {
            Ok(_) => reply.opened(0, 0),
            Err(errno) => reply.error(errno),
        }
    }

    fn readdir(
        &mut self,
        _req: &Request<'_>,
        ino: u64,
        _fh: u64,
        offset: i64,
        mut reply: ReplyDirectory,
    ) {
        let folder = match self.folder(ino) {
            Ok(folder) => folder,
            Err(errno) => return reply.error(errno),
        };
        let children = match self.drive.list(&self.space, folder.as_ref()) {
            Ok(children) => children,
            Err(error) => return reply.error(Self::errno(&error)),
        };
        let parent_ino = match &folder {
            None => ROOT_INO,
            Some(id) => self
                .drive
                .node(&self.space, id)
                .ok()
                .flatten()
                .and_then(|node| node.parent)
                .and_then(|parent| self.drive.node(&self.space, &parent).ok().flatten())
                .map(|node| node.ino + 1)
                .unwrap_or(ROOT_INO),
        };
        let mut entries: Vec<(u64, FileType, String)> = vec![
            (ino, FileType::Directory, ".".to_owned()),
            (parent_ino, FileType::Directory, "..".to_owned()),
        ];
        entries.extend(children.into_iter().map(|node| {
            let kind = if node.kind == Kind::Folder {
                FileType::Directory
            } else {
                FileType::RegularFile
            };
            (node.ino + 1, kind, node.name)
        }));
        for (index, (entry_ino, kind, name)) in entries
            .into_iter()
            .enumerate()
            .skip(offset.max(0) as usize)
        {
            if reply.add(entry_ino, (index + 1) as i64, kind, name) {
                break;
            }
        }
        reply.ok();
    }

    fn releasedir(&mut self, _req: &Request<'_>, _ino: u64, _fh: u64, _flags: i32, reply: ReplyEmpty) {
        reply.ok();
    }

    fn statfs(&mut self, _req: &Request<'_>, _ino: u64, reply: ReplyStatfs) {
        // The Space's room is the server's to count; this keeps file managers from saying full.
        let blocks = 1u64 << 32;
        reply.statfs(blocks, blocks, blocks, 1 << 24, 1 << 24, BLOCK, 255, BLOCK);
    }

    fn access(&mut self, _req: &Request<'_>, _ino: u64, _mask: i32, reply: ReplyEmpty) {
        reply.ok();
    }
}
