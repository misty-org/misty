//! Confined processes on Linux, the counterpart of `sandbox-exec` on macOS and the AppContainer on
//! Windows. Three layers, all set up by Misty between fork and exec, so they hold whatever the
//! program does:
//!
//! - **Landlock** (required): the process reads, writes and runs only what a [`Policy`] names. Its
//!   system libraries are readable, and nothing else on the computer is: no home folder, no
//!   `/proc`, no other program to start. Without Landlock nothing starts at all.
//! - **seccomp** (always): no sockets, so no network and no local service; no io_uring, mounts,
//!   namespaces, tracing or terminal injection; and, where nothing else keeps them in, signals and
//!   process calls only within its own process group (see `seccomp.rs`).
//! - **Namespaces** (when the system allows unprivileged ones): a user namespace holding an empty
//!   network namespace, its own IPC and a process namespace whose first process is the program. When
//!   that process ends, the kernel ends every other one inside, and nothing inside can see or signal
//!   a process outside.
//!
//! Each process also gets `PR_SET_PDEATHSIG`, so it dies with the Misty thread that started it,
//! its own session, the caller's resource limits, and every inherited descriptor beyond its standard
//! three closed on exec.
mod landlock;
mod seccomp;

use std::{
    ffi::CString,
    io,
    os::fd::RawFd,
    path::{Path, PathBuf},
};

use landlock::{EXECUTE, IOCTL_DEV, MAKE_DIR, MAKE_REG, READ_DIR, READ_FILE, TRUNCATE, WRITE_FILE};

/// What a rule allows on a path and everything under it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// List a folder's names, nothing more.
    List,
    /// Read files and list folders.
    Read,
    /// Read and run: only for the program itself and the system's program loader.
    Run,
    /// Add and edit files and folders, never delete, rename, link or run them.
    AddEdit,
    /// Everything inside a private folder except running what's there.
    Private,
    /// A device such as `/dev/null`: read, write, truncate and query.
    Device,
}

impl Access {
    fn rights(self) -> u64 {
        match self {
            Access::List => READ_DIR,
            Access::Read => READ_FILE | READ_DIR,
            Access::Run => READ_FILE | EXECUTE,
            Access::AddEdit => READ_FILE | READ_DIR | WRITE_FILE | TRUNCATE | MAKE_REG | MAKE_DIR,
            Access::Private => landlock::everything_but_running(),
            Access::Device => READ_FILE | WRITE_FILE | TRUNCATE | IOCTL_DEV,
        }
    }
}

/// What one confined process may do.
pub struct Policy {
    /// The program that starts, by real path. Its loader is found from it.
    pub program: PathBuf,
    /// Paths that must exist; a missing one refuses the start.
    pub required: Vec<(PathBuf, Access)>,
    /// Paths granted only when they exist (system files that differ between distributions).
    pub optional: Vec<(PathBuf, Access)>,
    /// Whether the process may start other processes (the shell) or only threads.
    pub forks: bool,
    /// `setrlimit` values applied before exec.
    pub limits: Vec<(libc::__rlimit_resource_t, libc::rlim_t)>,
}

/// The folders every dynamically linked program reads its libraries from, on the distributions
/// Misty supports (merged and split `/usr`, multiarch, Nix and Guix stores). They hold libraries
/// and data, never a person's files.
const SYSTEM_LIBRARIES: &[&str] = &[
    "/lib",
    "/lib64",
    "/lib32",
    "/usr/lib",
    "/usr/lib64",
    "/usr/lib32",
    "/usr/local/lib",
    "/nix/store",
    "/gnu/store",
    "/etc/ld.so.cache",
    "/etc/ld.so.preload",
];

/// Files any program may need to start: the bit bucket and randomness.
const DEVICES: &[(&str, Access)] = &[
    ("/dev/null", Access::Device),
    ("/dev/zero", Access::Device),
    ("/dev/urandom", Access::Read),
    ("/dev/random", Access::Read),
];

/// Why Linux can't confine anything here, for the person.
pub const NO_LANDLOCK: &str =
    "Misty's helpers need Landlock, which this Linux kernel has turned off. Use a kernel from 5.13 on with Landlock enabled.";

/// A policy turned into kernel objects, ready to apply to one command. Keep it alive until the
/// command has started: the child restricts itself with the ruleset this holds.
pub struct Confinement {
    ruleset: landlock::Ruleset,
    /// Used when the namespaces are there to contain signals.
    namespaced: seccomp::Filter,
    /// Used otherwise, which also keeps signals in.
    alone: seccomp::Filter,
    limits: Vec<(libc::__rlimit_resource_t, libc::rlim_t)>,
    files: ChildFiles,
}

