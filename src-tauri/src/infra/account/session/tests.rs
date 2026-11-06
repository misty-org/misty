use super::*;
use reqwest::header::HeaderMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn token(user: &str, kind: &str, exp: u64) -> String {
    format!(
        "header.{}.signature",
        URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&serde_json::json!({"sub":user,"token_use":kind,"exp":exp}))
                .unwrap()
        )
    )
}

/// The credential store's root is set once per process, so this directory lives as long as it.
/// Turning on a new database's write-ahead log fails at once if another connection is opening it
/// too, whatever the busy timeout, so the first test creates it while the others wait here.
fn credentials() {
    static DIRECTORY: OnceLock<tempfile::TempDir> = OnceLock::new();
    DIRECTORY.get_or_init(|| {
        let directory = tempfile::tempdir().unwrap();
        let _ = misty_credential_store::configure_root(directory.path().to_path_buf());
        misty_credential_store::account::load("prepare").unwrap();
        directory
    });
}

fn signed_in(url: &url::Url, user: &str, access_exp: u64) -> Arc<AccountClient> {
    let client = AccountClient::new().unwrap();
    client
        .set_tokens(
            url,
            &token(user, "access", access_exp),
            &token(user, "refresh", now() + 3600),
        )
        .unwrap();
    client
}

#[test]
fn restores_saved_scope_and_expiry_without_exposing_credentials() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let url = server("https://api.misty.test/v1").unwrap();
    let saved = SavedSession {
        account_id: "ada".into(),
        origin: url.origin().ascii_serialization(),
        access: Some(token("ada", "access", now() - 1)),
        refresh: token("ada", "refresh", now() + 3600),
    };
    let raw = serde_json::to_string(&saved).unwrap();
    let client = AccountClient::restore(&url, "ada", &raw).unwrap().unwrap();
    let snapshot = client.snapshot(&url).unwrap().unwrap();
    assert!(client.require_account(&url, "ada").is_ok());
    assert!(client.require_account(&url, "grace").is_err());
    assert!(snapshot.access.is_none());
    assert!(client.access_header().is_none());
    assert_eq!(snapshot.account_id, "ada");
    let other = server("https://other.test/v1").unwrap();
    assert!(client.snapshot(&other).unwrap().is_none());
    assert!(client.refresh_header(&other).is_none());
    let plain = server("http://api.misty.test/v1").unwrap();
    assert!(client.refresh_header(&plain).is_none());
    assert!(AccountClient::restore(&url, "grace", &raw).is_err());
    assert!(AccountClient::restore(&other, "ada", &raw).is_err());
}
#[test]
fn a_row_saved_when_these_were_cookies_still_loads() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let url = server("https://old-row.misty.test/v1").unwrap();
    let access = token("ada", "access", now() + 60);
    let refresh = token("ada", "refresh", now() + 3600);
    // Written out by hand: this is what's on people's computers, whatever the struct becomes.
    let raw = format!(
        r#"{{"account_id":"ada","origin":"https://old-row.misty.test","access":"{access}","refresh":"{refresh}"}}"#
    );
    let client = AccountClient::restore(&url, "ada", &raw).unwrap().unwrap();
    assert_eq!(client.access_header(), Some(format!("Bearer {access}")));
    assert_eq!(
        client.refresh_header(&url),
        Some(format!("Bearer {refresh}"))
    );
    let no_access = format!(
        r#"{{"account_id":"ada","origin":"https://old-row.misty.test","access":null,"refresh":"{refresh}"}}"#
    );
    let client = AccountClient::restore(&url, "ada", &no_access)
        .unwrap()
        .unwrap();
    assert!(client.access_header().is_none());
}
#[test]
fn same_account_restore_retains_live_client_but_never_matches_other_or_expired_accounts() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let url = server("https://worker-restore.misty.test/v1").unwrap();
    let client = signed_in(&url, "ada", now() + 60);
    activate(&url, client.clone()).unwrap();
    assert!(has_active_account(&url, Some("ada")));
    let scope = crate::infra::profile_data::account_scope(&url, Some("ada"));
    assert!(restore_preserves_scope(&url, Some("ada"), &scope));
    let grace = crate::infra::profile_data::account_scope(&url, Some("grace"));
    assert!(!restore_preserves_scope(&url, Some("ada"), &grace));
    let other = url::Url::parse("https://other.test/v1").unwrap();
    let elsewhere = crate::infra::profile_data::account_scope(&other, Some("ada"));
    assert!(!restore_preserves_scope(&url, Some("ada"), &elsewhere));
    assert!(Arc::ptr_eq(&client, &current(&url).unwrap()));
    assert!(!has_active_account(&url, Some("grace")));
    assert!(!has_active_account(&url, None));
    assert!(!has_active_account(&url, Some("")));
    assert!(!has_active_account(
        &server("https://another-worker.misty.test/v1").unwrap(),
        Some("ada")
    ));
    client
        .set_tokens(
            &url,
            &token("ada", "access", now() + 60),
            &token("ada", "refresh", now() - 1),
        )
        .unwrap();
    assert!(!has_active_account(&url, Some("ada")));
}
#[test]
fn rejects_expired_refresh_and_swapped_token_types() {
    let url = server("http://localhost:8081/v1").unwrap();
    let mut saved = SavedSession {
        account_id: "ada".into(),
        origin: url.origin().ascii_serialization(),
        access: None,
        refresh: token("ada", "refresh", now() - 1),
    };
    assert!(
        AccountClient::restore(&url, "ada", &serde_json::to_string(&saved).unwrap())
            .unwrap()
            .is_none()
    );
    saved.refresh = token("ada", "access", now() + 3600);
    assert!(AccountClient::restore(&url, "ada", &serde_json::to_string(&saved).unwrap()).is_err());
    let client = AccountClient::new().unwrap();
    let (access, refresh) = (
        token("ada", "access", now() + 60),
        token("ada", "refresh", now() + 3600),
    );
    assert!(client.set_tokens(&url, &refresh, &access).is_err());
    assert!(client
        .set_tokens(&url, &token("grace", "access", now() + 60), &refresh)
        .is_err());
    assert!(client.snapshot(&url).unwrap().is_none());
}

