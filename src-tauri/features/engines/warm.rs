use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::Instant;

use super::registry::{WARM_IDLE, WARM_MAX};
use super::SendRequest;

pub(crate) trait Retire: Send + 'static {
    fn retire(self, cleanup: Vec<PathBuf>);
    fn kill_now(self, cleanup: Vec<PathBuf>);
}

pub(crate) struct Warm<T> {
    pub(crate) item: T,
    pub(crate) token: Option<String>,
    pub(crate) cleanup: Vec<PathBuf>,
}

impl<T: Retire> Warm<T> {
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

pub(crate) fn kill_child_now(child: &mut tokio::process::Child, cleanup: &[PathBuf]) {
    if let Some(pid) = child.id() {
        super::kill_process_group(pid);
    }
    let _ = child.start_kill();
    super::cleanup_staged_files(cleanup);
}

struct Entry<T> {
    key: String,
    folder: PathBuf,
    fingerprint: u64,
    since: Instant,
    warm: Warm<T>,
}

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

    pub(crate) fn kill_all(&self) {
        let held = std::mem::take(&mut *self.held());
        for entry in held {
            entry.warm.item.kill_now(entry.warm.cleanup);
        }
    }

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

pub(crate) fn key(engine: &str, session_id: &str) -> String {
    format!("{engine}\u{0}{session_id}")
}

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

pub(crate) fn claim(run_id: &str) -> Option<u64> {
    intents().remove(run_id)
}

pub(crate) struct WarmAcp {
    pub(crate) spawned: super::acp_session::SpawnedAcp,
    pub(crate) session_id: String,
    pub(crate) effort: Option<String>,
    pub(crate) known: super::acp_session::AcpSessionState,
}

impl WarmAcp {
    pub(crate) fn alive(&mut self) -> bool {
        matches!(self.spawned.child.try_wait(), Ok(None))
    }
}

impl Retire for WarmAcp {
    fn retire(mut self, cleanup: Vec<PathBuf>) {
        tokio::spawn(async move {
            super::acp_session::teardown(&mut self.spawned.child).await;
            super::cleanup_staged_files(&cleanup);
        });
    }
    fn kill_now(mut self, cleanup: Vec<PathBuf>) {
        kill_child_now(&mut self.spawned.child, &cleanup);
    }
}

pub(crate) static ACP: Pool<WarmAcp> = Pool::new();

pub(crate) fn shutdown() {
    ACP.kill_all();
    super::codex_app::kill_warm();
}

pub(crate) fn retire_in(folder: &std::path::Path) {
    ACP.retire_in(folder);
    super::codex_app::retire_warm_in(folder);
}

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
    core.registry.set_stdin(
        &core.run_id,
        std::sync::Arc::clone(&warm.item.spawned.acp.stdin),
    );
    warm.hand_to(&core.run_id);
    Some(warm)
}

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
