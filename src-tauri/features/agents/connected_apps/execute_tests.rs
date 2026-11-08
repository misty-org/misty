use serde_json::{json, Value};

use super::{
    execute::{self, ExecuteCall, Executed},
    grants, requests,
    tests::{account, client_of, fake, store},
    tools,
};

const SEND: &str = "GMAIL_SEND_EMAIL";

fn gmail_rules(execute: Value) -> Vec<(&'static str, u16, Value)> {
    vec![
        (
            "POST /api/v3.1/tool_router/session/s_session/execute",
            200,
            execute,
        ),
        (
            "POST /api/v3.1/tool_router/session ",
            201,
            json!({ "session_id": "s_session" }),
        ),
        (
            "GET /api/v3.1/tools/GMAIL_SEND_EMAIL",
            200,
            json!({ "slug": SEND, "name": "Send email", "tags": ["createHint"], "toolkit": { "slug": "gmail", "name": "Gmail" } }),
        ),
        (
            "GET /api/v3.1/tools/GMAIL_FETCH_EMAILS",
            200,
            json!({ "slug": "GMAIL_FETCH_EMAILS", "name": "Fetch", "tags": ["readOnlyHint"], "toolkit": { "slug": "gmail", "name": "Gmail" } }),
        ),
        (
            "GET /api/v3.1/connected_accounts",
            200,
            json!({ "items": [account("ca_1", "gmail", "ACTIVE")] }),
        ),
    ]
}

fn call(slug: &str, mode: &str) -> ExecuteCall {
    ExecuteCall {
        run_id: "run_1".to_owned(),
        tool_slug: slug.to_owned(),
        arguments: json!({ "to": "a@example.com", "subject": "Hi" }),
        account: String::new(),
        mode: mode.to_owned(),
    }
}

fn done(execution: Result<Executed, tools::Failure>) -> Value {
    match execution {
        Ok(Executed::Done { result }) => result,
        other => panic!("expected a result, got {other:?}"),
    }
}

fn waiting_id(execution: Result<Executed, tools::Failure>) -> String {
    match execution {
        Ok(Executed::Waiting { request, .. }) => request.id,
        other => panic!("expected a waiting card, got {other:?}"),
    }
}

#[tokio::test]
async fn opens_a_session_that_spends_nothing_and_sends_the_key_only_as_a_header() {
    let fake = fake(gmail_rules(
        json!({ "result_type": "completed", "data": { "ok": true }, "log_id": "log_1" }),
    ))
    .await;
    let client = client_of(&fake);
    let (_directory, store) = store();
    done(execute::execute(&client, &store, call("GMAIL_FETCH_EMAILS", "ask")).await);
    let created = &fake.calls("POST /api/v3.1/tool_router/session ")[0];
    assert_eq!(created.body["user_id"], "misty_here");
    assert_eq!(created.body["instant"], false);
    assert_eq!(created.body["manage_connections"]["enable"], false);
    assert_eq!(created.body["workbench"]["enable"], false);
    assert_eq!(created.body["multi_account"]["enable"], true);
    for heard in fake.heard.lock().unwrap().iter() {
        assert_eq!(heard.key, "ak_test");
        assert!(!heard.body.to_string().contains("ak_test"));
        assert!(!heard.line.contains("ak_test"));
    }
}

#[tokio::test]
async fn a_read_runs_freely_even_in_ask_and_names_the_account() {
    let fake = fake(gmail_rules(
        json!({ "result_type": "completed", "data": { "n": 1 }, "log_id": "log_1" }),
    ))
    .await;
    let client = client_of(&fake);
    let (_directory, store) = store();
    let result = done(execute::execute(&client, &store, call("GMAIL_FETCH_EMAILS", "ask")).await);
    assert_eq!(
        result,
        json!({ "tool": "GMAIL_FETCH_EMAILS", "log_id": "log_1", "data": { "n": 1 } })
    );
    assert_eq!(fake.calls("/execute")[0].body["account"], "ca_1");
}

#[tokio::test]
async fn a_send_waits_for_the_person_and_one_approval_covers_one_action() {
    let fake = fake(gmail_rules(
        json!({ "result_type": "completed", "data": {}, "log_id": "log_1" }),
    ))
    .await;
    let client = client_of(&fake);
    let (_directory, store) = store();
    let id = waiting_id(execute::execute(&client, &store, call(SEND, "ask")).await);
    assert!(
        fake.calls("/execute").is_empty(),
        "nothing ran before the answer"
    );
    // A new run asks with the same arguments: the same card, still nothing run.
    let mut later = call(SEND, "ask");
    later.run_id = "run_2".to_owned();
    assert_eq!(
        waiting_id(execute::execute(&client, &store, later).await),
        id
    );
    assert!(fake.calls("/execute").is_empty());

    assert!(requests::decide(&store, &id, "nonsense").is_err());
    assert_eq!(
        requests::decide(&store, &id, "continue").unwrap().state,
        "approved"
    );
    done(execute::execute(&client, &store, call(SEND, "ask")).await);
    assert_eq!(fake.calls("/execute").len(), 1);
    assert_eq!(requests::get(&store, &id).unwrap().unwrap().state, "used");

    // Used up, so the same action asks again.
    let next = waiting_id(execute::execute(&client, &store, call(SEND, "ask")).await);
    assert_ne!(next, id);
    assert_eq!(fake.calls("/execute").len(), 1);
}

