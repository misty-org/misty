use super::*;
use tempfile::tempdir;

#[test]
fn popup_download_requires_exact_live_source_authority() {
    let fixture = || {
        let mut source = BrowserSession::default();
        source.scope_id = "source-scope".into();
        source.grants.insert(
            "grant".into(),
            BrowserGrant {
                agent_id: "agent".into(),
                capabilities: ["browser.click".into()].into(),
                expires_at: Utc::now() + chrono::Duration::minutes(1),
            },
        );
        source.pending_agent_download = Some(PendingAgentDownload {
            grant_id: "grant".into(),
            agent_id: "agent".into(),
            task_id: Some("task".into()),
            expires_at: Utc::now() + chrono::Duration::seconds(30),
            popup_id: Some("popup".into()),
        });
        source
    };
    assert_eq!(
        popup_download_authority(&fixture(), "popup"),
        Some(("source-scope".into(), "agent".into(), "task".into()))
    );
    assert!(popup_download_authority(&fixture(), "other-popup").is_none());
    for case in 0..6 {
        let mut source = fixture();
        match case {
            0 => source.pending_agent_download = None,
            1 => source.grants.clear(),
            2 => {
                source.pending_agent_download.as_mut().unwrap().expires_at =
                    Utc::now() - chrono::Duration::seconds(1)
            }
            3 => {
                source.grants.get_mut("grant").unwrap().expires_at =
                    Utc::now() - chrono::Duration::seconds(1)
            }
            4 => source.grants.get_mut("grant").unwrap().agent_id = "other-agent".into(),
            _ => source.grants.get_mut("grant").unwrap().capabilities.clear(),
        }
        assert!(
            popup_download_authority(&source, "popup").is_none(),
            "case {case}"
        );
    }
}

#[test]
fn browser_labels_reject_unsafe_identifiers() {
    assert!(webview_label("tab-123").is_ok());
    assert!(webview_label("../main").is_err());
    assert!(webview_label("").is_err());
}

#[test]
fn browser_navigation_accepts_only_web_urls() {
    assert!(external_url("about:blank").is_ok());
    assert!(external_url("https://example.com").is_ok());
    assert!(external_url("javascript:alert(1)").is_err());
    assert!(external_url("file:///tmp/private").is_err());
    // Ordinary browsing can follow federated login redirects; this does not
    // grant the destination provider-specific native or automation access.
    assert!(external_url("https://tenant.identity.example/login").is_ok());
    assert!(external_url("https://user:password@example.com").is_err());
    assert!(external_url("misty-extension://localhost/app.js").is_err());
}

#[test]
fn browser_page_and_renderer_swap_sibling_order_for_overlays() {
    assert!(!browser_child_should_be_below_renderer(false));
    assert!(browser_child_should_be_below_renderer(true));
}

#[test]
fn managed_profile_observations_expose_only_logical_identity() {
    let session = BrowserSession {
        profile_id: Some("b".repeat(64)),
        logical_profile_id: Some("a".repeat(64)),
        ..Default::default()
    };
    let target =
        browser_target_observation(&session, &Url::parse("https://example.test/").unwrap());
    assert_eq!(target["profileId"], "a".repeat(64));
    assert!(!target.to_string().contains(&"b".repeat(64)));
}

#[test]
fn browser_favicons_accept_only_bounded_web_urls() {
    assert_eq!(
        validated_favicon_url("https://example.com/icon-144.png").as_deref(),
        Some("https://example.com/icon-144.png")
    );
    assert!(validated_favicon_url("data:image/svg+xml,<svg></svg>").is_none());
    assert!(validated_favicon_url("file:///tmp/icon.png").is_none());
    assert!(validated_favicon_url(&format!("https://example.com/{}", "x".repeat(2_048))).is_none());
}

#[test]
fn browser_bounds_do_not_require_creation_fields() {
    let request: BrowserWebviewBoundsRequest = serde_json::from_value(json!({
        "id": "tab-123",
        "x": 10.0,
        "y": 20.0,
        "width": 800.0,
        "height": 600.0
    }))
    .unwrap();
    assert_eq!(request.id, "tab-123");
    assert!(!request.native_live_resize);
    let (_, size) = logical_bounds(request.x, request.y, request.width, request.height);
    assert_eq!(size.width, 800.0);
    assert_eq!(size.height, 600.0);
}

#[test]
fn download_names_are_sanitized() {
    assert_eq!(sanitize_download_name("../report.pdf"), "report.pdf");
    assert_eq!(sanitize_download_name("  "), "download");
    assert_eq!(sanitize_download_name("a/b:c.txt"), "abc.txt");
}

