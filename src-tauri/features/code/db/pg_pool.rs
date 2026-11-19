//! Postgres connections: rustls with the system's roots, a timeout on connecting, and a few clients
//! per saved connection kept open between runs (so expanding a schema while a query runs doesn't
//! wait on it), closed once they have sat unused for a while.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Once, OnceLock};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_postgres::error::SqlState;
use tokio_postgres::{CancelToken, Client};
use tokio_postgres_rustls::MakeRustlsConnect;

use super::store::{PostgresTarget, SslMode};
use super::types::sentence;

/// How long a server has to answer before Misty gives up connecting.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Clients open at once per connection: a query, the schema and an edit side by side.
const MOST_CLIENTS: usize = 3;
/// A client unused this long is closed.
const IDLE: Duration = Duration::from_secs(5 * 60);

// ---------------------------------------------------------------------------------------------
// TLS

/// The rustls setup every connection shares: the system's trusted roots and the ring provider
/// named explicitly, since reqwest is built without one and this mustn't depend on which default
/// some other part of the app installed first.
fn tls_config() -> Result<rustls::ClientConfig, String> {
    static CONFIG: OnceLock<Result<rustls::ClientConfig, String>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let mut roots = rustls::RootCertStore::empty();
            roots.add_parsable_certificates(rustls_native_certs::load_native_certs().certs);
            rustls::ClientConfig::builder_with_provider(Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .map(|builder| builder.with_root_certificates(roots).with_no_client_auth())
            .map_err(|_| "Misty couldn't set up a secure connection.".to_string())
        })
        .clone()
}

fn tls() -> Result<MakeRustlsConnect, String> {
    tls_config().map(MakeRustlsConnect::new)
}

// ---------------------------------------------------------------------------------------------
// Errors

/// A driver error as a sentence: the server's own message (with its detail and hint) when it
/// sent one, otherwise what went wrong on the way.
pub fn error_text(error: &tokio_postgres::Error) -> String {
    if let Some(db) = error.as_db_error() {
        if *db.code() == SqlState::QUERY_CANCELED {
            return "The query was stopped.".to_string();
        }
        let mut text = sentence(db.message());
        for extra in [db.detail(), db.hint()].into_iter().flatten() {
            text.push(' ');
            text.push_str(&sentence(extra));
        }
        return text;
    }
    if error.is_closed() {
        return "The connection to the database closed. Run it again to reconnect.".to_string();
    }
    sentence(&error.to_string())
}

// ---------------------------------------------------------------------------------------------
// Connecting and the pool

fn ssl_mode(mode: SslMode) -> tokio_postgres::config::SslMode {
    match mode {
        SslMode::Disable => tokio_postgres::config::SslMode::Disable,
        SslMode::Prefer => tokio_postgres::config::SslMode::Prefer,
        SslMode::Require => tokio_postgres::config::SslMode::Require,
    }
}

/// Opens one client. The password comes straight from the credential store and goes only into
/// the driver's config.
pub async fn connect(target: &PostgresTarget, password: Option<&str>) -> Result<Client, String> {
    let mut config = tokio_postgres::Config::new();
    config
        .host(&target.host)
        .port(target.port)
        .dbname(&target.database)
        .user(&target.user)
        .application_name("Misty")
        .ssl_mode(ssl_mode(target.ssl_mode))
        .connect_timeout(CONNECT_TIMEOUT);
    if let Some(password) = password {
        config.password(password);
    }
    let tls = tls()?;
    // The driver's timeout covers each address; this one covers the whole handshake.
    let (client, connection) = tokio::time::timeout(
        CONNECT_TIMEOUT + Duration::from_secs(5),
        config.connect(tls),
    )
    .await
    .map_err(|_| "The database didn't answer in time.".to_string())?
    .map_err(|error| format!("Couldn't connect. {}", error_text(&error)))?;
    // The connection does the socket work; it ends when the client is dropped.
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });
    Ok(client)
}

struct Pool {
    /// The target the clients were opened for; an edited connection starts a fresh pool.
    target: PostgresTarget,
    idle: Vec<(Client, Instant)>,
    permits: Arc<Semaphore>,
}

