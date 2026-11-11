// What every engine adapter shares: what a turn is asked to do, what it reports back, and how
// it is stopped or answered while it runs.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Notify};

/// How much an engine may do without asking, as Misty names it. Native code maps this to each
/// engine's own flags when its process starts; the renderer never picks a flag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    /// Stops before anything that changes files or runs a command.
    Ask,
    /// Works in its folder without stopping.
    Auto,
    /// Reads and proposes; changes nothing.
    Plan,
}

/// One request to an engine: a message in a folder, continuing a session if there is one.
#[derive(Clone, Debug)]
pub struct TurnRequest {
    pub folder: PathBuf,
    pub prompt: String,
    /// The engine's own session to continue; empty starts a new one.
    pub session: String,
    pub mode: RunMode,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// Extra MCP servers handed to the engine, as its own config object (`{"name": {...}}`).
    pub mcp_servers: Option<Value>,
}

/// What an engine reports while it works, already in one shape for every engine.
#[derive(Clone, Debug)]
pub enum EngineEvent {
    /// The engine's own id for this session, to continue it next time.
    Session(String),
    Model(String),
    /// More of the answer.
    Text(String),
    /// More of its reasoning.
    Thinking(String),
    ToolStarted {
        id: String,
        name: String,
        input: Value,
    },
    ToolFinished {
        id: String,
        name: String,
        output: Value,
        failed: bool,
    },
    /// The engine wants to do something and waits for a yes or no.
    Permission {
        request: String,
        tool: String,
        input: Value,
    },
    Usage(Value),
    /// Something went wrong that the turn survives.
    Notice(String),
}

/// The answer to a `Permission`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny(String),
}

/// A running turn's handle for its adapter: where to report, and how it hears a stop or an answer.
pub struct TurnLink {
    events: mpsc::UnboundedSender<EngineEvent>,
    stopped: Arc<AtomicBool>,
    stop_signal: Arc<Notify>,
    waiting: Arc<Mutex<HashMap<String, oneshot::Sender<Decision>>>>,
}

/// The other end, kept by whoever started the turn.
#[derive(Clone)]
pub struct TurnControl {
    stopped: Arc<AtomicBool>,
    stop_signal: Arc<Notify>,
    waiting: Arc<Mutex<HashMap<String, oneshot::Sender<Decision>>>>,
}

pub fn link() -> (TurnLink, TurnControl, mpsc::UnboundedReceiver<EngineEvent>) {
    let (events, received) = mpsc::unbounded_channel();
    let stopped = Arc::new(AtomicBool::new(false));
    let stop_signal = Arc::new(Notify::new());
    let waiting = Arc::new(Mutex::new(HashMap::new()));
    (
        TurnLink {
            events,
            stopped: stopped.clone(),
            stop_signal: stop_signal.clone(),
            waiting: waiting.clone(),
        },
        TurnControl {
            stopped,
            stop_signal,
            waiting,
        },
        received,
    )
}

impl TurnLink {
    pub fn report(&self, event: EngineEvent) {
        let _ = self.events.send(event);
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// Resolves once the turn is told to stop.
    pub async fn stopped(&self) {
        loop {
            if self.is_stopped() {
                return;
            }
            self.stop_signal.notified().await;
        }
    }

    /// Reports a permission request and waits for its answer. A stopped turn is a no.
    pub async fn ask(&self, request: String, tool: String, input: Value) -> Decision {
        let (answer, answered) = oneshot::channel();
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.insert(request.clone(), answer);
        }
        self.report(EngineEvent::Permission {
            request,
            tool,
            input,
        });
        tokio::select! {
            decision = answered => decision.unwrap_or_else(|_| Decision::Deny("The request was dropped.".into())),
            () = self.stopped() => Decision::Deny("The turn was stopped.".into()),
        }
    }
}

impl TurnControl {
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.stop_signal.notify_waiters();
    }

    /// Gives a waiting permission request its answer. False when nothing waits under that id.
    pub fn answer(&self, request: &str, decision: Decision) -> bool {
        let Some(waiting) = self
            .waiting
            .lock()
            .ok()
            .and_then(|mut waiting| waiting.remove(request))
        else {
            return false;
        };
        waiting.send(decision).is_ok()
    }
}

/// Ends a process and everything it started. Engines start their own helpers (node, shells), and
/// stopping only the parent would leave those running.
pub fn kill_tree(pid: u32) {
    #[cfg(unix)]
    {
        // The engine was started as the leader of its own process group.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// Starts the command as the leader of its own process group, so `kill_tree` reaches its helpers.
pub fn own_group(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: a console program started from a windowed app would flash a console.
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(any(unix, windows)))]
    let _ = command;
}
