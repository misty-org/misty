// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/registry.rs.
//! Live engine child-process registry: session/run-id keyed entries,
//! interrupt routing, and teardown sweeps.

use super::reader::READER_SETTLE_GRACE;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::io::AsyncWriteExt;
use tokio::process::Child;
use tokio::sync::{oneshot, Mutex as TokioMutex};

#[derive(Clone)]
pub struct ChildEntry {
    pub child: Option<Arc<TokioMutex<Child>>>,
    pub pid: u32,
    pub run_id: String,
    pub killed: Arc<std::sync::atomic::AtomicBool>,
    pub reader_abort: Arc<std::sync::OnceLock<tokio::task::AbortHandle>>,
    pub stdin: Option<Arc<TokioMutex<Option<tokio::process::ChildStdin>>>>,
    pub questions: Arc<Mutex<HashMap<String, Value>>>,
    pub plans: Arc<Mutex<HashMap<String, Value>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FollowupPrefs {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission: Option<String>,
    pub provider_id: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub launch: Vec<String>,
    pub dirs: Vec<String>,
    pub warm: bool,
}
#[derive(Debug, Clone)]
pub(crate) struct AwaitingFollowup {
    pub run_id: String,
    pub prefs: FollowupPrefs,
    pub idle_since: Option<std::time::Instant>,
}

pub(crate) const WARM_IDLE: std::time::Duration = std::time::Duration::from_secs(10 * 60);
pub(crate) const WARM_MAX: usize = 6;

pub(crate) fn reap_when_idle(
    registry: Arc<ProcessRegistry>,
    session_id: String,
    run_id: String,
    since: std::time::Instant,
) {
    tokio::spawn(async move {
        tokio::time::sleep(WARM_IDLE).await;
        if registry.expire_warm_followup(&session_id, &run_id, since) {
            registry.close_stdin(&run_id);
        }
    });
}

type PendingReplies = HashMap<(String, String), oneshot::Sender<Result<Value, String>>>;

type KillTarget = (
    u32,
    String,
    Option<Arc<TokioMutex<tokio::process::Child>>>,
    Arc<std::sync::atomic::AtomicBool>,
    Arc<std::sync::OnceLock<tokio::task::AbortHandle>>,
);

#[derive(Default)]
pub struct ProcessRegistry(
    pub Mutex<HashMap<String, ChildEntry>>,
    Mutex<PendingReplies>,
    Mutex<HashMap<String, AwaitingFollowup>>,
);

pub(crate) fn active_run_count(map: &HashMap<String, ChildEntry>) -> usize {
    map.values()
        .map(|entry| entry.run_id.as_str())
        .collect::<std::collections::HashSet<_>>()
        .len()
}

impl ProcessRegistry {
    pub(crate) fn register_pending_rpc_reply(
        &self,
        run_id: &str,
        request_id: &str,
    ) -> Result<oneshot::Receiver<Result<Value, String>>, String> {
        let (sender, receiver) = oneshot::channel();
        let mut pending = self
            .1
            .lock()
            .map_err(|_| "pending RPC reply state is poisoned".to_string())?;
        let key = (run_id.to_string(), request_id.to_string());
        if pending.contains_key(&key) {
            return Err("a reply is already pending for this RPC request".to_string());
        }
        pending.insert(key, sender);
        Ok(receiver)
    }

    pub(crate) fn resolve_pending_rpc_reply(
        &self,
        run_id: &str,
        request_id: &str,
        result: Result<Value, String>,
    ) -> bool {
        let sender =
            self.1.lock().ok().and_then(|mut pending| {
                pending.remove(&(run_id.to_string(), request_id.to_string()))
            });
        match sender {
            Some(sender) => sender.send(result).is_ok(),
            None => false,
        }
    }