#[tokio::test]
async fn an_approval_covers_only_its_exact_arguments() {
    let fake = fake(gmail_rules(
        json!({ "result_type": "completed", "data": {}, "log_id": "l" }),
    ))
    .await;
    let client = client_of(&fake);
    let (_directory, store) = store();
    let id = waiting_id(execute::execute(&client, &store, call(SEND, "ask")).await);
    requests::decide(&store, &id, "continue").unwrap();
    let mut changed = call(SEND, "ask");
    changed.arguments = json!({ "to": "someone-else@example.com", "subject": "Hi" });
    let other = waiting_id(execute::execute(&client, &store, changed).await);
    assert_ne!(other, id);
    assert!(fake.calls("/execute").is_empty());
}

#[tokio::test]
async fn a_decline_is_the_answer_for_a_while() {
    let fake = fake(gmail_rules(json!({}))).await;
    let client = client_of(&fake);
    let (_directory, store) = store();
    let id = waiting_id(execute::execute(&client, &store, call(SEND, "ask")).await);
    requests::decide(&store, &id, "deny").unwrap();
    let refused = execute::execute(&client, &store, call(SEND, "ask"))
        .await
        .unwrap_err();
    assert_eq!(refused.code, "declined");
    assert!(refused
        .message
        .starts_with("The user declined “Gmail · Send email”"));
    assert!(fake.calls("/execute").is_empty());
}

#[tokio::test]
async fn auto_needs_a_remembered_approval_for_a_send_and_revoking_applies_next_time() {
    let fake = fake(gmail_rules(
        json!({ "result_type": "completed", "data": {}, "log_id": "l" }),
    ))
    .await;
    let client = client_of(&fake);
    let (_directory, store) = store();
    let id = waiting_id(execute::execute(&client, &store, call(SEND, "auto")).await);
    let answered = requests::decide(&store, &id, "remember").unwrap();
    assert_eq!(
        answered.view().remember_label.as_deref(),
        Some("act in Gmail (ca_1)")
    );
    done(execute::execute(&client, &store, call(SEND, "auto")).await);
    assert_eq!(fake.calls("/execute").len(), 1);
    // The remembered approval ran it, so its card is used up.
    assert_eq!(requests::get(&store, &id).unwrap().unwrap().state, "used");

    // A different message now runs too, since the grant names the account and not the arguments.
    let mut other = call(SEND, "auto");
    other.arguments = json!({ "to": "b@example.com" });
    done(execute::execute(&client, &store, other).await);
    assert_eq!(fake.calls("/execute").len(), 2);
    let saved = grants::grants(&store).unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].use_count, 2);

    // Ask ignores what was remembered.
    waiting_id(execute::execute(&client, &store, call(SEND, "ask")).await);

    grants::revoke_grants(&store, Some(&saved[0].id)).unwrap();
    let mut after = call(SEND, "auto");
    after.arguments = json!({ "to": "c@example.com" });
    waiting_id(execute::execute(&client, &store, after).await);
    assert_eq!(fake.calls("/execute").len(), 2);
}

#[tokio::test]
async fn a_smaller_write_pauses_only_in_ask() {
    let mut rules = gmail_rules(json!({ "result_type": "completed", "data": {}, "log_id": "l" }));
    rules.insert(
        0,
        (
            "GET /api/v3.1/tools/GMAIL_CREATE_LABEL",
            200,
            json!({ "slug": "GMAIL_CREATE_LABEL", "name": "Create label", "tags": ["createHint"], "toolkit": { "slug": "gmail", "name": "Gmail" } }),
        ),
    );
    let fake = fake(rules).await;
    let client = client_of(&fake);
    let (_directory, store) = store();
    waiting_id(execute::execute(&client, &store, call("GMAIL_CREATE_LABEL", "ask")).await);
    assert!(fake.calls("/execute").is_empty());
    done(execute::execute(&client, &store, call("GMAIL_CREATE_LABEL", "auto")).await);
    assert_eq!(fake.calls("/execute").len(), 1);
    // A mode nobody knows is Ask.
    waiting_id(execute::execute(&client, &store, call("GMAIL_CREATE_LABEL", "whatever")).await);
}

