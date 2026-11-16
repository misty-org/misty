//! Warm engine processes. A chat's engine stays running after its turn, so the chat's next
//! message goes straight to it instead of starting the CLI, handshaking and loading the session
//! again, which took from a third of a second (Codex) to five seconds (Qoder) before every reply.
//! Claude Code keeps its process through follow-up parking (`reader.rs`, `registry.rs`); the
//! engines that drive their own transport (the ACP engines, Codex's app-server) park theirs here.
//!
//! A parked process is taken only by the same chat session, launched the same way: the engine,
//! program, folder, model, effort, mode, channel, folders and tools all match ([`fingerprint`]),
//! since a live process can't take new launch flags. Anything else retires it and starts fresh.
//! A process no message took within [`WARM_IDLE`] ends, and at most [`WARM_MAX`] wait per pool.

use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::Instant;

use super::registry::{WARM_IDLE, WARM_MAX};
use super::SendRequest;

/// A process a pool can hold: it ends itself for good, off the caller's thread, then removes
/// the files it may still have read.
pub(crate) trait Retire: Send + 'static {
    fn retire(self, cleanup: Vec<PathBuf>);
    /// Ends the process at once, as the app quits: no task may run after this.
    fn kill_now(self, cleanup: Vec<PathBuf>);
}

/// A parked process, with what the next turn needs to take it over.
pub(crate) struct Warm<T> {
    pub(crate) item: T,
    /// Misty's MCP token the process's session was opened with (`mcp::rebind`).
    pub(crate) token: Option<String>,
    /// Files the process may still read (a staged channel home): removed when it ends.
    pub(crate) cleanup: Vec<PathBuf>,
}

impl<T: Retire> Warm<T> {
    /// The turn that takes this process answers its tool calls from now on.
    pub(crate) fn hand_to(&self, run_id: &str) {
        if let Some(token) = self.token.as_deref() {
            super::mcp::rebind(token, run_id);
        }
    }

    pub(crate) fn retire(self) {
        if let Some(token) = self.token.as_deref() {
            super::mcp::drop_token(token);
        }
        self.item.retire(self.cleanup);
    }
}

/// Ends a child's whole tree now, for [`Retire::kill_now`].
pub(crate) fn kill_child_now(child: &mut tokio::process::Child, cleanup: &[PathBuf]) {
    if let Some(pid) = child.id() {
        super::kill_process_group(pid);
    }
    let _ = child.start_kill();
    super::cleanup_staged_files(cleanup);
}

struct Entry<T> {
    key: String,
    /// The folder the process works in.
    folder: PathBuf,
    fingerprint: u64,
    since: Instant,
    warm: Warm<T>,
}

/// One kind of parked process, keyed by engine and chat session.
pub(crate) struct Pool<T> {
    held: Mutex<Vec<Entry<T>>>,
}

impl<T: Retire> Pool<T> {
    pub(crate) const fn new() -> Self {
        Self {
            held: Mutex::new(Vec::new()),
        }
    }

    fn held(&self) -> MutexGuard<'_, Vec<Entry<T>>> {
        self.held
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The process parked for `key`, if it was launched as `fingerprint` says. One launched
    /// otherwise can't serve this turn and is retired, so its session isn't open twice.
    pub(crate) fn take(&self, key: &str, fingerprint: u64) -> Option<Warm<T>> {
        let entry = {
            let mut held = self.held();
            let at = held.iter().position(|entry| entry.key == key)?;
            held.swap_remove(at)
        };
        if entry.fingerprint == fingerprint {
            Some(entry.warm)
        } else {
            entry.warm.retire();
            None
        }
    }

    /// Ends the processes parked in `folder`, which is about to go.
    pub(crate) fn retire_in(&self, folder: &std::path::Path) {
        let gone: Vec<Entry<T>> = {
            let mut held = self.held();
            let (gone, kept) = std::mem::take(&mut *held)
                .into_iter()
                .partition(|entry| entry.folder == folder);
            *held = kept;
            gone
        };
        for entry in gone {
            entry.warm.retire();
        }
    }

    /// Ends every parked process, as the app quits.
    pub(crate) fn kill_all(&self) {
        let held = std::mem::take(&mut *self.held());
        for entry in held {
            entry.warm.item.kill_now(entry.warm.cleanup);
        }
    }

    /// Parks a process that finished its turn cleanly for the chat's next message.
    pub(crate) fn park(
        &'static self,
        key: String,
        folder: PathBuf,
        fingerprint: u64,
        warm: Warm<T>,
    ) {
        let since = Instant::now();
        let retired = {
            let mut held = self.held();
            let mut retired = Vec::new();
            if let Some(at) = held.iter().position(|entry| entry.key == key) {
                retired.push(held.swap_remove(at));
            }
            held.push(Entry {
                key: key.clone(),
                folder,
                fingerprint,
                since,
                warm,
            });
            while held.len() > WARM_MAX {
                let Some(oldest) = (0..held.len()).min_by_key(|&at| held[at].since) else {
                    break;
                };
                retired.push(held.swap_remove(oldest));
            }
            retired
        };
        for entry in retired {
            entry.warm.retire();
        }
        tokio::spawn(async move {
            tokio::time::sleep(WARM_IDLE).await;
            let idle = {
                let mut held = self.held();
                held.iter()
                    .position(|entry| entry.key == key && entry.since == since)
                    .map(|at| held.swap_remove(at))
            };
            if let Some(entry) = idle {
                entry.warm.retire();
            }
        });
    }
}

