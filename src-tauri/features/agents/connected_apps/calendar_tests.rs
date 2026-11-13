use serde_json::{json, Value};

use super::{
    calendar,
    tests::{account, client_of, fake},
};

const FROM: &str = "2026-11-29T00:00:00-08:00";
const TO: &str = "2027-01-10T00:00:00-08:00";

fn rules(accounts: Value, execute: Value) -> Vec<(&'static str, u16, Value)> {
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
        ("GET /api/v3.1/connected_accounts", 200, accounts),
    ]
}

fn google() -> Value {
    json!({ "items": [account("ca_1", "googlecalendar", "ACTIVE")] })
}

#[tokio::test]
async fn reads_one_fixed_tool_for_the_range_as_the_connected_account() {
    let fake = fake(rules(
        google(),
        json!({ "result_type": "completed", "log_id": "l", "data": { "items": [
            { "id": "e1", "summary": " Standup ", "location": "Room 2", "htmlLink": "https://www.google.com/calendar/event?eid=1",
              "start": { "dateTime": "2026-12-01T09:00:00-08:00" }, "end": { "dateTime": "2026-12-01T09:30:00-08:00" } },
            { "id": "e2", "start": { "date": "2026-12-02" }, "end": { "date": "2026-12-03" }, "htmlLink": "javascript:alert(1)" },
            { "id": "e3", "status": "cancelled", "start": { "date": "2026-12-02" } },
            { "id": "e4", "summary": "No time" },
        ] } }),
    ))
    .await;
    let events = calendar::events(&client_of(&fake), FROM, TO).await.unwrap();
    assert_eq!(events.len(), 2, "canceled and timeless events are dropped");
    assert_eq!(events[0].id, "ca_1:e1");
    assert_eq!(events[0].title, "Standup");
    assert_eq!(events[0].location, "Room 2");
    assert_eq!(events[0].starts_at, "2026-12-01T09:00:00-08:00");
    assert!(events[0].url.starts_with("https://"));
    assert!(events[1].all_day);
    assert_eq!(events[1].day, "2026-12-02");
    assert_eq!(events[1].title, "Busy");
    assert_eq!(events[1].url, "", "only an https link is passed on");

    let ran = fake.calls("/execute");
    assert_eq!(ran.len(), 1);
    assert_eq!(ran[0].body["tool_slug"], "GOOGLECALENDAR_EVENTS_LIST");
    assert_eq!(ran[0].body["account"], "ca_1");
    assert_eq!(
        ran[0].body["arguments"],
        json!({
            "calendarId": "primary", "timeMin": FROM, "timeMax": TO,
            "singleEvents": true, "orderBy": "startTime", "maxResults": 250,
        })
    );
}

#[tokio::test]
async fn reads_an_answer_wrapped_as_text_or_under_response_data() {
    for data in [
        json!({ "response_data": { "items": [{ "id": "e", "start": { "date": "2026-12-02" } }] } }),
        json!("{\"items\":[{\"id\":\"e\",\"start\":{\"date\":\"2026-12-02\"}}]}"),
    ] {
        let fake = fake(rules(
            google(),
            json!({ "result_type": "completed", "log_id": "l", "data": data }),
        ))
        .await;
        let events = calendar::events(&client_of(&fake), FROM, TO).await.unwrap();
        assert_eq!(events.len(), 1);
    }
}

#[tokio::test]
async fn runs_nothing_without_a_connected_account_or_for_a_bad_range() {
    let none = fake(rules(
        json!({ "items": [account("ca_9", "googlecalendar", "EXPIRED")] }),
        json!({}),
    ))
    .await;
    assert!(calendar::events(&client_of(&none), FROM, TO)
        .await
        .unwrap()
        .is_empty());
    assert!(none.calls("/execute").is_empty());

    let connected = fake(rules(google(), json!({}))).await;
    for (from, to) in [
        (TO, FROM),
        ("yesterday", TO),
        ("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"),
    ] {
        let refused = calendar::events(&client_of(&connected), from, to)
            .await
            .unwrap_err();
        assert_eq!(refused.code, "invalid_request");
    }
    assert!(connected.lines().is_empty(), "a bad range reaches no one");
}

#[tokio::test]
async fn a_failed_read_is_an_error_and_not_an_empty_calendar() {
    let fake = fake(rules(
        google(),
        json!({ "result_type": "failed", "error": "token expired", "log_id": "l" }),
    ))
    .await;
    let refused = calendar::events(&client_of(&fake), FROM, TO)
        .await
        .unwrap_err();
    assert_eq!(refused.code, "apps_rejected");
}