fn token_headers(access: &str, refresh: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(ACCESS_TOKEN_HEADER, access.parse().unwrap());
    headers.insert(REFRESH_TOKEN_HEADER, refresh.parse().unwrap());
    headers
}

#[test]
fn tokens_are_taken_from_headers_and_stripped_for_the_renderer() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    credentials();
    let url = server("https://capture.misty.test/v1").unwrap();
    let client = AccountClient::new().unwrap();
    let (access, refresh) = (
        token("ada", "access", now() + 60),
        token("ada", "refresh", now() + 3600),
    );
    let mut headers = token_headers(&access, &refresh);
    headers.insert(reqwest::header::SET_COOKIE, "a=b".parse().unwrap());
    headers.insert(SESSION_ENDED_HEADER, "1".parse().unwrap());
    headers.insert(reqwest::header::CONTENT_TYPE, "text/plain".parse().unwrap());
    assert_eq!(
        renderer_headers(&headers),
        vec![("content-type".to_owned(), "text/plain".to_owned())]
    );
    headers.remove(SESSION_ENDED_HEADER);

    assert!(matches!(
        client.capture(&url, &headers).unwrap(),
        Captured::Signed
    ));
    assert_eq!(client.access_header(), Some(format!("Bearer {access}")));
    let saved = misty_credential_store::account::load(&key(&url, "ada"))
        .unwrap()
        .unwrap();
    assert!(AccountClient::restore(&url, "ada", &saved)
        .unwrap()
        .is_some());

    // A response about nothing changes nothing.
    assert!(matches!(
        client.capture(&url, &HeaderMap::new()).unwrap(),
        Captured::Nothing
    ));
    assert!(client.access_header().is_some());

    // The server ended the session: the tokens and the saved row go.
    let mut ended = HeaderMap::new();
    ended.insert(SESSION_ENDED_HEADER, "1".parse().unwrap());
    assert!(matches!(
        client.capture(&url, &ended).unwrap(),
        Captured::Ended
    ));
    assert!(client.access_header().is_none());
    assert!(misty_credential_store::account::load(&key(&url, "ada"))
        .unwrap()
        .is_none());
}

