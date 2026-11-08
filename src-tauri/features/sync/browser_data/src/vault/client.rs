//! The server's vault endpoints and socket. Everything crossing here is already sealed.
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{protocol::WebSocketConfig, Message},
    MaybeTlsStream, WebSocketStream,
};

use super::{
    exchange::{b64, ClientFrame, ServerFrame},
    keys::{self, KeyEnvelope},
};
use crate::{
    crypto::{DeviceKey, VaultRoot},
    transport::{SyncApi, TrafficCounters},
    Error, Result,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// The server pings every 15 seconds.
const READ_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_FRAME_BYTES: usize = 4 << 20;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WireTransition {
    pub generation: u64,
    #[serde(with = "b64")]
    pub signature: Vec<u8>,
}

/// The account's vault as the server holds it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerVault {
    pub vault_id: String,
    pub head_sequence: u64,
    #[serde(default)]
    pub compacted_through: u64,
    #[serde(with = "b64")]
    pub root_public_key: Vec<u8>,
    pub key_envelope: KeyEnvelope,
    #[serde(default)]
    pub key_transition: Option<WireTransition>,
}

/// A signed-in session, for the Settings list.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerSession {
    pub session_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub os_version: String,
    pub created_at: String,
    #[serde(default)]
    pub last_seen_at: Option<String>,
    #[serde(default)]
    pub revoked_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScopeUsage {
    pub scope: String,
    pub bytes: u64,
    pub records: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerUsage {
    pub bytes: u64,
    pub limit_bytes: Option<u64>,
    pub scopes: Vec<ScopeUsage>,
}

/// A session's name and platform, as it describes itself.
#[derive(Clone, Debug, Default, Serialize)]
pub struct SessionInfo {
    pub name: String,
    pub platform: String,
    pub os_version: String,
}

#[derive(Serialize)]
struct WireGrant<'a> {
    vault_id: &'a str,
    session_id: &'a str,
    #[serde(with = "b64")]
    public_key: Vec<u8>,
    #[serde(with = "b64")]
    signature: Vec<u8>,
}

fn grant<'a>(
    root: &VaultRoot,
    vault_id: &'a str,
    session_id: &'a str,
    key: &DeviceKey,
) -> Result<WireGrant<'a>> {
    let public_key = key.public_key_bytes();
    let signature = root.sign_domain(&keys::grant_bytes(vault_id, session_id, &public_key)?)?;
    Ok(WireGrant {
        vault_id,
        session_id,
        public_key,
        signature,
    })
}

/// The vault's endpoints, on the account's client.
impl SyncApi {
    pub async fn server_vault(&self) -> Result<Option<ServerVault>> {
        #[derive(Deserialize)]
        struct Response {
            vault: Option<ServerVault>,
        }
        let response: Response = self
            .request(reqwest::Method::GET, "vault", None::<&()>)
            .await?;
        Ok(response.vault)
    }

