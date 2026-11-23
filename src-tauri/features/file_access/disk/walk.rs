use std::{
    ffi::OsStr,
    io,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

use super::checked::{CheckedDir, DirItem, Gate, ItemKind, Verdict};
use super::place::{cancelled, copy_file, is_cancelled};
use super::{closed, closed_places};
use crate::Access;

const MAX_DEPTH: usize = 512;
const LINK_OUTSIDE: &str = "Links that point outside the folder aren't copied.";
const SECRET: &str = "Secrets and keys aren't copied.";
const ODD_KIND: &str = "Only files, folders and links are copied.";
const AGENT_SECRETS_INSIDE: &str = "Agents can't remove a folder that holds secrets or keys.";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WalkFor {
    Person,
    Agent,
}

impl WalkFor {
    fn gate(self) -> Gate {
        match self {
            WalkFor::Person => Gate::Person,
            WalkFor::Agent => Gate::Agent,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WalkFlow {
    Continue,
    SkipDir,
    Stop,
}

pub struct WalkStep<'a> {
    pub dir: &'a CheckedDir,
    pub item: &'a DirItem,
    pub depth: usize,
    pub relative: &'a Path,
}

#[derive(Debug, Default)]
pub struct CopyOutcome {
    pub bytes: u64,
    pub items: u64,
    pub skipped: Vec<(PathBuf, String)>,
    pub cancelled: bool,
}

fn too_deep() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "That folder is nested too deeply.",
    )
}

fn skippable(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
    )
}

fn unreadable(error: &io::Error) -> bool {
    !is_cancelled(error) && error.kind() != io::ErrorKind::Interrupted
}