/// Where a pool keeps a chat session's process.
pub(crate) fn key(engine: &str, session_id: &str) -> String {
    format!("{engine}\u{0}{session_id}")
}

/// What a launch was, for telling whether a parked process can take the next turn: everything
/// that becomes a flag, an environment variable or a handshake choice. The prompt, its images
/// and attachments go into the turn itself and don't count.
pub(crate) fn fingerprint(
    engine: &str,
    bin: &str,
    req: &SendRequest,
    channel: u64,
    launch: &[String],
) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    engine.hash(&mut hasher);
    bin.hash(&mut hasher);
    req.workspace.hash(&mut hasher);
    req.model.hash(&mut hasher);
    req.effort.hash(&mut hasher);
    req.service_tier.hash(&mut hasher);
    req.permission.hash(&mut hasher);
    req.provider_id.hash(&mut hasher);
    req.allowed_tools.hash(&mut hasher);
    req.additional_dirs.hash(&mut hasher);
    let mut servers: Vec<&String> = req
        .mcp_servers
        .as_ref()
        .and_then(|servers| servers.as_object())
        .map(|servers| servers.keys().collect())
        .unwrap_or_default();
    servers.sort();
    servers.hash(&mut hasher);
    channel.hash(&mut hasher);
    launch.hash(&mut hasher);
    hasher.finish()
}

/// Runs that may stay warm, with their launch's fingerprint: set by the launch
/// (`send_host_stream`) and claimed once by the turn's driver as it starts.
static INTENTS: LazyLock<Mutex<std::collections::HashMap<String, u64>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

fn intents() -> MutexGuard<'static, std::collections::HashMap<String, u64>> {
    INTENTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn intend(run_id: &str, fingerprint: u64) {
    intents().insert(run_id.to_string(), fingerprint);
}

/// The fingerprint of a run that may stay warm; None for one that ends its process with the
/// turn (no chat session to come back to, or a launch that isn't a chat's).
pub(crate) fn claim(run_id: &str) -> Option<u64> {
    intents().remove(run_id)
}

// ==================== ACP ====================

/// An ACP agent idling on its session after a turn: the engines on `grok_acp`, Qoder, MiniMax
/// and Oh My Pi's plan sessions.
pub(crate) struct WarmAcp {
    pub(crate) spawned: super::qoder_session::SpawnedAcp,
    /// The session the process has open, as the agent named it.
    pub(crate) session_id: String,
    /// The effort the handshake reported (Kimi, Antigravity), shown again on the next turn.
    pub(crate) effort: Option<String>,
    /// The session's title, mode, model and effort as last known (Qoder), so the next turn
    /// shows only what it changes.
    pub(crate) known: super::qoder_session::AcpSessionState,
}

impl WarmAcp {
    /// Whether the process is still running and can take a prompt.
    pub(crate) fn alive(&mut self) -> bool {
        matches!(self.spawned.child.try_wait(), Ok(None))
    }
}

impl Retire for WarmAcp {
    fn retire(mut self, cleanup: Vec<PathBuf>) {
        tokio::spawn(async move {
            super::qoder_session::teardown(&mut self.spawned.child).await;
            super::cleanup_staged_files(&cleanup);
        });
    }
    fn kill_now(mut self, cleanup: Vec<PathBuf>) {
        kill_child_now(&mut self.spawned.child, &cleanup);
    }
}

pub(crate) static ACP: Pool<WarmAcp> = Pool::new();

/// Ends every warm process, as the app quits (`engines::shutdown`).
pub(crate) fn shutdown() {
    ACP.kill_all();
    super::codex_app::kill_warm();
}

/// Ends the warm processes working in `folder` (a multi-run worktree about to be removed).
pub(crate) fn retire_in(folder: &std::path::Path) {
    ACP.retire_in(folder);
    super::codex_app::retire_warm_in(folder);
}

/// Takes the ACP process parked for this turn's session, if it may take the turn and still
/// runs; it then answers this run (its stdin in the registry, its tool calls). None starts one.
pub(crate) fn take_acp(
    core: &super::TurnCore,
    req: &SendRequest,
    fingerprint: Option<u64>,
) -> Option<Warm<WarmAcp>> {
    let fingerprint = fingerprint?;
    let session = req.session_id.as_deref()?;
    let mut warm = ACP.take(&key(&core.engine_id, session), fingerprint)?;
    if !warm.item.alive() {
        warm.retire();
        return None;
    }
    core.registry
        .set_stdin(&core.run_id, std::sync::Arc::clone(&warm.item.spawned.acp.stdin));
    warm.hand_to(&core.run_id);
    Some(warm)
}

/// After a turn that went cleanly, parks its ACP process for the chat's next message; otherwise
/// ends it. A process this turn started has no token yet: its session was opened with the one
/// in this turn's servers.
pub(crate) fn park_acp(
    core: &super::TurnCore,
    req: &SendRequest,
    fingerprint: Option<u64>,
    clean: bool,
    mut warm: Warm<WarmAcp>,
) {
    let fingerprint = match fingerprint {
        Some(fingerprint) if clean && warm.item.alive() => fingerprint,
        _ => return warm.retire(),
    };
    if warm.token.is_none() {
        warm.token = super::mcp::token_in(req.mcp_servers.as_ref());
    }
    ACP.park(
        key(&core.engine_id, &warm.item.session_id),
        req.workspace.clone(),
        fingerprint,
        warm,
    );
}