/// Paths and text the child writes after `unshare`, prepared here so it allocates nothing.
#[derive(Clone)]
struct ChildFiles {
    setgroups: CString,
    uid_map: CString,
    gid_map: CString,
    uid_line: Vec<u8>,
    gid_line: Vec<u8>,
}

/// The program loader named in an ELF program's `PT_INTERP` header, when it has one. The program is
/// the helper Misty just staged, so the file gate has nothing to decide.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
fn interpreter(program: &Path) -> Option<PathBuf> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(program).ok()?;
    let mut header = [0u8; 64];
    file.read_exact(&mut header).ok()?;
    // A 64-bit little-endian ELF file.
    if &header[..4] != b"\x7fELF" || header[4] != 2 || header[5] != 1 {
        return None;
    }
    let read_u64 = |bytes: &[u8]| u64::from_le_bytes(bytes.try_into().unwrap_or_default());
    let read_u16 = |bytes: &[u8]| u16::from_le_bytes(bytes.try_into().unwrap_or_default());
    let table = read_u64(&header[0x20..0x28]);
    let size = u64::from(read_u16(&header[0x36..0x38]));
    let count = u64::from(read_u16(&header[0x38..0x3a]));
    if size < 56 || count > 512 {
        return None;
    }
    for index in 0..count {
        let mut entry = [0u8; 56];
        file.seek(SeekFrom::Start(table + index * size)).ok()?;
        file.read_exact(&mut entry).ok()?;
        // PT_INTERP
        if u32::from_le_bytes(entry[..4].try_into().ok()?) != 3 {
            continue;
        }
        let offset = read_u64(&entry[8..16]);
        let length = read_u64(&entry[32..40]).min(4096) as usize;
        let mut name = vec![0u8; length];
        file.seek(SeekFrom::Start(offset)).ok()?;
        file.read_exact(&mut name).ok()?;
        let end = name.iter().position(|byte| *byte == 0).unwrap_or(name.len());
        let path = PathBuf::from(String::from_utf8_lossy(&name[..end]).into_owned());
        return std::fs::canonicalize(path).ok();
    }
    None
}

impl Confinement {
    pub fn new(policy: &Policy) -> Result<Self, String> {
        let abi = landlock::abi();
        if abi == 0 {
            return Err(NO_LANDLOCK.into());
        }
        let ruleset = landlock::Ruleset::new(abi).map_err(|_| NO_LANDLOCK.to_owned())?;
        let refused = |what: &Path| format!("Misty couldn't confine its helper ({}).", what.display());
        let required = |path: &Path, access: Access| match ruleset.allow(path, access.rights()) {
            Ok(true) => Ok(()),
            _ => Err(refused(path)),
        };
        required(&policy.program, Access::Run)?;
        for (path, access) in &policy.required {
            required(path, *access)?;
        }
        // The loader runs, and every library it maps is only read.
        if let Some(loader) = interpreter(&policy.program) {
            required(&loader, Access::Run)?;
        }
        let system = SYSTEM_LIBRARIES
            .iter()
            .map(|path| (PathBuf::from(path), Access::Read))
            .chain(DEVICES.iter().map(|(path, access)| (PathBuf::from(path), *access)));
        for (path, access) in system.chain(policy.optional.iter().cloned()) {
            // A missing folder is fine; one that can't take a rule is not.
            ruleset.allow(&path, access.rights()).map_err(|_| refused(&path))?;
        }
        let contain_signals = !ruleset.scopes_signals();
        // SAFETY: plain getters.
        let (uid, gid) = unsafe { (libc::geteuid(), libc::getegid()) };
        let path = |text: &str| CString::new(text).unwrap_or_default();
        Ok(Self {
            namespaced: seccomp::Filter::build(&seccomp::Shape {
                forks: policy.forks,
                contain_signals: false,
            }),
            alone: seccomp::Filter::build(&seccomp::Shape {
                forks: policy.forks,
                contain_signals,
            }),
            ruleset,
            limits: policy.limits.clone(),
            files: ChildFiles {
                setgroups: path("/proc/self/setgroups"),
                uid_map: path("/proc/self/uid_map"),
                gid_map: path("/proc/self/gid_map"),
                uid_line: format!("{uid} {uid} 1\n").into_bytes(),
                gid_line: format!("{gid} {gid} 1\n").into_bytes(),
            },
        })
    }

