//! Keeping the ChatGPT sign-in alive: renewing the hour-long access token with the rotating
//! refresh token, and revoking it on sign-out.
use serde_json::Value;

use super::flow::{
    form_post, post_form, tokens, Endpoints, Failure, Stored, Tokens, REFRESH_MARGIN_SECS, RESOURCE,
};

pub fn needs_refresh(tokens: &Tokens, now: u64) -> bool {
    tokens.expires_at <= now + REFRESH_MARGIN_SECS
}

pub enum Renewal {
    /// Still fresh, or renewed: the session to keep.
    Fresh(Stored),
    /// The refresh token is dead; tokens cleared, registration kept.
    SignedOut(Stored),
    /// Couldn't renew for now; the old session stays.
    Unchanged,
}

/// Renews the access token when little of it is left. Rotation replaces the access token, its
/// expiry, the scopes and the refresh token together.
pub async fn renew(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    stored: &Stored,
    now: u64,
) -> Renewal {
    let Some(current) = stored.tokens.as_ref() else {
        return Renewal::Unchanged;
    };
    if !needs_refresh(current, now) {
        return Renewal::Fresh(stored.clone());
    }
    let form = [
        ("grant_type", "refresh_token"),
        ("client_id", stored.client_id.as_str()),
        ("refresh_token", current.refresh_token.as_str()),
        ("resource", RESOURCE),
    ];
    match post_form(http, &endpoints.token, &form).await {
        Ok(response) => match tokens(response, now, Some(current)) {
            Some(tokens) => Renewal::Fresh(Stored {
                tokens: Some(tokens),
                ..stored.clone()
            }),
            None => Renewal::Unchanged,
        },
        Err(Failure::Terminal) => Renewal::SignedOut(signed_out(stored)),
        Err(Failure::Transient) => Renewal::Unchanged,
    }
}

/// The registration without its tokens, kept for signing in again.
pub fn signed_out(stored: &Stored) -> Stored {
    Stored {
        id_token: String::new(),
        tokens: None,
        ..stored.clone()
    }
}

/// Revokes the refresh token at the issuer's revocation endpoint. True when it confirmed.
pub async fn revoke(http: &reqwest::Client, endpoints: &Endpoints, stored: &Stored) -> bool {
    let Some(tokens) = stored.tokens.as_ref() else {
        return true;
    };
    let discovery: Value = match http.get(&endpoints.discovery).send().await {
        Ok(response) => response.json().await.unwrap_or(Value::Null),
        Err(_) => return false,
    };
    let Some(endpoint) = discovery["revocation_endpoint"].as_str() else {
        return false;
    };
    let form = [
        ("token", tokens.refresh_token.as_str()),
        ("token_type_hint", "refresh_token"),
        ("client_id", stored.client_id.as_str()),
    ];
    form_post(http, endpoint, &form)
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}
