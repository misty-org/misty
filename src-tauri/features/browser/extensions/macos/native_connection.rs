// SPDX-License-Identifier: MIT
//! A companion program started for native messaging, and its length-prefixed JSON frames.
#![allow(clippy::disallowed_methods)] // The companion's manifest lives in the system's own folders.
use super::support::{on_main, on_main_after, string};

use objc2_foundation::{NSFileManager, NSHomeDirectory};

use serde_json::Value;
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    process::{Child, Command, Stdio},
    rc::Rc,
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};

const LIMIT: usize = 1024 * 1024;

/// `Ok` is a message from the program; `Err` says why the connection ended.
pub type Handler = Rc<dyn Fn(Result<Value, String>)>;

enum Incoming {
    Message(Value),
    Ended,
}

thread_local! {
    static CONNECTIONS: RefCell<HashMap<u64, std::rc::Weak<NativeConnection>>> = RefCell::new(HashMap::new());
    static NEXT: Cell<u64> = const { Cell::new(1) };
}

/// One running companion program.
pub struct NativeConnection {
    id: u64,
    child: RefCell<Child>,
    writes: RefCell<Option<mpsc::Sender<Vec<u8>>>>,
    reader: RefCell<Option<std::process::ChildStdout>>,
    handler: RefCell<Option<Handler>>,
    inbox: Arc<Mutex<VecDeque<Incoming>>>,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        })
}

impl NativeConnection {
    /// Starts the companion named in the extension's native messaging manifest, if the
    /// manifest names this extension.
    pub fn connect(name: &str, extension: &str) -> Result<Rc<Self>, String> {
        if !valid_name(name) {
            return Err("Invalid native application name.".into());
        }
        let relative = format!("Mozilla/NativeMessagingHosts/{name}.json");
        let roots = [
            format!("{}/Library/Application Support", NSHomeDirectory()),
            "/Library/Application Support".into(),
        ];
        let mut found: Option<(String, Value)> = None;
        for root in &roots {
            let candidate = format!("{root}/{relative}");
            if !std::path::Path::new(&candidate).exists() {
                continue;
            }
            let Ok(data) = std::fs::read(&candidate) else {
                break;
            };
            if data.len() > LIMIT {
                break;
            }
            if let Ok(manifest @ Value::Object(_)) = serde_json::from_slice::<Value>(&data) {
                found = Some((candidate, manifest));
            }
            break;
        }
        let Some((manifest_path, manifest)) = found else {
            return Err(
                "Install this extension's companion application to use native messaging.".into(),
            );
        };
        let path = manifest.get("path").and_then(Value::as_str);
        let allowed = manifest
            .get("allowed_extensions")
            .and_then(Value::as_array)
            .is_some_and(|list| list.iter().any(|item| item.as_str() == Some(extension)));
        let authorized = manifest.get("name").and_then(Value::as_str) == Some(name)
            && manifest.get("type").and_then(Value::as_str) == Some("stdio")
            && allowed;
        let executable = path
            .filter(|path| std::path::Path::new(path).is_absolute())
            .filter(|path| NSFileManager::defaultManager().isExecutableFileAtPath(&string(path)));
        let (true, Some(path)) = (authorized, executable) else {
            return Err("The native application does not authorize this extension.".into());
        };
        if !std::fs::metadata(path).is_ok_and(|info| info.is_file()) {
            return Err("The native application executable is invalid.".into());
        }
        let mut child = Command::new(path)
            .args([manifest_path.as_str(), extension])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|failure| failure.to_string())?;
        let (input, output) = (child.stdin.take(), child.stdout.take());
        let (send, receive) = mpsc::channel::<Vec<u8>>();
        let id = NEXT.with(|next| next.replace(next.get() + 1));
        // Writes happen on one serial thread, off the main thread.
        std::thread::spawn(move || {
            let Some(mut input) = input else {
                return;
            };
            while let Ok(packet) = receive.recv() {
                if input
                    .write_all(&packet)
                    .and_then(|()| input.flush())
                    .is_err()
                {
                    on_main_failed(id);
                    break;
                }
            }
        });
        let connection = Rc::new(Self {
            id,
            child: RefCell::new(child),
            writes: RefCell::new(Some(send)),
            reader: RefCell::new(output),
            handler: RefCell::new(None),
            inbox: Arc::new(Mutex::new(VecDeque::new())),
        });
        CONNECTIONS.with(|all| all.borrow_mut().insert(id, Rc::downgrade(&connection)));
        Ok(connection)
    }

    pub fn is_running(&self) -> bool {
        matches!(self.child.borrow_mut().try_wait(), Ok(None))
    }

    /// Sends one message to the program.
    pub fn send(self: &Rc<Self>, message: &Value) {
        let json = serde_json::to_vec(message).unwrap_or_default();
        if json.is_empty() || json.len() > LIMIT {
            self.fail("Native message exceeds the 1 MiB limit.");
            self.stop();
            return;
        }
        let mut packet = (json.len() as u32).to_ne_bytes().to_vec();
        packet.extend_from_slice(&json);
        if let Some(writes) = self.writes.borrow().as_ref() {
            let _ = writes.send(packet);
        }
    }

    fn fail(&self, message: &str) {
        let handler = self.handler.borrow().clone();
        if let Some(handler) = handler {
            handler(Err(message.to_owned()));
        }
    }

    /// Starts listening; every message and the end of the connection reach `handler` on the main thread.
    pub fn receive(self: &Rc<Self>, handler: Handler) {
        *self.handler.borrow_mut() = Some(handler);
        let Some(mut output) = self.reader.borrow_mut().take() else {
            return;
        };
        let (id, inbox) = (self.id, self.inbox.clone());
        std::thread::spawn(move || {
            let post = |event: Incoming| {
                inbox
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push_back(event);
                on_main(move || deliver(id));
            };
            loop {
                let mut header = [0_u8; 4];
                if output.read_exact(&mut header).is_err() {
                    break;
                }
                let length = u32::from_ne_bytes(header) as usize;
                if length > LIMIT {
                    break;
                }
                let mut body = vec![0_u8; length];
                if output.read_exact(&mut body).is_err() {
                    break;
                }
                let Ok(message) = serde_json::from_slice::<Value>(&body) else {
                    break;
                };
                post(Incoming::Message(message));
            }
            post(Incoming::Ended);
        });
    }

    pub fn stop(self: &Rc<Self>) {
        *self.handler.borrow_mut() = None;
        *self.writes.borrow_mut() = None;
        if !self.is_running() {
            return;
        }
        let pid = self.child.borrow().id() as libc::pid_t;
        // SAFETY: signals the companion this connection started.
        unsafe { libc::kill(pid, libc::SIGTERM) };
        let this = self.clone();
        on_main_after(Duration::from_secs(2), move || {
            if this.is_running() {
                // SAFETY: the companion survived the polite request.
                unsafe { libc::kill(this.child.borrow().id() as libc::pid_t, libc::SIGKILL) };
                let _ = this.child.borrow_mut().wait();
            }
        });
    }
}