/// Answers every request with `head`, slowly enough for callers to pile up, and counts them.
async fn fixture_server(
    head: impl Fn() -> String + Send + 'static,
) -> (url::Url, Arc<AtomicUsize>, Arc<std::sync::Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = server(&format!("http://{}/v1", listener.local_addr().unwrap())).unwrap();
    let (posts, seen) = (Arc::new(AtomicUsize::new(0)), Arc::default());
    let (counter, last): (_, Arc<std::sync::Mutex<String>>) = (posts.clone(), Arc::clone(&seen));
    tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let read = stream.read(&mut request).await.unwrap();
            counter.fetch_add(1, Ordering::SeqCst);
            *last.lock().unwrap() = String::from_utf8_lossy(&request[..read]).to_lowercase();
            tokio::time::sleep(Duration::from_millis(50)).await;
            stream.write_all(head().as_bytes()).await.unwrap();
        }
    });
    (base, posts, seen)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_callers_refused_together_send_one_refresh() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    credentials();
    let fresh = (
        token("ada", "access", now() + 600),
        token("ada", "refresh", now() + 7200),
    );
    let answer = format!(
        "HTTP/1.1 204 No Content\r\nX-Misty-Access-Token: {}\r\nX-Misty-Refresh-Token: {}\r\nConnection: close\r\n\r\n",
        fresh.0, fresh.1
    );
    let (base, posts, seen) = fixture_server(move || answer.clone()).await;
    let client = signed_in(&base, "ada", now() + 60);
    let refresh = client.refresh_header(&base).unwrap();
    let used = client.access_header().unwrap();
    let (first, second) = tokio::join!(
        client.refresh_after(&base, Some(&used)),
        client.refresh_after(&base, Some(&used))
    );
    assert!(first.unwrap().succeeded());
    assert!(second.unwrap().succeeded());
    assert_eq!(posts.load(Ordering::SeqCst), 1);
    assert_eq!(client.access_header(), Some(format!("Bearer {}", fresh.0)));
    let request = seen.lock().unwrap().clone();
    assert!(request.starts_with("post /v1/auth/refresh "), "{request}");
    assert!(request.contains(&format!("authorization: {}", refresh.to_lowercase())));
    assert!(request.contains("x-misty-token-transport: bearer"));
    assert!(request.contains("x-misty-csrf: 1"));
    // A later refresh sends the rotated token.
    client.refresh(&base).await.unwrap();
    assert_eq!(posts.load(Ordering::SeqCst), 2);
    assert!(seen
        .lock()
        .unwrap()
        .contains(&format!("authorization: bearer {}", fresh.1.to_lowercase())));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_refresh_ends_the_session() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    credentials();
    let (base, _, _) = fixture_server(|| {
        "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_owned()
    })
    .await;
    let client = signed_in(&base, "ada", now() + 60);
    client.persist(&base).unwrap();
    let used = client.access_header();
    let answer = client.refresh_after(&base, used.as_deref()).await.unwrap();
    assert_eq!(answer.status, 401);
    assert!(answer.ended);
    assert!(client.access_header().is_none());
    assert!(client.refresh_header(&base).is_none());
    assert!(misty_credential_store::account::load(&key(&base, "ada"))
        .unwrap()
        .is_none());
    // With nothing to present it answers without asking the server.
    assert_eq!(client.refresh_after(&base, None).await.unwrap().status, 401);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_failure_keeps_the_session() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let (base, _, _) = fixture_server(|| {
        "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 4\r\nConnection: close\r\n\r\nbusy"
            .to_owned()
    })
    .await;
    let client = signed_in(&base, "ada", now() + 60);
    let used = client.access_header();
    let answer = client.refresh_after(&base, used.as_deref()).await.unwrap();
    assert_eq!((answer.status, answer.ended), (503, false));
    assert_eq!(answer.body, b"busy");
    assert_eq!(client.access_header(), used);
}