#[test]
fn downloads_never_overwrite_or_reuse_reserved_paths() {
    let directory = tempdir().unwrap();
    std::fs::write(directory.path().join("report.pdf"), b"existing").unwrap();
    let state = BrowserSessionState::default();
    let first = reserve_download_path(&state, directory.path(), "report.pdf");
    let second = reserve_download_path(&state, directory.path(), "report.pdf");
    assert_eq!(first.file_name().unwrap(), "report (1).pdf");
    assert_eq!(second.file_name().unwrap(), "report (2).pdf");
}

#[test]
fn macos_download_completion_recovers_the_recorded_destination() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("mockup.png");
    let state = BrowserSessionState::default();
    let url = Url::parse("https://example.test/mockup").unwrap();
    let requested = requested_download(&state, "source", &url, &path);
    std::fs::write(&path, b"\x89PNG\r\n\x1a\nimage").unwrap();
    let finished = finish_download(&state, "source", &url, None, true);
    assert!(finished.success);
    assert_eq!(finished.path, requested.path);
    assert_eq!(finished.download_id, requested.download_id);
    assert!(finished.file.is_some());
    assert!(!finish_download(&state, "source", &url, None, true).success);
}

#[test]
fn download_completion_never_guesses_between_simultaneous_identical_urls() {
    let directory = tempdir().unwrap();
    let state = BrowserSessionState::default();
    let url = Url::parse("https://example.test/mockup").unwrap();
    for name in ["one.png", "two.png"] {
        let path = directory.path().join(name);
        requested_download(&state, "source", &url, &path);
        std::fs::write(&path, b"\x89PNG\r\n\x1a\nimage").unwrap();
    }
    assert!(!finish_download(&state, "source", &url, None, true).success);
    let one = directory.path().join("one.png");
    assert!(finish_download(&state, "source", &url, Some(&one), true).success);
    assert!(finish_download(&state, "source", &url, None, true).success);
}

#[test]
fn browser_capabilities_are_closed_over_known_operations() {
    assert!(is_browser_capability("browser.inspect"));
    assert!(is_browser_capability("browser.type"));
    assert!(is_browser_capability("browser.request"));
    assert!(is_browser_capability("browser.interact"));
    assert!(is_browser_capability("browser.downloads.list"));
    assert!(!is_browser_capability("browser.eval"));
}

#[test]
fn new_snapshots_invalidate_old_element_references() {
    let mut session = BrowserSession::default();
    let first = replace_snapshot_targets(
        &mut session,
        vec![RawInteractiveElement {
            target: "snapshot-a:0".to_owned(),
            tag: "button".to_owned(),
            role: String::new(),
            name: "First".to_owned(),
        }],
    );
    let first_ref = first[0]["ref"].as_str().unwrap().to_owned();
    let second = replace_snapshot_targets(
        &mut session,
        vec![RawInteractiveElement {
            target: "snapshot-b:0".to_owned(),
            tag: "a".to_owned(),
            role: String::new(),
            name: "Second".to_owned(),
        }],
    );
    assert!(!session.element_targets.contains_key(&first_ref));
    assert_ne!(first[0]["ref"], second[0]["ref"]);
}

#[test]
fn grants_are_agent_capability_and_expiry_scoped() {
    let mut session = BrowserSession::default();
    session.grants.insert(
        "grant".to_owned(),
        BrowserGrant {
            agent_id: "agent-a".to_owned(),
            capabilities: HashSet::from(["browser.inspect".to_owned()]),
            expires_at: Utc::now() + chrono::Duration::minutes(5),
        },
    );
    let mut request = BrowserAgentExecuteRequest {
        scope_id: "scope".to_owned(),
        grant_id: "grant".to_owned(),
        agent_id: "agent-a".to_owned(),
        operation: "browser.inspect".to_owned(),
        input: Value::Null,
    };
    assert!(validate_browser_grant(&mut session, &request).is_ok());
    request.agent_id = "agent-b".to_owned();
    assert!(validate_browser_grant(&mut session, &request).is_err());
    request.agent_id = "agent-a".to_owned();
    request.operation = "browser.click".to_owned();
    assert!(validate_browser_grant(&mut session, &request).is_err());
    session.grants.get_mut("grant").unwrap().expires_at = Utc::now();
    request.operation = "browser.inspect".to_owned();
    assert!(validate_browser_grant(&mut session, &request).is_err());
}