    pub(crate) fn remove_pending_rpc_reply(&self, run_id: &str, request_id: &str) {
        if let Ok(mut pending) = self.1.lock() {
            pending.remove(&(run_id.to_string(), request_id.to_string()));
        }
    }

    pub(crate) fn settle_pending_rpc_replies(&self, run_id: &str) {
        let pending = match self.1.lock() {
            Ok(mut pending) => {
                let keys: Vec<_> = pending
                    .keys()
                    .filter(|(pending_run, _)| pending_run.as_str() == run_id)
                    .cloned()
                    .collect();
                keys.into_iter()
                    .filter_map(|key| pending.remove(&key))
                    .collect::<Vec<_>>()
            }
            Err(_) => return,
        };
        for sender in pending {
            let _ = sender.send(Err(
                "Codex turn ended before the answer was acknowledged".to_string()
            ));
        }
    }

    pub(crate) fn get(&self, key: &str) -> Option<ChildEntry> {
        self.0.lock().ok().and_then(|map| map.get(key).cloned())
    }

    #[cfg(test)]
    pub fn active_run_count(&self) -> usize {
        match self.0.lock() {
            Ok(map) => active_run_count(&map),
            Err(poisoned) => active_run_count(&poisoned.into_inner()),
        }
    }

    pub(crate) async fn write_line(&self, key: &str, line: String) -> Result<(), String> {
        let stdin = self
            .get(key)
            .and_then(|entry| entry.stdin)
            .ok_or_else(|| "the session is no longer accepting input".to_string())?;
        let mut guard = stdin.lock().await;
        let handle = guard
            .as_mut()
            .ok_or_else(|| "the session's stdin is already closed".to_string())?;
        handle
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("write to the session's stdin: {e}"))?;
        handle
            .write_all(b"\n")
            .await
            .map_err(|e| format!("write to the session's stdin: {e}"))
    }

    pub(crate) fn close_stdin(&self, key: &str) {
        let Some(stdin) = self.get(key).and_then(|entry| entry.stdin) else {
            return;
        };
        tokio::spawn(async move {
            *stdin.lock().await = None;
        });
    }
    pub(crate) fn set_stdin(
        &self,
        key: &str,
        stdin: Arc<TokioMutex<Option<tokio::process::ChildStdin>>>,
    ) {
        if let Ok(mut map) = self.0.lock() {
            let Some(run_id) = map.get(key).map(|entry| entry.run_id.clone()) else {
                return;
            };
            for entry in map.values_mut().filter(|entry| entry.run_id == run_id) {
                entry.stdin = Some(Arc::clone(&stdin));
            }
        }
    }

    pub(crate) fn take_questions(&self, key: &str) -> Vec<String> {
        let Some(entry) = self.get(key) else {
            return Vec::new();
        };
        let Ok(mut questions) = entry.questions.lock() else {
            return Vec::new();
        };
        let ids: Vec<String> = questions.keys().cloned().collect();
        questions.clear();
        ids
    }
    pub(crate) fn take_plans(&self, key: &str) -> Vec<(String, i64, Value)> {
        let Some(entry) = self.get(key) else {
            return Vec::new();
        };
        let Ok(mut plans) = entry.plans.lock() else {
            return Vec::new();
        };
        plans
            .drain()
            .map(|(plan_id, context)| {
                let revision = context.get("revision").and_then(Value::as_i64).unwrap_or(0);
                (plan_id, revision, context)
            })
            .collect()
    }

    pub(crate) fn set_awaiting_followup(
        &self,
        session_id: &str,
        run_id: &str,
        prefs: FollowupPrefs,
    ) {
        if let Ok(mut map) = self.2.lock() {
            map.insert(
                session_id.to_string(),
                AwaitingFollowup {
                    run_id: run_id.to_string(),
                    prefs,
                    idle_since: None,
                },
            );
        }
    }

    pub(crate) fn restore_awaiting_followup(&self, session_id: &str, awaiting: AwaitingFollowup) {
        if let Ok(mut map) = self.2.lock() {
            map.insert(session_id.to_string(), awaiting);
        }
    }