    /// The hook to run between fork and exec (`pre_exec`). The caller must not also put the
    /// command in a process group: the hook starts a session, which does.
    pub fn hook(&self) -> impl FnMut() -> io::Result<()> + Send + Sync + 'static {
        let ruleset = self.ruleset.raw();
        let mut namespaced = self.namespaced.clone();
        let mut alone = self.alone.clone();
        let limits = self.limits.clone();
        let files = self.files.clone();
        // SAFETY: plain getter, read before fork.
        let parent = unsafe { libc::getpid() };
        move || {
            // SAFETY: everything below is a system call on memory this child already owns.
            unsafe { confine(ruleset, &mut namespaced, &mut alone, &limits, &files, parent) }
        }
    }
}

fn check(result: libc::c_int) -> io::Result<()> {
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Writes `line` to the file at `path`, for the user namespace's maps.
unsafe fn write_file(path: &CString, line: &[u8]) -> bool {
    let fd = libc::open(path.as_ptr(), libc::O_WRONLY | libc::O_CLOEXEC);
    if fd < 0 {
        return false;
    }
    let written = libc::write(fd, line.as_ptr().cast(), line.len());
    libc::close(fd);
    written == line.len() as isize
}

/// Closes every descriptor from `first` on at exec, or right away when `now`.
unsafe fn close_from(first: libc::c_uint, now: bool) {
    let flags = if now { 0 } else { libc::CLOSE_RANGE_CLOEXEC as libc::c_int };
    if libc::syscall(libc::SYS_close_range, first, libc::c_uint::MAX, flags) == 0 {
        return;
    }
    // Kernels before 5.11: one call per descriptor, up to the open-file limit.
    let mut limit: libc::rlimit = std::mem::zeroed();
    let top = if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) == 0 {
        limit.rlim_cur.min(1 << 20) as libc::c_int
    } else {
        1024
    };
    for fd in first as libc::c_int..top {
        if now {
            libc::close(fd);
        } else {
            libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC);
        }
    }
}

/// Waits for the namespace's first process and leaves the same way it did. This process holds
/// nothing open, so the program's output ends when the program's does.
unsafe fn stand_in_for(child: libc::pid_t) -> ! {
    close_from(0, true);
    let mut status = 0;
    loop {
        let waited = libc::waitpid(child, &mut status, 0);
        if waited == child {
            break;
        }
        if waited < 0 && *libc::__errno_location() != libc::EINTR {
            libc::_exit(127);
        }
    }
    if libc::WIFEXITED(status) {
        libc::_exit(libc::WEXITSTATUS(status));
    }
    let signal = libc::WTERMSIG(status);
    libc::signal(signal, libc::SIG_DFL);
    libc::kill(libc::getpid(), signal);
    libc::_exit(128 + signal)
}

/// The confinement itself, in the child between fork and exec. Only async-signal-safe calls: no
/// allocation, no locks.
unsafe fn confine(
    ruleset: RawFd,
    namespaced: &mut seccomp::Filter,
    alone: &mut seccomp::Filter,
    limits: &[(libc::__rlimit_resource_t, libc::rlim_t)],
    files: &ChildFiles,
    parent: libc::pid_t,
) -> io::Result<()> {
    check(libc::setsid())?;
    // Dies with Misty. If Misty is already gone, the signal would never come.
    check(libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0))?;
    if libc::getppid() != parent {
        return Err(io::Error::other("parent gone"));
    }
    // Native libraries in Misty can leave a descriptor open across exec, and the program would
    // then hold whatever it is. The runner's own pipes are already marked.
    close_from(3, false);
    for &(resource, value) in limits {
        let limit = libc::rlimit {
            rlim_cur: value,
            rlim_max: value,
        };
        check(libc::setrlimit(resource, &limit))?;
    }
    let isolated = libc::unshare(
        libc::CLONE_NEWUSER | libc::CLONE_NEWNET | libc::CLONE_NEWIPC | libc::CLONE_NEWPID,
    ) == 0;
    if isolated {
        // Keep the person's own user and group ids inside, so files keep their owner. A map that
        // can't be written leaves the ids unmapped, which still reaches only what Landlock allows.
        if write_file(&files.setgroups, b"deny") {
            write_file(&files.uid_map, &files.uid_line);
            write_file(&files.gid_map, &files.gid_line);
        }
    }
    check(libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0))?;
    landlock::restrict_self(ruleset)?;
    if !isolated {
        return alone.install(libc::getpid());
    }
    // A new process namespace takes effect for the next process, which becomes its first.
    let child = libc::fork();
    if child < 0 {
        return Err(io::Error::last_os_error());
    }
    if child > 0 {
        stand_in_for(child);
    }
    // Dies with the stand-in, which dies with Misty.
    check(libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0))?;
    namespaced.install(libc::getpid())
}
