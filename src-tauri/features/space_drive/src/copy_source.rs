use std::ffi::OsStr;
use std::io::{self, Read};
use std::path::Path;
use std::time::SystemTime;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CopyKind {
    File,
    Folder,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CopyFlow {
    Continue,
    SkipFolder,
    Stop,
}

pub trait CopyFolder {
    fn open(&self, name: &OsStr) -> io::Result<Box<dyn Read + '_>>;
}

pub struct CopyStep<'a> {
    pub folder: &'a dyn CopyFolder,
    pub relative: &'a Path,
    pub name: &'a OsStr,
    pub kind: CopyKind,
    pub modified: Option<SystemTime>,
}

pub trait CopySource: Send + Sync {
    fn name(&self) -> Option<&OsStr>;
    fn kind(&self) -> CopyKind;
    fn modified(&self) -> Option<SystemTime>;
    fn open(&self) -> io::Result<Box<dyn Read + '_>>;
    fn walk(&self, visit: &mut dyn FnMut(CopyStep<'_>) -> CopyFlow) -> io::Result<()>;
}