    /// Creates the account's vault and admits this session. `Error::Recovery` means another
    /// session got there first: the account has a vault now, so open that one.
    pub async fn create_server_vault(
        &self,
        root: &VaultRoot,
        vault_id: &str,
        envelope: &KeyEnvelope,
        session_id: &str,
        key: &DeviceKey,
        info: &SessionInfo,
    ) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> {
            #[serde(with = "b64")]
            root_public_key: Vec<u8>,
            key_envelope: &'a KeyEnvelope,
            session: WireGrant<'a>,
            #[serde(flatten)]
            info: &'a SessionInfo,
        }
        let _: serde_json::Value = self
            .request(
                reqwest::Method::POST,
                "vault",
                Some(&Body {
                    root_public_key: keys::public_key(root)?,
                    key_envelope: envelope,
                    session: grant(root, vault_id, session_id, key)?,
                    info,
                }),
            )
            .await?;
        Ok(())
    }

    /// Admits this session to a vault it just opened.
    pub async fn enroll_session(
        &self,
        root: &VaultRoot,
        vault_id: &str,
        session_id: &str,
        key: &DeviceKey,
        info: &SessionInfo,
    ) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> {
            session: WireGrant<'a>,
            #[serde(flatten)]
            info: &'a SessionInfo,
        }
        let _: serde_json::Value = self
            .request(
                reqwest::Method::POST,
                "sessions",
                Some(&Body {
                    session: grant(root, vault_id, session_id, key)?,
                    info,
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn sessions(&self) -> Result<Vec<ServerSession>> {
        #[derive(Deserialize)]
        struct Response {
            sessions: Vec<ServerSession>,
        }
        let response: Response = self
            .request(reqwest::Method::GET, "sessions", None::<&()>)
            .await?;
        Ok(response.sessions)
    }

    pub async fn rename_session(&self, session_id: &str, name: &str) -> Result<()> {
        let _: serde_json::Value = self
            .request(
                reqwest::Method::PUT,
                &format!("sessions/{session_id}/name"),
                Some(&serde_json::json!({ "name": name })),
            )
            .await?;
        Ok(())
    }

    /// Removes a session for good, with the vault root's signature.
    pub async fn remove_session(
        &self,
        root: &VaultRoot,
        vault_id: &str,
        session_id: &str,
    ) -> Result<()> {
        let proof = root.sign_domain(&keys::removal_bytes(vault_id, session_id)?)?;
        #[derive(Serialize)]
        struct Body {
            #[serde(with = "b64")]
            proof: Vec<u8>,
        }
        let _: serde_json::Value = self
            .request(
                reqwest::Method::POST,
                &format!("sessions/{session_id}/remove"),
                Some(&Body { proof }),
            )
            .await?;
        Ok(())
    }

    /// Replaces the sealed root after a password change, for the next generation. The server
    /// accepts it only with the root's signature.
    pub async fn replace_sealed_root(
        &self,
        root: &VaultRoot,
        vault: &ServerVault,
        envelope: &KeyEnvelope,
    ) -> Result<()> {
        let generation = vault
            .key_transition
            .as_ref()
            .map_or(0, |transition| transition.generation)
            + 1;
        #[derive(Serialize)]
        struct Body<'a> {
            key_envelope: &'a KeyEnvelope,
            key_transition: WireTransition,
        }
        let _: serde_json::Value = self
            .request(
                reqwest::Method::PUT,
                "vault/key",
                Some(&Body {
                    key_envelope: envelope,
                    key_transition: WireTransition {
                        generation,
                        signature: keys::sign_transition(
                            root,
                            &vault.vault_id,
                            generation,
                            envelope,
                        )?,
                    },
                }),
            )
            .await?;
        Ok(())
    }

    /// Destroys the vault with the root's signature, from a session that has it open.
    pub async fn destroy_vault_with_root(&self, root: &VaultRoot, vault_id: &str) -> Result<bool> {
        let proof = root.sign_domain(&keys::destroy_bytes(vault_id)?)?;
        #[derive(Serialize)]
        struct Body {
            #[serde(with = "b64")]
            proof: Vec<u8>,
        }
        self.destroy(&Body { proof }).await
    }

    /// Destroys the vault for someone who lost its password: the account password, or none for an
    /// account that has none and signed in moments ago. `Error::Unlock` means it wasn't accepted.
    pub async fn destroy_vault_with_password(&self, current_password: &str) -> Result<bool> {
        self.destroy(&serde_json::json!({ "current_password": current_password }))
            .await
    }

    async fn destroy(&self, body: &impl Serialize) -> Result<bool> {
        #[derive(Deserialize)]
        struct Response {
            deleted: bool,
        }
        let response: Response = self
            .request(reqwest::Method::DELETE, "vault", Some(body))
            .await?;
        Ok(response.deleted)
    }

    pub async fn usage(&self) -> Result<ServerUsage> {
        self.request(reqwest::Method::GET, "usage", None::<&()>)
            .await
    }

    async fn vault_ticket(&self, vault_id: &str, session_id: &str) -> Result<String> {
        #[derive(Deserialize)]
        struct Response {
            ticket: String,
        }
        let response: Response = self
            .request(
                reqwest::Method::POST,
                "ticket",
                Some(&serde_json::json!({ "vault_id": vault_id, "session_id": session_id })),
            )
            .await?;
        Ok(response.ticket)
    }
}

/// The open socket. Ticket first, then the session proves it holds its key.
pub struct VaultSocket {
    stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
    traffic: Arc<TrafficCounters>,
    pub vault: ServerVault,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Handshake {
    Challenge {
        challenge: String,
    },
    Welcome {
        vault: ServerVault,
    },
    #[serde(other)]
    Other,
}

impl VaultSocket {
    pub async fn connect(
        api: &SyncApi,
        vault_id: &str,
        session_id: &str,
        key: &DeviceKey,
    ) -> Result<Self> {
        let ticket = api.vault_ticket(vault_id, session_id).await?;
        let mut endpoint = api.endpoint("ws");
        let secure = endpoint.scheme() == "https";
        endpoint
            .set_scheme(if secure { "wss" } else { "ws" })
            .map_err(|_| Error::Invalid)?;
        endpoint.query_pairs_mut().append_pair("ticket", &ticket);
        let connector = if secure {
            Some(crate::transport::tls_connector()?)
        } else {
            None
        };
        let config = WebSocketConfig::default()
            .read_buffer_size(8192)
            .write_buffer_size(8192)
            .max_write_buffer_size(4 << 20)
            .max_message_size(Some(MAX_FRAME_BYTES))
            .max_frame_size(Some(MAX_FRAME_BYTES));
        let (stream, _) = timeout(
            CONNECT_TIMEOUT,
            connect_async_tls_with_config(endpoint.as_str(), Some(config), false, connector),
        )
        .await
        .map_err(|_| Error::Network)?
        .map_err(|_| Error::Network)?;
        let mut socket = Self {
            stream,
            traffic: api.traffic(),
            vault: ServerVault {
                vault_id: vault_id.to_owned(),
                head_sequence: 0,
                compacted_through: 0,
                root_public_key: Vec::new(),
                key_envelope: KeyEnvelope {
                    version: 0,
                    kdf: String::new(),
                    salt: String::new(),
                    nonce: String::new(),
                    ciphertext: String::new(),
                },
                key_transition: None,
            },
        };
        let Handshake::Challenge { challenge } = socket.handshake_frame().await? else {
            return Err(Error::Network);
        };
        let signature = key.sign_bytes(&keys::connect_bytes(vault_id, session_id, &challenge)?);
        socket
            .send_text(
                serde_json::json!({ "type": "authenticate", "signature": signature }).to_string(),
            )
            .await?;
        let Handshake::Welcome { vault } = socket.handshake_frame().await? else {
            return Err(Error::Network);
        };
        if vault.vault_id != vault_id {
            return Err(Error::Identity);
        }
        socket.vault = vault;
        Ok(socket)
    }

    async fn handshake_frame(&mut self) -> Result<Handshake> {
        let text = timeout(WRITE_TIMEOUT, self.next_text())
            .await
            .map_err(|_| Error::Network)??;
        Ok(serde_json::from_str(&text)?)
    }

    async fn next_text(&mut self) -> Result<String> {
        loop {
            let message = self
                .stream
                .next()
                .await
                .ok_or(Error::Network)?
                .map_err(|_| Error::Network)?;
            match message {
                Message::Text(text) => {
                    self.traffic.add_downloaded(text.len() as u64);
                    return Ok(text.to_string());
                }
                Message::Ping(_) => {
                    // The library queues the pong; flushing sends it.
                    self.stream.flush().await.map_err(|_| Error::Network)?;
                }
                Message::Pong(_) => {}
                _ => return Err(Error::Network),
            }
        }
    }

    /// The next frame. One this version can't read at all is skipped: a newer server never breaks
    /// an older client.
    pub async fn receive(&mut self) -> Result<ServerFrame> {
        loop {
            let text = timeout(READ_TIMEOUT, self.next_text())
                .await
                .map_err(|_| Error::Network)??;
            if let Ok(frame) = serde_json::from_str(&text) {
                return Ok(frame);
            }
        }
    }

    pub async fn send(&mut self, frame: &ClientFrame) -> Result<()> {
        self.send_text(serde_json::to_string(frame)?).await
    }

    async fn send_text(&mut self, text: String) -> Result<()> {
        let bytes = text.len() as u64;
        timeout(WRITE_TIMEOUT, self.stream.send(Message::Text(text.into())))
            .await
            .map_err(|_| Error::Network)?
            .map_err(|_| Error::Network)?;
        self.traffic.add_uploaded(bytes);
        Ok(())
    }

    pub async fn close(&mut self) {
        let _ = timeout(Duration::from_secs(1), self.stream.close(None)).await;
    }
}

impl TrafficCounters {
    pub(crate) fn add_uploaded(&self, bytes: u64) {
        self.uploaded.fetch_add(bytes, Ordering::Relaxed);
    }
    pub(crate) fn add_downloaded(&self, bytes: u64) {
        self.downloaded.fetch_add(bytes, Ordering::Relaxed);
    }
}
