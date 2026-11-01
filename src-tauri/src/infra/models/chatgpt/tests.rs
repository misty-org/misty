use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

use super::{flow::*, renewal::*};

/// A token endpoint that answers each request with the next canned reply and keeps the forms
/// it was sent.
struct FakeIssuer {
    endpoints: Endpoints,
    forms: Arc<Mutex<Vec<HashMap<String, String>>>>,
}

async fn fake_issuer(replies: Vec<(u16, Value)>) -> FakeIssuer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let forms = Arc::new(Mutex::new(Vec::new()));
    let seen = forms.clone();
    tokio::spawn(async move {
        for (status, body) in replies {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = stream.read(&mut chunk).await.unwrap();
                buffer.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buffer).to_string();
                if let Some(split) = text.find("\r\n\r\n") {
                    let length = text[..split]
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if buffer.len() >= split + 4 + length {
                        let form =
                            url::form_urlencoded::parse(&buffer[split + 4..split + 4 + length])
                                .into_owned()
                                .collect();
                        seen.lock().unwrap().push(form);
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let body = body.to_string();
            let reply = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(reply.as_bytes()).await.unwrap();
        }
    });
    FakeIssuer {
        endpoints: Endpoints {
            issuer: "https://auth.example".into(),
            authorize: format!("{base}/authorize"),
            token: format!("{base}/token"),
            discovery: format!("{base}/discovery"),
        },
        forms,
    }
}

fn http() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder().no_proxy().build().unwrap()
}

fn id_token(claims: Value) -> String {
    format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
}

fn signed_in(expires_at: u64) -> Stored {
    Stored {
        client_id: "client-issued".into(),
        email: "ada@example.com".into(),
        subject: "user-1".into(),
        id_token: "old-id".into(),
        tokens: Some(Tokens {
            access_token: "access-1".into(),
            refresh_token: "refresh-1".into(),
            expires_at,
            scopes: vec![PLAN_SCOPE.into(), "offline_access".into()],
        }),
    }
}

#[test]
fn first_sign_in_registers_a_client_for_this_host() {
    let endpoints = Endpoints::openai();
    let attempt = Attempt {
        client_id: None,
        host_id: "urn:uuid:4f1c3e70-8f3a-4a52-9c1d-1d3a0b2c6e11",
        redirect_uri: "http://127.0.0.1:51234/auth/callback",
        state: "state-1",
        nonce: "nonce-1",
        challenge: "challenge-1",
        id_token_hint: Some("ignored-without-a-client"),
        login_hint: None,
    };
    let url = url::Url::parse(&authorize_url(&endpoints, &attempt)).unwrap();
    assert_eq!(
        url.as_str().split('?').next(),
        Some("https://auth.openai.com/api/accounts/authorize")
    );
    let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(query["client_id"], "dynamic_agent_client");
    assert_eq!(query["agent_name_hint"], "Misty");
    assert_eq!(query["ext_agent_host_id"], attempt.host_id);
    assert_eq!(
        query["redirect_uri"],
        "http://127.0.0.1:51234/auth/callback"
    );
    assert_eq!(
        query["scope"],
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
    );
    assert_eq!(query["resource"], "https://api.openai.com/v1");
    assert_eq!(query["response_type"], "code");
    assert_eq!(query["code_challenge_method"], "S256");
    assert!(!query.contains_key("id_token_hint"));

    // Signing in again names the issued client, sends the hint and no name hint.
    let again = Attempt {
        client_id: Some("client-issued"),
        ..attempt
    };
    let query: HashMap<_, _> = url::Url::parse(&authorize_url(&endpoints, &again))
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect();
    assert_eq!(query["client_id"], "client-issued");
    assert_eq!(query["id_token_hint"], "ignored-without-a-client");
    assert!(!query.contains_key("agent_name_hint"));
}

#[test]
fn callback_checks_state_and_the_issued_client() {
    let query = |pairs: &[(&str, &str)]| {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<HashMap<_, _>>()
    };
    let ok = query(&[("code", "c"), ("state", "s"), ("client_id", "issued")]);
    assert_eq!(
        callback(&ok, "s", None).unwrap(),
        ("c".into(), "issued".into())
    );
    assert!(callback(&ok, "other", None).is_err());
    assert!(
        callback(&ok, "s", Some("saved")).is_err(),
        "a different client is refused"
    );
    let returning = query(&[("code", "c"), ("state", "s")]);
    assert_eq!(callback(&returning, "s", Some("saved")).unwrap().1, "saved");
    assert!(
        callback(&returning, "s", None).is_err(),
        "a new registration needs its client"
    );
    assert!(callback(
        &query(&[("error", "access_denied"), ("state", "s")]),
        "s",
        None
    )
    .is_err());
}

