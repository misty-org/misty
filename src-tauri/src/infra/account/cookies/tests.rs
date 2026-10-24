use super::*;
fn token(user: &str, kind: &str, exp: u64) -> String {
    format!(
        "header.{}.signature",
        URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&serde_json::json!({"sub":user,"token_use":kind,"exp":exp}))
                .unwrap()
        )
    )
}
#[test]
fn restores_cookie_scope_and_expiry_without_exposing_credentials() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let url = server("https://api.misty.test/v1").unwrap();
    let saved = SavedCookies {
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
    assert_eq!(snapshot.account_id, "ada");
    assert!(client
        .jar
        .cookies(&server("https://other.test/v1").unwrap())
        .is_none());
    assert!(client
        .jar
        .cookies(&server("http://api.misty.test/v1").unwrap())
        .is_none());
    assert!(AccountClient::restore(&url, "grace", &raw).is_err());
    assert!(
        AccountClient::restore(&server("https://other.test/v1").unwrap(), "ada", &raw).is_err()
    );
}
#[test]
fn same_account_restore_retains_live_jar_but_never_matches_other_or_expired_accounts() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let url = server("https://worker-restore.misty.test/v1").unwrap();
    let client = AccountClient::new().unwrap();
    client.add(
        &url,
        "misty_refresh",
        &token("ada", "refresh", now() + 3600),
        now() + 3600,
    );
    activate(&url, client.clone()).unwrap();
    assert!(has_active_account(&url, Some("ada")));
    let mut scope = misty_browser_sync::crypto::VaultScope {
        deployment: url.as_str().trim_end_matches('/').into(),
        account_id: "ada".into(),
        vault_id: "test-vault".into(),
    };
    assert!(restore_preserves_scope(&url, Some("ada"), None));
    assert!(restore_preserves_scope(&url, Some("ada"), Some(&scope)));
    scope.account_id = "grace".into();
    assert!(!restore_preserves_scope(&url, Some("ada"), Some(&scope)));
    scope.account_id = "ada".into();
    scope.deployment = "https://other.test/v1".into();
    assert!(!restore_preserves_scope(&url, Some("ada"), Some(&scope)));
    assert!(Arc::ptr_eq(&client, &current(&url).unwrap()));
    assert!(!has_active_account(&url, Some("grace")));
    assert!(!has_active_account(&url, None));
    assert!(!has_active_account(&url, Some("")));
    assert!(!has_active_account(
        &server("https://another-worker.misty.test/v1").unwrap(),
        Some("ada")
    ));
    client.add(
        &url,
        "misty_refresh",
        &token("ada", "refresh", now() - 1),
        now() + 3600,
    );
    assert!(!has_active_account(&url, Some("ada")));
}
#[test]
fn rejects_expired_refresh_and_swapped_token_types() {
    let url = server("http://localhost:8081/v1").unwrap();
    let mut saved = SavedCookies {
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
}
