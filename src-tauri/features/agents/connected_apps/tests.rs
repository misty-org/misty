use serde_json::{json, Value};

use super::AccountStore as Store;
use super::{
    api::{valid_tool_slug, ToolInfo},
    policy,
    requests::{self, Draft},
    text::truncate,
};

const SEND: &str = "GMAIL_SEND_EMAIL";

pub(super) fn store() -> (tempfile::TempDir, Store) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::new(
        database::store::Store::at(directory.path().join("misty.db")),
        "a",
    );
    (directory, store)
}

#[test]
fn expired_cards_read_as_expired_and_cant_be_answered() {
    let (_directory, store) = store();
    let draft = Draft {
        run_id: "r".to_owned(),
        kind: "approve",
        subject: SEND.to_owned(),
        arguments_hash: "h".to_owned(),
        title: "t".to_owned(),
        summary: "s".to_owned(),
        permission_mode: "ask".to_owned(),
        grant: None,
    };
    let mut request = requests::open(&store, draft).unwrap();
    request.expires_at = 1;
    let connection = store.connect().unwrap();
    connection
        .execute(
            "UPDATE agent_chats SET document = ?1 WHERE kind = 'app_request'",
            [serde_json::to_string(&request).unwrap()],
        )
        .unwrap();
    assert_eq!(
        requests::get(&store, &request.id).unwrap().unwrap().state,
        "expired"
    );
    assert!(requests::decide(&store, &request.id, "continue").is_err());
}

#[test]
fn the_chat_commands_cant_write_an_approval() {
    let source = include_str!("../chats.rs");
    let kinds = source
        .lines()
        .find(|line| line.starts_with("const KINDS"))
        .unwrap();
    assert!(
        !kinds.contains("app_request") && !kinds.contains("app_grant"),
        "{kinds}"
    );
}

#[test]
fn classifies_tools_like_the_server() {
    let tags = |items: &[&str]| {
        items
            .iter()
            .map(|item| (*item).to_owned())
            .collect::<Vec<_>>()
    };
    for (slug, tagged, want) in [
        (
            "GMAIL_FETCH_EMAILS",
            tags(&["readOnlyHint"]),
            policy::Kind::Read,
        ),
        ("GMAIL_FETCH_EMAILS", tags(&[]), policy::Kind::Read),
        (
            "GMAIL_SEND_EMAIL",
            tags(&["createHint"]),
            policy::Kind::Consequential,
        ),
        ("GITHUB_DELETE_REPO", tags(&[]), policy::Kind::Destructive),
        (
            "NOTION_UPDATE_PAGE",
            tags(&["destructiveHint"]),
            policy::Kind::Destructive,
        ),
        (
            "NOTION_CREATE_PAGE",
            tags(&["createHint"]),
            policy::Kind::Write,
        ),
        (
            "GMAIL_GET_AND_SEND",
            tags(&["readOnlyHint"]),
            policy::Kind::Read,
        ),
        (
            "GMAIL_GET_THING",
            tags(&["updateHint"]),
            policy::Kind::Write,
        ),
        (
            "STRIPE_CREATE_REFUND",
            tags(&[]),
            policy::Kind::Consequential,
        ),
    ] {
        assert_eq!(policy::classify(slug, &tagged), want, "{slug}");
    }
}

#[test]
fn a_payment_is_remembered_only_with_a_cap_it_stays_under() {
    let info = ToolInfo {
        slug: "STRIPE_CREATE_PAYMENT_INTENT".to_owned(),
        name: "Create payment".to_owned(),
        tags: vec![],
        toolkit: super::api::ToolToolkit {
            slug: "stripe".to_owned(),
            name: "Stripe".to_owned(),
        },
    };
    let need = policy::grant_need(
        &info,
        &json!({ "amount": 1250, "currency": "usd" }),
        "ca_1",
        policy::Kind::Write,
    );
    assert_eq!(need.action, policy::ACTION_PAYMENT);
    assert_eq!(need.scope_id, "stripe");
    assert_eq!(need.label, "pay through Stripe up to 12.50 USD");
    assert!(need.rememberable());
    let cap = |amount: i64, currency: &str| policy::Amount {
        max_amount_minor: amount,
        currency: currency.to_owned(),
    };
    assert!(need.covered_by(Some(&cap(1250, "USD"))));
    assert!(!need.covered_by(Some(&cap(1000, "usd"))));
    assert!(!need.covered_by(Some(&cap(9000, "eur"))));
    assert!(!need.covered_by(None));
    let unknown = policy::grant_need(
        &info,
        &json!({ "amount": "soon" }),
        "ca_1",
        policy::Kind::Write,
    );
    assert!(!unknown.rememberable());
    assert_eq!(
        policy::decide("auto", &unknown, false),
        policy::Decision::Pause
    );
}

