use serde_json::json;

use super::catalog::{app_key, by_maker, from_registry, makers};
use super::client::answer_in;
use super::commands::test_plain_page;
use super::oauth::{challenge_of, test_callback_answer, test_callback_code};
use super::store::{unique_app, Connection};
use super::tools::{is_direct, slug_of, tool_of};

#[test]
fn a_maker_serves_from_the_domain_it_proved() {
    assert!(by_maker(
        "app.linear/linear",
        "Linear",
        "https://mcp.linear.app/mcp"
    ));
    assert!(by_maker("com.neon/mcp", "", "https://mcp.neon.tech/mcp") == false);
    assert!(by_maker("tech.neon/mcp", "", "https://mcp.neon.tech/mcp"));
}

#[test]
fn middlemen_are_left_out() {
    // A GitHub namespace proves no domain.
    assert!(!by_maker(
        "io.github.someone/notion",
        "Notion",
        "https://notion.example.com/mcp"
    ));
    // Served from another domain than the one proved.
    assert!(!by_maker(
        "com.example/notion",
        "",
        "https://notion.insightfulmcp.com/"
    ));
    // A publisher that lists other companies' apps.
    assert!(!by_maker(
        "ai.smithery/notion",
        "Notion",
        "https://server.smithery.ai/notion/mcp"
    ));
    // Another company's brand on someone else's server.
    assert!(!by_maker(
        "com.acme/gmail-helper",
        "Gmail helper",
        "https://mcp.acme.com/mcp"
    ));
    assert!(by_maker(
        "com.acme/helper",
        "Acme",
        "https://mcp.acme.com/mcp"
    ));
    // Plain http is never offered.
    assert!(!by_maker(
        "app.linear/linear",
        "",
        "http://mcp.linear.app/mcp"
    ));
}

#[test]
fn apps_are_named_after_their_domain() {
    assert_eq!(app_key("https://mcp.notion.com/mcp"), "notion");
    assert_eq!(app_key("https://api.dashboard.plaid.com/mcp/"), "plaid");
    assert_eq!(app_key("https://netlify-mcp.netlify.app/mcp"), "netlify");
    assert_eq!(app_key("https://mcp.example.co.uk/mcp"), "example");
    assert!(makers().iter().all(|app| app.url.starts_with("https://")));
}

#[test]
fn registry_pages_keep_only_makers() {
    let page = json!({ "servers": [
        { "server": { "name": "app.linear/linear", "title": "Linear",
            "remotes": [{ "type": "streamable-http", "url": "https://mcp.linear.app/mcp" }] } },
        { "server": { "name": "co.civai.nova/mcp-linear",
            "remotes": [{ "type": "streamable-http", "url": "https://nova.civai.co/mcp/agents/mcp-linear" }] } },
        { "server": { "name": "com.old/thing",
            "remotes": [{ "type": "streamable-http", "url": "https://mcp.old.com/mcp" }] },
          "_meta": { "io.modelcontextprotocol.registry/official": { "status": "deleted" } } },
        { "server": { "name": "com.local/tool", "packages": [{}] } },
    ]});
    let found = from_registry(&page);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].name, "Linear");
    assert_eq!(found[0].app, "linear");
}

