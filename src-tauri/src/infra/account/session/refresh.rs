//! Rotating a session's tokens. Rotations are serialized: the server treats two uses of one
//! refresh token as a replay and ends the whole session.
use super::{authorization, AccountClient, Captured, TOKEN_TRANSPORT};
use std::{sync::Arc, time::Duration};

const REFRESH_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ANSWER_BYTES: usize = 64 << 10;

/// How a refresh went, for a caller that passes it on.
pub(in crate::infra) struct RefreshAnswer {
    pub status: u16,
    pub body: Vec<u8>,
    /// The server ended the session, so the tokens are gone.
    pub ended: bool,
}

impl RefreshAnswer {
    pub fn succeeded(&self) -> bool {
        (200..300).contains(&self.status)
    }
    fn rotated() -> Self {
        Self {
            status: 204,
            body: Vec::new(),
            ended: false,
        }
    }
}

fn refresh_endpoint(base: &url::Url) -> url::Url {
    let mut endpoint = base.clone();
    endpoint.set_path(&format!(
        "{}/auth/refresh",
        base.path().trim_end_matches('/')
    ));
    endpoint.set_query(None);
    endpoint
}

impl AccountClient {
    /// Rotates the session once. A caller that was waiting while another rotated it uses that
    /// rotation instead of starting its own.
    pub(in crate::infra) async fn refresh(self: &Arc<Self>, base: &url::Url) -> Result<(), String> {
        let used = self.access_header();
        let answer = self.refresh_after(base, used.as_deref()).await?;
        if answer.succeeded() {
            Ok(())
        } else {
            Err("Sign in again.".into())
        }
    }

    /// Rotates the session after the server refused `used`, the `access_header` a request sent.
    pub(in crate::infra) async fn refresh_after(
        self: &Arc<Self>,
        base: &url::Url,
        used: Option<&str>,
    ) -> Result<RefreshAnswer, String> {
        self.rotate(refresh_endpoint(base), used.map(str::to_owned))
            .await
    }

    /// Runs apart from the caller: a caller that gives up mid-request must not lose the tokens
    /// the server has already rotated to, or the next attempt would look like a replay.
    pub(in crate::infra) async fn rotate(
        self: &Arc<Self>,
        endpoint: url::Url,
        used: Option<String>,
    ) -> Result<RefreshAnswer, String> {
        let client = self.clone();
        tokio::spawn(async move { client.rotate_now(endpoint, used).await })
            .await
            .map_err(|_| "Could not refresh the Misty session".to_owned())?
    }

    async fn rotate_now(
        &self,
        endpoint: url::Url,
        used: Option<String>,
    ) -> Result<RefreshAnswer, String> {
        let _guard = self.refresh_lock.lock().await;
        if let Some(current) = self.access_header() {
            if used.as_deref() != Some(current.as_str()) {
                return Ok(RefreshAnswer::rotated());
            }
        }
        let Some(bearer) = self.refresh_header(&endpoint) else {
            self.persist(&endpoint)?;
            return Ok(RefreshAnswer {
                status: 401,
                body: br#"{"code":"not_authenticated"}"#.to_vec(),
                ended: true,
            });
        };
        let response = self
            .http
            .post(endpoint.clone())
            .timeout(REFRESH_TIMEOUT)
            .header(reqwest::header::AUTHORIZATION, authorization(&bearer)?)
            .header(TOKEN_TRANSPORT.0, TOKEN_TRANSPORT.1)
            .header("X-Misty-CSRF", "1")
            .send()
            .await
            .map_err(|_| "Could not reach the Misty server".to_owned())?;
        let status = response.status().as_u16();
        let ended = match self.capture(&endpoint, response.headers())? {
            Captured::Signed => return Ok(RefreshAnswer::rotated()),
            Captured::Ended => true,
            Captured::Nothing if status == 401 => {
                self.clear()?;
                self.persist(&endpoint)?;
                true
            }
            Captured::Nothing => false,
        };
        Ok(RefreshAnswer {
            // A success that renewed nothing isn't one: a server too old to answer in headers.
            status: if (200..300).contains(&status) {
                502
            } else {
                status
            },
            body: read_limited(response).await,
            ended,
        })
    }
}

async fn read_limited(mut response: reqwest::Response) -> Vec<u8> {
    let mut bytes = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if bytes.len() + chunk.len() > MAX_ANSWER_BYTES {
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    bytes
}