#[test]
fn an_approval_is_bound_to_exact_content_whatever_the_key_order() {
    let one = policy::arguments_hash(SEND, &json!({ "a": 1, "b": { "c": 2, "d": 3 } }), "ca_1");
    assert_eq!(
        one,
        policy::arguments_hash(SEND, &json!({ "b": { "d": 3, "c": 2 }, "a": 1 }), "ca_1")
    );
    assert_ne!(
        one,
        policy::arguments_hash(SEND, &json!({ "a": 1, "b": { "c": 2, "d": 4 } }), "ca_1")
    );
    assert_ne!(
        one,
        policy::arguments_hash(SEND, &json!({ "a": 1, "b": { "c": 2, "d": 3 } }), "ca_2")
    );
    assert_ne!(
        one,
        policy::arguments_hash(
            "GMAIL_REPLY",
            &json!({ "a": 1, "b": { "c": 2, "d": 3 } }),
            "ca_1"
        )
    );
}

#[test]
fn the_card_names_what_is_being_approved() {
    let info = ToolInfo {
        slug: SEND.to_owned(),
        name: "Send email".to_owned(),
        tags: vec![],
        toolkit: super::api::ToolToolkit {
            slug: "gmail".to_owned(),
            name: "Gmail".to_owned(),
        },
    };
    let (title, summary) =
        policy::action_summary(&info, &json!({ "to": "a@example.com", "count": 2 }), "ca_1")
            .unwrap();
    assert_eq!(title, "Send email in Gmail");
    assert_eq!(summary, "count: 2\nto: a@example.com\naccount: ca_1");
}

#[test]
fn a_card_shows_everything_or_refuses() {
    let info = ToolInfo {
        slug: SEND.to_owned(),
        name: "Send email".to_owned(),
        tags: vec![],
        toolkit: super::api::ToolToolkit {
            slug: "gmail".to_owned(),
            name: "Gmail".to_owned(),
        },
    };
    let body = "z".repeat(1_000);
    let mut many = serde_json::Map::new();
    for index in 0..30 {
        many.insert(format!("field{index}"), json!(body));
    }
    let (_, summary) = policy::action_summary(&info, &Value::Object(many), "").unwrap();
    assert!(summary.contains("field29") && summary.contains(&body));
    let too_long =
        json!({ "body": "z".repeat(crate::agents::run_control::tool_question::MAX_SHOWN + 1) });
    assert!(policy::action_summary(&info, &too_long, "").is_none());
}

#[test]
fn making_a_message_email_or_comment_is_a_send() {
    for slug in [
        "SLACK_CREATE_MESSAGE",
        "GITHUB_CREATE_ISSUE_COMMENT",
        "OUTLOOK_NEW_EMAIL",
        "TEAMS_ADD_MESSAGE",
    ] {
        assert_eq!(
            policy::classify(slug, &[]),
            policy::Kind::Consequential,
            "{slug}"
        );
    }
    assert_eq!(
        policy::classify("GMAIL_FETCH_EMAILS", &[]),
        policy::Kind::Read
    );
    assert_eq!(
        policy::classify("SLACK_GET_MESSAGE", &[]),
        policy::Kind::Read
    );
    assert_eq!(
        policy::classify("GMAIL_CREATE_EMAIL_DRAFT", &[]),
        policy::Kind::Write
    );
    assert_eq!(
        policy::classify("GMAIL_ADD_LABEL_TO_EMAIL", &[]),
        policy::Kind::Write
    );
    assert_eq!(
        policy::classify("NOTION_CREATE_PAGE", &[]),
        policy::Kind::Write
    );
}

#[test]
fn one_accounts_requests_and_approvals_are_not_anothers() {
    let directory = tempfile::tempdir().unwrap();
    let base = database::store::Store::at(directory.path().join("misty.db"));
    let (first, second) = (Store::new(base.clone(), "a"), Store::new(base.clone(), "b"));
    let draft = Draft {
        run_id: "r".to_owned(),
        kind: "approve",
        subject: SEND.to_owned(),
        arguments_hash: "h".to_owned(),
        title: "t".to_owned(),
        summary: "s".to_owned(),
        permission_mode: "ask".to_owned(),
        grant: None,
    };
    let request = requests::open(&first, draft).unwrap();
    assert!(requests::get(&first, &request.id).unwrap().is_some());
    assert!(requests::get(&second, &request.id).unwrap().is_none());
    assert_eq!(
        Store::new(base.clone(), super::SIGNED_OUT).account(),
        "this_computer"
    );
    assert_eq!(Store::new(base, "").account(), "this_computer");
}

#[test]
fn slugs_and_text_are_checked() {
    assert!(valid_tool_slug(SEND));
    assert!(!valid_tool_slug("gmail_send"));
    assert!(!valid_tool_slug("GMAIL/../SEND"));
    assert_eq!(truncate("héllo wörld", 6), "héllo…");
    assert_eq!(truncate("short", 6), "short");
}
