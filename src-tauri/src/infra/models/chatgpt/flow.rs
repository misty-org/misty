//! The OAuth steps of Sign in with ChatGPT for open-source apps
//! (developers.openai.com/siwc/token-sharing-open-source): the authorize URL, the callback,
//! the code exchange, the ID token's claims, refresh and revocation. Endpoints are passed in,
//! so the tests run against a fake issuer.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// Where the issuer and the API live.
#[derive(Clone)]
pub struct Endpoints {
    pub issuer: String,
    pub authorize: String,
    pub token: String,
    pub discovery: String,
}

impl Endpoints {
    pub fn openai() -> Self {
        Self {
            issuer: "https://auth.openai.com".into(),
            authorize: "https://auth.openai.com/api/accounts/authorize".into(),
            token: "https://auth.openai.com/api/accounts/oauth/token".into(),
            discovery: "https://auth.openai.com/.well-known/openid-configuration".into(),
        }
    }
}

/// First sign-ins register a client of their own through this ID.
pub const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
pub const RESOURCE: &str = "https://api.openai.com/v1";
pub const SCOPE: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The grant that lets requests use the person's ChatGPT plan.
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
pub const CALLBACK_PATH: &str = "/auth/callback";
/// Access tokens last an hour; they are renewed when this little is left.
pub const REFRESH_MARGIN_SECS: u64 = 5 * 60;

/// One sign-in attempt's fresh values.
pub struct Attempt<'a> {
    /// The client issued at an earlier sign-in, or None to register one.
    pub client_id: Option<&'a str>,
    pub host_id: &'a str,
    pub redirect_uri: &'a str,
    pub state: &'a str,
    pub nonce: &'a str,
    pub challenge: &'a str,
    pub id_token_hint: Option<&'a str>,
    pub login_hint: Option<&'a str>,
}

pub fn authorize_url(endpoints: &Endpoints, attempt: &Attempt) -> String {
    let mut url = url::Url::parse(&endpoints.authorize).expect("authorize endpoint");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", attempt.client_id.unwrap_or(DYNAMIC_CLIENT));
        if attempt.client_id.is_none() {
            query.append_pair("agent_name_hint", "Misty");
        }
        query.append_pair("ext_agent_host_id", attempt.host_id);
        if let (Some(_), Some(hint)) = (attempt.client_id, attempt.id_token_hint) {
            query.append_pair("id_token_hint", hint);
        }
        if let Some(hint) = attempt.login_hint {
            query.append_pair("login_hint", hint);
        }
        query
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", attempt.redirect_uri)
            .append_pair("scope", SCOPE)
            .append_pair("resource", RESOURCE)
            .append_pair("state", attempt.state)
            .append_pair("nonce", attempt.nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", attempt.challenge);
    }
    url.into()
}

/// The code and the client it was issued to, from the browser's redirect.
pub fn callback(
    query: &HashMap<String, String>,
    state: &str,
    pending_client: Option<&str>,
) -> Result<(String, String), String> {
    if query.get("state").map(String::as_str) != Some(state) {
        return Err("The sign-in came back for another attempt. Try again.".into());
    }
    if query.contains_key("error") {
        return Err("ChatGPT sign-in was cancelled.".into());
    }
    let code = query
        .get("code")
        .filter(|code| !code.is_empty())
        .ok_or("ChatGPT didn't send a sign-in code.")?;
    let issued = query.get("client_id").filter(|id| !id.is_empty());
    let client = match (pending_client, issued) {
        (Some(saved), Some(issued)) if saved != issued => {
            return Err("ChatGPT answered for a different registration. Try again.".into())
        }
        (Some(saved), _) => saved.to_owned(),
        (None, Some(issued)) => issued.clone(),
        (None, None) => return Err("ChatGPT didn't finish registering Misty. Try again.".into()),
    };
    Ok((code.clone(), client))
}

#[derive(Deserialize, Default)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub scope: Option<String>,
}

/// What Misty keeps for the signed-in ChatGPT account, in the credential store. The client and
/// account stay after signing out, so signing in again reuses the registration.
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
pub struct Stored {
    pub client_id: String,
    pub email: String,
    pub subject: String,
    #[serde(default)]
    pub id_token: String,
    #[serde(default)]
    pub tokens: Option<Tokens>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    pub scopes: Vec<String>,
}

