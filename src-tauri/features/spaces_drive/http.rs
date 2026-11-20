//! The drive's network, with Misty's own session: the account client's bearer on every server
//! request, rotated tokens taken from every answer, and one rotation and retry on a 401, as
//! `account/http.rs` does for the renderer. Presigned storage addresses get no session at all,
//! through a client that follows Settings' proxy. Nothing here is logged.
use std::time::Duration;

use futures_util::{future::BoxFuture, StreamExt};
use reqwest::header::{HeaderName, HeaderValue, AUTHORIZATION, CONTENT_LENGTH};
use space_drive::api::{ByteStream, Method, Request, Response};
use space_drive::{Http, HttpError};

use crate::account::session::{self, Captured};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// The most of a server answer kept; drive answers are small JSON.
const MAX_ANSWER: usize = 16 * 1024 * 1024;

pub(crate) struct AccountHttp {
    /// The API base the renderer named, such as `https://misty.example/v1`.
    base: url::Url,
    account_id: String,
    transfer: reqwest::Client,
}

impl AccountHttp {
    pub(crate) fn new(base: url::Url, account_id: String) -> Result<Self, String> {
        // Misty's builds carry rustls without a default provider; the app installs ring at launch.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let transfer = crate::engine_config::proxy::apply_to_client(
            reqwest::Client::builder()
                .user_agent(concat!("Misty/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(CONNECT_TIMEOUT),
        )
        .build()
        .map_err(|error| error.to_string())?;
        Ok(Self {
            base,
            account_id,
            transfer,
        })
    }

    fn url(&self, path: &str) -> Result<url::Url, HttpError> {
        let joined = format!("{}{}", self.base.as_str().trim_end_matches('/'), path);
        url::Url::parse(&joined).map_err(|_| HttpError::Other("A bad drive address.".into()))
    }

    fn refresh_endpoint(&self) -> url::Url {
        let mut endpoint = self.base.clone();
        endpoint.set_path(&format!(
            "{}/auth/refresh",
            self.base.path().trim_end_matches('/')
        ));
        endpoint.set_query(None);
        endpoint
    }
}

fn method_of(method: Method) -> reqwest::Method {
    match method {
        Method::Get => reqwest::Method::GET,
        Method::Post => reqwest::Method::POST,
        Method::Put => reqwest::Method::PUT,
        Method::Patch => reqwest::Method::PATCH,
        Method::Delete => reqwest::Method::DELETE,
    }
}

/// A response's headers without the session's: tokens never leave the account client.
fn headers_of(response: &reqwest::Response) -> Vec<(String, String)> {
    response
        .headers()
        .iter()
        .filter(|(name, _)| {
            *name != reqwest::header::SET_COOKIE && !name.as_str().starts_with("x-misty-")
        })
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_owned()))
        })
        .collect()
}

async fn body_of(response: reqwest::Response) -> Result<Vec<u8>, HttpError> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| HttpError::Offline)?;
        if body.len() + chunk.len() > MAX_ANSWER {
            return Err(HttpError::Other("The server's answer was too long.".into()));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

impl Http for AccountHttp {
    fn api(&self, request: Request) -> BoxFuture<'_, Result<Response, HttpError>> {
        Box::pin(async move {
            let url = self.url(&request.path)?;
            let client = session::current(&self.base).map_err(|_| HttpError::SignedOut)?;
            if client.require_account(&self.base, &self.account_id).is_err() {
                return Err(HttpError::SignedOut);
            }
            for attempt in 0..2 {
                let used = client.access_header();
                let mut builder = client.http.request(method_of(request.method), url.clone());
                for (name, value) in &request.headers {
                    if let (Ok(name), Ok(value)) = (
                        HeaderName::from_bytes(name.as_bytes()),
                        HeaderValue::from_str(value),
                    ) {
                        builder = builder.header(name, value);
                    }
                }
                if let Some(bearer) = &used {
                    builder = builder.header(
                        AUTHORIZATION,
                        session::authorization(bearer).map_err(|_| HttpError::SignedOut)?,
                    );
                }
                builder = builder
                    .header(session::TOKEN_TRANSPORT.0, session::TOKEN_TRANSPORT.1)
                    .header("X-Misty-CSRF", "1");
                if let Some(body) = &request.body {
                    builder = builder.body(body.clone());
                }
                let response = builder.send().await.map_err(|_| HttpError::Offline)?;
                match client.capture(&self.base, response.headers()) {
                    Ok(Captured::Ended) => return Err(HttpError::SignedOut),
                    Ok(Captured::Signed | Captured::Nothing) => {}
                    Err(_) => return Err(HttpError::SignedOut),
                }
                let status = response.status().as_u16();
                if status == 401 && attempt == 0 {
                    let answer = client
                        .rotate(self.refresh_endpoint(), used)
                        .await
                        .map_err(|_| HttpError::Offline)?;
                    if answer.ended || !(200..300).contains(&answer.status) {
                        return Err(HttpError::SignedOut);
                    }
                    continue;
                }
                let headers = headers_of(&response);
                let body = body_of(response).await?;
                return Ok(Response {
                    status,
                    headers,
                    body,
                });
            }
            Err(HttpError::SignedOut)
        })
    }

    fn put_blob(
        &self,
        url: String,
        method: String,
        headers: Vec<(String, String)>,
        length: u64,
        body: ByteStream,
    ) -> BoxFuture<'_, Result<Response, HttpError>> {
        Box::pin(async move {
            let url = reqwest::Url::parse(&url)
                .ok()
                .filter(|url| matches!(url.scheme(), "http" | "https"))
                .ok_or_else(|| HttpError::Other("The server sent an address Misty can't use.".into()))?;
            let method = match method.to_ascii_uppercase().as_str() {
                "PUT" => reqwest::Method::PUT,
                "POST" => reqwest::Method::POST,
                _ => return Err(HttpError::Other("The server asked for an upload Misty can't make.".into())),
            };
            // Object storage wants the length up front rather than a chunked body.
            let mut builder = self
                .transfer
                .request(method, url)
                .header(CONTENT_LENGTH, length.to_string())
                .body(reqwest::Body::wrap_stream(body));
            for (name, value) in &headers {
                if !space_drive::transfer::skipped_header(name) {
                    builder = builder.header(name.as_str(), value.as_str());
                }
            }
            let response = builder.send().await.map_err(|_| HttpError::Offline)?;
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.to_string(), value.to_owned()))
                })
                .collect();
            Ok(Response {
                status,
                headers,
                body: Vec::new(),
            })
        })
    }

    fn get_blob(&self, url: String) -> BoxFuture<'_, Result<(u16, ByteStream), HttpError>> {
        Box::pin(async move {
            let url = reqwest::Url::parse(&url)
                .ok()
                .filter(|url| matches!(url.scheme(), "http" | "https"))
                .ok_or_else(|| HttpError::Other("The server sent an address Misty can't use.".into()))?;
            let response = self
                .transfer
                .get(url)
                .send()
                .await
                .map_err(|_| HttpError::Offline)?;
            let status = response.status().as_u16();
            let stream: ByteStream = Box::pin(response.bytes_stream().map(|chunk| {
                chunk.map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))
            }));
            Ok((status, stream))
        })
    }
}
