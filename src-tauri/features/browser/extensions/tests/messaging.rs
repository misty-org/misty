// SPDX-License-Identifier: MIT
//! Native messaging against a real companion program: identity checks, direct execution
//! arguments, persistent fragmented framing, the size limit and process cleanup.
use super::support::{fail, Harness};
use misty_native::browser::extensions::macos::testing::NativeConnection;
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    io::{Read, Write},
    rc::Rc,
};

const EXTENSION: &str = "native-fixture@misty.test";

/// The companion program: this test binary again, started by the host with the manifest path
/// and the extension's id. It deliberately fragments frames so the client must read exactly
/// each field.
pub fn companion() -> ! {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || args[2] != EXTENSION {
        std::process::exit(2);
    }
    let (mut input, mut output) = (std::io::stdin().lock(), std::io::stdout().lock());
    loop {
        let mut header = [0_u8; 4];
        if input.read_exact(&mut header).is_err() {
            std::process::exit(0);
        }
        let length = u32::from_ne_bytes(header) as usize;
        if length > 1024 * 1024 {
            std::process::exit(3);
        }
        let mut body = vec![0_u8; length];
        if input.read_exact(&mut body).is_err() {
            std::process::exit(4);
        }
        if body == b"\"oversize\"" {
            let _ = output.write_all(&(1024 * 1024 + 1_u32).to_ne_bytes());
            let _ = output.flush();
            std::thread::sleep(std::time::Duration::from_secs(10));
            std::process::exit(5);
        }
        let pause = || std::thread::sleep(std::time::Duration::from_millis(1));
        let _ = output.write_all(&header[..1]).and_then(|()| output.flush());
        pause();
        let _ = output.write_all(&header[1..]).and_then(|()| output.flush());
        let (first, second) = body.split_at(length / 2);
        let _ = output.write_all(first).and_then(|()| output.flush());
        pause();
        let _ = output.write_all(second).and_then(|()| output.flush());
    }
}

pub fn run(name: &str) {
    let harness = Harness::new("messaging");
    if NativeConnection::connect(name, "unapproved@misty.test").is_ok() {
        fail("Unauthorized identity was accepted");
    }
    if NativeConnection::connect("../escape", EXTENSION).is_ok() {
        fail("Invalid host name was accepted");
    }
    let connection =
        NativeConnection::connect(name, EXTENSION).unwrap_or_else(|message| fail(message));
    let messages = Rc::new(Cell::new(0_u64));
    let ended: Rc<RefCell<Option<bool>>> = Rc::default();
    let sender = connection.clone();
    {
        let (messages, ended) = (messages.clone(), ended.clone());
        connection.receive(Rc::new(move |incoming: Result<Value, String>| {
            let count = messages.get();
            if count == 3 {
                *ended.borrow_mut() = Some(incoming.is_err());
                return;
            }
            match incoming {
                Ok(value) if value["sequence"] == json!(count) => {}
                _ => fail("Persistent frame round trip failed"),
            }
            messages.set(count + 1);
            if count + 1 == 3 {
                sender.send(&json!("oversize"));
            } else {
                sender.send(&json!({"sequence": count + 1}));
            }
        }));
    }
    connection.send(&json!({"sequence": 0}));
    harness.wait_until("the native companion", 15.0, || ended.borrow().is_some());
    if ended.borrow().is_some_and(|errored| !errored) {
        fail("Oversized incoming frame was accepted");
    }
    connection.stop();
    harness.spin(3.0);
    if connection.is_running() {
        fail("Native host survived connection cleanup");
    }
    println!("PASS: native host identity, direct execution arguments, persistent fragmented framing, size limit, process cleanup");
}
