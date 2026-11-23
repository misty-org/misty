mod landlock;
mod seccomp;

use std::{
    ffi::CString,
    io,
    os::fd::RawFd,
    path::{Path, PathBuf},
};

use landlock::{EXECUTE, IOCTL_DEV, MAKE_DIR, MAKE_REG, READ_DIR, READ_FILE, TRUNCATE, WRITE_FILE};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    List,
    Read,
    Run,
    AddEdit,
    Private,
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

pub struct Policy {
    pub program: PathBuf,
    pub required: Vec<(PathBuf, Access)>,
    pub optional: Vec<(PathBuf, Access)>,
    pub forks: bool,
    pub limits: Vec<(libc::__rlimit_resource_t, libc::rlim_t)>,
}

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

const DEVICES: &[(&str, Access)] = &[
    ("/dev/null", Access::Device),
    ("/dev/zero", Access::Device),
    ("/dev/urandom", Access::Read),
    ("/dev/random", Access::Read),
];

pub const NO_LANDLOCK: &str =
    "Misty's helpers need Landlock, which this Linux kernel has turned off. Use a kernel from 5.13 on with Landlock enabled.";

pub struct Confinement {
    ruleset: landlock::Ruleset,
    namespaced: seccomp::Filter,
    alone: seccomp::Filter,
    limits: Vec<(libc::__rlimit_resource_t, libc::rlim_t)>,
    files: ChildFiles,
}

#[derive(Clone)]
struct ChildFiles {
    setgroups: CString,
    uid_map: CString,
    gid_map: CString,
    uid_line: Vec<u8>,
    gid_line: Vec<u8>,
}

#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
fn interpreter(program: &Path) -> Option<PathBuf> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(program).ok()?;
    let mut header = [0u8; 64];
    file.read_exact(&mut header).ok()?;
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
        if u32::from_le_bytes(entry[..4].try_into().ok()?) != 3 {
            continue;
        }
        let offset = read_u64(&entry[8..16]);
        let length = read_u64(&entry[32..40]).min(4096) as usize;
        let mut name = vec![0u8; length];
        file.seek(SeekFrom::Start(offset)).ok()?;
        file.read_exact(&mut name).ok()?;
        let end = name
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(name.len());
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
        let refused =
            |what: &Path| format!("Misty couldn't confine its helper ({}).", what.display());
        let required = |path: &Path, access: Access| match ruleset.allow(path, access.rights()) {
            Ok(true) => Ok(()),
            _ => Err(refused(path)),
        };
        required(&policy.program, Access::Run)?;
        for (path, access) in &policy.required {
            required(path, *access)?;
        }
        if let Some(loader) = interpreter(&policy.program) {
            required(&loader, Access::Run)?;
        }
        let system = SYSTEM_LIBRARIES
            .iter()
            .map(|path| (PathBuf::from(path), Access::Read))
            .chain(
                DEVICES
                    .iter()
                    .map(|(path, access)| (PathBuf::from(path), *access)),
            );
        for (path, access) in system.chain(policy.optional.iter().cloned()) {
            ruleset
                .allow(&path, access.rights())
                .map_err(|_| refused(&path))?;
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
            unsafe {
                confine(
                    ruleset,
                    &mut namespaced,
                    &mut alone,
                    &limits,
                    &files,
                    parent,
                )
            }
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

unsafe fn write_file(path: &CString, line: &[u8]) -> bool {
    let fd = libc::open(path.as_ptr(), libc::O_WRONLY | libc::O_CLOEXEC);
    if fd < 0 {
        return false;
    }
    let written = libc::write(fd, line.as_ptr().cast(), line.len());
    libc::close(fd);
    written == line.len() as isize
}

unsafe fn close_from(first: libc::c_uint, now: bool) {
    let flags = if now {
        0
    } else {
        libc::CLOSE_RANGE_CLOEXEC as libc::c_int
    };
    if libc::syscall(libc::SYS_close_range, first, libc::c_uint::MAX, flags) == 0 {
        return;
    }
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

unsafe fn confine(
    ruleset: RawFd,
    namespaced: &mut seccomp::Filter,
    alone: &mut seccomp::Filter,
    limits: &[(libc::__rlimit_resource_t, libc::rlim_t)],
    files: &ChildFiles,
    parent: libc::pid_t,
) -> io::Result<()> {
    check(libc::setsid())?;
    check(libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0))?;
    if libc::getppid() != parent {
        return Err(io::Error::other("parent gone"));
    }
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
    let child = libc::fork();
    if child < 0 {
        return Err(io::Error::last_os_error());
    }
    if child > 0 {
        stand_in_for(child);
    }
    check(libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0))?;
    namespaced.install(libc::getpid())
}
