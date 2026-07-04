#![cfg(unix)]
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
struct Worker {
    child: Child,
    root: tempfile::TempDir,
    events: mpsc::Receiver<Value>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        if let Ok(pid) = std::fs::read_to_string(self.root.path().join("child.pid")) {
            if let Ok(pid) = pid.parse::<i32>() {
                unsafe {
                    libc::kill(-pid, libc::SIGKILL);
                }
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Worker {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let server = root.path().join("pyright-langserver");
        std::fs::write(&server, "#!/bin/sh\nprintf '%s' \"$$\" > child.pid\nIFS= read -r header\nprintf blocked > blocked.marker\nexec /bin/sleep 30\n").unwrap();
        std::fs::set_permissions(server, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut child = Command::new(env!("CARGO_BIN_EXE_misty-code-tools"))
            .env_clear()
            .env("HOME", root.path())
            .env(
                "PATH",
                format!(
                    "{}:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin",
                    root.path().display()
                ),
            )
            .current_dir(root.path())
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let output = child.stdout.take().unwrap();
        let (send, events) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                if let Ok(line) = line {
                    if let Ok(value) = serde_json::from_str(&line) {
                        let _ = send.send(value);
                    }
                }
            }
        });
        Self {
            child,
            root,
            events,
        }
    }
    fn request(&mut self, value: Value) {
        let input = self.child.stdin.as_mut().unwrap();
        serde_json::to_writer(&mut *input, &value).unwrap();
        input.write_all(b"\n").unwrap();
        input.flush().unwrap();
    }
    fn start(&mut self) -> i32 {
        self.request(
            json!({"protocol":1,"id":1,"command":{"operation":"start","language":"python"}}),
        );
        let response = self.events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(response["id"], 1);
        assert!(response.get("error").is_none(), "{response}");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(pid) = std::fs::read_to_string(self.root.path().join("child.pid")) {
                if let Ok(pid) = pid.parse() {
                    return pid;
                }
            }
            assert!(
                Instant::now() < deadline,
                "child did not start in the selected cwd"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn wait(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline, "worker did not stop");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
#[test]
fn invalid_protocol_never_starts_a_language_server() {
    let mut worker = Worker::new();
    worker
        .request(json!({"protocol":2,"id":1,"command":{"operation":"start","language":"python"}}));
    worker.wait();
    assert!(!worker.root.path().join("child.pid").exists());
}
#[test]
fn supervisor_eof_reaps_the_language_server() {
    let mut worker = Worker::new();
    let pid = worker.start();
    drop(worker.child.stdin.take());
    worker.wait();
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
}
#[test]
fn supervisor_eof_interrupts_a_blocked_language_server_write() {
    let mut worker = Worker::new();
    let pid = worker.start();
    let payload =
        json!({"jsonrpc":"2.0","method":"blocked","params":{"text":"x".repeat(2*1024*1024)}})
            .to_string();
    worker.request(json!({"protocol":1,"id":2,"command":{"operation":"send","payload":payload}}));
    let deadline = Instant::now() + Duration::from_secs(5);
    while !worker.root.path().join("blocked.marker").exists() {
        assert!(
            Instant::now() < deadline,
            "server never received the pending write"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        worker.events.try_recv().is_err(),
        "a blocked write must not report completion"
    );
    drop(worker.child.stdin.take());
    worker.wait();
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
}

#[test]
fn protocol_preserves_json_rpc_bytes_and_forwards_server_messages() {
    let mut worker = Worker::new();
    let payload =
        json!({"jsonrpc":"2.0","id":7,"method":"example","params":{"text":"λ"}}).to_string();
    let reply = json!({"jsonrpc":"2.0","id":7,"result":{"text":"λ"}}).to_string();
    let script = format!(
        "#!/bin/sh\nprintf '%s' \"$$\" > child.pid\nIFS= read -r header\nprintf '%s' \"$header\" > header.txt\nIFS= read -r empty\n/bin/dd bs=1 count={} > request.json 2>/dev/null\nprintf 'Content-Length: {}\\r\\n\\r\\n%s' '{}'\nexec /bin/sleep 30\n",
        payload.len(), reply.len(), reply
    );
    std::fs::write(worker.root.path().join("pyright-langserver"), script).unwrap();
    worker.start();
    worker.request(json!({"protocol":1,"id":2,"command":{"operation":"send","payload":payload}}));
    let mut acknowledged = false;
    let mut received = false;
    for _ in 0..2 {
        let event = worker.events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(event.get("error").is_none(), "{event}");
        if event["id"] == 2 {
            acknowledged = true;
        }
        if event["event"] == "message" {
            assert_eq!(event["payload"], reply);
            received = true;
        }
    }
    assert!(acknowledged && received);
    assert_eq!(
        std::fs::read_to_string(worker.root.path().join("request.json")).unwrap(),
        payload
    );
    assert_eq!(
        std::fs::read_to_string(worker.root.path().join("header.txt")).unwrap(),
        format!("Content-Length: {}\r", payload.len())
    );
    drop(worker.child.stdin.take());
    worker.wait();
}
