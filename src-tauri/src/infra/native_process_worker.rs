//! Verified interactive service supervision. App algorithms remain in the package.
use crate::infra::document_intelligence::ServiceLease;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    os::unix::{fs::PermissionsExt, io::AsRawFd, process::CommandExt},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
const TERMINAL_MAX_MESSAGE: usize = 1024 * 1024;
const CODE_MAX_MESSAGE: usize = 48 * 1024 * 1024 + 1024;
struct Request {
    id: u64,
    bytes: Vec<u8>,
    reply: SyncSender<Result<Value, String>>,
    cancel_target: Option<u64>,
}
struct PendingReply {
    reply: SyncSender<Result<Value, String>>,
    cancel_target: Option<u64>,
}
struct PeerResult {
    worker: Arc<ProcessWorker>,
    result: Option<Result<Value, String>>,
}
impl Drop for PeerResult {
    fn drop(&mut self) {
        // Release handles when a reply wins the race with its awaiter's cancellation.
        if let Some(Ok(value)) = self.result.as_ref() {
            let command = if let Some(stream) = value.get("stream").and_then(Value::as_str) {
                Some(json!({"operation":"releaseStream", "stream":stream}))
            } else if let Some(connection) = value.get("connection").and_then(Value::as_str) {
                Some(json!({"operation":"closeConnection", "connection":connection}))
            } else {
                None
            };
            if let Some(command) = command {
                if self.worker.enqueue(command, None).is_err() {
                    self.worker.close();
                }
            }
        }
    }
}
struct CancelPeerRequest<'a> {
    worker: &'a ProcessWorker,
    id: Option<u64>,
}
impl Drop for CancelPeerRequest<'_> {
    fn drop(&mut self) {
        if let Some(id) = self.id {
            if self
                .worker
                .enqueue(json!({"operation":"cancel", "requestId":id}), Some(id))
                .is_err()
            {
                self.worker.close();
            }
        }
    }
}
pub(crate) struct ProcessWorker {
    requests: SyncSender<Request>,
    closed: Arc<AtomicBool>,
    next: Mutex<u64>,
    lease: Arc<ServiceLease>,
    max_message: usize,
    peer_operations: AtomicUsize,
}
struct PeerOperationSlot<'a>(&'a AtomicUsize);
impl Drop for PeerOperationSlot<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
impl Drop for ProcessWorker {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::Release);
    }
}
impl ProcessWorker {
    pub(crate) fn launch(
        lease: Arc<ServiceLease>,
        events: Arc<dyn Fn(Value) + Send + Sync>,
    ) -> Result<Self, String> {
        Self::launch_with_shell(lease, events, None)
    }
    #[cfg(test)]
    pub(crate) fn launch_test(
        lease: Arc<ServiceLease>,
        events: Arc<dyn Fn(Value) + Send + Sync>,
        shell: &std::path::Path,
    ) -> Result<Self, String> {
        Self::launch_with_shell(lease, events, Some(shell))
    }
    fn launch_with_shell(
        lease: Arc<ServiceLease>,
        events: Arc<dyn Fn(Value) + Send + Sync>,
        shell: Option<&std::path::Path>,
    ) -> Result<Self, String> {
        Self::launch_inner(lease, events, shell, None, false)
    }
    pub(crate) fn launch_code(
        lease: Arc<ServiceLease>,
        events: Arc<dyn Fn(Value) + Send + Sync>,
        directory: Arc<cap_std::fs::Dir>,
    ) -> Result<Self, String> {
        Self::launch_inner(lease, events, None, Some(directory), false)
    }
    pub(crate) fn launch_peer(lease: Arc<ServiceLease>) -> Result<Self, String> {
        Self::launch_inner(lease, Arc::new(|_| {}), None, None, true)
    }
    fn launch_inner(
        lease: Arc<ServiceLease>,
        events: Arc<dyn Fn(Value) + Send + Sync>,
        shell: Option<&std::path::Path>,
        directory: Option<Arc<cap_std::fs::Dir>>,
        peer: bool,
    ) -> Result<Self, String> {
        let code = directory.is_some();
        let max_message = if peer {
            128 * 1024
        } else if code {
            CODE_MAX_MESSAGE
        } else {
            TERMINAL_MAX_MESSAGE
        };
        if !(if peer {
            lease.is_peer_transport()
        } else if code {
            lease.is_code_tools()
        } else {
            lease.is_terminal()
        }) || lease.cancelled()
        {
            return Err("Native service authorization is unavailable.".into());
        }
        let work = tempfile::Builder::new()
            .prefix("misty-native-service-")
            .tempdir()
            .map_err(|e| e.to_string())?;
        let executable = work.path().join("worker");
        std::fs::write(&executable, &lease.worker).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o500))
            .map_err(|e| e.to_string())?;
        // The app execution grant permits these processes to inherit the device
        // environment. Code additionally starts in its retained project directory.
        let mut command = Command::new(&executable);
        command
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if peer {
            command.env_clear().current_dir(work.path());
        }
        if let Some(shell) = shell {
            command.env("SHELL", shell);
        }
        if let Some(directory) = directory {
            // The project descriptor is retained through exec. A renamed or
            // replaced path cannot redirect the language server's cwd.
            unsafe {
                command.pre_exec(move || {
                    if libc::fchdir(directory.as_raw_fd()) == -1 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let setup = (|| {
            let input = child
                .stdin
                .take()
                .ok_or("Native service input unavailable.")?;
            let output = child
                .stdout
                .take()
                .ok_or("Native service output unavailable.")?;
            for fd in [input.as_raw_fd(), output.as_raw_fd()] {
                let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
                if flags < 0
                    || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
                {
                    return Err("Could not supervise service pipes.");
                }
            }
            Ok((input, output))
        })();
        let (mut input, mut output) = match setup {
            Ok(pipes) => pipes,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        };
        let (requests, receive) = mpsc::sync_channel::<Request>(if peer {
            64
        } else if code {
            1
        } else {
            8
        });
        let closed = Arc::new(AtomicBool::new(false));
        let stop = closed.clone();
        let authority = lease.clone();
        thread::spawn(move || {
            let _work = work;
            let mut writing: Option<(Request, usize)> = None;
            let mut pending = HashMap::<u64, PendingReply>::new();
            let limit = if peer { 64 } else { 1 };
            let mut buffer = Vec::new();
            let mut scan_from = 0;
            let mut scratch = [0u8; 16384];
            let mut exited = false;
            let result = (|| -> Result<(), String> {
                loop {
                    if stop.load(Ordering::Acquire) || authority.cancelled() {
                        return Err("Native service session access changed.".into());
                    }
                    if writing.is_none() && pending.len() < limit {
                        match receive.try_recv() {
                            Ok(request) => writing = Some((request, 0)),
                            Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
                            Err(mpsc::TryRecvError::Empty) => {}
                        }
                    }
                    if let Some((request, offset)) = writing.as_mut() {
                        if *offset < request.bytes.len() {
                            match input.write(&request.bytes[*offset..]) {
                                Ok(0) => return Err("Native service input closed.".into()),
                                Ok(n) => *offset += n,
                                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                                Err(error) => return Err(error.to_string()),
                            }
                        }
                    }
                    if writing
                        .as_ref()
                        .is_some_and(|(request, offset)| *offset == request.bytes.len())
                    {
                        let (request, _) = writing.take().unwrap();
                        pending.insert(
                            request.id,
                            PendingReply {
                                reply: request.reply,
                                cancel_target: request.cancel_target,
                            },
                        );
                    }
                    // Bound each drain so continuous output cannot starve revocation.
                    for _ in 0..4 {
                        match output.read(&mut scratch) {
                            Ok(0) => return Err("Native service stopped.".into()),
                            Ok(n) => buffer.extend_from_slice(&scratch[..n]),
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                            Err(error) => return Err(error.to_string()),
                        }
                        loop {
                            let Some(end) = buffer[scan_from..]
                                .iter()
                                .position(|byte| *byte == b'\n')
                                .map(|offset| scan_from + offset)
                            else {
                                scan_from = buffer.len();
                                break;
                            };
                            scan_from = 0;
                            if end > max_message {
                                return Err("Native service response exceeds its limit.".into());
                            }
                            let value: Value = serde_json::from_slice(&buffer[..end])
                                .map_err(|_| "Invalid service response.")?;
                            buffer.drain(..=end);
                            if value["protocol"] != 1 {
                                return Err("Incompatible terminal service.".into());
                            }
                            if let Some(event) = value["event"].as_str() {
                                if peer {
                                    return Err("Unexpected peer service event.".into());
                                }
                                match event {
                                    "message" if code => {
                                        let payload = value["payload"]
                                            .as_str()
                                            .filter(|s| s.len() <= 8 * 1024 * 1024)
                                            .ok_or("Invalid Code message.")?;
                                        events(json!({"event":"message","payload":payload}));
                                    }
                                    "exit" if code => {
                                        let reason =
                                            value["reason"].as_str().ok_or("Invalid Code exit.")?;
                                        events(
                                            json!({"event":"exit","reason":reason.chars().take(2000).collect::<String>()}),
                                        );
                                        exited = true;
                                    }
                                    "output" if !code => {
                                        let data = value["data"]
                                            .as_str()
                                            .filter(|s| s.len() <= 128 * 1024)
                                            .ok_or("Invalid terminal output.")?;
                                        events(json!({"event":"output","data":data}));
                                    }
                                    "exit" if !code => {
                                        let code = if value["exitCode"].is_null() {
                                            None
                                        } else {
                                            Some(
                                                value["exitCode"]
                                                    .as_u64()
                                                    .filter(|v| *v <= u32::MAX as u64)
                                                    .ok_or("Invalid terminal exit status.")?,
                                            )
                                        };
                                        events(json!({"event":"exit","exitCode":code}));
                                        exited = true;
                                    }
                                    _ => return Err("Unknown service event.".into()),
                                }
                            } else {
                                let id =
                                    value["id"].as_u64().ok_or("Missing service response id.")?;
                                let reply = pending
                                    .remove(&id)
                                    .ok_or("Unexpected service response id.")?;
                                let result = if let Some(error) = value["error"].as_str() {
                                    Err(error.chars().take(2000).collect())
                                } else if let Some(result) = value.get("result") {
                                    Ok(result.clone())
                                } else {
                                    return Err("Missing service response.".into());
                                };
                                if let Some(target) = reply.cancel_target {
                                    if result.is_err() {
                                        return Err("Peer cancellation failed.".into());
                                    }
                                    if let Some(cancelled) = pending.remove(&target) {
                                        let _ = cancelled
                                            .reply
                                            .send(Err("Peer request cancelled.".into()));
                                    }
                                }
                                let _ = reply.reply.send(result);
                            }
                        }
                        if buffer.len() > max_message {
                            return Err("Native service response exceeds its limit.".into());
                        }
                    }
                    if exited && pending.is_empty() && writing.is_none() {
                        return Ok(());
                    }
                    if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                        return Err("Native service stopped.".into());
                    }
                    thread::sleep(Duration::from_millis(10));
                }
            })();
            stop.store(true, Ordering::Release);
            let failure = result
                .clone()
                .err()
                .unwrap_or_else(|| "Native service closed.".into());
            if let Some((request, _)) = writing {
                let _ = request.reply.send(Err(failure.clone()));
            }
            for (_, reply) in pending {
                let _ = reply.reply.send(Err(failure.clone()));
            }
            // The worker has an independent EOF reader, so a blocked process write
            // still cancels. Keep draining output during its shutdown window.
            drop(input);
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    break;
                }
                let _ = output.read(&mut scratch);
                thread::sleep(Duration::from_millis(10));
            }
            if child.try_wait().ok().flatten().is_none() {
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.wait();
            }
            if !exited && !peer {
                events(if code {
                    json!({"event":"exit","reason":result.err().unwrap_or_else(|| "Code service closed.".into())})
                } else {
                    json!({"event":"exit","exitCode":null})
                });
            }
        });
        Ok(Self {
            requests,
            closed,
            next: Mutex::new(1),
            lease,
            max_message,
            peer_operations: AtomicUsize::new(0),
        })
    }
    pub(crate) fn release_peer_handle(&self, operation: &str, id: &str) {
        if !self.lease.is_peer_transport() {
            return;
        }
        let command = match operation {
            "releaseStream" => json!({"operation":operation,"stream":id}),
            "closeConnection" => json!({"operation":operation,"connection":id}),
            _ => {
                self.close();
                return;
            }
        };
        if self.enqueue(command, None).is_err() {
            self.close();
        }
    }
    #[cfg(test)]
    pub(crate) fn pending_peer_operations(&self) -> usize {
        self.peer_operations.load(Ordering::Acquire)
    }
    pub(crate) fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire) || self.lease.cancelled()
    }
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }
    pub(crate) fn call(&self, command: Value) -> Result<Value, String> {
        self.call_inner(command, Some(Duration::from_secs(30)))
    }
    /// Long-lived transport accepts/reads end on stream release or lease revocation.
    pub(crate) fn wait_peer(&self, command: Value) -> Result<Value, String> {
        if !self.lease.is_peer_transport() {
            return Err("Not a peer transport service.".into());
        }
        self.call_inner(command, None)
    }
    /// Dropping this future cancels only its request; other streams stay live.
    pub(crate) async fn peer_request(self: &Arc<Self>, command: Value) -> Result<Value, String> {
        if !self.lease.is_peer_transport()
            || self.closed.load(Ordering::Acquire)
            || self.lease.cancelled()
        {
            return Err("Peer service is closed.".into());
        }
        let _slot = self.peer_slot(&command)?;
        let (id, receive) = self.enqueue(command, None)?;
        let mut cancellation = CancelPeerRequest {
            worker: self,
            id: Some(id),
        };
        let worker = self.clone();
        let mut received = tokio::task::spawn_blocking(move || PeerResult {
            worker,
            result: Some(
                receive
                    .recv()
                    .unwrap_or_else(|_| Err("Peer service stopped.".into())),
            ),
        })
        .await
        .map_err(|_| "Peer response task stopped.")?;
        cancellation.id = None;
        if self.closed.load(Ordering::Acquire) || self.lease.cancelled() {
            return Err("Peer service access changed.".into());
        }
        received.result.take().unwrap()
    }
    fn peer_slot(&self, command: &Value) -> Result<Option<PeerOperationSlot<'_>>, String> {
        // Network reads/accepts/writes can remain pending. Reserve capacity for
        // stream release, connection close and health checks that unblock them.
        let slot = if self.lease.is_peer_transport()
            && !matches!(
                command.get("operation").and_then(Value::as_str),
                Some("releaseStream" | "closeConnection" | "snapshot" | "cancel")
            ) {
            self.peer_operations
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                    (count < 32).then_some(count + 1)
                })
                .map_err(|_| "Peer transport is busy.")?;
            Some(PeerOperationSlot(&self.peer_operations))
        } else {
            None
        };
        Ok(slot)
    }
    fn enqueue(
        &self,
        command: Value,
        cancel_target: Option<u64>,
    ) -> Result<(u64, mpsc::Receiver<Result<Value, String>>), String> {
        // Serialize assignment through enqueue, so concurrent callers cannot put
        // decreasing IDs on the worker's strictly ordered input channel.
        let mut next = self
            .next
            .lock()
            .map_err(|_| "Native request queue unavailable.")?;
        let id = *next;
        *next = next.checked_add(1).ok_or("Native request IDs exhausted.")?;
        let mut bytes = serde_json::to_vec(&json!({"protocol":1,"id":id,"command":command}))
            .map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        if bytes.len() > self.max_message {
            return Err("Native service request exceeds its limit.".into());
        }
        let (reply, receive) = mpsc::sync_channel(1);
        self.requests
            .try_send(Request {
                id,
                bytes,
                reply,
                cancel_target,
            })
            .map_err(|_| "Native service is busy or closed.")?;
        drop(next);
        Ok((id, receive))
    }
    fn call_inner(&self, command: Value, timeout: Option<Duration>) -> Result<Value, String> {
        if self.closed.load(Ordering::Acquire) || self.lease.cancelled() {
            return Err("Native service session is closed.".into());
        }
        let _slot = self.peer_slot(&command)?;
        let (_, receive) = self.enqueue(command, None)?;
        let start = Instant::now();
        loop {
            match receive.recv_timeout(Duration::from_millis(20)) {
                Ok(result) => {
                    if self.lease.cancelled() {
                        return Err("Native service access changed.".into());
                    }
                    return result;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Native service stopped.".into())
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if self.closed.load(Ordering::Acquire) || self.lease.cancelled() {
                return Err("Native service session is closed.".into());
            }
            if timeout.is_some_and(|timeout| start.elapsed() > timeout) {
                self.closed.store(true, Ordering::Release);
                return Err("Native service operation timed out and was stopped.".into());
            }
        }
    }
}
