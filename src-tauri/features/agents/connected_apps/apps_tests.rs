use serde_json::json;

use super::{
    apps,
    client::Error,
    requests,
    tests::{account, client_of, fake, store},
    tools,
};

#[tokio::test]
async fn a_lost_session_is_replaced_once() {
    let fake = fake(vec![
        (
            "POST /api/v3.1/tool_router/session/s_session/search",
            404,
            json!({ "error": { "message": "No session" } }),
        ),
        (
            "POST /api/v3.1/tool_router/session ",
            201,
            json!({ "session_id": "s_session" }),
        ),
    ])
    .await;
    let client = client_of(&fake);
    let error = client
        .with_session(|session| {
            let client = &client;
            async move { client.search(&session, &["x".to_owned()]).await }
        })
        .await
        .unwrap_err();
    assert!(error.not_found());
    assert_eq!(fake.calls("/search").len(), 2);
    assert_eq!(fake.calls("POST /api/v3.1/tool_router/session ").len(), 2);
}

#[tokio::test]
async fn connected_apps_never_carry_what_a_connection_holds() {
    let mut named = account("ca_1", "gmail", "ACTIVE");
    named["state"]["val"]["displayName"] = json!("me@example.com");
    let fake = fake(vec![
        ("POST /api/v3.1/tool_router/session ", 201, json!({ "session_id": "s_session" })),
        ("GET /api/v3.1/tool_router/session/s_session/toolkits", 200, json!({ "items": [{ "slug": "gmail", "name": "Gmail" }] })),
        (
            "GET /api/v3.1/connected_accounts",
            200,
            json!({ "items": [
                named,
                account("ca_2", "slack", "EXPIRED"),
                { "id": "ca_old", "user_id": "misty_here", "status": "INITIATED", "created_at": "2020-01-01T00:00:00Z", "toolkit": { "slug": "notion" } },
                { "id": "ca_other", "user_id": "someone_else", "status": "ACTIVE", "toolkit": { "slug": "gmail" } },
            ] }),
        ),
    ])
    .await;
    let listed = apps::connected_apps(&client_of(&fake)).await.unwrap();
    let text = serde_json::to_string(&listed).unwrap();
    assert!(!text.contains("secret-token"));
    assert_eq!(
        listed
            .iter()
            .map(|app| (app.id.as_str(), app.status))
            .collect::<Vec<_>>(),
        vec![("ca_1", "active"), ("ca_2", "needs_attention")]
    );
    assert_eq!(listed[0].name, "Gmail");
    assert_eq!(listed[0].account, "me@example.com");
}

#[tokio::test]
async fn the_catalog_carries_each_apps_logo_when_it_is_https() {
    let fake = fake(vec![
        ("POST /api/v3.1/tool_router/session ", 201, json!({ "session_id": "s_session" })),
        (
            "GET /api/v3.1/tool_router/session/s_session/toolkits",
            200,
            json!({ "items": [
                { "slug": "gmail", "name": "Gmail", "meta": { "logo": "https://logos.composio.dev/api/gmail" } },
                { "slug": "odd", "name": "Odd", "meta": { "logo": "http://example.com/odd.png" } },
            ] }),
        ),
    ])
    .await;
    let (apps, _) = apps::catalog(&client_of(&fake), "", "").await.unwrap();
    assert_eq!(apps[0].logo, "https://logos.composio.dev/api/gmail");
    assert_eq!(apps[1].logo, "");
    let text = serde_json::to_string(&apps[1]).unwrap();
    assert!(!text.contains("logo"));
}

#[tokio::test]
async fn a_connect_card_finishes_once_the_app_has_an_account() {
    let empty = fake(vec![
        (
            "POST /api/v3.1/tool_router/session ",
            201,
            json!({ "session_id": "s_session" }),
        ),
        (
            "GET /api/v3.1/tool_router/session/s_session/toolkits",
            200,
            json!({ "items": [{ "slug": "gmail", "name": "Gmail" }] }),
        ),
        (
            "GET /api/v3.1/connected_accounts",
            200,
            json!({ "items": [] }),
        ),
    ])
    .await;
    let (_directory, store) = store();
    let tools::Connect::Card { name, request } =
        tools::connect(&client_of(&empty), &store, "run_1", "gmail")
            .await
            .unwrap()
    else {
        panic!("expected a card");
    };
    assert_eq!(name, "Gmail");
    assert_eq!(request.title, "Connect Gmail");
    assert_eq!(request.summary, "Sign in to Gmail so Misty can continue.");
    // Still pending while the app has no account, and without a key.
    let current = apps::current_request(&store, Some(&client_of(&empty)), &request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(current.state, "pending");
    assert_eq!(
        apps::current_request(&store, None, &request.id)
            .await
            .unwrap()
            .unwrap()
            .state,
        "pending"
    );
    let connected = fake(vec![(
        "GET /api/v3.1/connected_accounts",
        200,
        json!({ "items": [account("ca_1", "gmail", "ACTIVE")] }),
    )])
    .await;
    let current = apps::current_request(&store, Some(&client_of(&connected)), &request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(current.state, "connected");
    assert!(matches!(
        tools::connect(&client_of(&connected), &store, "run_2", "gmail")
            .await
            .unwrap(),
        tools::Connect::Connected
    ));
    // A Connect card can only be dismissed, never approved.
    let (_other, store) = self::store();
    let tools::Connect::Card { request, .. } =
        tools::connect(&client_of(&empty), &store, "r", "gmail")
            .await
            .unwrap()
    else {
        panic!("expected a card");
    };
    assert!(requests::decide(&store, &request.id, "continue").is_err());
    assert_eq!(
        requests::decide(&store, &request.id, "deny").unwrap().state,
        "declined"
    );
}

#[tokio::test]
async fn a_sign_in_link_stays_on_composio_and_no_key_says_plainly_to_use_the_web_page() {
    let outside = fake(vec![
        (
            "POST /api/v3.1/tool_router/session/s_session/link",
            201,
            json!({ "redirect_url": "https://evil.example/x" }),
        ),
        (
            "POST /api/v3.1/tool_router/session ",
            201,
            json!({ "session_id": "s_session" }),
        ),
    ])
    .await;
    let error = apps::sign_in_link(&client_of(&outside), "gmail")
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Api { status: 502, .. }));
    let failure = tools::failure(Error::Unavailable, true);
    assert_eq!(failure.code, "apps_not_connected");
    assert!(!failure.uncertain);
    assert!(failure.message.contains("Use the app's web page"));
}