    pub(crate) fn set_warm_followup(
        &self,
        session_id: &str,
        run_id: &str,
        prefs: FollowupPrefs,
    ) -> (std::time::Instant, Vec<String>) {
        let since = std::time::Instant::now();
        let Ok(mut map) = self.2.lock() else {
            return (since, Vec::new());
        };
        map.insert(
            session_id.to_string(),
            AwaitingFollowup {
                run_id: run_id.to_string(),
                prefs,
                idle_since: Some(since),
            },
        );
        let mut idle: Vec<(std::time::Instant, String)> = map
            .iter()
            .filter_map(|(session, waiting)| waiting.idle_since.map(|at| (at, session.clone())))
            .collect();
        idle.sort();
        let over = idle.len().saturating_sub(WARM_MAX);
        let evicted = idle
            .into_iter()
            .take(over)
            .filter_map(|(_, session)| map.remove(&session).map(|waiting| waiting.run_id))
            .collect();
        (since, evicted)
    }

    pub(crate) fn expire_warm_followup(
        &self,
        session_id: &str,
        run_id: &str,
        since: std::time::Instant,
    ) -> bool {
        let Ok(mut map) = self.2.lock() else {
            return false;
        };
        let idle = map
            .get(session_id)
            .is_some_and(|waiting| waiting.run_id == run_id && waiting.idle_since == Some(since));
        if idle {
            map.remove(session_id);
        }
        idle
    }

    pub(crate) fn clear_awaiting_followup(&self, run_id: &str) {
        if let Ok(mut map) = self.2.lock() {
            map.retain(|_, waiting| waiting.run_id != run_id);
        }
    }

    pub(crate) fn take_awaiting_followup(&self, session_id: &str) -> Option<AwaitingFollowup> {
        self.2
            .lock()
            .ok()
            .and_then(|mut map| map.remove(session_id))
    }

