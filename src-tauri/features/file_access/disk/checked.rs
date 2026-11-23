use std::{
    ffi::{OsStr, OsString},
    fs::{File, Metadata},
    io,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

use super::{closed, closed_places, disk_allowed, owned_by_person, same_place, sys};
use crate::{paths::normalize_asked, real_path, secrets, Access, POLICY};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ItemKind {
    File,
    Dir,
    Link,
    Other,
}

#[derive(Clone, Debug)]
pub struct DirItem {
    pub name: OsString,
    pub kind: ItemKind,
    pub len: u64,
    pub modified: Option<SystemTime>,
    pub created: Option<SystemTime>,
    pub mode: u32,
    pub ino: u64,
    pub dev: u64,
    pub flags: u32,
}

impl DirItem {
    fn from_stat(name: OsString, stat: sys::Stat) -> Self {
        Self {
            name,
            kind: stat.kind,
            len: stat.len,
            modified: stat.modified,
            created: stat.created,
            mode: stat.mode,
            ino: stat.ino,
            dev: stat.dev,
            flags: stat.flags,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Gate {
    Person,
    Agent,
    App,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Verdict {
    Open,
    Closed(&'static str),
}

const NOT_ALLOWED: &str = "Misty doesn't have access to this location.";
const NO_DISK: &str = "Files hasn't been given access to this computer.";
const AGENT_SECRET: &str = "Agents can't open secrets or keys.";
const MOVED: &str = "That folder moved while Misty was opening it.";
const LINKED: &str = "Links aren't followed here.";
const NOT_YOURS: &str = "That folder belongs to another user of this computer.";

pub(crate) fn policy_allows(real: &Path, access: Access) -> bool {
    POLICY
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .allows(real, access)
}

impl Gate {
    pub(crate) fn verdict(self, real: &Path, access: Access) -> Verdict {
        match self {
            Gate::App => {
                if policy_allows(real, access) {
                    Verdict::Open
                } else {
                    Verdict::Closed(NOT_ALLOWED)
                }
            }
            Gate::Person => {
                if let Some(why) = closed_places().why(real, access) {
                    return Verdict::Closed(why);
                }
                if disk_allowed() || policy_allows(real, access) {
                    Verdict::Open
                } else {
                    Verdict::Closed(NOT_ALLOWED)
                }
            }
            Gate::Agent => {
                if !disk_allowed() {
                    return Verdict::Closed(NO_DISK);
                }
                if let Some(why) = closed_places().why(real, access) {
                    return Verdict::Closed(why);
                }
                if secrets::closed_to_agents(real) {
                    return Verdict::Closed(AGENT_SECRET);
                }
                Verdict::Open
            }
        }
    }

    pub(crate) fn skips_secret(self, name: &OsStr) -> bool {
        match self {
            Gate::Person => name.to_str().is_some_and(|name| {
                secrets::is_secret_file(name) || secrets::is_secret_folder(name)
            }),
            Gate::Agent => name
                .to_str()
                .is_some_and(|name| secrets::closed_to_agents(Path::new(name))),
            Gate::App => false,
        }
    }

    pub(crate) fn admit(self, shown: &Path, real: &Path, access: Access) -> io::Result<()> {
        match self.verdict(real, access) {
            Verdict::Open => Ok(()),
            Verdict::Closed(why) => Err(closed(shown, why)),
        }
    }
}

fn opened(shown: &Path, error: io::Error) -> io::Error {
    if sys::link_error(&error) {
        closed(shown, LINKED)
    } else {
        error
    }
}

fn valid_name(name: &OsStr) -> io::Result<()> {
    let mut parts = Path::new(name).components();
    let single = matches!(
        (parts.next(), parts.next()),
        (Some(Component::Normal(part)), None) if part == name
    );
    if single {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "That name can't be used.",
        ))
    }
}

pub type CheckedFile = std::fs::File;

#[derive(Debug)]
pub struct CheckedDir {
    dir: sys::Dir,
    real: PathBuf,
    gate: Gate,
}

impl CheckedDir {
    pub fn open(path: &Path, access: Access) -> io::Result<CheckedDir> {
        Self::open_with(path, access, Gate::Person)
    }

    pub fn open_for_agent(path: &Path, access: Access) -> io::Result<CheckedDir> {
        Self::open_with(path, access, Gate::Agent)
    }

    pub(crate) fn open_with(path: &Path, access: Access, gate: Gate) -> io::Result<CheckedDir> {
        let asked = normalize_asked(path)?;
        let real = real_path::resolve(&asked)?;
        gate.admit(&asked, &real, access)?;
        if gate == Gate::Agent && access == Access::Write {
            owned_by_person(&real)?;
        }
        let dir = sys::Dir::open_real(&real).map_err(|error| opened(&asked, error))?;
        let handle = CheckedDir { dir, real, gate };
        handle.verify(&asked, Some(access))?;
        Ok(handle)
    }

    pub(crate) fn open_parent(
        path: &Path,
        access: Access,
        gate: Gate,
    ) -> io::Result<(CheckedDir, OsString)> {
        let asked = normalize_asked(path)?;
        let (Some(parent), Some(name)) = (asked.parent(), asked.file_name()) else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "A whole drive can't be used here.",
            ));
        };
        let real = real_path::resolve(parent)?;
        let dir = sys::Dir::open_real(&real).map_err(|error| opened(&asked, error))?;
        let handle = CheckedDir { dir, real, gate };
        handle.verify(&asked, None)?;
        let child = handle.admit_child(name, access)?;
        if gate == Gate::Agent && access == Access::Write {
            owned_by_person(&child)?;
        }
        Ok((handle, name.to_owned()))
    }

    fn verify(&self, shown: &Path, access: Option<Access>) -> io::Result<()> {
        let Some(seen) = self.dir.path()? else {
            return Ok(());
        };
        if seen == self.real {
            return Ok(());
        }
        if !same_place(&seen, &self.real) {
            return Err(closed(shown, MOVED));
        }
        match access {
            Some(access) => self.gate.admit(shown, &seen, access),
            None => Ok(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.real
    }

    pub(crate) fn gate(&self) -> Gate {
        self.gate
    }

    pub(crate) fn sys(&self) -> &sys::Dir {
        &self.dir
    }

    pub(crate) fn admit_child(&self, name: &OsStr, access: Access) -> io::Result<PathBuf> {
        valid_name(name)?;
        let real = self.real.join(name);
        self.gate.admit(&real, &real, access)?;
        Ok(real)
    }

    pub(crate) fn stat_at(&self, name: &OsStr) -> io::Result<sys::Stat> {
        valid_name(name)?;
        self.dir.stat_at(name)
    }

    pub fn child(&self, name: &OsStr, access: Access) -> io::Result<CheckedDir> {
        let real = self.admit_child(name, access)?;
        let dir = self.dir.open_dir(name).map_err(|error| {
            let link = self
                .dir
                .stat_at(name)
                .is_ok_and(|stat| stat.kind == ItemKind::Link);
            if link {
                closed(&real, LINKED)
            } else {
                opened(&real, error)
            }
        })?;
        #[cfg(unix)]
        if self.gate == Gate::Agent && access == Access::Write {
            // SAFETY: getuid has no preconditions and can't fail.
            let me = unsafe { libc::getuid() };
            if dir.stat()?.uid != me {
                return Err(closed(&real, NOT_YOURS));
            }
        }
        let child = CheckedDir {
            dir,
            real,
            gate: self.gate,
        };
        child.verify(&child.real, Some(access))?;
        Ok(child)
    }

    pub fn open_file(&self, name: &OsStr) -> io::Result<File> {
        let real = self.admit_child(name, Access::Read)?;
        let file = self
            .dir
            .open_file(name)
            .map_err(|error| opened(&real, error))?;
        if !file.metadata()?.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "That isn't a file.",
            ));
        }
        if let Some(seen) = sys::file_path(&file)? {
            if seen != real {
                self.gate.admit(&real, &seen, Access::Read)?;
            }
        }
        Ok(file)
    }

    pub fn create_file(&self, name: &OsStr) -> io::Result<File> {
        let real = self.admit_child(name, Access::Write)?;
        self.dir
            .create_file(name, 0o666)
            .map_err(|error| opened(&real, error))
    }

    pub fn create_dir(&self, name: &OsStr) -> io::Result<()> {
        self.admit_child(name, Access::Write)?;
        self.dir.mkdir(name, 0o777)
    }

    pub fn metadata(&self, name: &OsStr) -> io::Result<Metadata> {
        let real = self.admit_child(name, Access::Read)?;
        let stat = self.dir.stat_at(name)?;
        let meta = std::fs::symlink_metadata(&real)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if meta.ino() != stat.ino || meta.dev() != stat.dev {
                return Err(closed(&real, MOVED));
            }
        }
        #[cfg(not(unix))]
        let _ = stat;
        Ok(meta)
    }

    pub fn read_dir(&self) -> io::Result<Vec<DirItem>> {
        let mut items = Vec::new();
        for name in self.dir.names()? {
            match self.dir.stat_at(&name) {
                Ok(stat) => items.push(DirItem::from_stat(name, stat)),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(items)
    }

    pub fn read_link(&self, name: &OsStr) -> io::Result<PathBuf> {
        self.admit_child(name, Access::Read)?;
        self.dir.read_link(name)
    }

    pub fn remove_file(&self, name: &OsStr) -> io::Result<()> {
        let real = self.admit_child(name, Access::Write)?;
        if self.dir.stat_at(name)?.kind == ItemKind::Dir {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "That's a folder.",
            ));
        }
        self.dir.unlink(name).map_err(|error| opened(&real, error))
    }

    pub fn remove_dir(&self, name: &OsStr) -> io::Result<()> {
        let real = self.admit_child(name, Access::Write)?;
        if self.gate != Gate::App {
            if let Some(why) = closed_places().inside(&real) {
                return Err(closed(&real, why));
            }
        }
        self.dir.rmdir(name)
    }
}
