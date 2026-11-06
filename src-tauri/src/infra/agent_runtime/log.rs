//! `<data>/runtime.log`, where the runtime's `[misty-agent-runtime]` lines go for benchmarks and for
//! finding out why a run failed. Nothing else here writes a log that grows, so this sets its own
//! limit: past 20 MiB it moves to `runtime.log.1`, over any older one, and starts again. Nothing that
//! goes wrong here reaches a run.
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
};

use misty_agent::runtime::LogSink;

use crate::infra::file_access::fs;

const MAX_BYTES: u64 = 20 * 1024 * 1024;

struct RuntimeLog {
    path: PathBuf,
    limit: u64,
    open: Option<(fs::File, u64)>,
}

fn open(path: &Path) -> Option<(fs::File, u64)> {
    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()?;
    let size = file.metadata().map_or(0, |metadata| metadata.len());
    Some((file, size))
}

impl RuntimeLog {
    fn write(&mut self, line: &str) {
        let incoming = line.len() as u64 + 1;
        if self.open.is_none() {
            self.open = open(&self.path);
        }
        if self
            .open
            .as_ref()
            .is_some_and(|(_, size)| *size > 0 && size + incoming > self.limit)
        {
            self.open = None;
            let mut older = self.path.clone().into_os_string();
            older.push(".1");
            let _ = fs::rename(&self.path, PathBuf::from(older));
            self.open = open(&self.path);
        }
        let Some((file, size)) = self.open.as_mut() else {
            return;
        };
        if writeln!(file, "{line}").is_ok() {
            *size += incoming;
        }
    }
}

fn sink_with_limit(path: PathBuf, limit: u64) -> LogSink {
    let log = Mutex::new(RuntimeLog {
        path,
        limit,
        open: None,
    });
    Arc::new(move |line: &str| {
        log.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .write(line);
    })
}

/// Where the crate's log lines go.
pub(super) fn sink(path: PathBuf) -> LogSink {
    sink_with_limit(path, MAX_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_arrive_whole_and_the_log_stops_growing() {
        let home = crate::infra::paths::misty_home_dir()
            .unwrap()
            .join("runtime-log-test");
        fs::create_dir_all(&home).unwrap();
        let path = home.join("runtime.log");
        let log = sink_with_limit(path.clone(), 40);
        for index in 0..10 {
            log(&format!("[misty-agent-runtime] line {index}"));
        }
        let newest = fs::read_to_string(&path).unwrap();
        assert!(newest.len() <= 40, "{newest}");
        assert!(newest.ends_with("line 9\n"), "{newest}");
        let older = fs::read_to_string(home.join("runtime.log.1")).unwrap();
        assert!(older.len() <= 40, "{older}");
        assert!(older.ends_with("line 8\n"), "{older}");
    }

    #[test]
    fn a_log_it_cannot_open_is_not_a_failure() {
        let log = sink(PathBuf::from("/nonexistent/folder/runtime.log"));
        log("[misty-agent-runtime] nowhere to go");
    }
}