    pub(crate) fn insert(&self, key: String, entry: ChildEntry) {
        if let Ok(mut map) = self.0.lock() {
            for reserved in map
                .values_mut()
                .filter(|reserved| reserved.pid == 0 && reserved.run_id == entry.run_id)
            {
                *reserved = entry.clone();
            }
            map.insert(key, entry);
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.0.lock().map(|map| map.len()).unwrap_or(0)
    }

    pub(crate) fn insert_alias(&self, key: String, entry: ChildEntry) {
        if let Ok(mut map) = self.0.lock() {
            map.entry(key).or_insert(entry);
        }
    }

    pub(crate) fn rekey(&self, from: &str, to: String) {
        if from == to {
            return;
        }
        if let Ok(mut map) = self.0.lock() {
            if map.contains_key(&to) {
                return;
            }
            if let Some(entry) = map.get(from).cloned() {
                map.insert(to, entry);
            }
        }
    }

    pub(crate) fn remove_reservation(&self, key: &str) {
        if let Ok(mut map) = self.0.lock() {
            let reserved = map
                .get(key)
                .map(|entry| entry.child.is_none() && entry.pid == 0)
                .unwrap_or(false);
            if reserved {
                map.retain(|_, entry| {
                    entry.run_id != key || entry.pid != 0 || entry.child.is_some()
                });
            }
        }
    }

    pub(crate) fn remove_if_pid(&self, key: &str, pid: u32) {
        if let Ok(mut map) = self.0.lock() {
            if map.get(key).map(|entry| entry.pid) == Some(pid) {
                map.remove(key);
            }
        }
    }
    pub(crate) fn remove_run_if_pid(&self, run_id: &str, pid: u32) {
        if let Ok(mut map) = self.0.lock() {
            map.retain(|_, entry| entry.run_id != run_id || entry.pid != pid);
        }
    }

    fn kill_entry(
        child: Option<&Arc<TokioMutex<tokio::process::Child>>>,
        pid: u32,
        killed: &Arc<std::sync::atomic::AtomicBool>,
    ) -> bool {
        killed.store(true, std::sync::atomic::Ordering::SeqCst);
        let Some(child) = child else {
            return true;
        };
        if let Ok(mut guard) = child.try_lock() {
            match guard.try_wait() {
                Ok(Some(_)) => false,
                _ => {
                    kill_process_group(pid);
                    let _ = guard.start_kill();
                    true
                }
            }
        } else {
            kill_process_group(pid);
            true
        }
    }

    pub fn kill(self: &Arc<Self>, key: &str) -> bool {
        let mut entries: Vec<KillTarget> = match self.0.lock() {
            Ok(map) => {
                let mut seen_pids = std::collections::HashSet::new();
                map.iter()
                    .filter(|(k, e)| *k == key || e.run_id == key)
                    .filter(|(_, e)| seen_pids.insert(e.pid))
                    .map(|(_, e)| {
                        (
                            e.pid,
                            e.run_id.clone(),
                            e.child.clone(),
                            Arc::clone(&e.killed),
                            Arc::clone(&e.reader_abort),
                        )
                    })
                    .collect()
            }
            Err(_) => Vec::new(),
        };
        entries.sort_by_key(|(pid, _, _, _, _)| *pid);
        entries.dedup_by_key(|(pid, _, _, _, _)| *pid);
        let mut killed_any = false;
        for (pid, _, child, killed, _) in &entries {
            killed_any |= Self::kill_entry(child.as_ref(), *pid, killed);
        }
        for (pid, run_id, _, _, reader_abort) in &entries {
            if let Some(handle) = reader_abort.get() {
                let handle = handle.clone();
                let registry = Arc::clone(self);
                let run_id = run_id.clone();
                let pid = *pid;
                tokio::spawn(async move {
                    tokio::time::sleep(READER_SETTLE_GRACE).await;
                    handle.abort();
                    registry.remove_run_if_pid(&run_id, pid);
                });
            }
        }
        killed_any
    }

    pub fn kill_all(&self) {
        let mut entries: Vec<ChildEntry> = match self.0.lock() {
            Ok(mut map) => map.drain().map(|(_, e)| e).collect(),
            Err(poisoned) => poisoned.into_inner().drain().map(|(_, e)| e).collect(),
        };
        entries.sort_by_key(|e| e.pid);
        entries.dedup_by_key(|e| e.pid);
        for entry in entries {
            if let Some(child) = entry.child.as_ref() {
                kill_process_group(entry.pid);
                if let Ok(mut guard) = child.try_lock() {
                    let _ = guard.start_kill();
                }
            }
            if let Some(handle) = entry.reader_abort.get() {
                handle.abort();
            }
        }
    }
}

impl Drop for ProcessRegistry {
    fn drop(&mut self) {
        let map = self.0.get_mut().unwrap_or_else(|e| e.into_inner());
        let mut entries: Vec<ChildEntry> = map.drain().map(|(_, e)| e).collect();
        entries.sort_by_key(|e| e.pid);
        entries.dedup_by_key(|e| e.pid);
        for entry in entries {
            if let Some(child) = entry.child.as_ref() {
                kill_process_group(entry.pid);
                if let Ok(mut guard) = child.try_lock() {
                    let _ = guard.start_kill();
                }
            }
        }
    }
}

#[cfg(unix)]
pub(crate) fn kill_process_group(pid: u32) {
    // SAFETY: kill with a negated pgid signals the group; no memory touched.
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
}

#[cfg(not(unix))]
pub(crate) fn kill_process_group(pid: u32) {
    let mut command = std::process::Command::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(mut killer) = command.spawn() else {
        return;
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        match killer.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
}

pub(crate) fn next_virtual_pid() -> u32 {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(u32::MAX / 2);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod registry_tests;