fn items_of(dir: &CheckedDir, depth: usize) -> io::Result<Option<Vec<DirItem>>> {
    match dir.read_dir() {
        Ok(items) => Ok(Some(items)),
        Err(error) if depth > 0 && unreadable(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

fn shut(dir: &CheckedDir, item: &DirItem, access: Access) -> Option<&'static str> {
    match dir.gate().verdict(&dir.path().join(&item.name), access) {
        Verdict::Open => None,
        Verdict::Closed(why) => Some(why),
    }
}

pub fn walk(
    root: &Path,
    access: Access,
    who: WalkFor,
    visit: &mut dyn FnMut(WalkStep<'_>) -> io::Result<WalkFlow>,
) -> io::Result<()> {
    let dir = CheckedDir::open_with(root, access, who.gate())?;
    let mut relative = PathBuf::new();
    walk_dir(&dir, access, 0, &mut relative, visit).map(drop)
}

fn walk_dir(
    dir: &CheckedDir,
    access: Access,
    depth: usize,
    relative: &mut PathBuf,
    visit: &mut dyn FnMut(WalkStep<'_>) -> io::Result<WalkFlow>,
) -> io::Result<bool> {
    if depth > MAX_DEPTH {
        return Err(too_deep());
    }
    let Some(items) = items_of(dir, depth)? else {
        return Ok(false);
    };
    for item in items {
        if shut(dir, &item, access).is_some() {
            continue;
        }
        relative.push(&item.name);
        let flow = visit(WalkStep {
            dir,
            item: &item,
            depth,
            relative: relative.as_path(),
        });
        let flow = match flow {
            Ok(flow) => flow,
            Err(error) => {
                relative.pop();
                return Err(error);
            }
        };
        let mut stopped = flow == WalkFlow::Stop;
        if flow == WalkFlow::Continue && item.kind == ItemKind::Dir {
            match dir.child(&item.name, access) {
                Ok(child) => match walk_dir(&child, access, depth + 1, relative, visit) {
                    Ok(stop) => stopped = stop,
                    Err(error) => {
                        relative.pop();
                        return Err(error);
                    }
                },
                Err(error) if unreadable(&error) => {}
                Err(error) => {
                    relative.pop();
                    return Err(error);
                }
            }
        }
        relative.pop();
        if stopped {
            return Ok(true);
        }
    }
    Ok(false)
}

fn link_stays_inside(depth: usize, target: &Path) -> bool {
    let mut level = depth;
    for part in target.components() {
        match part {
            Component::Normal(_) => level += 1,
            Component::CurDir => {}
            Component::ParentDir => {
                if level == 0 {
                    return false;
                }
                level -= 1;
            }
            Component::RootDir | Component::Prefix(_) => return false,
        }
    }
    true
}

fn finish_dir(dir: &CheckedDir, mode: u32, modified: Option<SystemTime>) {
    let _ = dir.sys().set_mode(mode & 0o1777);
    if let Some(modified) = modified {
        let _ = dir.sys().set_modified(modified);
    }
}

struct Copier<'a> {
    gate: Gate,
    outcome: CopyOutcome,
    progress: &'a mut dyn FnMut(u64, &Path) -> bool,
}

impl Copier<'_> {
    fn skip(&mut self, path: PathBuf, why: &str) {
        self.outcome.skipped.push((path, why.to_owned()));
    }

    fn dir(&mut self, source: &CheckedDir, target: &CheckedDir, depth: usize) -> io::Result<()> {
        if depth > MAX_DEPTH {
            return Err(too_deep());
        }
        let items = match source.read_dir() {
            Ok(items) => items,
            Err(error) if depth > 0 && unreadable(&error) => {
                self.skip(source.path().to_path_buf(), &error.to_string());
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        for item in items {
            let from = source.path().join(&item.name);
            if let Some(why) = shut(source, &item, Access::Read) {
                self.skip(from, why);
                continue;
            }
            if self.gate.skips_secret(&item.name) {
                self.skip(from, SECRET);
                continue;
            }
            if let Some(why) = shut(target, &item, Access::Write) {
                self.skip(from, why);
                continue;
            }
            if !(self.progress)(0, &from) {
                return Err(cancelled());
            }
            match item.kind {
                ItemKind::Dir => {
                    let inner = match source.child(&item.name, Access::Read) {
                        Ok(inner) => inner,
                        Err(error) if unreadable(&error) => {
                            self.skip(from, &error.to_string());
                            continue;
                        }
                        Err(error) => return Err(error),
                    };
                    target.create_dir(&item.name)?;
                    let made = target.child(&item.name, Access::Write)?;
                    self.dir(&inner, &made, depth + 1)?;
                    finish_dir(&made, item.mode, item.modified);
                    self.outcome.items += 1;
                }
                ItemKind::File => {
                    let progress = &mut *self.progress;
                    let copied = copy_file(source, &item.name, target, &item.name, &mut |bytes| {
                        progress(bytes, &from)
                    });
                    match copied {
                        Ok(bytes) => {
                            self.outcome.bytes += bytes;
                            self.outcome.items += 1;
                        }
                        Err(error) if !is_cancelled(&error) && skippable(&error) => {
                            self.skip(from, &error.to_string());
                        }
                        Err(error) => return Err(error),
                    }
                }
                ItemKind::Link => {
                    let points = source.read_link(&item.name)?;
                    if self.gate == Gate::App || link_stays_inside(depth, &points) {
                        target.sys().symlink(&points, &item.name, &from)?;
                        self.outcome.items += 1;
                    } else {
                        self.skip(from, LINK_OUTSIDE);
                    }
                }
                ItemKind::Other => self.skip(from, ODD_KIND),
            }
        }
        Ok(())
    }
}

pub fn copy_tree_checked(
    from: &Path,
    to_dir: &Path,
    to_name: &OsStr,
    who: WalkFor,
    progress: &mut dyn FnMut(u64, &Path) -> bool,
) -> io::Result<CopyOutcome> {
    copy_tree_with(from, to_dir, to_name, who.gate(), progress)
}

pub(crate) fn copy_tree_with(
    from: &Path,
    to_dir: &Path,
    to_name: &OsStr,
    gate: Gate,
    progress: &mut dyn FnMut(u64, &Path) -> bool,
) -> io::Result<CopyOutcome> {
    let (source_parent, name) = CheckedDir::open_parent(from, Access::Read, gate)?;
    let (target_parent, to_name) =
        CheckedDir::open_parent(&to_dir.join(to_name), Access::Write, gate)?;
    let stat = source_parent.stat_at(&name)?;
    let from_real = source_parent.path().join(&name);
    let mut copy = Copier {
        gate,
        outcome: CopyOutcome::default(),
        progress,
    };
    let mut created = false;
    let result = match stat.kind {
        ItemKind::Dir => (|| -> io::Result<()> {
            let source = source_parent.child(&name, Access::Read)?;
            let into = target_parent.path().join(&to_name);
            if into.starts_with(source.path()) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("{} can't go inside itself.", name.to_string_lossy()),
                ));
            }
            target_parent.create_dir(&to_name)?;
            created = true;
            let target = target_parent.child(&to_name, Access::Write)?;
            copy.dir(&source, &target, 0)?;
            finish_dir(&target, stat.mode, stat.modified);
            copy.outcome.items += 1;
            Ok(())
        })(),
        ItemKind::File => {
            let progress = &mut *copy.progress;
            copy_file(
                &source_parent,
                &name,
                &target_parent,
                &to_name,
                &mut |bytes| progress(bytes, &from_real),
            )
            .map(|bytes| {
                copy.outcome.bytes += bytes;
                copy.outcome.items += 1;
            })
        }
        ItemKind::Link => source_parent.read_link(&name).and_then(|points| {
            target_parent
                .sys()
                .symlink(&points, &to_name, &from_real)
                .map(|()| copy.outcome.items += 1)
        }),
        ItemKind::Other => Err(io::Error::new(io::ErrorKind::InvalidInput, ODD_KIND)),
    };
    match result {
        Ok(()) => Ok(copy.outcome),
        Err(error) => {
            if created {
                let _ = remove_named(&target_parent, &to_name, &mut |_| true);
            }
            if is_cancelled(&error) {
                copy.outcome.cancelled = true;
                Ok(copy.outcome)
            } else {
                Err(error)
            }
        }
    }
}

pub fn remove_tree_checked(
    path: &Path,
    who: WalkFor,
    progress: &mut dyn FnMut(&Path) -> bool,
) -> io::Result<()> {
    remove_tree_with(path, who.gate(), progress)
}

pub(crate) fn remove_tree_with(
    path: &Path,
    gate: Gate,
    progress: &mut dyn FnMut(&Path) -> bool,
) -> io::Result<()> {
    let (parent, name) = CheckedDir::open_parent(path, Access::Write, gate)?;
    remove_named(&parent, &name, progress)
}

fn remove_named(
    parent: &CheckedDir,
    name: &OsStr,
    progress: &mut dyn FnMut(&Path) -> bool,
) -> io::Result<()> {
    let real = parent.admit_child(name, Access::Write)?;
    let stat = parent.stat_at(name)?;
    if stat.kind != ItemKind::Dir {
        parent.sys().unlink(name)?;
        progress(&real);
        return Ok(());
    }
    if parent.gate() != Gate::App {
        if let Some(why) = closed_places().inside(&real) {
            return Err(closed(&real, why));
        }
    }
    let dir = parent.child(name, Access::Write)?;
    if parent.gate() == Gate::Agent {
        holds_nothing_closed(&dir, 0)?;
    }
    remove_contents(&dir, progress, 0)?;
    parent.remove_dir(name)?;
    progress(&real);
    Ok(())
}

fn holds_nothing_closed(dir: &CheckedDir, depth: usize) -> io::Result<()> {
    if depth > MAX_DEPTH {
        return Err(too_deep());
    }
    for item in dir.read_dir()? {
        let real = dir.path().join(&item.name);
        if shut(dir, &item, Access::Write).is_some() || dir.gate().skips_secret(&item.name) {
            return Err(closed(&real, AGENT_SECRETS_INSIDE));
        }
        if item.kind == ItemKind::Dir {
            let child = dir.child(&item.name, Access::Write)?;
            holds_nothing_closed(&child, depth + 1)?;
        }
    }
    Ok(())
}

fn gone(result: io::Result<()>) -> io::Result<()> {
    match result {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

fn remove_contents(
    dir: &CheckedDir,
    progress: &mut dyn FnMut(&Path) -> bool,
    depth: usize,
) -> io::Result<()> {
    if depth > MAX_DEPTH {
        return Err(too_deep());
    }
    for item in dir.read_dir()? {
        let real = dir.path().join(&item.name);
        if let Some(why) = shut(dir, &item, Access::Write) {
            return Err(closed(&real, why));
        }
        if item.kind == ItemKind::Dir {
            let child = match dir.child(&item.name, Access::Write) {
                Ok(child) => child,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            remove_contents(&child, progress, depth + 1)?;
            gone(dir.sys().rmdir(&item.name))?;
        } else {
            gone(dir.sys().unlink(&item.name))?;
        }
        if !progress(&real) {
            return Err(cancelled());
        }
    }
    Ok(())
}

pub fn tree_size_checked(
    path: &Path,
    who: WalkFor,
    cancel: &dyn Fn() -> bool,
) -> io::Result<(u64, u64)> {
    let (parent, name) = CheckedDir::open_parent(path, Access::Read, who.gate())?;
    let stat = parent.stat_at(&name)?;
    match stat.kind {
        ItemKind::File => Ok((stat.len, 1)),
        ItemKind::Dir => {
            let dir = parent.child(&name, Access::Read)?;
            let mut total = (0, 1);
            size_of(&dir, cancel, 0, &mut total)?;
            Ok(total)
        }
        ItemKind::Link | ItemKind::Other => Ok((0, 1)),
    }
}

fn size_of(
    dir: &CheckedDir,
    cancel: &dyn Fn() -> bool,
    depth: usize,
    total: &mut (u64, u64),
) -> io::Result<()> {
    if depth > MAX_DEPTH {
        return Err(too_deep());
    }
    let Some(items) = items_of(dir, depth)? else {
        return Ok(());
    };
    for item in items {
        if cancel() {
            return Err(cancelled());
        }
        if shut(dir, &item, Access::Read).is_some() {
            continue;
        }
        total.1 += 1;
        match item.kind {
            ItemKind::File => total.0 += item.len,
            ItemKind::Dir => match dir.child(&item.name, Access::Read) {
                Ok(child) => size_of(&child, cancel, depth + 1, total)?,
                Err(error) if unreadable(&error) => {}
                Err(error) => return Err(error),
            },
            ItemKind::Link | ItemKind::Other => {}
        }
    }
    Ok(())
}
