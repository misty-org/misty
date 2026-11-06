//! One MCP session per run instead of one per tool call (docs/agents/harness.md, Device jobs). A run
//! keeps its five-minute bearer until a minute before it expires and one connected client, so most
//! calls skip the token exchange and the MCP handshake. The server still authorizes every request
//! against the run's binding; the bearer only ever names this run. A session missing here (after an
//! idle close, or a restart) is simply rebuilt. Ported from `mcp-sessions.ts`.
use std::{
    collections::{HashMap, VecDeque},
    fmt,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use tokio::sync::Mutex as AsyncMutex;

use super::{js_json::JsValue, mcp_client::McpClient, mcp_endpoint::resolve_mcp_endpoint, runtime_errors::RuntimeError};

const RENEW_BEFORE_MS: i64 = 60_000;
const IDLE_CLOSE_MS: i64 = 120_000;
const MAX_SESSIONS: usize = 256;

/// The bearer the server issued for a run. It never prints.
#[derive(Clone)]
pub(crate) struct McpRunAccess {
    pub(crate) access_token: String,
    pub(crate) token_type: String,
    pub(crate) expires_in: f64,
    pub(crate) mcp_path: String,
    pub(crate) protocol: String,
}

impl fmt::Debug for McpRunAccess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("McpRunAccess").field("mcp_path", &self.mcp_path).field("protocol", &self.protocol).finish_non_exhaustive()
    }
}

impl McpRunAccess {
    pub(crate) fn from_json(value: &JsValue) -> Self {
        let text = |name: &str| value.get(name).and_then(JsValue::as_str).unwrap_or("").to_owned();
        let expires_in = match value.get("expires_in") {
            Some(JsValue::Number(number)) => *number,
            _ => 0.0,
        };
        Self { access_token: text("access_token"), token_type: text("token_type"), expires_in, mcp_path: text("mcp_path"), protocol: text("protocol") }
    }

    /// Fails on anything but the protocol this runtime speaks.
    pub(crate) fn check(&self) -> Result<(), RuntimeError> {
        if self.access_token.is_empty() || self.token_type != "Bearer" || self.protocol != "2026-07-28" || !self.mcp_path.starts_with('/') {
            return Err(RuntimeError::error("Misty returned invalid MCP access credentials"));
        }
        Ok(())
    }
}

struct Session {
    access: McpRunAccess,
    expires_at: i64,
    endpoint: String,
    last_used: i64,
    client: Arc<AsyncMutex<Option<McpClient>>>,
}

#[derive(Default)]
struct Sessions {
    live: HashMap<String, Session>,
    // Insertion order, as a `Map`'s keys are, for dropping the oldest at the cap.
    order: VecDeque<String>,
}

#[derive(Default)]
pub(crate) struct McpSessions(Mutex<Sessions>);

fn session_key(run_id: &str, control_plane_url: &str) -> String {
    format!("{run_id}\n{control_plane_url}")
}

impl Sessions {
    fn remove(&mut self, key: &str) {
        self.live.remove(key);
        self.order.retain(|known| known != key);
    }
}

impl McpSessions {
    fn sessions(&self) -> MutexGuard<'_, Sessions> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A cached bearer for the run, when it still has more than a minute left.
    pub(crate) fn cached_run_access(&self, run_id: &str, control_plane_url: &str, now: i64) -> Option<McpRunAccess> {
        let sessions = self.sessions();
        let session = sessions.live.get(&session_key(run_id, control_plane_url))?;
        (session.expires_at - RENEW_BEFORE_MS > now).then(|| session.access.clone())
    }

    /// Stores a freshly issued bearer; the run's client picks it up on its next request.
    pub(crate) fn remember_run_access(&self, run_id: &str, control_plane_url: &str, access: McpRunAccess, now: i64) -> Result<(), RuntimeError> {
        let key = session_key(run_id, control_plane_url);
        let endpoint = resolve_mcp_endpoint(control_plane_url, &access.mcp_path)?;
        let expires_at = now + (access.expires_in.max(0.0) * 1000.0) as i64;
        let mut sessions = self.sessions();
        if let Some(existing) = sessions.live.get_mut(&key) {
            if existing.endpoint == endpoint {
                existing.access = access;
                existing.expires_at = expires_at;
                return Ok(());
            }
        }
        sessions.remove(&key);
        if sessions.live.len() >= MAX_SESSIONS {
            if let Some(oldest) = sessions.order.front().cloned() {
                sessions.remove(&oldest);
            }
        }
        sessions.order.push_back(key.clone());
        sessions.live.insert(key, Session { access, expires_at, endpoint, last_used: now, client: Arc::default() });
        Ok(())
    }

