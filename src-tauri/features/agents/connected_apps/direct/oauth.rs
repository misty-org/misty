//! Signing in to an app's own MCP server the way the MCP authorization spec lays out: the server
//! names its authorization server, Misty registers itself there for this one sign-in (dynamic client
//! registration), and the person approves in their browser with PKCE. Misty has no client secret of
//! its own and no server in between; the tokens go to the keychain (`store.rs`).
//!
//! A server that only works with an app registered ahead of time ("needs app") isn't offered: that
//! would mean Misty keeping keys of its own.
use std::time::Duration;

use base64::Engine as _;
use rand::RngCore;
use reqwest::{header, Client, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// How long the browser sign-in may take before Misty stops listening for it.
const SIGN_IN_LIMIT: Duration = Duration::from_secs(600);
const PROBE_LIMIT: Duration = Duration::from_secs(10);

/// What signing in to a server takes.
#[derive(Clone, Debug, PartialEq)]
pub enum Access {
    /// The server answers without a sign-in.
    Open,
    /// The server takes a sign-in Misty can do with no key of its own.
    Keyless(Discovered),
    /// The server needs an app registered ahead of time.
    NeedsApp,
    /// No answer, or one Misty can't use.
    Unreachable,
}

impl Access {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Keyless(_) => "keyless",
            Self::NeedsApp => "needs_app",
            Self::Unreachable => "unreachable",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Discovered {
    pub resource: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: String,
    pub scope: Option<String>,
}

/// Tokens from a sign-in or a refresh.
#[derive(Clone, Debug)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

/// The client the app registered for one sign-in.
#[derive(Clone, Debug)]
pub struct Registered {
    pub client_id: String,
    pub client_secret: Option<String>,
}

pub fn initialize_body() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": super::client::PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "Misty", "version": env!("CARGO_PKG_VERSION") },
        },
    })
}

fn origin(url: &url::Url) -> String {
    let mut origin = format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default());
    if let Some(port) = url.port() {
        origin.push_str(&format!(":{port}"));
    }
    origin
}

async fn json_at(http: &Client, url: &str) -> Option<Value> {
    let response = tokio::time::timeout(
        PROBE_LIMIT,
        http.get(url)
            .header(header::ACCEPT, "application/json")
            .send(),
    )
    .await
    .ok()?
    .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().await.ok()
}

/// `resource_metadata="…"` and `scope="…"` from a 401's challenge.
fn challenge_field(challenge: &str, field: &str) -> Option<String> {
    let start = challenge.find(&format!("{field}=\""))? + field.len() + 2;
    let end = challenge[start..].find('"')? + start;
    Some(challenge[start..end].to_owned())
}

