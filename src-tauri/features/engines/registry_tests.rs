// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/registry.rs.
use super::*;

/// A send on a session whose process idles for a background follow-up
/// retires that process exactly once; any other session is untouched, and
/// a run that settled or resumed no longer counts as idle.
#[test]
fn awaiting_followup_is_taken_once_per_session_and_cleared_by_run() {
    let registry = ProcessRegistry::default();
    let prefs = || FollowupPrefs {
        model: None,
        effort: None,
        permission: None,
        provider_id: None,
        allowed_tools: None,
        launch: Vec::new(),
    };
    registry.set_awaiting_followup("s-1", "run-1", prefs());
    registry.set_awaiting_followup("s-2", "run-2", prefs());

    assert_eq!(
        registry.take_awaiting_followup("s-1").map(|a| a.run_id).as_deref(),
        Some("run-1")
    );
    assert!(registry.take_awaiting_followup("s-1").is_none());
    assert!(registry.take_awaiting_followup("unknown").is_none());

    registry.clear_awaiting_followup("run-2");
    assert!(registry.take_awaiting_followup("s-2").is_none());
}

/// rekey must COPY (not move) so both the session-id and run-id keys
/// route an interrupt to the same process. A resume whose
/// thread.started never arrives leaves run id as the only route — a
/// moving rekey leaked the child (user pressed Stop, nothing died).
#[tokio::test]
async fn rekey_keeps_both_keys_and_kill_routes_by_either() {
    let child = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
        .args(if cfg!(windows) {
            ["/c", "ping -n 30 127.0.0.1"]
        } else {
            ["-c", "sleep 30"]
        })
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn sleep child");
    let pid = child.id().unwrap_or(0);
    let entry = ChildEntry {
        child: Some(Arc::new(TokioMutex::new(child))),
        pid,
        run_id: "run-1".to_string(),
        killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        reader_abort: Arc::new(std::sync::OnceLock::new()),
        stdin: None,
        questions: Arc::new(Mutex::new(HashMap::new())),
        plans: Arc::new(Mutex::new(HashMap::new())),
    };
    let registry = Arc::new(ProcessRegistry::default());
    registry.insert("run-1".to_string(), entry);

    // Simulate the engine adopting the native session id mid-run.
    registry.rekey("run-1", "session-9".to_string());

    // Both keys route to the same pid; killing by the RUN id (the
    // fallback route when the session announcement never arrived) must
    // still find it, and the session key must survive the by-run-id
    // kill so a second stop also lands (idempotent, pid-deduped).
    assert!(registry.kill("run-1"));
    // kill does not drain: both keys still map to the (now dying)
    // child, so a second stop via the session id still lands on the
    // same entry. Its boolean result is racy (the child may already be
    // reaped, in which case kill_entry reports false on a SUCCESSFUL
    // interrupt), so assert the routing — not the return value.
    assert_eq!(registry.len(), 2);
    let _ = registry.kill("session-9");

    // The registry drains the entry from both keys on exit.
    registry.remove_if_pid("session-9", pid);
    registry.remove_if_pid("run-1", pid);
    assert_eq!(registry.len(), 0);
}

/// A resumed session is registered under its preassigned id at spawn:
/// the engine's own announcement of that same id equals it, so
/// adopt_session_id early-returns and never rekeys. Without the alias a
/// by-session-id Stop found nothing.
#[tokio::test]
async fn preassigned_session_alias_routes_stop_before_session_event() {
    let child = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
        .args(if cfg!(windows) {
            ["/c", "ping -n 30 127.0.0.1"]
        } else {
            ["-c", "sleep 30"]
        })
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn sleep child");
    let pid = child.id().unwrap_or(0);
    let entry = ChildEntry {
        child: Some(Arc::new(TokioMutex::new(child))),
        pid,
        run_id: "run-preassigned".to_string(),
        killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        reader_abort: Arc::new(std::sync::OnceLock::new()),
        stdin: None,
        questions: Arc::new(Mutex::new(HashMap::new())),
        plans: Arc::new(Mutex::new(HashMap::new())),
    };
    let registry = Arc::new(ProcessRegistry::default());
    registry.insert("run-preassigned".to_string(), entry.clone());
    registry.insert_alias("session-preassigned".to_string(), entry);

    assert!(registry.kill("session-preassigned"));
    registry.remove_if_pid("session-preassigned", pid);
    registry.remove_if_pid("run-preassigned", pid);
    assert_eq!(registry.len(), 0);
}

