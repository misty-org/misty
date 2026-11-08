//! The standard library's file types, through the gate. They're wrappers so the only ways to open
//! a file are the ones checked here.
use std::{
    fs, io,
    ops::{Deref, DerefMut},
    path::Path,
};

use super::{check, Access};

/// The Windows null device, for a helper's standard error. It isn't anyone's file, so no rule
/// applies to it.
#[cfg(windows)]
pub fn null_device() -> io::Result<File> {
    fs::File::create("NUL").map(File)
}

/// `std::fs::File`. It's a wrapper so the only ways to open one are the two checked here; once open
/// it works like the standard type, which `Deref` gives it.
#[derive(Debug)]
pub struct File(fs::File);

impl File {
    /// A file with no name in the temp folder, for a helper's input or output. It has no path, so
    /// there's nothing to check.
    pub fn unnamed_temp() -> io::Result<Self> {
        tempfile::tempfile().map(Self)
    }

    pub fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        check(path.as_ref(), Access::Read)?;
        fs::File::open(path).map(Self)
    }

    pub fn create(path: impl AsRef<Path>) -> io::Result<Self> {
        check(path.as_ref(), Access::Write)?;
        fs::File::create(path).map(Self)
    }
}

impl Deref for File {
    type Target = fs::File;

    fn deref(&self) -> &fs::File {
        &self.0
    }
}

impl DerefMut for File {
    fn deref_mut(&mut self) -> &mut fs::File {
        &mut self.0
    }
}

impl io::Read for File {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.0.read(buffer)
    }
}

impl io::Write for File {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.0.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

impl io::Seek for File {
    fn seek(&mut self, position: io::SeekFrom) -> io::Result<u64> {
        self.0.seek(position)
    }
}

impl From<File> for std::process::Stdio {
    fn from(file: File) -> Self {
        file.0.into()
    }
}

/// `std::fs::OpenOptions`, checked as writing when the options can change anything.
#[derive(Clone, Debug)]
pub struct OpenOptions {
    options: fs::OpenOptions,
    writes: bool,
}

impl OpenOptions {
    pub fn new() -> Self {
        Self {
            options: fs::OpenOptions::new(),
            writes: false,
        }
    }

    pub fn read(&mut self, read: bool) -> &mut Self {
        self.options.read(read);
        self
    }

    pub fn write(&mut self, write: bool) -> &mut Self {
        self.options.write(write);
        self.writes |= write;
        self
    }

    pub fn append(&mut self, append: bool) -> &mut Self {
        self.options.append(append);
        self.writes |= append;
        self
    }

    pub fn truncate(&mut self, truncate: bool) -> &mut Self {
        self.options.truncate(truncate);
        self.writes |= truncate;
        self
    }

    pub fn create(&mut self, create: bool) -> &mut Self {
        self.options.create(create);
        self.writes |= create;
        self
    }

    pub fn create_new(&mut self, create_new: bool) -> &mut Self {
        self.options.create_new(create_new);
        self.writes |= create_new;
        self
    }

    #[cfg(unix)]
    pub fn mode(&mut self, mode: u32) -> &mut Self {
        use std::os::unix::fs::OpenOptionsExt;
        self.options.mode(mode);
        self
    }

    #[cfg(unix)]
    pub fn custom_flags(&mut self, flags: i32) -> &mut Self {
        use std::os::unix::fs::OpenOptionsExt;
        self.options.custom_flags(flags);
        self
    }

    pub fn open(&self, path: impl AsRef<Path>) -> io::Result<File> {
        let access = if self.writes {
            Access::Write
        } else {
            Access::Read
        };
        check(path.as_ref(), access)?;
        self.options.open(path).map(File)
    }
}

impl Default for OpenOptions {
    fn default() -> Self {
        Self::new()
    }
}

/// `std::fs::DirBuilder`, checked as writing.
#[derive(Debug)]
pub struct DirBuilder(fs::DirBuilder);

impl DirBuilder {
    pub fn new() -> Self {
        Self(fs::DirBuilder::new())
    }

    pub fn recursive(&mut self, recursive: bool) -> &mut Self {
        self.0.recursive(recursive);
        self
    }

    #[cfg(unix)]
    pub fn mode(&mut self, mode: u32) -> &mut Self {
        use std::os::unix::fs::DirBuilderExt;
        self.0.mode(mode);
        self
    }

    pub fn create(&self, path: impl AsRef<Path>) -> io::Result<()> {
        check(path.as_ref(), Access::Write)?;
        self.0.create(path)
    }
}

impl Default for DirBuilder {
    fn default() -> Self {
        Self::new()
    }
}
