use super::{authorization, AccountClient, Captured, TOKEN_TRANSPORT};
use std::{sync::Arc, time::Duration};

const REFRESH_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ANSWER_BYTES: usize = 64 << 10;

pub(crate) struct RefreshAnswer {
    pub status: u16,
    pub body: Vec<u8>,
    pub ended: bool,
}

impl RefreshAnswer {
    #[cfg(test)]
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

#[cfg(test)]
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
    #[cfg(test)]
    pub(crate) async fn refresh(self: &Arc<Self>, base: &url::Url) -> Result<(), String> {
        let used = self.access_header();
        let answer = self.refresh_after(base, used.as_deref()).await?;
        if answer.succeeded() {
            Ok(())
        } else {
            Err("Sign in again.".into())
        }
    }

    #[cfg(test)]
    pub(crate) async fn refresh_after(
        self: &Arc<Self>,
        base: &url::Url,
        used: Option<&str>,
    ) -> Result<RefreshAnswer, String> {
        self.rotate(refresh_endpoint(base), used.map(str::to_owned))
            .await
    }

    pub(crate) async fn rotate(
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
