use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

type Seen = Arc<Mutex<HashMap<i32, (u64, u64)>>>;

pub struct Tree {
    seen: Seen,
    task: tokio::task::JoinHandle<()>,
}

#[cfg(target_os = "macos")]
fn start_time(pid: i32) -> Option<(u64, u64)> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    (read == size).then_some((info.pbi_start_tvsec, info.pbi_start_tvusec))
}

#[cfg(target_os = "macos")]
fn children(pid: i32) -> Vec<i32> {
    let mut buffer = vec![0 as libc::pid_t; 512];
    let bytes = unsafe {
        libc::proc_listchildpids(
            pid,
            buffer.as_mut_ptr() as *mut libc::c_void,
            (buffer.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
        )
    };
    if bytes <= 0 {
        return Vec::new();
    }
    let count = (bytes as usize).min(buffer.len());
    buffer.truncate(count);
    buffer.retain(|pid| *pid > 1);
    buffer
}

#[cfg(target_os = "linux")]
#[allow(clippy::disallowed_methods)]
fn start_time(pid: i32) -> Option<(u64, u64)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 1..];
    let ticks = rest.split_whitespace().nth(19)?.parse().ok()?;
    Some((ticks, 0))
}

#[cfg(target_os = "linux")]
#[allow(clippy::disallowed_methods)]
fn children(pid: i32) -> Vec<i32> {
    let mut found = Vec::new();
    for task in std::fs::read_dir(format!("/proc/{pid}/task"))
        .into_iter()
        .flatten()
        .flatten()
    {
        let Ok(list) = std::fs::read_to_string(task.path().join("children")) else {
            continue;
        };
        found.extend(
            list.split_whitespace()
                .filter_map(|child| child.parse::<i32>().ok())
                .filter(|child| *child > 1),
        );
        if found.len() >= 512 {
            break;
        }
    }
    found
}

fn record(root: i32, seen: &Seen) {
    let mut queue = vec![root];
    let mut visited = 0;
    while let Some(pid) = queue.pop() {
        visited += 1;
        if visited > 4096 {
            break;
        }
        for child in children(pid) {
            if let Some(started) = start_time(child) {
                if let Ok(mut seen) = seen.lock() {
                    seen.entry(child).or_insert(started);
                }
            }
            queue.push(child);
        }
    }
}

impl Tree {
    pub fn watch(root: Option<u32>) -> Self {
        let seen: Seen = Arc::default();
        let task = match root {
            Some(root) if root > 1 => {
                let seen = seen.clone();
                tokio::spawn(async move {
                    loop {
                        record(root as i32, &seen);
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                })
            }
            _ => tokio::spawn(async {}),
        };
        Self { seen, task }
    }

    pub fn kill_all(&self) {
        let seen: Vec<(i32, (u64, u64))> = self
            .seen
            .lock()
            .map(|seen| seen.iter().map(|(pid, started)| (*pid, *started)).collect())
            .unwrap_or_default();
        for (pid, started) in seen {
            if start_time(pid) == Some(started) {
                unsafe { libc::kill(pid, libc::SIGKILL) };
            }
        }
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        self.task.abort();
        self.kill_all();
    }
}
