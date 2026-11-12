//! Landlock, the kernel's own sandbox for unprivileged processes: once a process restricts itself,
//! it and everything it starts can reach only the files and folders a rule names, and nothing it
//! does later can widen that. The rules are opened here, in Misty's process, before the confined
//! process starts; the child only calls `landlock_restrict_self`.
use std::{
    ffi::CString,
    io,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
        unix::ffi::OsStrExt,
    },
    path::Path,
};

// The three Landlock calls have the same numbers on every architecture.
const SYS_CREATE_RULESET: libc::c_long = 444;
const SYS_ADD_RULE: libc::c_long = 445;
const SYS_RESTRICT_SELF: libc::c_long = 446;
const CREATE_RULESET_VERSION: u32 = 1;
const RULE_PATH_BENEATH: u32 = 1;

pub(super) const EXECUTE: u64 = 1 << 0;
pub(super) const WRITE_FILE: u64 = 1 << 1;
pub(super) const READ_FILE: u64 = 1 << 2;
pub(super) const READ_DIR: u64 = 1 << 3;
const REMOVE_DIR: u64 = 1 << 4;
const REMOVE_FILE: u64 = 1 << 5;
const MAKE_CHAR: u64 = 1 << 6;
pub(super) const MAKE_DIR: u64 = 1 << 7;
pub(super) const MAKE_REG: u64 = 1 << 8;
const MAKE_SOCK: u64 = 1 << 9;
const MAKE_FIFO: u64 = 1 << 10;
const MAKE_BLOCK: u64 = 1 << 11;
const MAKE_SYM: u64 = 1 << 12;
/// ABI 2: linking or renaming a file into another folder.
const REFER: u64 = 1 << 13;
/// ABI 3: truncating, `open(O_TRUNC)` included.
pub(super) const TRUNCATE: u64 = 1 << 14;
/// ABI 5: `ioctl` on a device file.
pub(super) const IOCTL_DEV: u64 = 1 << 15;

/// ABI 4: TCP. With no rule for it, neither binding nor connecting is allowed.
const NET_BIND_TCP: u64 = 1 << 0;
const NET_CONNECT_TCP: u64 = 1 << 1;

/// ABI 6: abstract Unix sockets and signals reach only processes in the same sandbox.
const SCOPE_ABSTRACT_UNIX_SOCKET: u64 = 1 << 0;
const SCOPE_SIGNAL: u64 = 1 << 1;

/// The rights that apply to a file rather than a folder.
const FILE_RIGHTS: u64 = EXECUTE | WRITE_FILE | READ_FILE | TRUNCATE | IOCTL_DEV;

#[repr(C)]
struct RulesetAttr {
    handled_access_fs: u64,
    handled_access_net: u64,
    scoped: u64,
}

#[repr(C, packed)]
struct PathBeneathAttr {
    allowed_access: u64,
    parent_fd: i32,
}

/// The Landlock version this kernel speaks, or 0 when Landlock is off or missing.
pub(super) fn abi() -> u32 {
    // SAFETY: the version query reads no memory.
    let version = unsafe {
        libc::syscall(
            SYS_CREATE_RULESET,
            std::ptr::null::<RulesetAttr>(),
            0usize,
            CREATE_RULESET_VERSION,
        )
    };
    u32::try_from(version).unwrap_or(0)
}

/// Every filesystem right this ABI knows. Handling all of them means anything without a rule is
/// refused.
fn handled_fs(abi: u32) -> u64 {
    let mut rights = EXECUTE
        | WRITE_FILE
        | READ_FILE
        | READ_DIR
        | REMOVE_DIR
        | REMOVE_FILE
        | MAKE_CHAR
        | MAKE_DIR
        | MAKE_REG
        | MAKE_SOCK
        | MAKE_FIFO
        | MAKE_BLOCK
        | MAKE_SYM;
    if abi >= 2 {
        rights |= REFER;
    }
    if abi >= 3 {
        rights |= TRUNCATE;
    }
    if abi >= 5 {
        rights |= IOCTL_DEV;
    }
    rights
}