/// The real Windows stop bug: engine CLIs run as `cmd /c shim.cmd` and
/// the model process is a grandchild. Killing must take the WHOLE tree
/// down synchronously — a fire-and-forget taskkill that raced the direct
/// child's start_kill orphaned the grandchild (it kept streaming and
/// burning tokens after the user pressed Stop). This spawns a cmd whose
/// grandchild outlives it and asserts the grandchild is gone after kill.
#[cfg(windows)]
#[tokio::test]
async fn kill_reaps_windows_grandchild_process_tree() {
    use std::collections::HashSet;
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

    let child = tokio::process::Command::new("cmd")
        .args(["/c", "ping -n 60 127.0.0.1 > NUL"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn cmd child");
    let cmd_pid = child.id().unwrap_or(0);

    // Let cmd spawn its ping grandchild.
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing(),
    );
    let grandchildren: Vec<Pid> = sys
        .processes()
        .iter()
        .filter(|(_, p)| p.parent() == Some(Pid::from_u32(cmd_pid)))
        .map(|(pid, _)| *pid)
        .collect();
    assert!(
        !grandchildren.is_empty(),
        "expected cmd to have spawned a ping grandchild"
    );

    let entry = ChildEntry {
        child: Some(Arc::new(TokioMutex::new(child))),
        pid: cmd_pid,
        run_id: "run-tree".to_string(),
        killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        reader_abort: Arc::new(std::sync::OnceLock::new()),
        stdin: None,
        questions: Arc::new(Mutex::new(HashMap::new())),
        plans: Arc::new(Mutex::new(HashMap::new())),
    };
    let registry = Arc::new(ProcessRegistry::default());
    registry.insert("run-tree".to_string(), entry);
    assert!(registry.kill("run-tree"));

    // Poll: process teardown is observable only after the kernel reaps.
    let targets: HashSet<Pid> = grandchildren
        .iter()
        .copied()
        .chain(std::iter::once(Pid::from_u32(cmd_pid)))
        .collect();
    let mut alive = targets.clone();
    for _ in 0..50 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );
        alive.retain(|pid| sys.process(*pid).is_some());
        if alive.is_empty() {
            break;
        }
    }
    assert!(
        alive.is_empty(),
        "stop left process-tree survivors alive: {alive:?}"
    );
}
fn stub_entry(run_id: &str, pid: u32) -> ChildEntry {
    ChildEntry {
        child: None,
        pid,
        run_id: run_id.to_string(),
        killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        reader_abort: Arc::new(std::sync::OnceLock::new()),
        stdin: None,
        questions: Arc::new(Mutex::new(HashMap::new())),
        plans: Arc::new(Mutex::new(HashMap::new())),
    }
}

#[test]
fn live_run_ids_answers_by_run_id_under_either_key() {
    let registry = ProcessRegistry::default();
    registry.insert("run-a".into(), stub_entry("run-a", 101));
    // After a rekey only the session alias remains; it still carries the
    // run id the frontend routes by.
    registry.insert_alias("session-b".into(), stub_entry("run-b", 102));
    let asked = ["run-a", "run-b", "run-gone"].map(String::from);
    assert_eq!(registry.live_run_ids(&asked), ["run-a", "run-b"]);
    registry.remove_run_if_pid("run-a", 101);
    assert_eq!(registry.live_run_ids(&asked), ["run-b"]);
    // Parked for a background follow-up: the process lives on, but its
    // turn already sent done — an observer that missed it must recover.
    let prefs = FollowupPrefs {
        model: None,
        effort: None,
        permission: None,
        provider_id: None,
        allowed_tools: None,
        launch: Vec::new(),
    };
    registry.set_awaiting_followup("session-b", "run-b", prefs);
    assert!(registry.live_run_ids(&asked).is_empty());
    registry.clear_awaiting_followup("run-b");
    assert_eq!(registry.live_run_ids(&asked), ["run-b"]);
}

#[test]
fn session_edit_lease_blocks_only_its_session_until_dropped() {
    let registry = ProcessRegistry::default();
    registry.insert("other-run".into(), stub_entry("other-run", 101));
    let edit = registry.begin_session_edit("edited").unwrap();
    assert!(registry.ensure_session_not_editing(Some("edited")).is_err());
    assert!(registry.begin_session_edit("edited").is_err());
    registry.ensure_session_not_editing(Some("other")).unwrap();
    registry.ensure_session_not_editing(None).unwrap();
    assert!(registry.get("other-run").is_some());
    assert!(registry.0.try_lock().is_ok(), "remote I/O must not hold the process map lock");
    drop(edit);
    registry.ensure_session_not_editing(Some("edited")).unwrap();
    assert!(registry.begin_session_edit("edited").is_ok());
}