impl Stored {
    /// Whether requests may use the ChatGPT plan: signed in, and the plan grant was given.
    pub fn plan_usage(&self) -> bool {
        self.tokens
            .as_ref()
            .is_some_and(|tokens| tokens.scopes.iter().any(|scope| scope == PLAN_SCOPE))
    }
}

pub enum Failure {
    /// The refresh token can't be used again: sign in again.
    Terminal,
    /// The network or the issuer failed for now: keep the tokens.
    Transient,
}

fn error_code(body: &Value) -> String {
    let error = &body["error"];
    error
        .as_str()
        .or_else(|| error["code"].as_str())
        .unwrap_or_default()
        .to_owned()
}

/// A form-encoded POST, as the token and revocation endpoints take.
pub(super) fn form_post(
    http: &reqwest::Client,
    url: &str,
    form: &[(&str, &str)],
) -> reqwest::RequestBuilder {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form)
        .finish();
    http.post(url)
        .header("content-type", "application/x-www-form-urlencoded")
        .header("accept", "application/json")
        .body(body)
}

pub(super) async fn post_form(
    http: &reqwest::Client,
    url: &str,
    form: &[(&str, &str)],
) -> Result<TokenResponse, Failure> {
    let response = form_post(http, url, form)
        .send()
        .await
        .map_err(|_| Failure::Transient)?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        return serde_json::from_value(body).map_err(|_| Failure::Transient);
    }
    let terminal = [
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
        "invalid_client",
    ];
    if terminal.contains(&error_code(&body).as_str()) {
        Err(Failure::Terminal)
    } else {
        Err(Failure::Transient)
    }
}

pub async fn exchange(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, String> {
    let form = [
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
        ("resource", RESOURCE),
    ];
    post_form(http, &endpoints.token, &form)
        .await
        .map_err(|_| "ChatGPT didn't accept the sign-in. Try again.".to_string())
}

fn claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?).ok()
}

/// Checks a token response from the code exchange and makes what Misty keeps. The ID token
/// arrived straight from the issuer's token endpoint over TLS, so its claims are checked and its
/// signature is not (OpenID Connect Core 3.1.3.7, item 6).
pub fn accept(
    response: TokenResponse,
    endpoints: &Endpoints,
    client_id: &str,
    nonce: &str,
    now: u64,
    previous: Option<&Stored>,
) -> Result<Stored, String> {
    let id_token = response
        .id_token
        .clone()
        .ok_or("ChatGPT didn't say who signed in.")?;
    let claims = claims(&id_token).ok_or("ChatGPT's sign-in couldn't be read.")?;
    let audience = match &claims["aud"] {
        Value::String(one) => one == client_id,
        Value::Array(many) => many.iter().any(|aud| aud.as_str() == Some(client_id)),
        _ => false,
    };
    let valid = claims["iss"].as_str() == Some(endpoints.issuer.as_str())
        && audience
        && claims["exp"].as_u64().is_some_and(|exp| exp > now)
        && claims["nonce"].as_str() == Some(nonce);
    let subject = claims["sub"].as_str().filter(|sub| !sub.is_empty());
    let (true, Some(subject)) = (valid, subject) else {
        return Err("ChatGPT's sign-in didn't check out. Try again.".into());
    };
    if let Some(previous) = previous.filter(|p| p.client_id == client_id && !p.subject.is_empty()) {
        if previous.subject != subject {
            return Err("That's a different ChatGPT account than this registration's.".into());
        }
    }
    let tokens = tokens(response, now, None).ok_or("ChatGPT didn't grant offline access.")?;
    Ok(Stored {
        client_id: client_id.to_owned(),
        email: claims["email"].as_str().unwrap_or_default().to_owned(),
        subject: subject.to_owned(),
        id_token,
        tokens: Some(tokens),
    })
}

pub(super) fn tokens(
    response: TokenResponse,
    now: u64,
    previous: Option<&Tokens>,
) -> Option<Tokens> {
    let refresh_token = response
        .refresh_token
        .filter(|token| !token.is_empty())
        .or_else(|| previous.map(|tokens| tokens.refresh_token.clone()))?;
    let scopes = match (response.scope, previous) {
        (Some(scope), _) => scope.split_whitespace().map(str::to_owned).collect(),
        (None, Some(previous)) => previous.scopes.clone(),
        (None, None) => Vec::new(),
    };
    Some(Tokens {
        access_token: response.access_token,
        refresh_token,
        expires_at: now + response.expires_in.unwrap_or(3600),
        scopes,
    })
}