/// Everything inside a private folder, short of running what's written there.
pub(super) fn everything_but_running() -> u64 {
    handled_fs(u32::MAX) & !EXECUTE
}

/// A set of rules, ready for a child to restrict itself with.
pub(super) struct Ruleset {
    fd: OwnedFd,
    abi: u32,
    handled: u64,
}

impl Ruleset {
    pub(super) fn new(abi: u32) -> io::Result<Self> {
        let handled = handled_fs(abi);
        let attr = RulesetAttr {
            handled_access_fs: handled,
            handled_access_net: if abi >= 4 {
                NET_BIND_TCP | NET_CONNECT_TCP
            } else {
                0
            },
            scoped: if abi >= 6 {
                SCOPE_ABSTRACT_UNIX_SOCKET | SCOPE_SIGNAL
            } else {
                0
            },
        };
        // Older kernels read only the fields they know; the rest are zero.
        // SAFETY: a valid attribute struct of the given size.
        let fd = unsafe {
            libc::syscall(
                SYS_CREATE_RULESET,
                &attr as *const RulesetAttr,
                std::mem::size_of::<RulesetAttr>(),
                0u32,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: a new descriptor the kernel just returned, owned from here; it is close-on-exec.
        let fd = unsafe { OwnedFd::from_raw_fd(fd as RawFd) };
        Ok(Self { fd, abi, handled })
    }

    /// Whether signals and abstract sockets stay inside the sandbox (Landlock ABI 6).
    pub(super) fn scopes_signals(&self) -> bool {
        self.abi >= 6
    }

    /// Allows `access` on `path` and everything under it. A link as the last part of `path` is
    /// never followed: a rule always lands on what is really there. Returns false when nothing is
    /// at `path` (or it is a link), which callers decide about.
    pub(super) fn allow(&self, path: &Path, access: u64) -> io::Result<bool> {
        let Ok(name) = CString::new(path.as_os_str().as_bytes()) else {
            return Ok(false);
        };
        // SAFETY: a NUL-terminated path; the descriptor is owned below.
        let raw = unsafe {
            libc::open(
                name.as_ptr(),
                libc::O_PATH | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if raw < 0 {
            return Ok(false);
        }
        // SAFETY: just opened.
        let fd = unsafe { OwnedFd::from_raw_fd(raw) };
        // SAFETY: an all-zero stat is a valid buffer.
        let mut stat: libc::stat = unsafe { std::mem::zeroed() };
        // SAFETY: a live descriptor and a stat buffer.
        if unsafe { libc::fstat(fd.as_raw_fd(), &mut stat) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let kind = stat.st_mode & libc::S_IFMT;
        if kind == libc::S_IFLNK {
            return Ok(false);
        }
        let mut allowed = access & self.handled;
        if kind != libc::S_IFDIR {
            allowed &= FILE_RIGHTS;
        }
        if allowed == 0 {
            return Ok(true);
        }
        let rule = PathBeneathAttr {
            allowed_access: allowed,
            parent_fd: fd.as_raw_fd(),
        };
        // SAFETY: a valid rule and a live ruleset.
        let added = unsafe {
            libc::syscall(
                SYS_ADD_RULE,
                self.fd.as_raw_fd(),
                RULE_PATH_BENEATH,
                &rule as *const PathBeneathAttr,
                0u32,
            )
        };
        if added != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(true)
    }

    pub(super) fn raw(&self) -> RawFd {
        self.fd.as_raw_fd()
    }
}

/// Restricts the calling process to `ruleset`. Async-signal-safe: one system call. No new
/// privileges must already be set.
pub(super) fn restrict_self(ruleset: RawFd) -> io::Result<()> {
    // SAFETY: a ruleset descriptor this process inherited from its parent.
    if unsafe { libc::syscall(SYS_RESTRICT_SELF, ruleset, 0u32) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