#[test]
fn pkce_matches_the_rfc_example() {
    assert_eq!(
        challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}

#[test]
fn the_browser_comes_back_with_a_code_for_this_sign_in() {
    assert_eq!(
        test_callback_code("GET /callback?code=abc&state=s1 HTTP/1.1", "s1"),
        Some(Ok("abc".to_owned()))
    );
    assert!(matches!(
        test_callback_code("GET /callback?code=abc&state=other HTTP/1.1", "s1"),
        Some(Err(_))
    ));
    assert!(matches!(
        test_callback_code("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1"),
        Some(Err(message)) if message.contains("cancelled")
    ));
    assert_eq!(test_callback_code("GET /favicon.ico HTTP/1.1", "s1"), None);
}

#[test]
fn a_finished_sign_in_moves_the_tab_off_the_local_address() {
    let moved = test_callback_answer(true, Some("https://example.com/connected"));
    assert!(moved.starts_with("HTTP/1.1 303 See Other\r\n"));
    assert!(moved.contains("\r\nLocation: https://example.com/connected\r\n"));
    // Without a done page, or when the sign-in failed, the tab stays and says how it went.
    assert!(test_callback_answer(true, None).contains("You're signed in"));
    let failed = test_callback_answer(false, Some("https://example.com/connected"));
    assert!(failed.starts_with("HTTP/1.1 200 OK") && failed.contains("didn't finish"));
}

#[test]
fn only_a_bare_web_page_ends_a_sign_in() {
    assert_eq!(
        test_plain_page("https://example.com/connected").as_deref(),
        Some("https://example.com/connected")
    );
    assert!(test_plain_page("http://localhost:5176/connected").is_some());
    assert_eq!(test_plain_page("http://example.com/connected"), None);
    assert_eq!(
        test_plain_page("https://example.com/connected?code=1"),
        None
    );
    assert_eq!(test_plain_page("https://example.com/connected#x"), None);
    assert_eq!(test_plain_page("misty://connected"), None);
    assert_eq!(test_plain_page("javascript:alert(1)"), None);
}

#[test]
fn answers_are_read_from_json_or_an_event_stream() {
    let json_body = r#"{"jsonrpc":"2.0","id":2,"result":{"ok":true}}"#;
    assert_eq!(
        answer_in(json_body, "application/json", 2).unwrap()["result"]["ok"],
        true
    );
    let stream = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n\
                  event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"tools\":[]}}\n\n";
    assert!(answer_in(stream, "text/event-stream", 3).unwrap()["result"]["tools"].is_array());
    assert!(answer_in(stream, "text/event-stream", 4).is_none());
}

#[test]
fn tools_get_composio_shaped_slugs() {
    assert_eq!(
        slug_of("notion", "notion-search"),
        "MCP_NOTION_NOTION_SEARCH"
    );
    assert!(is_direct("MCP_NOTION_NOTION_SEARCH"));
    assert!(!is_direct("GMAIL_SEND_EMAIL"));
    let tool = tool_of(
        "linear",
        &json!({ "name": "list_issues", "description": "Lists issues",
            "inputSchema": { "type": "object" }, "annotations": { "readOnlyHint": true } }),
    )
    .unwrap();
    assert_eq!(tool.slug, "MCP_LINEAR_LIST_ISSUES");
    assert!(tool.read_only && !tool.destructive);
}

#[test]
fn two_servers_of_one_app_get_their_own_names() {
    let existing = vec![Connection {
        app: "cloudflare".to_owned(),
        url: "https://bindings.mcp.cloudflare.com/mcp".to_owned(),
        ..Connection::default()
    }];
    assert_eq!(
        unique_app(
            &existing,
            "cloudflare",
            "https://docs.mcp.cloudflare.com/mcp"
        ),
        "cloudflare2"
    );
    assert_eq!(
        unique_app(
            &existing,
            "cloudflare",
            "https://bindings.mcp.cloudflare.com/mcp"
        ),
        "cloudflare"
    );
}

/// Reads real servers' sign-in metadata; nothing is registered. `cargo test -- --ignored live_`
#[tokio::test]
#[ignore]
async fn live_makers_take_a_keyless_sign_in() {
    let http = crate::engine_config::support::http_client().unwrap();
    for url in [
        "https://mcp.linear.app/mcp",
        "https://mcp.notion.com/mcp",
        "https://mcp.stripe.com",
    ] {
        let access = super::oauth::discover(&http, url).await;
        println!("{url} -> {}", access.code());
        assert_eq!(access.code(), "keyless", "{url}");
    }
    let github = super::oauth::discover(&http, "https://api.githubcopilot.com/mcp/").await;
    println!("github -> {}", github.code());
    assert_eq!(github.code(), "needs_app");
    // Linear is in the shipped catalog, so the registry adds only what's newer, never a middleman.
    let newer = super::catalog::search_registry(&http, "linear")
        .await
        .unwrap();
    assert!(newer.iter().all(|app| !app.url.contains("civai")));
}