    pub(crate) fn close_run_session(&self, run_id: &str, control_plane_url: &str) {
        self.sessions().remove(&session_key(run_id, control_plane_url));
    }

    /// Drops every session left idle, as the TypeScript's timers did.
    fn close_idle(&self, now: i64) {
        let mut sessions = self.sessions();
        let idle: Vec<String> = sessions.live.iter().filter(|(_, session)| now - session.last_used >= IDLE_CLOSE_MS).map(|(key, _)| key.clone()).collect();
        for key in idle {
            sessions.remove(&key);
        }
    }

    /// The run's connected client, connecting once. The bearer is read per request. A failed
    /// connection is never reused; the next call connects again.
    pub(crate) async fn run_client(&self, http: &reqwest::Client, run_id: &str, control_plane_url: &str, now: i64) -> Result<McpClient, RuntimeError> {
        self.close_idle(now);
        let key = session_key(run_id, control_plane_url);
        let (cell, endpoint, token) = {
            let mut sessions = self.sessions();
            let Some(session) = sessions.live.get_mut(&key) else {
                return Err(RuntimeError::error("mcp_session_missing"));
            };
            session.last_used = now;
            (session.client.clone(), session.endpoint.clone(), session.access.access_token.clone())
        };
        let mut slot = cell.lock().await;
        if let Some(client) = slot.as_ref() {
            return Ok(client.with_token(token));
        }
        let client = McpClient::connect(http.clone(), endpoint, token).await?;
        *slot = Some(client.clone());
        Ok(client)
    }

    #[cfg(test)]
    pub(crate) fn session_count(&self) -> usize {
        self.sessions().live.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn access(token: &str, expires: f64) -> McpRunAccess {
        McpRunAccess { access_token: token.to_owned(), token_type: "Bearer".to_owned(), expires_in: expires, mcp_path: "/mcp".to_owned(), protocol: "2026-07-28".to_owned() }
    }

    const BASE: &str = "http://api:8080/api";

    #[test]
    fn reuses_a_runs_bearer_until_a_minute_before_it_expires() {
        let sessions = McpSessions::default();
        let now = 1_000_000;
        sessions.remember_run_access("run-a", BASE, access("t1", 300.0), now).unwrap();
        assert_eq!(sessions.cached_run_access("run-a", BASE, now + 60_000).unwrap().access_token, "t1");
        assert!(sessions.cached_run_access("run-a", BASE, now + 240_001).is_none());
        sessions.remember_run_access("run-a", BASE, access("t2", 300.0), now + 240_001).unwrap();
        assert_eq!(sessions.cached_run_access("run-a", BASE, now + 240_002).unwrap().access_token, "t2");
    }

    #[test]
    fn never_shares_a_bearer_across_runs_or_control_planes() {
        let sessions = McpSessions::default();
        sessions.remember_run_access("run-a", BASE, access("a", 300.0), 0).unwrap();
        assert!(sessions.cached_run_access("run-b", BASE, 0).is_none());
        assert!(sessions.cached_run_access("run-a", "http://other:8080", 0).is_none());
        sessions.remember_run_access("run-b", BASE, access("b", 300.0), 0).unwrap();
        assert_eq!(sessions.cached_run_access("run-a", BASE, 0).unwrap().access_token, "a");
        assert_eq!(sessions.cached_run_access("run-b", BASE, 0).unwrap().access_token, "b");
    }

    #[test]
    fn forgets_a_session_once_it_is_closed() {
        let sessions = McpSessions::default();
        sessions.remember_run_access("run-a", BASE, access("a", 300.0), 0).unwrap();
        let before = sessions.session_count();
        sessions.close_run_session("run-a", BASE);
        assert_eq!(sessions.session_count(), before - 1);
        assert!(sessions.cached_run_access("run-a", BASE, 0).is_none());
    }

    #[test]
    fn does_not_cache_a_bearer_that_is_already_about_to_expire() {
        let sessions = McpSessions::default();
        sessions.remember_run_access("run-a", BASE, access("short", 30.0), 0).unwrap();
        assert!(sessions.cached_run_access("run-a", BASE, 0).is_none());
    }

    #[test]
    fn the_bearer_never_prints() {
        assert!(!format!("{:?}", access("secret-bearer", 1.0)).contains("secret-bearer"));
    }
}