impl Drop for NativeConnection {
    fn drop(&mut self) {
        CONNECTIONS.with(|all| {
            all.borrow_mut().remove(&self.id);
        });
        // A companion nobody holds any more must not outlive the connection.
        if self.is_running() {
            // SAFETY: signals the companion this connection started.
            unsafe { libc::kill(self.child.borrow().id() as libc::pid_t, libc::SIGKILL) };
        }
        let _ = self.child.borrow_mut().wait();
    }
}

/// Runs queued events for one connection on the main thread.
fn deliver(id: u64) {
    let Some(connection) =
        CONNECTIONS.with(|all| all.borrow().get(&id).and_then(std::rc::Weak::upgrade))
    else {
        return;
    };
    loop {
        let event = connection
            .inbox
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pop_front();
        let Some(event) = event else {
            return;
        };
        let handler = connection.handler.borrow().clone();
        match event {
            Incoming::Message(message) => {
                if let Some(handler) = handler {
                    handler(Ok(message));
                }
            }
            Incoming::Ended => {
                if let Some(handler) = handler {
                    handler(Err(
                        "The native application disconnected or returned an invalid message."
                            .into(),
                    ));
                }
                connection.stop();
            }
        }
    }
}

fn on_main_failed(id: u64) {
    on_main(move || {
        let connection =
            CONNECTIONS.with(|all| all.borrow().get(&id).and_then(std::rc::Weak::upgrade));
        if let Some(connection) = connection {
            connection.fail("The native application disconnected.");
            connection.stop();
        }
    });
}