#[tokio::test]
async fn an_account_is_named_or_the_model_is_told_how_to_name_one() {
    let mut rules = gmail_rules(json!({ "result_type": "completed", "data": {}, "log_id": "l" }));
    rules.retain(|(text, _, _)| !text.contains("connected_accounts"));
    rules.push((
        "GET /api/v3.1/connected_accounts",
        200,
        json!({ "items": [account("ca_1", "gmail", "ACTIVE"), account("ca_2", "gmail", "ACTIVE"), account("ca_3", "slack", "ACTIVE")] }),
    ));
    let fake = fake(rules).await;
    let client = client_of(&fake);
    let (_directory, store) = store();
    let several = execute::execute(&client, &store, call("GMAIL_FETCH_EMAILS", "ask"))
        .await
        .unwrap_err();
    assert_eq!(
        several.message,
        "The user has several gmail accounts. Pass account as one of: ca_1, ca_2."
    );
    let mut other = call("GMAIL_FETCH_EMAILS", "ask");
    other.account = "ca_3".to_owned();
    let refused = execute::execute(&client, &store, other).await.unwrap_err();
    assert!(refused
        .message
        .starts_with("That gmail account isn't one of the user's."));
    assert!(fake.calls("/execute").is_empty());
    let mut named = call("GMAIL_FETCH_EMAILS", "ask");
    named.account = "ca_2".to_owned();
    done(execute::execute(&client, &store, named).await);
    assert_eq!(fake.calls("/execute")[0].body["account"], "ca_2");
}

#[tokio::test]
async fn an_app_not_connected_says_to_connect_it() {
    let mut rules = gmail_rules(json!({}));
    rules.retain(|(text, _, _)| !text.contains("connected_accounts"));
    rules.push((
        "GET /api/v3.1/connected_accounts",
        200,
        json!({ "items": [] }),
    ));
    let fake = fake(rules).await;
    let (_directory, store) = store();
    let refused = execute::execute(&client_of(&fake), &store, call(SEND, "auto"))
        .await
        .unwrap_err();
    assert_eq!(
        refused.message,
        "The user has not connected gmail. Call integration_connect with app gmail first."
    );
}

#[tokio::test]
async fn what_composio_answered_decides_whether_a_write_is_uncertain() {
    // A refusal had no effect, so the model may correct it.
    let mut rules =
        gmail_rules(json!({ "error": { "message": "Bad to field.", "request_id": "r1" } }));
    rules[0].1 = 400;
    let refusing = fake(rules).await;
    let (_directory, store1) = store();
    let client = client_of(&refusing);
    let id = waiting_id(execute::execute(&client, &store1, call(SEND, "ask")).await);
    requests::decide(&store1, &id, "continue").unwrap();
    let refused = execute::execute(&client, &store1, call(SEND, "ask"))
        .await
        .unwrap_err();
    assert!(!refused.uncertain);
    assert_eq!(refused.message, "Bad to field. (request r1)");

    // A server error may have run.
    let mut rules = gmail_rules(json!({ "error": { "message": "Boom" } }));
    rules[0].1 = 500;
    let broken = fake(rules).await;
    let (_directory, store2) = store();
    let client = client_of(&broken);
    let id = waiting_id(execute::execute(&client, &store2, call(SEND, "ask")).await);
    requests::decide(&store2, &id, "continue").unwrap();
    let failed = execute::execute(&client, &store2, call(SEND, "ask"))
        .await
        .unwrap_err();
    assert!(failed.uncertain);

    // The same on a read just means try again.
    let failed = execute::execute(&client, &store2, call("GMAIL_FETCH_EMAILS", "ask"))
        .await
        .unwrap_err();
    assert!(!failed.uncertain);
    assert_eq!(failed.code, "apps_unreachable");
}

#[tokio::test]
async fn composio_blocks_and_failures_are_refusals_with_their_log() {
    for (body, want) in [
        (
            json!({ "result_type": "failed", "data": {}, "error": "Label exists", "log_id": "log_9" }),
            "Label exists (log log_9)",
        ),
        (
            json!({ "result_type": "failed", "data": {}, "error": null, "log_id": "log_9" }),
            "The app reported that this failed. (log log_9)",
        ),
        (
            json!({ "result_type": "blocked", "message": "A hook stopped it", "log_id": "log_9", "reason": {} }),
            "A hook stopped it (log log_9)",
        ),
        (
            json!({ "result_type": "input_required", "input_requests": {} }),
            "This tool asked for more input than Misty can give it. Try another tool.",
        ),
    ] {
        let fake = fake(gmail_rules(body)).await;
        let (_directory, store) = store();
        let refused =
            execute::execute(&client_of(&fake), &store, call("GMAIL_FETCH_EMAILS", "ask"))
                .await
                .unwrap_err();
        assert_eq!(refused.message, want);
        assert!(!refused.uncertain);
    }
}

#[tokio::test]
async fn a_large_result_comes_back_as_a_preview() {
    let big = "x".repeat(60 * 1024);
    let fake = fake(gmail_rules(
        json!({ "result_type": "completed", "data": { "text": big }, "log_id": "l" }),
    ))
    .await;
    let (_directory, store) = store();
    let result =
        done(execute::execute(&client_of(&fake), &store, call("GMAIL_FETCH_EMAILS", "ask")).await);
    assert!(result.get("data").is_none());
    assert!(result["data_preview"].as_str().unwrap().ends_with('…'));
    assert!(result["note"]
        .as_str()
        .unwrap()
        .contains("Narrow the request"));
}