#[tokio::test]
async fn exchanges_the_code_and_checks_the_id_token() {
    let now = 1_800_000_000;
    let token = id_token(
        json!({"iss": "https://auth.example", "aud": "client-issued", "exp": now + 600, "nonce": "n-1", "sub": "user-1", "email": "ada@example.com"}),
    );
    let issuer = fake_issuer(vec![(200, json!({
        "access_token": "access-1", "refresh_token": "refresh-1", "id_token": token,
        "token_type": "Bearer", "expires_in": 3600,
        "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    }))]).await;
    let response = exchange(
        &http(),
        &issuer.endpoints,
        "client-issued",
        "code-1",
        "verifier-1",
        "http://127.0.0.1:1/auth/callback",
    )
    .await
    .unwrap();
    let form = issuer.forms.lock().unwrap()[0].clone();
    assert_eq!(form["grant_type"], "authorization_code");
    assert_eq!(form["client_id"], "client-issued");
    assert_eq!(form["code_verifier"], "verifier-1");
    assert_eq!(form["resource"], RESOURCE);
    let stored = accept(
        response,
        &issuer.endpoints,
        "client-issued",
        "n-1",
        now,
        None,
    )
    .unwrap();
    assert_eq!(stored.email, "ada@example.com");
    assert!(stored.plan_usage());
    assert_eq!(stored.tokens.unwrap().expires_at, now + 3600);
}

#[test]
fn refuses_an_id_token_for_another_attempt_or_account() {
    let now = 1_800_000_000;
    let endpoints = Endpoints {
        issuer: "https://auth.example".into(),
        ..Endpoints::openai()
    };
    let response = |claims: Value| TokenResponse {
        access_token: "a".into(),
        refresh_token: Some("r".into()),
        id_token: Some(id_token(claims)),
        expires_in: Some(3600),
        scope: Some("offline_access".into()),
    };
    let good = json!({"iss": "https://auth.example", "aud": ["client-issued"], "exp": now + 60, "nonce": "n", "sub": "user-1"});
    let stored = accept(
        response(good.clone()),
        &endpoints,
        "client-issued",
        "n",
        now,
        None,
    )
    .unwrap();
    assert!(!stored.plan_usage(), "no plan grant, no plan usage");
    assert!(accept(
        response(good.clone()),
        &endpoints,
        "client-issued",
        "other-nonce",
        now,
        None
    )
    .is_err());
    assert!(accept(
        response(good.clone()),
        &endpoints,
        "someone-else",
        "n",
        now,
        None
    )
    .is_err());
    let mut expired = good.clone();
    expired["exp"] = json!(now - 1);
    assert!(accept(
        response(expired),
        &endpoints,
        "client-issued",
        "n",
        now,
        None
    )
    .is_err());
    let mut other = good;
    other["sub"] = json!("user-2");
    assert!(accept(
        response(other),
        &endpoints,
        "client-issued",
        "n",
        now,
        Some(&signed_in(now))
    )
    .is_err());
}

#[tokio::test]
async fn renews_near_expiry_and_keeps_the_rotated_refresh_token() {
    let now = 1_800_000_000;
    let fresh = signed_in(now + 3000);
    let issuer = fake_issuer(vec![(200, json!({"access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600, "scope": PLAN_SCOPE}))]).await;
    // Plenty of time left: nothing is sent.
    assert!(
        matches!(renew(&http(), &issuer.endpoints, &fresh, now).await, Renewal::Fresh(same) if same == fresh)
    );
    assert!(issuer.forms.lock().unwrap().is_empty());
    let Renewal::Fresh(renewed) =
        renew(&http(), &issuer.endpoints, &signed_in(now + 60), now).await
    else {
        panic!("expected a renewal");
    };
    let tokens = renewed.tokens.unwrap();
    assert_eq!(
        (tokens.access_token.as_str(), tokens.refresh_token.as_str()),
        ("access-2", "refresh-2")
    );
    assert_eq!(tokens.expires_at, now + 3600);
    let form = issuer.forms.lock().unwrap()[0].clone();
    assert_eq!(form["grant_type"], "refresh_token");
    assert_eq!(
        form["client_id"], "client-issued",
        "never dynamic_agent_client"
    );
    assert_eq!(form["refresh_token"], "refresh-1");
    assert_eq!(form["resource"], RESOURCE);
    assert!(
        !form.contains_key("scope"),
        "the grant is kept by leaving scope out"
    );
}

#[tokio::test]
async fn a_dead_refresh_token_signs_out_and_a_flaky_issuer_does_not() {
    let now = 1_800_000_000;
    let issuer = fake_issuer(vec![
        (400, json!({"error": "refresh_token_reused"})),
        (503, json!({"error": "temporarily_unavailable"})),
    ])
    .await;
    let Renewal::SignedOut(cleared) = renew(&http(), &issuer.endpoints, &signed_in(now), now).await
    else {
        panic!("expected sign-out");
    };
    assert!(cleared.tokens.is_none());
    assert_eq!(cleared.client_id, "client-issued", "the registration stays");
    assert!(cleared.id_token.is_empty());
    assert!(matches!(
        renew(&http(), &issuer.endpoints, &signed_in(now), now).await,
        Renewal::Unchanged
    ));
}