#[test]
fn session_edit_lease_rejects_live_and_launching_turns() {
    let registry = ProcessRegistry::default();
    registry.insert_alias("edited".into(), stub_entry("live-run", 101));
    assert!(registry.begin_session_edit("edited").is_err());
    registry.remove_run_if_pid("live-run", 101);
    registry.insert("launching-run".into(), stub_entry("launching-run", 0));
    registry.insert_alias("edited".into(), stub_entry("launching-run", 0));
    assert!(registry.begin_session_edit("edited").is_err());
    registry.remove_reservation("launching-run");
    assert!(registry.begin_session_edit("edited").is_ok());
}

#[test]
fn unrelated_launch_does_not_block_editing_a_stopped_session() {
    let registry = ProcessRegistry::default();
    registry.insert("other-run".into(), stub_entry("other-run", 0));
    registry.insert_alias("other-session".into(), stub_entry("other-run", 0));
    let edit = registry.begin_session_edit("edited").unwrap();
    assert!(registry.begin_session_edit("other-session").is_err());
    assert!(registry.ensure_session_not_editing(Some("edited")).is_err());
    registry.ensure_session_not_editing(Some("another-session")).unwrap();
    drop(edit);
    assert!(registry.begin_session_edit("edited").is_ok());
}

#[test]
fn launch_session_alias_upgrades_and_failed_launch_releases_its_edit_block() {
    let registry = ProcessRegistry::default();
    registry.insert("launch".into(), stub_entry("launch", 0));
    registry.insert_alias("edited".into(), stub_entry("launch", 0));
    registry.insert("launch".into(), stub_entry("launch", 101));
    assert_eq!(registry.get("edited").unwrap().pid, 101);
    registry.remove_run_if_pid("launch", 101);
    registry.insert("failed".into(), stub_entry("failed", 0));
    registry.insert_alias("edited".into(), stub_entry("failed", 0));
    registry.remove_reservation("failed");
    assert!(registry.get("edited").is_none());
    assert!(registry.begin_session_edit("edited").is_ok());
}

/// The concurrency limit counts RUNS, not map entries: a run keyed
/// under both its run id and its session alias is one run — an entry
/// count halved the real ceiling (16 felt like 8).
#[test]
fn active_run_count_dedupes_session_alias_keys() {
    let registry = ProcessRegistry::default();
    registry.insert("run-1".to_string(), stub_entry("run-1", 101));
    registry.insert_alias("session-1".to_string(), stub_entry("run-1", 101));
    registry.insert("run-2".to_string(), stub_entry("run-2", 102));
    // A pre-spawn reservation (pid 0) is an in-flight run too.
    registry.insert("run-3".to_string(), stub_entry("run-3", 0));
    let map = registry.0.lock().expect("lock registry");
    assert_eq!(map.len(), 4);
    assert_eq!(active_run_count(&map), 3);
}

/// The kill() abort backstop skips the reader's remove_if_pid cleanup;
/// remove_run_if_pid must drain BOTH keys of the run so its slots do
/// not stay pinned until app exit.
#[test]
fn remove_run_if_pid_drains_every_key_of_the_run() {
    let registry = ProcessRegistry::default();
    registry.insert("run-1".to_string(), stub_entry("run-1", 101));
    registry.insert_alias("session-1".to_string(), stub_entry("run-1", 101));
    registry.insert("run-2".to_string(), stub_entry("run-2", 102));
    registry.remove_run_if_pid("run-1", 101);
    assert!(registry.get("run-1").is_none());
    assert!(registry.get("session-1").is_none());
    assert!(registry.get("run-2").is_some());
}

/// A client retry that reused the run id registers a NEW child with a
/// different pid; the backstop for the old run must not evict it (same
/// guard class as remove_if_pid's pid match).
#[test]
fn remove_run_if_pid_spares_same_id_successor() {
    let registry = ProcessRegistry::default();
    registry.insert("run-1".to_string(), stub_entry("run-1", 101));
    registry.remove_run_if_pid("run-1", 999);
    assert!(registry.get("run-1").is_some());
}
