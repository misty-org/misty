#![cfg(unix)]
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::fs::PermissionsExt,
    process::{Command, Stdio},
    sync::mpsc::{channel, Receiver},
    time::Duration,
};
struct Worker {
    child: std::process::Child,
    input: Option<std::process::ChildStdin>,
    events: Receiver<Value>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.input.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Worker {
    fn start(shell: &std::path::Path, home: &std::path::Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_misty-terminal"))
            .env("SHELL", shell)
            .env("HOME", home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let input = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (send, events) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else {
                    break;
                };
                if send.send(serde_json::from_str(&line).unwrap()).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            input,
            events,
        }
    }
    fn finish(&mut self) -> std::process::ExitStatus {
        self.input.take();
        let start = std::time::Instant::now();
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "worker did not stop after EOF"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn request(&mut self, id: u64, command: Value) {
        writeln!(
            self.input.as_mut().unwrap(),
            "{}",
            json!({"protocol":1,"id":id,"command":command})
        )
        .unwrap();
    }
    fn event(&self) -> Value {
        self.events
            .recv_timeout(Duration::from_secs(5))
            .expect("worker response")
    }
}
#[test]
fn real_protocol_preserves_environment_stream_and_exit() {
    let root = tempfile::tempdir().unwrap();
    let shell = root.path().join("shell");
    std::fs::write(&shell, "#!/bin/sh\nexec /bin/sh -s\n").unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut worker = Worker::start(&shell, root.path());
    worker.request(1,json!({"operation":"create","request":{"cwd":root.path(),"env":{"MISTY_TERMINAL_TEST":"worker-owned"}}}));
    let ready = worker.event();
    assert_eq!(ready["id"], 1);
    assert!(ready.get("error").is_none());
    worker.request(2,json!({"operation":"write","data":"printf '\\nVALUE=%s\\n' \"$MISTY_TERMINAL_TEST\"; exit 9\n"}));
    let mut output = String::new();
    let mut reply = false;
    let mut exited = false;
    while !(reply && exited) {
        let event = worker.event();
        assert_eq!(event["protocol"], 1);
        if event["id"] == 2 {
            reply = true;
            assert!(event.get("error").is_none());
        }
        if event["event"] == "output" {
            output.push_str(event["data"].as_str().unwrap());
        }
        if event["event"] == "exit" {
            assert_eq!(event["exitCode"], 9);
            exited = true;
        }
    }
    assert!(output.contains("VALUE=worker-owned"));
    worker.input.take();
    assert!(worker.finish().success());
}
#[test]
fn rejects_invalid_protocol_without_starting_a_shell() {
    let root = tempfile::tempdir().unwrap();
    let marker = root.path().join("should-not-run");
    let shell = root.path().join("shell");
    std::fs::write(&shell, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut worker = Worker::start(&shell, root.path());
    writeln!(
        worker.input.as_mut().unwrap(),
        "{}",
        json!({"protocol":99,"id":1,"command":{"operation":"create","request":{"env":{}}}})
    )
    .unwrap();
    worker.input.take();
    assert!(!worker.finish().success());
    assert!(!marker.exists());
}

#[test]
fn closing_supervisor_input_stops_live_pty_process() {
    let root = tempfile::tempdir().unwrap();
    let shell = root.path().join("shell");
    std::fs::write(&shell, "#!/bin/sh\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut worker = Worker::start(&shell, root.path());
    worker.request(1, json!({"operation":"create","request":{"env":{}}}));
    let ready = worker.event();
    let pid = ready["result"]["processId"]
        .as_u64()
        .expect("owned process") as i32;
    assert!(pid > 1);
    assert!(worker.finish().success());
    let start = std::time::Instant::now();
    while unsafe { libc::kill(pid, 0) } == 0 {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "PTY process survived supervisor EOF"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn supervisor_eof_cancels_even_when_pty_input_is_blocked() {
    let root = tempfile::tempdir().unwrap();
    let shell = root.path().join("shell");
    std::fs::write(
        &shell,
        "#!/bin/sh\nstty -icanon -echo\nprintf raw-ready\nexec sleep 30\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut worker = Worker::start(&shell, root.path());
    worker.request(1, json!({"operation":"create","request":{"env":{}}}));
    let ready = worker.event();
    let pid = ready["result"]["processId"].as_u64().unwrap() as i32;
    loop {
        let event = worker.event();
        if event["data"]
            .as_str()
            .is_some_and(|value| value.contains("raw-ready"))
        {
            break;
        }
    }
    worker.request(2, json!({"operation":"write","data":"x".repeat(512*1024)}));
    std::thread::sleep(Duration::from_millis(100));
    assert!(worker.finish().success());
    let start = std::time::Instant::now();
    while unsafe { libc::kill(pid, 0) } == 0 {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "blocked input prevented cancellation"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