/// Asks the server what a sign-in takes, without signing in.
pub async fn discover(http: &Client, server: &str) -> Access {
    let Ok(url) = url::Url::parse(server) else {
        return Access::Unreachable;
    };
    let answer = tokio::time::timeout(
        PROBE_LIMIT,
        http.post(server)
            .header(header::ACCEPT, "application/json, text/event-stream")
            .json(&initialize_body())
            .send(),
    )
    .await;
    let Ok(Ok(response)) = answer else {
        return Access::Unreachable;
    };
    if response.status().is_success() {
        return Access::Open;
    }
    if response.status() != StatusCode::UNAUTHORIZED {
        return Access::Unreachable;
    }
    let challenge = response
        .headers()
        .get(header::WWW_AUTHENTICATE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let base = origin(&url);
    let path = url.path().trim_end_matches('/');
    let mut metadata = None;
    if let Some(named) = challenge_field(&challenge, "resource_metadata") {
        metadata = json_at(http, &named).await;
    }
    for candidate in [
        format!("{base}/.well-known/oauth-protected-resource{path}"),
        format!("{base}/.well-known/oauth-protected-resource"),
    ] {
        if metadata.is_some() {
            break;
        }
        metadata = json_at(http, &candidate).await;
    }
    let metadata = metadata.unwrap_or(Value::Null);
    let resource = metadata["resource"].as_str().unwrap_or(server).to_owned();
    let issuer = metadata["authorization_servers"][0]
        .as_str()
        .unwrap_or(&base)
        .trim_end_matches('/')
        .to_owned();
    let Ok(issuer_url) = url::Url::parse(&issuer) else {
        return Access::Unreachable;
    };
    let issuer_base = origin(&issuer_url);
    let issuer_path = issuer_url.path().trim_end_matches('/');
    let mut server_metadata = None;
    for candidate in [
        format!("{issuer_base}/.well-known/oauth-authorization-server{issuer_path}"),
        format!("{issuer}/.well-known/oauth-authorization-server"),
        format!("{issuer_base}/.well-known/openid-configuration{issuer_path}"),
        format!("{issuer}/.well-known/openid-configuration"),
    ] {
        server_metadata = json_at(http, &candidate).await;
        if server_metadata.is_some() {
            break;
        }
    }
    let Some(found) = server_metadata else {
        return Access::Unreachable;
    };
    let text = |name: &str| found[name].as_str().map(str::to_owned);
    let pkce = found["code_challenge_methods_supported"]
        .as_array()
        .is_none_or(|methods| methods.iter().any(|method| method == "S256"));
    match (
        text("authorization_endpoint"),
        text("token_endpoint"),
        text("registration_endpoint"),
    ) {
        (Some(authorization_endpoint), Some(token_endpoint), Some(registration_endpoint))
            if pkce =>
        {
            Access::Keyless(Discovered {
                resource,
                authorization_endpoint,
                token_endpoint,
                registration_endpoint,
                scope: challenge_field(&challenge, "scope")
                    .or_else(|| {
                        metadata["scopes_supported"].as_array().map(|scopes| {
                            scopes
                                .iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                    })
                    .filter(|scope| !scope.is_empty()),
            })
        }
        (Some(_), Some(_), _) => Access::NeedsApp,
        _ => Access::Unreachable,
    }
}

fn random_text() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn challenge_of(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn failure(response: &Value, fallback: &str) -> String {
    response["error_description"]
        .as_str()
        .or_else(|| response["error"].as_str())
        .map(|text| super::super::client::truncate(text, 300))
        .unwrap_or_else(|| fallback.to_owned())
}

async fn register(
    http: &Client,
    found: &Discovered,
    redirect_uri: &str,
) -> Result<Registered, String> {
    let mut body = json!({
        "client_name": "Misty",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    if let Some(scope) = &found.scope {
        body["scope"] = json!(scope);
    }
    let response = http
        .post(&found.registration_endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|_| "The app didn't answer. Try again.".to_owned())?;
    let ok = response.status().is_success();
    let answer: Value = response.json().await.unwrap_or(Value::Null);
    let client_id = answer["client_id"].as_str().filter(|_| ok);
    match client_id {
        Some(id) => Ok(Registered {
            client_id: id.to_owned(),
            client_secret: answer["client_secret"].as_str().map(str::to_owned),
        }),
        None => Err(failure(&answer, "The app didn't let Misty sign in.")),
    }
}

#[derive(Deserialize)]
struct TokenAnswer {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

async fn token_request(
    http: &Client,
    token_endpoint: &str,
    form: Vec<(&str, String)>,
) -> Result<Tokens, String> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form.iter().map(|(key, value)| (*key, value.as_str())))
        .finish();
    let response = http
        .post(token_endpoint)
        .header(header::ACCEPT, "application/json")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|_| "The app didn't answer. Try again.".to_owned())?;
    let ok = response.status().is_success();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    let parsed: Option<TokenAnswer> = serde_json::from_value(value.clone()).ok();
    match parsed.filter(|_| ok) {
        Some(TokenAnswer {
            access_token: Some(access_token),
            refresh_token,
            expires_in,
        }) => Ok(Tokens {
            access_token,
            refresh_token,
            expires_at: expires_in.map(|seconds| chrono::Utc::now().timestamp() + seconds),
        }),
        _ => Err(failure(&value, "The app didn't finish the sign-in.")),
    }
}

/// A new access token from a refresh token.
pub async fn refresh(
    http: &Client,
    token_endpoint: &str,
    client_id: &str,
    client_secret: Option<&str>,
    resource: &str,
    refresh_token: &str,
) -> Result<Tokens, String> {
    let mut form = vec![
        ("grant_type", "refresh_token".to_owned()),
        ("refresh_token", refresh_token.to_owned()),
        ("client_id", client_id.to_owned()),
        ("resource", resource.to_owned()),
    ];
    if let Some(secret) = client_secret {
        form.push(("client_secret", secret.to_owned()));
    }
    token_request(http, token_endpoint, form).await
}

/// A sign-in under way: open `authorize_url` in the browser, then await `finish`.
pub struct SignIn {
    pub authorize_url: String,
    pub registered: Registered,
    listener: TcpListener,
    state: String,
    verifier: String,
    redirect_uri: String,
}

pub async fn begin(http: &Client, found: &Discovered) -> Result<SignIn, String> {
    // A one-time address on this computer only, which the browser comes back to.
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|_| "Misty couldn't start the sign-in. Try again.".to_owned())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Misty couldn't start the sign-in. Try again.".to_owned())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let registered = register(http, found, &redirect_uri).await?;
    let state = random_text();
    let verifier = random_text();
    let mut authorize = url::Url::parse(&found.authorization_endpoint)
        .map_err(|_| "The app gave a sign-in address Misty can't use.".to_owned())?;
    {
        let mut query = authorize.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", &registered.client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("code_challenge", &challenge_of(&verifier))
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state)
            .append_pair("resource", &found.resource);
        if let Some(scope) = &found.scope {
            query.append_pair("scope", scope);
        }
    }
    Ok(SignIn {
        authorize_url: authorize.into(),
        registered,
        listener,
        state,
        verifier,
        redirect_uri,
    })
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Misty</title>\
<body style=\"font:16px system-ui;background:#141414;color:#eee;display:grid;place-items:center;height:90vh\">\
<p>You're signed in. You can close this tab and go back to Misty.</p>";
const FAILED_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Misty</title>\
<body style=\"font:16px system-ui;background:#141414;color:#eee;display:grid;place-items:center;height:90vh\">\
<p>The sign-in didn't finish. Go back to Misty and try again.</p>";

/// The `code` from the browser's return to the one-time address, checked against `state`.
fn callback_code(request_line: &str, state: &str) -> Option<Result<String, String>> {
    let target = request_line.split_whitespace().nth(1)?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != "/callback" {
        return None;
    }
    let field = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    if field("state").as_deref() != Some(state) {
        return Some(Err("The sign-in came back for another request.".to_owned()));
    }
    Some(match (field("code"), field("error")) {
        (Some(code), _) => Ok(code),
        (None, Some(error)) if error == "access_denied" => {
            Err("The sign-in was cancelled.".to_owned())
        }
        _ => Err("The app didn't finish the sign-in.".to_owned()),
    })
}

impl SignIn {
    /// Waits for the browser to come back, then trades the code for tokens.
    pub async fn finish(self, http: &Client, found: &Discovered) -> Result<Tokens, String> {
        let code = tokio::time::timeout(SIGN_IN_LIMIT, async {
            loop {
                let Ok((mut socket, _)) = self.listener.accept().await else {
                    continue;
                };
                let mut buffer = vec![0u8; 8192];
                let read = socket.read(&mut buffer).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]);
                let line = request.lines().next().unwrap_or_default();
                let Some(outcome) = callback_code(line, &self.state) else {
                    let _ = socket
                        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                        .await;
                    continue;
                };
                let page = if outcome.is_ok() { DONE_PAGE } else { FAILED_PAGE };
                let _ = socket
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                            page.len()
                        )
                        .as_bytes(),
                    )
                    .await;
                return outcome;
            }
        })
        .await
        .map_err(|_| "The sign-in took too long. Try again.".to_owned())??;
        let mut form = vec![
            ("grant_type", "authorization_code".to_owned()),
            ("code", code),
            ("redirect_uri", self.redirect_uri.clone()),
            ("client_id", self.registered.client_id.clone()),
            ("code_verifier", self.verifier.clone()),
            ("resource", found.resource.clone()),
        ];
        if let Some(secret) = &self.registered.client_secret {
            form.push(("client_secret", secret.clone()));
        }
        token_request(http, &found.token_endpoint, form).await
    }
}

#[cfg(test)]
pub(super) fn test_callback_code(line: &str, state: &str) -> Option<Result<String, String>> {
    callback_code(line, state)
}
