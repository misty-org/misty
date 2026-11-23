use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::model::{ItemId, SpaceId};

pub const ANSWER_HOLD: Duration = Duration::from_secs(120);
pub const USED_LATELY: Duration = Duration::from_secs(5 * 60);
pub const STALE_CHECK: Duration = Duration::from_secs(10);
pub const REPORT_AFTER: Duration = Duration::from_secs(3);

type Key = (SpaceId, ItemId);

#[derive(Debug, Default, Clone)]
struct OpenState {
    readers: u32,
    writers: u32,
    since: Option<Instant>,
    written: bool,
}

impl OpenState {
    fn reportable(&self) -> bool {
        self.written
            || self
                .since
                .is_some_and(|since| since.elapsed() >= REPORT_AFTER)
    }

    fn editing(&self) -> bool {
        self.writers > 0
    }
}

#[derive(Default)]
pub struct Opens {
    open: Mutex<HashMap<Key, OpenState>>,
    answered: Mutex<HashMap<Key, Instant>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Opens {
    pub fn open(&self, key: Key, editing: bool) -> bool {
        let mut open = lock(&self.open);
        let state = open.entry(key).or_default();
        let first = state.readers + state.writers == 0;
        if first {
            state.since = Some(Instant::now());
            state.written = false;
        }
        if editing {
            state.writers += 1;
        } else {
            state.readers += 1;
        }
        first
    }

    pub fn close(&self, key: &Key, editing: bool) -> bool {
        let mut open = lock(&self.open);
        let Some(state) = open.get_mut(key) else {
            return true;
        };
        if editing {
            state.writers = state.writers.saturating_sub(1);
        } else {
            state.readers = state.readers.saturating_sub(1);
        }
        if state.readers + state.writers == 0 {
            open.remove(key);
            true
        } else {
            false
        }
    }

    pub fn is_open(&self, key: &Key) -> bool {
        lock(&self.open).contains_key(key)
    }

    pub fn is_writing(&self, key: &Key) -> bool {
        lock(&self.open).get(key).is_some_and(OpenState::editing)
    }

    pub fn open_keys(&self) -> HashSet<Key> {
        lock(&self.open).keys().cloned().collect()
    }

    pub fn reportable(&self, key: &Key) -> bool {
        lock(&self.open).get(key).is_some_and(OpenState::reportable)
    }

    pub fn reportable_keys(&self) -> Vec<(Key, bool)> {
        lock(&self.open)
            .iter()
            .filter(|(_, state)| state.reportable())
            .map(|(key, state)| (key.clone(), state.editing()))
            .collect()
    }

    pub fn wrote(&self, key: &Key) -> bool {
        let mut open = lock(&self.open);
        let Some(state) = open.get_mut(key) else {
            return false;
        };
        let newly = !state.reportable();
        state.written = true;
        newly
    }

    pub fn answered(&self, key: Key) {
        lock(&self.answered).insert(key, Instant::now());
    }

    pub fn forget_answer(&self, key: &Key) {
        lock(&self.answered).remove(key);
    }

    pub fn is_answered(&self, key: &Key) -> bool {
        lock(&self.answered)
            .get(key)
            .is_some_and(|at| at.elapsed() < ANSWER_HOLD)
    }

    pub fn answered_live(&self) -> Vec<Key> {
        let mut answered = lock(&self.answered);
        answered.retain(|_, at| at.elapsed() < ANSWER_HOLD);
        answered.keys().cloned().collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Held {
    pub user_id: String,
    pub name: String,
    pub device_id: String,
    pub device_name: String,
    pub editing: bool,
    pub expires_ms: i64,
}

impl Held {
    fn shown(&self) -> (&str, &str, &str, &str, bool) {
        (
            &self.name,
            &self.device_name,
            &self.user_id,
            &self.device_id,
            self.editing,
        )
    }
}

fn same(a: &[Held], b: &[Held]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.shown() == b.shown())
}

#[derive(Default)]
pub struct Marks {
    by_space: Mutex<HashMap<SpaceId, HashMap<ItemId, Vec<Held>>>>,
}

impl Marks {
    pub fn replace(
        &self,
        space: &SpaceId,
        marks: Vec<(ItemId, Held)>,
        now_ms: i64,
    ) -> HashSet<ItemId> {
        let mut next: HashMap<ItemId, Vec<Held>> = HashMap::new();
        for (item, held) in marks {
            if held.expires_ms > now_ms {
                next.entry(item).or_default().push(held);
            }
        }
        for list in next.values_mut() {
            list.sort_by(|a, b| a.shown().cmp(&b.shown()));
        }
        let mut by_space = lock(&self.by_space);
        let old = by_space.remove(space).unwrap_or_default();
        let mut changed: HashSet<ItemId> = old
            .iter()
            .filter(|(item, list)| !next.get(*item).is_some_and(|now| same(now, list)))
            .map(|(item, _)| item.clone())
            .collect();
        changed.extend(next.keys().filter(|item| !old.contains_key(*item)).cloned());
        by_space.insert(space.clone(), next);
        changed
    }

    pub fn expire(&self, space: &SpaceId, now_ms: i64) -> HashSet<ItemId> {
        let mut changed = HashSet::new();
        if let Some(items) = lock(&self.by_space).get_mut(space) {
            items.retain(|item, list| {
                let before = list.len();
                list.retain(|held| held.expires_ms > now_ms);
                if list.len() != before {
                    changed.insert(item.clone());
                }
                !list.is_empty()
            });
        }
        changed
    }

    pub fn expiring(&self, space: &SpaceId, by_ms: i64) -> bool {
        lock(&self.by_space).get(space).is_some_and(|items| {
            items
                .values()
                .flatten()
                .any(|held| held.expires_ms <= by_ms)
        })
    }

    pub fn on(&self, space: &SpaceId, item: &ItemId, now_ms: i64) -> Vec<Held> {
        lock(&self.by_space)
            .get(space)
            .and_then(|items| items.get(item))
            .map(|list| {
                list.iter()
                    .filter(|held| held.expires_ms > now_ms)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn forget(&self, space: &SpaceId) {
        lock(&self.by_space).remove(space);
    }
}

pub fn held_open(paths: &[PathBuf]) -> HashSet<PathBuf> {
    if paths.is_empty() {
        return HashSet::new();
    }
    platform::held_open(paths)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        collections::HashSet,
        ffi::{c_void, CStr},
        os::raw::{c_char, c_int},
        path::PathBuf,
    };

    const PROC_UID_ONLY: u32 = 4;
    const PROC_PIDFDVNODEPATHINFO: c_int = 2;

    #[repr(C)]
    struct ProcFileInfo {
        fi_openflags: u32,
        fi_status: u32,
        fi_offset: i64,
        fi_type: i32,
        fi_guardflags: u32,
    }

    #[repr(C)]
    struct VnodeFdInfoWithPath {
        pfi: ProcFileInfo,
        pvip: libc::vnode_info_path,
    }

    pub fn held_open(paths: &[PathBuf]) -> HashSet<PathBuf> {
        let wanted: HashSet<&PathBuf> = paths.iter().collect();
        let mut held = HashSet::new();
        let pid_size = std::mem::size_of::<libc::pid_t>();
        // SAFETY: a null buffer only asks for the size the list would take.
        let bytes =
            unsafe { libc::proc_listpids(PROC_UID_ONLY, libc::getuid(), std::ptr::null_mut(), 0) };
        if bytes <= 0 {
            return held;
        }
        let mut pids: Vec<libc::pid_t> = vec![0; bytes as usize / pid_size + 32];
        // SAFETY: the buffer is as long as the size given.
        let bytes = unsafe {
            libc::proc_listpids(
                PROC_UID_ONLY,
                libc::getuid(),
                pids.as_mut_ptr().cast::<c_void>(),
                (pids.len() * pid_size) as c_int,
            )
        };
        let count = (bytes.max(0) as usize / pid_size).min(pids.len());
        let fd_size = std::mem::size_of::<libc::proc_fdinfo>();
        for &pid in &pids[..count] {
            if pid <= 0 {
                continue;
            }
            // SAFETY: as above, a null buffer asks for the size.
            let size = unsafe {
                libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0)
            };
            if size <= 0 {
                continue;
            }
            // SAFETY: `proc_fdinfo` is plain data; all zeroes is a valid value.
            let mut fds: Vec<libc::proc_fdinfo> =
                vec![unsafe { std::mem::zeroed() }; size as usize / fd_size + 16];
            // SAFETY: the buffer is as long as the size given.
            let got = unsafe {
                libc::proc_pidinfo(
                    pid,
                    libc::PROC_PIDLISTFDS,
                    0,
                    fds.as_mut_ptr().cast::<c_void>(),
                    (fds.len() * fd_size) as c_int,
                )
            };
            let got = (got.max(0) as usize / fd_size).min(fds.len());
            for fd in &fds[..got] {
                if fd.proc_fdtype != libc::PROX_FDTYPE_VNODE as u32 {
                    continue;
                }
                // SAFETY: plain data; all zeroes is a valid value.
                let mut info: VnodeFdInfoWithPath = unsafe { std::mem::zeroed() };
                let wanted_size = std::mem::size_of::<VnodeFdInfoWithPath>() as c_int;
                // SAFETY: `info` is as large as the size given.
                let written = unsafe {
                    libc::proc_pidfdinfo(
                        pid,
                        fd.proc_fd,
                        PROC_PIDFDVNODEPATHINFO,
                        (&mut info as *mut VnodeFdInfoWithPath).cast::<c_void>(),
                        wanted_size,
                    )
                };
                if written != wanted_size {
                    continue;
                }
                // SAFETY: the kernel writes a NUL-terminated path into the 1024-byte array.
                let path = unsafe { CStr::from_ptr(info.pvip.vip_path.as_ptr().cast::<c_char>()) };
                let path = PathBuf::from(path.to_string_lossy().into_owned());
                if wanted.contains(&path) {
                    held.insert(path);
                }
            }
            if held.len() == wanted.len() {
                break;
            }
        }
        held
    }
}

#[cfg(target_os = "linux")]
mod platform {
    #![allow(clippy::disallowed_methods)]
    use std::{collections::HashSet, os::unix::fs::MetadataExt, path::PathBuf};

    pub fn held_open(paths: &[PathBuf]) -> HashSet<PathBuf> {
        let wanted: HashSet<&PathBuf> = paths.iter().collect();
        let mut held = HashSet::new();
        // SAFETY: getuid has no preconditions.
        let me = unsafe { libc::getuid() };
        let Ok(processes) = std::fs::read_dir("/proc") else {
            return held;
        };
        for process in processes.flatten() {
            let name = process.file_name();
            if !name.to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            if !std::fs::metadata(process.path()).is_ok_and(|meta| meta.uid() == me) {
                continue;
            }
            let Ok(fds) = std::fs::read_dir(process.path().join("fd")) else {
                continue;
            };
            for fd in fds.flatten() {
                if let Ok(target) = std::fs::read_link(fd.path()) {
                    if wanted.contains(&target) {
                        held.insert(target);
                    }
                }
            }
            if held.len() == wanted.len() {
                break;
            }
        }
        held
    }
}

#[cfg(windows)]
mod platform {
    use std::{collections::HashSet, os::windows::ffi::OsStrExt, path::PathBuf};

    use windows_sys::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS};
    use windows_sys::Win32::System::RestartManager::{
        RmEndSession, RmGetList, RmRegisterResources, RmStartSession, CCH_RM_SESSION_KEY,
    };

    const MOST: usize = 64;

    pub fn held_open(paths: &[PathBuf]) -> HashSet<PathBuf> {
        let mut held = HashSet::new();
        for path in paths.iter().take(MOST) {
            let mut session = 0u32;
            let mut key = [0u16; CCH_RM_SESSION_KEY as usize + 1];
            // SAFETY: the out pointers are valid for the call, the key buffer is as long as the
            // API asks.
            if unsafe { RmStartSession(&mut session, 0, key.as_mut_ptr()) } != ERROR_SUCCESS {
                continue;
            }
            let wide: Vec<u16> = path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let names = [wide.as_ptr()];
            // SAFETY: one NUL-terminated name that outlives the call; no apps or services.
            let registered = unsafe {
                RmRegisterResources(
                    session,
                    1,
                    names.as_ptr(),
                    0,
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                )
            };
            if registered == ERROR_SUCCESS {
                let (mut needed, mut count, mut reasons) = (0u32, 0u32, 0u32);
                // SAFETY: a null list with a zero count only asks how many hold it.
                let listed = unsafe {
                    RmGetList(
                        session,
                        &mut needed,
                        &mut count,
                        std::ptr::null_mut(),
                        &mut reasons,
                    )
                };
                if (listed == ERROR_SUCCESS || listed == ERROR_MORE_DATA) && needed > 0 {
                    held.insert(path.clone());
                }
            }
            // SAFETY: the session was started above.
            unsafe {
                RmEndSession(session);
            }
        }
        held
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod platform {
    use std::{collections::HashSet, path::PathBuf};

    pub fn held_open(_paths: &[PathBuf]) -> HashSet<PathBuf> {
        HashSet::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_opens_and_closes() {
        let opens = Opens::default();
        let key = (SpaceId("s".into()), ItemId("drv_a".into()));
        assert!(opens.open(key.clone(), false));
        assert!(!opens.open(key.clone(), true));
        assert!(opens.is_writing(&key));
        assert!(!opens.close(&key, true));
        assert!(!opens.is_writing(&key));
        assert!(opens.close(&key, false));
        assert!(!opens.is_open(&key));
    }

    #[test]
    fn a_brief_open_is_not_reported_until_it_lasts_or_is_written() {
        let opens = Opens::default();
        let key = (SpaceId("s".into()), ItemId("drv_a".into()));
        assert!(!opens.wrote(&key), "a closed item has no open to report");
        opens.open(key.clone(), false);
        assert!(!opens.reportable(&key));
        assert!(opens.reportable_keys().is_empty());
        assert!(opens.wrote(&key));
        assert!(opens.reportable(&key));
        assert!(!opens.wrote(&key), "already reported");
        assert!(opens.close(&key, false));
        opens.open(key.clone(), true);
        assert!(!opens.reportable(&key), "a new open starts over");
    }

    #[test]
    fn a_renewal_is_no_change_and_a_lapsed_lease_goes() {
        let marks = Marks::default();
        let space = SpaceId("s".into());
        let item = ItemId("drv_a".into());
        let ana = |editing, expires_ms| Held {
            user_id: "ana".into(),
            name: "Ana".into(),
            device_id: "dev_1".into(),
            device_name: "MacBook".into(),
            editing,
            expires_ms,
        };
        assert_eq!(
            marks.replace(&space, vec![(item.clone(), ana(false, 100))], 0),
            HashSet::from([item.clone()])
        );
        assert!(marks
            .replace(&space, vec![(item.clone(), ana(false, 200))], 0)
            .is_empty());
        assert_eq!(
            marks.replace(&space, vec![(item.clone(), ana(true, 200))], 0),
            HashSet::from([item.clone()])
        );
        assert!(marks.expiring(&space, 200));
        assert!(marks.expire(&space, 199).is_empty());
        assert_eq!(marks.expire(&space, 200), HashSet::from([item.clone()]));
        assert!(marks.on(&space, &item, 0).is_empty());
    }
}