static POOLS: LazyLock<Mutex<HashMap<String, Pool>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn pool_key(account: &str, id: &str) -> String {
    format!("{account}\u{0}{id}")
}

/// Closes a connection's clients, as it is edited or removed. Clients still running finish their
/// work and are then dropped rather than returned.
pub fn forget(account: &str, id: &str) {
    POOLS.lock().remove(&pool_key(account, id));
}

/// Closes clients that sat unused past `IDLE`, every minute, from the first connection on.
fn sweep_idle() {
    static STARTED: Once = Once::new();
    STARTED.call_once(|| {
        tauri::async_runtime::spawn(async {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                let mut pools = POOLS.lock();
                for pool in pools.values_mut() {
                    pool.idle.retain(|(_, since)| since.elapsed() < IDLE);
                }
                pools.retain(|_, pool| {
                    !pool.idle.is_empty() || pool.permits.available_permits() < MOST_CLIENTS
                });
            }
        });
    });
}

/// One client, held for one command and handed back to its pool afterwards.
pub struct Lease {
    key: String,
    target: PostgresTarget,
    client: Option<Client>,
    /// The person's SQL began a transaction of its own; the client isn't reused, so the next run
    /// doesn't land inside it.
    pub(super) discard: bool,
    _permit: OwnedSemaphorePermit,
}

impl Lease {
    pub fn client(&mut self) -> &mut Client {
        self.client
            .as_mut()
            .expect("a lease holds its client until dropped")
    }

    pub fn cancel_token(&mut self) -> CancelToken {
        self.client().cancel_token()
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        let Some(client) = self.client.take() else {
            return;
        };
        if self.discard || client.is_closed() {
            return;
        }
        let mut pools = POOLS.lock();
        if let Some(pool) = pools.get_mut(&self.key) {
            if pool.target == self.target {
                pool.idle.push((client, Instant::now()));
            }
        }
    }
}

/// A client for this connection: an idle one, or a new one while fewer than `MOST_CLIENTS` are
/// open. `password` is read only when a new client has to be opened.
pub async fn lease(
    account: &str,
    id: &str,
    target: &PostgresTarget,
    password: impl FnOnce() -> Result<Option<zeroize::Zeroizing<String>>, String> + Send + 'static,
) -> Result<Lease, String> {
    sweep_idle();
    let key = pool_key(account, id);
    let permits = {
        let mut pools = POOLS.lock();
        let pool = pools.entry(key.clone()).or_insert_with(|| Pool {
            target: target.clone(),
            idle: Vec::new(),
            permits: Arc::new(Semaphore::new(MOST_CLIENTS)),
        });
        if pool.target != *target {
            *pool = Pool {
                target: target.clone(),
                idle: Vec::new(),
                permits: Arc::new(Semaphore::new(MOST_CLIENTS)),
            };
        }
        pool.permits.clone()
    };
    let permit = tokio::time::timeout(Duration::from_secs(30), permits.acquire_owned())
        .await
        .map_err(|_| "The database is busy with other queries. Try again in a moment.".to_string())?
        .map_err(|_| "The connection was closed.".to_string())?;
    let reused = {
        let mut pools = POOLS.lock();
        let mut found = None;
        if let Some(pool) = pools.get_mut(&key) {
            while let Some((client, _)) = pool.idle.pop() {
                if !client.is_closed() {
                    found = Some(client);
                    break;
                }
            }
        }
        found
    };
    let client = match reused {
        Some(client) => client,
        None => {
            let password = tokio::task::spawn_blocking(password)
                .await
                .map_err(|error| error.to_string())??;
            connect(target, password.as_deref().map(String::as_str)).await?
        }
    };
    Ok(Lease {
        key,
        target: target.clone(),
        client: Some(client),
        discard: false,
        _permit: permit,
    })
}

/// Asks the server to stop whatever the token's client is running.
pub async fn cancel(token: CancelToken) {
    if let Ok(tls) = tls() {
        let _ = token.cancel_query(tls).await;
    }
}
