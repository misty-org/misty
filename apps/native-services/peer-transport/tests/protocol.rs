use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
struct Worker {
    child: Child,
    output: mpsc::Receiver<Value>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Worker {
    fn new() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_misty-peer-transport"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let out = child.stdout.take().unwrap();
        let (send, output) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines() {
                if let Ok(line) = line {
                    if let Ok(value) = serde_json::from_str(&line) {
                        let _ = send.send(value);
                    }
                }
            }
        });
        Self { child, output }
    }
    fn send(&mut self, id: u64, protocol: u32, command: Value) {
        let input = self.child.stdin.as_mut().unwrap();
        serde_json::to_writer(
            &mut *input,
            &json!({"protocol":protocol,"id":id,"command":command}),
        )
        .unwrap();
        input.write_all(b"\n").unwrap();
        input.flush().unwrap();
    }
    fn receive(&self, id: u64) -> Value {
        let reply = self.output.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(reply["id"], id);
        assert!(reply.get("error").is_none(), "{reply}");
        reply["result"].clone()
    }
    fn wait(&mut self) -> std::process::ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(Instant::now() < deadline, "worker failed to stop");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
#[test]
fn invalid_protocol_exits_without_creating_an_endpoint() {
    let mut worker = Worker::new();
    worker.send(1, 2, json!({"operation":"snapshot"}));
    assert!(!worker.wait().success());
}
#[test]
fn cancels_pending_accept_and_closes_on_supervisor_eof() {
    let mut worker = Worker::new();
    worker.send(
        1,
        1,
        json!({"operation":"initialize","secret":([7u8;32].to_vec()),"relay":{"mode":"disabled"}}),
    );
    let initialized = worker.receive(1);
    assert!(initialized["endpointId"].as_str().is_some());
    worker.send(2, 1, json!({"operation":"accept"}));
    worker.send(3, 1, json!({"operation":"cancel","requestId":2}));
    worker.receive(3);
    worker.send(4, 1, json!({"operation":"snapshot"}));
    assert_eq!(worker.receive(4)["endpointId"], initialized["endpointId"]);
    worker.send(5, 1, json!({"operation":"accept"}));
    drop(worker.child.stdin.take());
    assert!(worker.wait().success());
}
#[test]
fn rejects_reused_request_ids_even_after_completion() {
    let mut worker = Worker::new();
    worker.send(1, 1, json!({"operation":"cancel","requestId":0}));
    worker.receive(1);
    worker.send(1, 1, json!({"operation":"cancel","requestId":0}));
    assert!(!worker.wait().success());
}

#[test]
fn cancellation_ack_is_final_even_when_the_job_already_completed() {
    let mut worker = Worker::new();
    worker.send(
        1,
        1,
        json!({"operation":"initialize","secret":vec![9u8;32],"relay":{"mode":"disabled"}}),
    );
    worker.receive(1);
    for round in 0..50 {
        let id = 2 + round * 3;
        worker.send(id, 1, json!({"operation":"snapshot"}));
        worker.send(id + 1, 1, json!({"operation":"cancel","requestId":id}));
        loop {
            let reply = worker.output.recv_timeout(Duration::from_secs(3)).unwrap();
            if reply["id"] == id + 1 {
                break;
            }
            assert_eq!(reply["id"], id);
        }
        worker.send(id + 2, 1, json!({"operation":"snapshot"}));
        worker.receive(id + 2);
    }
}
