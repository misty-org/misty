// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/registry.rs.
use super::*;

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
        dirs: Vec::new(),
        warm: false,
    };
    registry.set_awaiting_followup("s-1", "run-1", prefs());
    registry.set_awaiting_followup("s-2", "run-2", prefs());

    assert_eq!(
        registry
            .take_awaiting_followup("s-1")
            .map(|a| a.run_id)
            .as_deref(),
        Some("run-1")
    );
    assert!(registry.take_awaiting_followup("s-1").is_none());
    assert!(registry.take_awaiting_followup("unknown").is_none());

    registry.clear_awaiting_followup("run-2");
    assert!(registry.take_awaiting_followup("s-2").is_none());
}

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

    registry.rekey("run-1", "session-9".to_string());

    assert!(registry.kill("run-1"));
    assert_eq!(registry.len(), 2);
    let _ = registry.kill("session-9");

    registry.remove_if_pid("session-9", pid);
    registry.remove_if_pid("run-1", pid);
    assert_eq!(registry.len(), 0);
}

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

    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
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
fn launch_session_alias_upgrades_and_failed_launch_releases_its_alias() {
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
}

#[test]
fn active_run_count_dedupes_session_alias_keys() {
    let registry = ProcessRegistry::default();
    registry.insert("run-1".to_string(), stub_entry("run-1", 101));
    registry.insert_alias("session-1".to_string(), stub_entry("run-1", 101));
    registry.insert("run-2".to_string(), stub_entry("run-2", 102));
    registry.insert("run-3".to_string(), stub_entry("run-3", 0));
    let map = registry.0.lock().expect("lock registry");
    assert_eq!(map.len(), 4);
    assert_eq!(active_run_count(&map), 3);
}

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

#[test]
fn remove_run_if_pid_spares_same_id_successor() {
    let registry = ProcessRegistry::default();
    registry.insert("run-1".to_string(), stub_entry("run-1", 101));
    registry.remove_run_if_pid("run-1", 999);
    assert!(registry.get("run-1").is_some());
}
